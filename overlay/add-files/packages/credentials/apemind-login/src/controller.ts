import { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { CliError, CliProcess } from './cli-process.ts'
import type {
  AccountState, AccountView, CredentialStatus, LoginProgress, OAuthAccountView,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { authorizationController: AuthorizationController }
}

type CliConnection = {
  id: string
  server: string
  user_id: string
  username: string
  kind: 'oauth' | 'api-key'
  verified_at: string
  credential_storage?: string
}
type ConnectionList = { current: string | null; items: CliConnection[] }
type Status = {
  logged_in: boolean
  connection: CliConnection | null
  credential_available?: boolean
  credential_error?: string
}

/** The Desktop UI is a presentation layer over the same CLI used by agents. */
export class AuthorizationController extends TypertRemoteService {
  private readonly cli = new CliProcess()
  private cliVersion: string | null = null
  private loginAbort: AbortController | undefined
  private loginProgress: LoginProgress | null = null

  constructor(ctx: Context) { super(ctx, 'authorizationController', { namespace: 'apemindAuth' }) }

  private async run<T>(args: string[], options: Parameters<CliProcess['run']>[1] = {}): Promise<T> {
    try { return await this.cli.run<T>(args, options) } catch (error) {
      if (error instanceof CliError) {
        const code = error.code === 'cancelled' ? 'gateway/cancelled' : 'gateway/bad-request'
        throw new RemoteError(code, error.message, { cliCode: error.code, exitCode: error.exitCode })
      }
      throw new RemoteError('gateway/bad-request', '本地 ApeMind 操作失败，请重试。', {})
    }
  }

  private view(connection: CliConnection): AccountView {
    return {
      id: connection.id, origin: connection.server, userId: connection.user_id, username: connection.username,
      verifiedAt: connection.verified_at,
    }
  }

  private oauthView(connection: CliConnection): OAuthAccountView {
    return {
      id: connection.id, origin: connection.server, userId: connection.user_id, username: connection.username,
      verifiedAt: connection.verified_at,
    }
  }

  private async version(): Promise<string | null> {
    if (this.cliVersion) return this.cliVersion
    try {
      const version = await this.cli.text(['--version'])
      if (/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
        this.cliVersion = version
      }
    } catch { /* A version lookup must not hide the account state. */ }
    return this.cliVersion
  }

  private credentialStatus(status: Status): CredentialStatus | null {
    if (!status.connection) return null
    const available = status.credential_available ?? status.logged_in
    const error = status.credential_error === 'reauthentication_required'
      ? 'reauthentication_required'
      : !available || status.credential_error ? 'credential_unavailable' : null
    const storage = status.connection.credential_storage
    return {
      connectionId: status.connection.id,
      available: available && !error,
      error,
      storage: storage === 'system' || storage === 'encrypted-file' ? storage : null,
    }
  }

  private async snapshot(): Promise<{ list: ConnectionList; status: Status }> {
    const list = await this.run<ConnectionList>(['connection', 'list'])
    const status = list.current
      ? await this.run<Status>(['auth', 'status', '--connection', list.current])
      : { logged_in: false, connection: null }
    return { list, status }
  }

  private async connection(id: string, kind: CliConnection['kind']): Promise<CliConnection> {
    if (!id) throw new RemoteError('gateway/bad-request', '请选择 ApeMind 连接。', {})
    const status = await this.run<Status>(['auth', 'status', '--connection', id])
    if (!status.logged_in || !status.connection || status.connection.id !== id || status.connection.kind !== kind) {
      throw new RemoteError('gateway/bad-request', '此连接已不可用，请重新登录或选择连接。', {})
    }
    return status.connection
  }

  @Remote
  async state(): Promise<AccountState> {
    const { list, status } = await this.snapshot()
    const connections = list.items.filter(item => item.kind === 'api-key').map(item => this.view(item))
    const credentialStatus = this.credentialStatus(status)
    const active = status.logged_in && credentialStatus?.available ? status.connection : null
    return {
      activeId: active?.kind === 'api-key' ? active.id : null,
      connections,
      oauthConnections: list.items.filter(item => item.kind === 'oauth').map(item => this.oauthView(item)),
      oauth: active?.kind === 'oauth' ? this.oauthView(active) : null,
      cliVersion: await this.version(),
      credentialStatus,
      browserLoginPending: Boolean(this.loginAbort),
      loginProgress: this.loginProgress,
    }
  }

  @Remote
  async oauthState(): Promise<OAuthAccountView | null> {
    const { status } = await this.snapshot()
    return status.logged_in && status.connection?.kind === 'oauth' ? this.oauthView(status.connection) : null
  }

  private async login(device: boolean, origin: string, connectionId?: string): Promise<OAuthAccountView> {
    if (this.loginAbort) throw new RemoteError('gateway/bad-request', '登录已经在进行中。', {})
    const controller = new AbortController(); this.loginAbort = controller
    try {
      const args = ['auth', 'login', '--server', origin]
      if (connectionId) args.push('--connection', connectionId)
      if (device) args.push('--device')
      this.loginProgress = null
      const connection = await this.run<CliConnection>(args, {
        signal: controller.signal,
        timeoutMs: 15 * 60 * 1000,
        onEvent: event => {
          if (event.type !== 'browser_opened' && event.type !== 'device_code' && event.type !== 'device_fallback') return
          const data = event.data as Record<string, unknown> | undefined
          const progress: LoginProgress = { type: event.type }
          if (typeof data?.verification_uri === 'string') progress.verificationUri = data.verification_uri
          if (typeof data?.verification_uri_complete === 'string') progress.verificationUriComplete = data.verification_uri_complete
          if (typeof data?.user_code === 'string') progress.userCode = data.user_code
          if (typeof data?.reason === 'string') progress.reason = data.reason
          this.loginProgress = progress
        },
      })
      return this.oauthView(connection)
    } finally {
      if (this.loginAbort === controller) this.loginAbort = undefined
      this.loginProgress = null
    }
  }

  @Remote async startBrowserLogin(origin: string, connectionId?: string): Promise<OAuthAccountView> {
    return this.login(false, origin, connectionId)
  }
  @Remote async startDeviceLogin(origin: string): Promise<OAuthAccountView> {
    return this.login(true, origin)
  }
  @Remote async cancelBrowserLogin(): Promise<void> { this.loginAbort?.abort() }

  @Remote
  async openDevicePage(): Promise<void> {
    const signal = this.loginAbort?.signal
    const progress = this.loginProgress
    const address = progress?.verificationUriComplete || progress?.verificationUri
    if (!signal || signal.aborted || progress?.type !== 'device_code' || !address) {
      throw new RemoteError('gateway/bad-request', '设备码登录已结束，请重新开始登录。', {})
    }
    const url = new URL(address)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new RemoteError('gateway/bad-request', '授权页面地址不可用，请重新开始登录。', {})
    }
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open'
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url.href] : [url.href]
    try {
      await promisify(execFile)(command, args, { signal, timeout: 20_000, windowsHide: true })
    } catch {
      throw new RemoteError('gateway/bad-request', '无法打开系统浏览器，请复制授权地址后手动打开。', {})
    }
  }

  @Remote async oauthLogout(connectionId: string): Promise<void> {
    await this.connection(connectionId, 'oauth')
    await this.run(['auth', 'logout', '--connection', connectionId])
  }

  @Remote
  async connect(origin: string, apiKey: string): Promise<AccountState> {
    if (!apiKey.trim()) throw new RemoteError('gateway/bad-request', '请输入 API Key。', {})
    await this.run<CliConnection>(['auth', 'connect', '--server', origin, '--api-key-stdin'], { input: apiKey })
    return this.state()
  }

  @Remote async select(id: string): Promise<AccountState> {
    await this.run(['connection', 'use', id])
    return this.state()
  }

  @Remote async disconnect(id: string): Promise<AccountState> {
    // `auth logout --connection` exists in every bundled CLI; `connection remove` is being retired.
    await this.run(['auth', 'logout', '--connection', id])
    return this.state()
  }
}

export default AuthorizationController

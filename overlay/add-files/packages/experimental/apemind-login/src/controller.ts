import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { CliError, CliProcess } from './cli-process.ts'
import type { AccountState, AccountView, KnowledgeBaseView, KnowledgePage, LoginProgress, OAuthAccountView, WorkspaceView } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { authorizationController: AuthorizationController }
}

type CliConnection = {
  id: string
  server: string
  user_id: string
  username: string
  kind: 'oauth' | 'api-key'
  workspace_id: string
  workspaces: WorkspaceView[]
  verified_at: string
  role?: string | null
  permissions?: string[]
  workspace_name?: string
}
type ConnectionList = { current: string; items: CliConnection[] }
type Status = { logged_in: boolean; connection: CliConnection | null }
type WorkspaceResult = { items: WorkspaceView[]; next_cursor: string | null }
type KnowledgeResult = { items: KnowledgeBaseView[]; next_cursor: string | null }

/** The Desktop UI is a presentation layer over the same CLI used by agents. */
export class AuthorizationController extends TypertRemoteService {
  private readonly cli = new CliProcess()
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
    const active = connection.workspaces?.find(item => item.id === connection.workspace_id)
    return {
      id: connection.id, origin: connection.server, userId: connection.user_id, username: connection.username,
      workspaceName: active?.name ?? connection.workspace_name ?? 'ApeMind',
      orgId: active?.type === 'organization' ? active.id : null,
      role: active?.role ?? connection.role ?? null, permissions: active?.permissions ?? connection.permissions ?? [],
      verifiedAt: connection.verified_at,
    }
  }

  private oauthView(connection: CliConnection): OAuthAccountView {
    return { id: connection.id, origin: connection.server, userId: connection.user_id, username: connection.username,
      verifiedAt: connection.verified_at, activeWorkspaceId: connection.workspace_id || null,
      workspaces: connection.workspaces ?? [] }
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

  private async knowledge(connectionId: string, workspaceId: string, cursor?: string): Promise<KnowledgePage> {
    if (!workspaceId) throw new RemoteError('gateway/bad-request', '请选择工作空间。', {})
    const args = ['knowledge', 'list', '--connection', connectionId, '--workspace', workspaceId, '--limit', '20']
    if (cursor) args.push('--cursor', cursor)
    const result = await this.run<KnowledgeResult>(args)
    return { items: result.items, nextCursor: result.next_cursor }
  }

  @Remote
  async state(): Promise<AccountState> {
    const { list, status } = await this.snapshot()
    const connections = list.items.filter(item => item.kind === 'api-key').map(item => this.view(item))
    const active = status.logged_in && status.connection ? status.connection : null
    return { activeId: active?.kind === 'api-key' ? active.id : null, connections,
      oauthConnections: list.items.filter(item => item.kind === 'oauth').map(item => this.oauthView(item)),
      oauth: active?.kind === 'oauth' ? this.oauthView(active) : null,
      browserLoginPending: Boolean(this.loginAbort), loginProgress: this.loginProgress }
  }

  @Remote
  async oauthState(): Promise<OAuthAccountView | null> {
    const { status } = await this.snapshot()
    return status.logged_in && status.connection?.kind === 'oauth' ? this.oauthView(status.connection) : null
  }

  private async login(device: boolean, origin: string): Promise<OAuthAccountView> {
    if (this.loginAbort) throw new RemoteError('gateway/bad-request', '登录已经在进行中。', {})
    const controller = new AbortController(); this.loginAbort = controller
    try {
      const args = ['auth', 'login', '--server', origin]; if (device) args.push('--device')
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

  @Remote async startBrowserLogin(origin: string): Promise<OAuthAccountView> { return this.login(false, origin) }
  @Remote async startDeviceLogin(origin: string): Promise<OAuthAccountView> { return this.login(true, origin) }
  @Remote async cancelBrowserLogin(): Promise<void> { this.loginAbort?.abort() }

  @Remote
  async refreshWorkspaces(connectionId: string): Promise<OAuthAccountView> {
    await this.connection(connectionId, 'oauth')
    await this.run<WorkspaceResult>(['workspace', 'list', '--connection', connectionId])
    return this.oauthView(await this.connection(connectionId, 'oauth'))
  }

  @Remote
  async selectWorkspace(connectionId: string, id: string): Promise<OAuthAccountView> {
    await this.connection(connectionId, 'oauth')
    const next = await this.run<CliConnection>(['workspace', 'use', id, '--connection', connectionId])
    return this.oauthView(next)
  }

  @Remote
  async oauthCollections(connectionId: string, workspaceId: string, cursor?: string): Promise<KnowledgePage & { workspace: WorkspaceView }> {
    const current = await this.connection(connectionId, 'oauth')
    const workspace = current.workspaces.find(item => item.id === workspaceId)
    if (!workspace) throw new RemoteError('gateway/bad-request', '当前工作空间不可用。', {})
    return { workspace, ...await this.knowledge(connectionId, workspaceId, cursor) }
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
  @Remote async select(id: string): Promise<AccountState> { await this.run(['connection', 'use', id]); return this.state() }
  @Remote async disconnect(id: string): Promise<AccountState> { await this.run(['connection', 'remove', id]); return this.state() }

  @Remote
  async collections(connectionId: string, cursor?: string): Promise<KnowledgePage & { account: AccountView }> {
    const connection = await this.connection(connectionId, 'api-key')
    return { account: this.view(connection), ...await this.knowledge(connectionId, connection.workspace_id, cursor) }
  }
}

export default AuthorizationController

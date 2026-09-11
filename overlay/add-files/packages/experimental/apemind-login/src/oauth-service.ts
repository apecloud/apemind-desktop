import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { AccountError, ApeMindClient, normalizeOrigin } from './api-client.ts'
import type { OAuthAccountView, WorkspaceView } from './types.ts'

interface StoredOAuth extends OAuthAccountView { refreshToken: string }
interface OAuthStore { read(): Promise<StoredOAuth | undefined>; write(value: StoredOAuth | undefined): Promise<void> }

function base64url(value: Buffer): string { return value.toString('base64url') }
function challenge(verifier: string): string { return base64url(createHash('sha256').update(verifier).digest()) }

export class OAuthService {
  private accessToken: string | undefined
  private accessExpiresAt = 0
  constructor(private readonly store: OAuthStore, private readonly client = new ApeMindClient()) {}

  async state(): Promise<OAuthAccountView | null> {
    const stored = await this.store.read()
    return stored ? this.publicView(stored) : null
  }

  async login(origin: string): Promise<OAuthAccountView> {
    const normalized = normalizeOrigin(origin)
    const verifier = base64url(randomBytes(32))
    const state = base64url(randomBytes(24))
    const server = createServer()
    const callback = new Promise<{ code: string }>((resolve, reject) => {
      const timer = setTimeout(() => { server.close(); reject(new AccountError('oauth_timeout', '浏览器登录等待超时，请重试。')) }, 300_000)
      server.on('request', (request, response) => {
        try {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1')
          if (url.pathname !== '/callback') return
          if (url.searchParams.get('state') !== state) throw new AccountError('oauth_state', '登录回调校验失败，请重试。')
          const code = url.searchParams.get('code')
          if (!code) throw new AccountError('oauth', '浏览器登录未完成，请重试。')
          clearTimeout(timer)
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end('<h2>登录成功</h2><p>可以返回 ApeMind Desktop。</p>')
          server.close()
          resolve({ code })
        } catch (error) {
          clearTimeout(timer)
          server.close()
          response.writeHead(400)
          response.end('Login failed')
          reject(error instanceof Error ? error : new Error('Login callback failed'))
        }
      })
      server.on('error', reject)
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const port = (server.address() as AddressInfo).port
    const redirectUri = `http://127.0.0.1:${String(port)}/callback`
    const authorization = new URL(`${normalized}/api/v2/auth/desktop/authorize`)
    authorization.search = new URLSearchParams({
      response_type: 'code', client_id: 'apemind-desktop', redirect_uri: redirectUri,
      code_challenge: challenge(verifier), code_challenge_method: 'S256', state,
      scope: 'openid profile workspace.read collection.read',
    }).toString()
    await new Promise<void>((resolve, reject) => {
      const command = process.platform === 'win32' ? 'cmd' : 'open'
      const args = process.platform === 'win32' ? ['/c', 'start', authorization.toString()] : [authorization.toString()]
      execFile(command, args, (error) => {
        if (error) reject(new AccountError('browser', '无法打开系统浏览器，请复制登录地址后重试。'))
        else resolve()
      })
    })
    const { code } = await callback
    const tokens = await this.client.exchangeCode(normalized, code, verifier, redirectUri)
    this.accessToken = tokens.access_token; this.accessExpiresAt = Date.now() + tokens.expires_in * 1000
    const [account, workspaces] = await Promise.all([
      this.client.oauthUser(normalized, this.accessToken),
      this.client.workspaces(normalized, this.accessToken),
    ])
    const selected = workspaces.items.find(item => item.type === 'personal') ?? workspaces.items[0]
    const stored: StoredOAuth = {
      origin: normalized, userId: account.id, username: account.username,
      verifiedAt: new Date().toISOString(), activeWorkspaceId: selected?.id ?? null,
      workspaces: workspaces.items.map(item => ({ ...item, role: item.role ?? null })), refreshToken: tokens.refresh_token,
    }
    await this.store.write(stored)
    return this.publicView(stored)
  }

  async select(workspaceId: string): Promise<OAuthAccountView> {
    const stored = await this.store.read()
    if (!stored || !stored.workspaces.some(item => item.id === workspaceId && item.status === 'active')) throw new AccountError('workspace', '工作空间不可用，请刷新后重试。')
    stored.activeWorkspaceId = workspaceId; await this.store.write(stored); return this.publicView(stored)
  }

  async collections(): Promise<{ workspace: WorkspaceView; items: Awaited<ReturnType<ApeMindClient['oauthCollections']>> }> {
    const stored = await this.store.read(); if (!stored || !stored.activeWorkspaceId) throw new AccountError('missing', '请先登录 ApeMind。')
    if (!this.accessToken || Date.now() + 30_000 >= this.accessExpiresAt) {
      const tokens = await this.client.refresh(stored.origin, stored.refreshToken)
      this.accessToken = tokens.access_token
      this.accessExpiresAt = Date.now() + tokens.expires_in * 1000
      stored.refreshToken = tokens.refresh_token
      await this.store.write(stored)
    }
    const workspace = stored.workspaces.find(item => item.id === stored.activeWorkspaceId)
    if (!workspace) throw new AccountError('workspace', '当前工作空间不可用，请刷新后重试。')
    return { workspace, items: await this.client.oauthCollections(stored.origin, this.accessToken, workspace.id) }
  }

  async logout(): Promise<void> {
    const stored = await this.store.read()
    if (stored) await this.client.revoke(stored.origin, stored.refreshToken)
    this.accessToken = undefined
    this.accessExpiresAt = 0
    await this.store.write(undefined)
  }
  private publicView({ refreshToken: _refresh, ...view }: StoredOAuth): OAuthAccountView { return view }
}

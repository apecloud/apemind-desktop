import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { AccountError, ApeMindClient, normalizeOrigin } from './api-client.ts'
import type { OAuthAccountView, WorkspaceView } from './types.ts'

const workspaceSchema = z.object({
  id: z.string().min(1), type: z.enum(['personal', 'organization']), name: z.string(),
  status: z.string(), role: z.string().nullable(), permissions: z.array(z.string()),
})
const storedSchema = z.object({
  origin: z.string(), userId: z.string().min(1), username: z.string(), verifiedAt: z.string(),
  activeWorkspaceId: z.string().nullable(), workspaces: z.array(workspaceSchema), refreshToken: z.string().min(1),
}).strict()
type StoredOAuth = z.infer<typeof storedSchema>
export interface OAuthStore {
  read(): Promise<unknown>
  write(value: StoredOAuth | undefined, expected: StoredOAuth | undefined): Promise<void>
}
type BrowserLauncher = (url: string) => Promise<void>

function openBrowser(url: string): Promise<void> {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) reject(new AccountError('browser', '无法打开系统浏览器，请检查默认浏览器设置后重试。'))
      else resolve()
    })
  })
}

/** One Host owns mutation ordering; the store also compares snapshots across Hosts. */
export class OAuthService {
  private pending: Promise<unknown> = Promise.resolve()
  private loginAttempt: AbortController | undefined
  private access: { token: string; expiresAt: number; refreshToken: string; origin: string } | undefined
  constructor(private readonly store: OAuthStore, private readonly client = new ApeMindClient(),
    private readonly launch: BrowserLauncher = openBrowser, private readonly timeoutMs = 300_000) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.catch(() => undefined)
    return result
  }
  private async read(): Promise<StoredOAuth | undefined> {
    const value = await this.store.read()
    if (value === undefined) return undefined
    const parsed = storedSchema.safeParse(value)
    if (!parsed.success || normalizeOrigin(parsed.data.origin) !== parsed.data.origin) {
      throw new AccountError('storage', '本地登录记录格式不正确，请联系支持人员。')
    }
    return parsed.data
  }
  async state(): Promise<OAuthAccountView | null> {
    const stored = await this.read()
    return stored ? this.publicView(stored) : null
  }
  isLoggingIn(): boolean { return this.loginAttempt !== undefined }
  cancelLogin(): void { this.loginAttempt?.abort() }

  login(origin: string): Promise<OAuthAccountView> {
    if (this.loginAttempt) return Promise.reject(new AccountError('busy', '浏览器登录正在进行。'))
    const attempt = new AbortController()
    this.loginAttempt = attempt
    return this.serial(async () => {
      const signal = attempt.signal
      const checkCancelled = (): void => {
        if (signal.aborted) throw new AccountError('cancelled', '已取消浏览器登录。')
      }
      checkCancelled()
      if (await this.read()) throw new AccountError('connected', '请先退出当前账户，再登录其他账户。')
      const normalized = normalizeOrigin(origin)
      const verifier = randomBytes(32).toString('base64url')
      const state = randomBytes(24).toString('base64url')
      const server = createServer()
      let complete: ((success: boolean) => void) | undefined
      let rejectCallback: (error: Error) => void = () => undefined
      let claimed = false
      const callback = new Promise<string>((resolve, reject) => {
        rejectCallback = reject
        server.on('request', (request, response) => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1')
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('Referrer-Policy', 'no-referrer')
          if (request.method !== 'GET' || url.pathname !== '/callback') {
            response.writeHead(404); response.end('Not found'); return
          }
          if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state || claimed) {
            response.writeHead(400); response.end('Invalid callback'); return
          }
          claimed = true
          complete = (success) => {
            response.writeHead(success ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
            response.end(success ? '<!doctype html><meta charset="utf-8"><h2>已连接 ApeMind</h2><p>可以返回 ApeMind Desktop。</p>' : '<!doctype html><meta charset="utf-8"><h2>登录未完成</h2><p>请返回 ApeMind Desktop 重试。</p>')
          }
          const code = url.searchParams.get('code')
          if (url.searchParams.has('error') || !code || url.searchParams.getAll('code').length !== 1) {
            reject(new AccountError('cancelled', '浏览器授权已取消或未完成。')); return
          }
          resolve(code)
        })
        server.on('error', () => { reject(new AccountError('callback', '无法启动本机登录回调，请重试。')) })
      })
      // A launcher can fail before we await the callback.
      void callback.catch(() => undefined)
      const abort = (): void => { rejectCallback(new AccountError('cancelled', '已取消浏览器登录。')) }
      signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => { rejectCallback(new AccountError('oauth_timeout', '浏览器登录等待超时，请重试。')) }, this.timeoutMs)
      let issuedRefresh: string | undefined
      let saved = false
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', resolve)
        })
        checkCancelled()
        const redirectUri = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/callback`
        const authorization = new URL(`${normalized}/api/v2/auth/desktop/authorize`)
        authorization.search = new URLSearchParams({
          response_type: 'code', client_id: 'apemind-desktop', redirect_uri: redirectUri,
          code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state,
          scope: 'profile workspace.read collection.read',
        }).toString()
        await this.launch(authorization.toString())
        const code = await callback
        checkCancelled()
        const tokens = await this.client.exchangeCode(normalized, code, verifier, redirectUri)
        issuedRefresh = tokens.refresh_token
        checkCancelled()
        const [account, workspaces] = await Promise.all([
          this.client.oauthUser(normalized, tokens.access_token), this.client.workspaces(normalized, tokens.access_token),
        ])
        checkCancelled()
        const selected = workspaces.items.find(item => item.type === 'personal' && item.status === 'active')
          ?? workspaces.items.find(item => item.status === 'active')
        const stored: StoredOAuth = {
          origin: normalized, userId: account.id, username: account.username, verifiedAt: new Date().toISOString(),
          activeWorkspaceId: selected?.id ?? null,
          workspaces: workspaces.items.map(item => ({ ...item, role: item.role ?? null })), refreshToken: tokens.refresh_token,
        }
        await this.store.write(stored, undefined)
        saved = true
        this.rememberAccess(stored, tokens)
        complete?.(true)
        return this.publicView(stored)
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (!saved) {
          complete?.(false)
          if (issuedRefresh) await this.client.revoke(normalized, issuedRefresh).catch(() => undefined)
        }
        server.closeAllConnections()
        server.close()
      }
    }).finally(() => { if (this.loginAttempt === attempt) this.loginAttempt = undefined })
  }

  private rememberAccess(stored: StoredOAuth, tokens: { access_token: string; expires_in: number }): void {
    this.access = { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000,
      refreshToken: stored.refreshToken, origin: stored.origin }
  }
  private async authenticated(): Promise<{ stored: StoredOAuth; token: string }> {
    let stored = await this.read()
    if (!stored) throw new AccountError('missing', '请先登录 ApeMind。')
    if (this.access && this.access.refreshToken === stored.refreshToken && this.access.origin === stored.origin
      && Date.now() + 30_000 < this.access.expiresAt) return { stored, token: this.access.token }
    const expected = stored
    let tokens
    try { tokens = await this.client.refresh(stored.origin, stored.refreshToken) }
    catch (error) {
      if (error instanceof AccountError && error.code === 'oauth_expired') {
        this.access = undefined
        await this.store.write(undefined, expected)
      }
      throw error
    }
    stored = { ...stored, refreshToken: tokens.refresh_token }
    try { await this.store.write(stored, expected) }
    catch (error) { await this.client.revoke(stored.origin, stored.refreshToken).catch(() => undefined); throw error }
    this.rememberAccess(stored, tokens)
    return { stored, token: tokens.access_token }
  }
  refreshWorkspaces(): Promise<OAuthAccountView> {
    return this.serial(async () => {
      const { stored, token } = await this.authenticated()
      const list = await this.client.workspaces(stored.origin, token)
      const next = { ...stored, workspaces: list.items.map(item => ({ ...item, role: item.role ?? null })), verifiedAt: new Date().toISOString() }
      if (!next.workspaces.some(item => item.id === next.activeWorkspaceId && item.status === 'active')) next.activeWorkspaceId = null
      await this.store.write(next, stored)
      return this.publicView(next)
    })
  }
  select(workspaceId: string): Promise<OAuthAccountView> {
    return this.serial(async () => {
      const { stored, token } = await this.authenticated()
      const list = await this.client.workspaces(stored.origin, token)
      if (!list.items.some(item => item.id === workspaceId && item.status === 'active')) throw new AccountError('workspace', '此工作空间已不可用，请刷新列表。')
      const next = { ...stored, activeWorkspaceId: workspaceId,
        workspaces: list.items.map(item => ({ ...item, role: item.role ?? null })), verifiedAt: new Date().toISOString() }
      await this.store.write(next, stored)
      return this.publicView(next)
    })
  }
  collections(): Promise<{ workspace: WorkspaceView; items: Awaited<ReturnType<ApeMindClient['oauthCollections']>> }> {
    return this.serial(async () => {
      const { stored, token } = await this.authenticated()
      const workspace = stored.workspaces.find(item => item.id === stored.activeWorkspaceId && item.status === 'active')
      if (!workspace) throw new AccountError('workspace', '请选择一个可用工作空间。')
      return { workspace, items: await this.client.oauthCollections(stored.origin, token, workspace.id) }
    })
  }
  logout(): Promise<void> {
    this.cancelLogin()
    return this.serial(async () => {
      const stored = await this.read()
      if (stored) { await this.client.revoke(stored.origin, stored.refreshToken); await this.store.write(undefined, stored) }
      this.access = undefined
    })
  }
  private publicView({ refreshToken: _refresh, ...view }: StoredOAuth): OAuthAccountView { return view }
}

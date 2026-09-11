import { z } from 'zod'
import type { AccountView, KnowledgeBaseView } from './types.ts'

const userSchema = z.object({
  id: z.string().min(1), username: z.string().nullable(), email: z.string().nullable().optional(),
  bound_org_id: z.string().nullable().optional(),
  bound_org_role: z.string().nullable().optional(),
  bound_org_permissions: z.array(z.string()).nullable().optional(),
})
const orgSchema = z.object({ id: z.string(), name: z.string(), display_name: z.string().nullable().optional(), status: z.string() })
const collectionsSchema = z.object({ items: z.array(z.object({ id: z.string(), title: z.string().nullable() })).nullable() })
const tokenSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(), scope: z.string(),
})
const workspaceListSchema = z.object({
  items: z.array(z.object({
    id: z.string(), type: z.enum(['personal', 'organization']), name: z.string(),
    status: z.string(), role: z.string().nullable().optional(), permissions: z.array(z.string()).default([]),
  })),
})
const deviceAuthorizationSchema = z.object({
  device_code: z.string().min(1), user_code: z.string().min(1),
  verification_uri: z.string().url(), verification_uri_complete: z.string().url(),
  expires_in: z.number().int().positive(), interval: z.number().int().positive(),
})
const deviceTokenErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() })

/** Errors contain fixed product messages, never server bodies or credential values. */
export class AccountError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

export function normalizeOrigin(raw: string): string {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new AccountError('origin', '请输入完整的 HTTPS 服务地址。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new AccountError('origin', '服务地址必须是 HTTPS 站点地址，不能包含路径、账号或查询参数。')
  }
  return url.origin
}

export class ApeMindClient {
  constructor(private readonly transport: typeof fetch = fetch) {}

  private async get(origin: string, apiKey: string, path: string): Promise<unknown> {
    let response: Response
    try {
      response = await this.transport(`${normalizeOrigin(origin)}/api/v2${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new AccountError('network', '无法连接 ApeMind，请检查服务地址和网络后重试。')
    }
    if (response.status === 401) throw new AccountError('invalid_key', 'API Key 无效、已过期或已停用，请重新连接。')
    if (response.status === 403) throw new AccountError('forbidden', '当前账号或 API Key 没有访问权限。')
    if (!response.ok) throw new AccountError('server', `ApeMind 请求失败（HTTP ${response.status}），请稍后重试。`)
    try { return await response.json() } catch { throw new AccountError('protocol', '服务响应格式不正确，请确认地址指向 ApeMind。') }
  }

  private async post(origin: string, path: string, body: URLSearchParams): Promise<unknown> {
    let response: Response
    try {
      response = await this.transport(`${normalizeOrigin(origin)}/api/v2${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000),
      })
    } catch { throw new AccountError('network', '无法连接 ApeMind，请检查服务地址和网络后重试。') }
    if (!response.ok) {
      if (response.status === 400) throw new AccountError('oauth_expired', '登录授权已过期或被撤销，请重新登录。')
      throw new AccountError('server', `ApeMind 请求失败（HTTP ${response.status}），请稍后重试。`)
    }
    try { return await response.json() } catch { throw new AccountError('protocol', '服务响应格式不正确，请确认地址指向 ApeMind。') }
  }

  async verify(origin: string, apiKey: string): Promise<Omit<AccountView, 'id'>> {
    const parsed = userSchema.safeParse(await this.get(origin, apiKey, '/auth/user'))
    if (!parsed.success) throw new AccountError('protocol', '服务未返回完整的账户信息。')
    const user = parsed.data
    // Old servers without workspace projection cannot establish a safe key scope.
    if (user.bound_org_id === undefined) throw new AccountError('version', '服务端缺少工作空间信息，请升级 ApeMind 后重试。')
    let workspaceName = '个人空间'
    if (user.bound_org_id !== null) {
      if (!user.bound_org_role || !user.bound_org_permissions) throw new AccountError('forbidden', '无法确认此 Key 的组织成员身份，请联系组织管理员。')
      const org = orgSchema.safeParse(await this.get(origin, apiKey, `/organizations/${encodeURIComponent(user.bound_org_id)}`))
      if (!org.success || org.data.id !== user.bound_org_id) throw new AccountError('protocol', '服务未返回对应的组织信息。')
      if (org.data.status !== 'active') throw new AccountError('forbidden', '该组织当前不可用，请联系组织管理员。')
      workspaceName = org.data.display_name || org.data.name
    }
    return { origin, userId: user.id, username: user.username || user.email || user.id, workspaceName, orgId: user.bound_org_id,
      role: user.bound_org_role ?? null, permissions: user.bound_org_permissions ?? [], verifiedAt: new Date().toISOString() }
  }

  async collections(origin: string, apiKey: string): Promise<KnowledgeBaseView[]> {
    // No client-selected org parameter: the server resolves the key's bound workspace.
    const data = collectionsSchema.safeParse(await this.get(origin, apiKey, '/collections?page=1&page_size=20&include_subscribed=false'))
    if (!data.success) throw new AccountError('protocol', '服务未返回有效的知识库列表。')
    return (data.data.items ?? []).map(item => ({ id: item.id, name: item.title || '未命名知识库' }))
  }

  async exchangeCode(origin: string, code: string, verifier: string, redirectUri: string): Promise<z.infer<typeof tokenSchema>> {
    const data = await this.post(origin, '/auth/desktop/token', new URLSearchParams({ grant_type: 'authorization_code', client_id: 'apemind-desktop', code, code_verifier: verifier, redirect_uri: redirectUri }))
    const parsed = tokenSchema.safeParse(data)
    if (!parsed.success) throw new AccountError('protocol', '服务未返回有效的登录令牌。')
    return parsed.data
  }

  async refresh(origin: string, refreshToken: string): Promise<z.infer<typeof tokenSchema>> {
    const data = await this.post(origin, '/auth/desktop/token', new URLSearchParams({ grant_type: 'refresh_token', client_id: 'apemind-desktop', refresh_token: refreshToken }))
    const parsed = tokenSchema.safeParse(data)
    if (!parsed.success) throw new AccountError('protocol', '服务未返回有效的刷新令牌。')
    return parsed.data
  }

  async revoke(origin: string, refreshToken: string): Promise<void> {
    await this.post(origin, '/auth/desktop/revoke', new URLSearchParams({ token: refreshToken }))
  }

  async startDevice(origin: string): Promise<z.infer<typeof deviceAuthorizationSchema>> {
    const data = await this.post(origin, '/auth/desktop/device', new URLSearchParams({ client_id: 'apemind-desktop', scope: 'profile workspace.read collection.read' }))
    const parsed = deviceAuthorizationSchema.safeParse(data)
    if (!parsed.success) throw new AccountError('protocol', '服务未返回有效的设备登录信息。')
    return parsed.data
  }

  async pollDevice(origin: string, deviceCode: string): Promise<{ status: 'pending'; interval: number } | { status: 'approved'; tokens: z.infer<typeof tokenSchema> }> {
    let response: Response
    try {
      response = await this.transport(`${normalizeOrigin(origin)}/api/v2/auth/desktop/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: 'apemind-desktop', device_code: deviceCode }),
        redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000),
      })
    } catch { throw new AccountError('network', '无法连接 ApeMind，请检查服务地址和网络后重试。') }
    const data: unknown = await response.json().catch(() => undefined)
    if (response.ok) {
      const parsed = tokenSchema.safeParse(data)
      if (!parsed.success) throw new AccountError('protocol', '服务未返回有效的登录令牌。')
      return { status: 'approved', tokens: parsed.data }
    }
    const error = deviceTokenErrorSchema.safeParse(data)
    if (error.success && error.data.error === 'authorization_pending') return { status: 'pending', interval: 5 }
    if (error.success && error.data.error === 'slow_down') return { status: 'pending', interval: 10 }
    if (error.success && error.data.error === 'access_denied') throw new AccountError('denied', '你已取消 ApeMind 登录。')
    if (error.success && error.data.error === 'expired_token') throw new AccountError('oauth_expired', '设备登录已过期，请重新开始。')
    throw new AccountError(response.status === 401 ? 'oauth_expired' : 'server', '设备登录失败，请重新开始。')
  }

  async workspaces(origin: string, accessToken: string): Promise<z.infer<typeof workspaceListSchema>> {
    const response = await this.transport(`${normalizeOrigin(origin)}/api/v2/me/workspaces`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new AccountError(response.status === 401 ? 'oauth_expired' : 'server', response.status === 401 ? '登录已过期，请重新登录。' : `ApeMind 请求失败（HTTP ${response.status}），请稍后重试。`)
    const parsed = workspaceListSchema.safeParse(await response.json())
    if (!parsed.success) throw new AccountError('protocol', '服务未返回有效的工作空间列表。')
    return parsed.data
  }

  async oauthUser(origin: string, accessToken: string): Promise<{ id: string; username: string }> {
    const response = await this.transport(`${normalizeOrigin(origin)}/api/v2/auth/user`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new AccountError(response.status === 401 ? 'oauth_expired' : 'server', response.status === 401 ? '登录已过期，请重新登录。' : '无法读取 ApeMind 账户。')
    const parsed = userSchema.safeParse(await response.json())
    if (!parsed.success) throw new AccountError('protocol', '服务未返回有效的账户信息。')
    return { id: parsed.data.id, username: parsed.data.username || parsed.data.email || parsed.data.id }
  }

  async oauthCollections(origin: string, accessToken: string, workspaceId: string): Promise<KnowledgeBaseView[]> {
    const response = await this.transport(`${normalizeOrigin(origin)}/api/v2/collections?page=1&page_size=20&include_subscribed=false`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-ApeMind-Workspace-Id': workspaceId, Accept: 'application/json' }, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new AccountError(response.status === 401 ? 'oauth_expired' : 'forbidden', response.status === 401 ? '登录已过期，请重新登录。' : '当前工作空间没有访问权限。')
    const parsed = collectionsSchema.safeParse(await response.json())
    if (!parsed.success) throw new AccountError('protocol', '服务未返回有效的知识库列表。')
    return (parsed.data.items ?? []).map(item => ({ id: item.id, name: item.title || '未命名知识库' }))
  }
}

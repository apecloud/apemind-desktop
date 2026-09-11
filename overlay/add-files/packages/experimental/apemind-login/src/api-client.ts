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
}

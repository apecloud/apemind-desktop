import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AccountError, ApeMindClient, normalizeOrigin } from './api-client.ts'
import type { AccountState, AccountView, KnowledgeBaseView } from './types.ts'

const accountSchema = z.object({
  id: z.string(), origin: z.string(), userId: z.string(), username: z.string(),
  workspaceName: z.string(), orgId: z.string().nullable(), role: z.string().nullable(),
  permissions: z.array(z.string()), verifiedAt: z.string(), apiKey: z.string(),
})
const storeSchema = z.object({ version: z.literal(1), activeId: z.string().nullable(), connections: z.array(accountSchema) })
type StoredState = z.infer<typeof storeSchema>

export interface AccountStore {
  read(): Promise<unknown>
  write(value: StoredState, expected: StoredState): Promise<void>
}

function publicState(state: StoredState): AccountState {
  return { activeId: state.activeId, connections: state.connections.map(({ apiKey: _secret, ...view }) => view) }
}

/** Single owner of account mutations; network verification completes before durable writes. */
export class AccountService {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: AccountStore, private readonly client = new ApeMindClient()) {}

  private async read(): Promise<StoredState> {
    const value = await this.store.read()
    if (value === undefined) return { version: 1, activeId: null, connections: [] }
    const parsed = storeSchema.safeParse(value)
    if (!parsed.success) throw new AccountError('storage', '本地连接记录无法读取，请联系支持人员。')
    return parsed.data
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    // Release the queue after failure; the operation's caller still receives the rejection.
    this.pending = result.catch(() => undefined)
    return result
  }

  async state(): Promise<AccountState> { return publicState(await this.read()) }

  connect(origin: string, apiKey: string): Promise<AccountState> {
    return this.serial(async () => {
      origin = normalizeOrigin(origin)
      apiKey = apiKey.trim()
      if (!apiKey || /\s/u.test(apiKey) || apiKey.length > 4096) throw new AccountError('invalid_key', '请输入有效的 API Key。')
      const account = await this.client.verify(origin, apiKey)
      const id = createHash('sha256').update(JSON.stringify([origin, account.userId, account.orgId])).digest('hex')
      const state = await this.read()
      const connections = state.connections.filter(item => item.id !== id)
      connections.push({ ...account, id, apiKey })
      const next: StoredState = { version: 1, activeId: id, connections }
      await this.store.write(next, state)
      return publicState(next)
    })
  }

  select(id: string): Promise<AccountState> {
    return this.serial(async () => {
      const state = await this.read()
      const connection = state.connections.find(item => item.id === id)
      if (!connection) throw new AccountError('missing', '该连接已移除，请重新连接。')
      const account = await this.client.verify(connection.origin, connection.apiKey)
      if (account.userId !== connection.userId || account.orgId !== connection.orgId) {
        throw new AccountError('scope', '此 Key 的身份或工作空间已改变，请重新连接。')
      }
      const expected = structuredClone(state)
      Object.assign(connection, account)
      state.activeId = id
      await this.store.write(state, expected)
      return publicState(state)
    })
  }

  disconnect(id: string): Promise<AccountState> {
    return this.serial(async () => {
      const state = await this.read()
      const expected = structuredClone(state)
      state.connections = state.connections.filter(item => item.id !== id)
      // Do not silently activate another identity when signing out.
      if (state.activeId === id) state.activeId = null
      await this.store.write(state, expected)
      return publicState(state)
    })
  }

  collections(): Promise<{ account: AccountView; items: KnowledgeBaseView[] }> {
    return this.serial(async () => {
      const state = await this.read()
      const connection = state.connections.find(item => item.id === state.activeId)
      if (!connection) throw new AccountError('missing', '请先连接一个工作空间。')
      const account = await this.client.verify(connection.origin, connection.apiKey)
      if (account.userId !== connection.userId || account.orgId !== connection.orgId) throw new AccountError('scope', '连接权限已改变，请重新连接。')
      const items = await this.client.collections(connection.origin, connection.apiKey)
      return { account: { ...account, id: connection.id }, items }
    })
  }
}

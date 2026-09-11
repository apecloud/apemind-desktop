import { isDeepStrictEqual } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { AccountService } from './account-service.ts'
import { AccountError } from './api-client.ts'
import { OAuthService } from './oauth-service.ts'
import type { AccountState, AccountView, KnowledgeBaseView, OAuthAccountView, WorkspaceView } from './types.ts'

const KEY = credentialKey('apemind', 'connections')
const OAUTH_KEY = credentialKey('apemind', 'oauth')

declare module '@deepseek-ai/cordis' {
  interface Context { authorizationController: AuthorizationController }
}

/** ApeMind-specific Remote API. Secrets are accepted only on connect, never returned. */
export class AuthorizationController extends TypertRemoteService {
  private readonly accounts: AccountService
  private readonly oauth: OAuthService

  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'apemindAuth' })
    this.accounts = new AccountService({
      read: async () => {
        const record = await ctx.credentials.readRecord(KEY)
        if (record === undefined) return undefined
        if (record.kind !== 'grant') throw new AccountError('storage', '本地连接记录格式不正确。')
        return record.payload
      },
      write: async (payload, expected) => {
        await ctx.credentials.modifyRecord(KEY, (current) => {
          const existing = current?.kind === 'grant' ? current.payload : { version: 1, activeId: null, connections: [] }
          if (!isDeepStrictEqual(existing, expected)) throw new AccountError('conflict', '连接已在其他窗口更新，请重新打开设置页后重试。')
          return Promise.resolve({ kind: 'grant', payload })
        })
      },
    })
    this.oauth = new OAuthService({
      read: async () => {
        const record = await ctx.credentials.readRecord(OAUTH_KEY)
        if (record === undefined) return undefined
        if (record.kind !== 'grant') throw new AccountError('storage', '本地登录记录格式不正确。')
        return record.payload as never
      },
      write: async (value) => {
        if (value === undefined) { await ctx.credentials.deleteRecord(OAUTH_KEY); return }
        await ctx.credentials.modifyRecord(OAUTH_KEY, () => Promise.resolve({ kind: 'grant', payload: value }))
      },
    })
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      throw new RemoteError('gateway/bad-request', error instanceof AccountError ? error.message : '本地连接操作失败，请重试。', {})
    }
  }

  @Remote
  async state(): Promise<AccountState> {
    return this.call(async () => ({ ...(await this.accounts.state()), oauth: await this.oauth.state() }))
  }

  @Remote
  async oauthState(): Promise<OAuthAccountView | null> { return this.call(() => this.oauth.state()) }

  @Remote
  async startBrowserLogin(origin: string): Promise<OAuthAccountView> { return this.call(() => this.oauth.login(origin)) }

  @Remote
  async selectWorkspace(id: string): Promise<OAuthAccountView> { return this.call(() => this.oauth.select(id)) }

  @Remote
  async oauthCollections(): Promise<{ workspace: WorkspaceView; items: KnowledgeBaseView[] }> { return this.call(() => this.oauth.collections()) }

  @Remote
  async oauthLogout(): Promise<void> { return this.call(() => this.oauth.logout()) }

  @Remote
  async connect(origin: string, apiKey: string): Promise<AccountState> {
    return this.call(() => this.accounts.connect(origin, apiKey))
  }

  @Remote
  async select(id: string): Promise<AccountState> { return this.call(() => this.accounts.select(id)) }

  @Remote
  async disconnect(id: string): Promise<AccountState> { return this.call(() => this.accounts.disconnect(id)) }

  @Remote
  async collections(): Promise<{ account: AccountView; items: KnowledgeBaseView[] }> {
    return this.call(() => this.accounts.collections())
  }
}

export default AuthorizationController

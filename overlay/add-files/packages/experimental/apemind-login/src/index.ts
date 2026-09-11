/**
 * ApeMind Desktop overlay: registers the ApeMind credential flow.
 *
 * The flow offers two methods requested by the product owner:
 *  - `api-key`  : paste an ApeMind API key (works today, no server endpoint needed).
 *  - `browser`  : sign in via the browser using an existing ApeMind web session.
 *                 The browser `url` / code exchange is filled in once the
 *                 product owner confirms ApeMind's sign-in endpoint (it is NOT
 *                 the Raft-Agent-only `raft/agent-login` path).
 *
 * Storage goes through the dsh credential seam (`ctx.credentials`), i.e. the
 * native credential store — not the CLI `state.json`.
 * @module @deepseek-ai/dsh-apemind-login
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'

/** Service injection: the authorization registry and the credential seam. */
export const inject = ['authorization', 'credentials']

/** The credential record this flow owns. */
const KEY = credentialKey('apemind', 'account')

/** Environment/CLI-shape fields the user may supply alongside the key. */
interface ApeMindGrant {
  /** ApeMind API key (or bearer token). */
  readonly apiKey?: string
  /** Hosted instance workspace/org scope (`--org-id` equivalent). */
  readonly orgId?: string
}

/** Validate an ApeMind API key. Local shape check only; the server validates on use. */
function looksLikeKey(value: string): boolean {
  const v = value.trim()
  return v.length >= 16 && !/\s/u.test(v)
}

/**
 * Register the ApeMind authorization flow.
 * @param ctx - root context carrying `authorization` and `credentials`.
 */
export function apply(ctx: Context): void {
  process.stdout.write('[apemind-login] apply() called — registering ApeMind authorization flow\n')
  ctx.authorization.registerFlow({
    key: KEY,
    label: 'ApeMind',
    methods: [
      { id: 'browser', label: '浏览器登录 ApeMind' },
      { id: 'api-key', label: '粘贴 API Key' },
    ],
    async run(session: AuthorizationSession): Promise<void> {
      if (session.method === 'api-key') {
        const raw = await session.prompt({
          kind: 'secret',
          message: '粘贴你的 ApeMind API Key',
          placeholder: 'ap-...',
        })
        if (!looksLikeKey(raw)) {
          throw new Error('ApeMind: API Key 看起来不合法（长度不足或含空白）')
        }
        const orgId = await session.prompt({
          kind: 'text',
          message: '可选：ApeMind 组织/workspace id（--org-id，可留空）',
        })
        const grant: ApeMindGrant = { apiKey: raw.trim() }
        if (orgId.trim() !== '') Object.assign(grant, { orgId: orgId.trim() })
        await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'grant', payload: grant }))
        session.notify({ message: 'ApeMind 凭据已保存' })
        return
      }

      // method === 'browser'
      // NOTE: the sign-in endpoint is pending owner confirmation. It must NOT be
      // the Raft-Agent-only `POST /api/v2/auth/raft/agent-login`. Until the
      // endpoint is provided, surface the intent and stop cleanly.
      session.notify({
        message: '请先在浏览器登录 ApeMind；登录完成后回到这里输入一次性授权码。',
        url: process.env.DSH_APEMIND_SIGNIN_URL ?? 'https://apemind.ai/',
      })
      const code = await session.prompt({
        kind: 'text',
        message: '粘贴浏览器给出的授权码（待服务端端点确认后启用）',
      })
      throw new Error(`ApeMind: 浏览器登录端点尚未确认（收到 code 长度 ${String(code.length)}），请先用 API Key 方式`)
    },
  })
  process.stdout.write('[apemind-login] flow registered for key apemind/account\n')
}

/**
 * Host Remote owner of the `authorization` namespace: lets the web settings
 * page list ApeMind sign-in flows and run one attempt, carrying the flow's
 * notices and prompts to the page and its answers back.
 *
 * @module @deepseek-ai/dsh-apemind-login/src/controller.ts
 */

import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { AuthorizationAnswer, AuthorizationAttemptView, AuthorizationFlowView, PendingNotice } from './types.ts'

const keySchema = z.string().min(1)
const methodSchema = z.string().min(1)
const answerSchema = z.object({ id: z.string().min(1), value: z.string(), declined: z.boolean().optional() })

/** One outstanding prompt waiting for the page's answer. */
interface Pending {
  readonly resolve: (value: string) => void
  readonly reject: (error: unknown) => void
}

/** Live attempt bookkeeping. */
interface Attempt {
  readonly key: string
  readonly method: string
  notice: AuthorizationNotice | undefined
  promptId: string | undefined
  prompt: AuthorizationPrompt | undefined
  pending: Pending | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/**
 * Host service backing the generated `ctx.remote.authorization` namespace.
 */
export class AuthorizationController extends TypertRemoteService {
  private seq = 0
  private readonly attempts = new Map<string, Attempt>()

  /** @param ctx - host context that owns the authorization seam. */
  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
  }

  /** List the sign-in flows a page can start. */
  @Remote
  async list(): Promise<AuthorizationFlowView[]> {
    return this.ctx.authorization.list().map(entry => ({
      key: entry.key,
      label: entry.label,
      methods: entry.methods.map(m => ({ id: m.id, label: m.label })),
    }))
  }

  /** Read the current prompt/notice for one live attempt. */
  @Remote
  async view(key: string): Promise<AuthorizationAttemptView | undefined> {
    const parsed = keySchema.safeParse(key)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', 'invalid key', {})
    const attempt = this.attempts.get(parsed.data)
    if (attempt === undefined) return undefined
    const p = attempt.prompt
    const prompt = attempt.promptId !== undefined && p !== undefined
      ? {
          id: attempt.promptId,
          message: p.message,
          kind: p.kind,
          ...('placeholder' in p && p.placeholder !== undefined ? { placeholder: p.placeholder } : {}),
          ...(p.kind === 'select' ? { options: p.options.map(o => ({ id: o.id, label: o.label })) } : {}),
        }
      : undefined
    return {
      key: attempt.key,
      method: attempt.method,
      ...(attempt.notice === undefined ? {} : { notice: noticeOf(attempt.notice) }),
      ...(prompt === undefined ? {} : { prompt }),
    }
  }

  /**
   * Start one attempt; the flow runs in the background and publishes prompts
   * through {@link view}, consuming answers through {@link answer}.
   * @param key - credential key, e.g. `apemind/account`.
   * @param method - the flow method id to run.
   */
  @Remote
  async begin(key: string, method: string): Promise<void> {
    const k = keySchema.safeParse(key)
    const m = methodSchema.safeParse(method)
    if (!k.success || !m.success) throw new RemoteError('gateway/bad-request', 'invalid begin payload', {})
    if (this.attempts.has(k.data)) throw new RemoteError('gateway/bad-request', 'an attempt is already running for this key', {})
    const attempt: Attempt = { key: k.data, method: m.data, notice: undefined, promptId: undefined, prompt: undefined, pending: undefined }
    this.attempts.set(k.data, attempt)
    const interaction = {
      notify: (notice: AuthorizationNotice): void => { attempt.notice = notice },
      prompt: (prompt: AuthorizationPrompt): Promise<string> => {
        attempt.promptId = `p${String(++this.seq)}`
        attempt.prompt = prompt
        return new Promise<string>((resolve, reject) => { attempt.pending = { resolve, reject } })
      },
    }
    void this.ctx.authorization
      .begin({ key: keyOf(k.data), method: m.data, interaction })
      .catch(() => undefined)
      .finally(() => { this.attempts.delete(k.data) })
  }

  /** Answer the pending prompt of one attempt. */
  @Remote
  async answer(payload: AuthorizationAnswer): Promise<void> {
    const parsed = answerSchema.safeParse(payload)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', 'invalid answer payload', {})
    for (const attempt of this.attempts.values()) {
      const pending = attempt.pending
      if (attempt.promptId !== parsed.data.id || pending === undefined) continue
      attempt.pending = undefined
      attempt.promptId = undefined
      attempt.prompt = undefined
      if (parsed.data.declined === true) pending.reject(new AuthorizationDeclinedError())
      else pending.resolve(parsed.data.value)
      return
    }
    throw new RemoteError('gateway/bad-request', 'no pending prompt with that id', {})
  }

  /** Withdraw a live attempt. */
  @Remote
  async cancel(key: string): Promise<void> {
    const parsed = keySchema.safeParse(key)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', 'invalid key', {})
    const attempt = this.attempts.get(parsed.data)
    if (attempt?.pending !== undefined) {
      const pending = attempt.pending
      attempt.pending = undefined
      pending.reject(new AuthorizationDeclinedError())
    }
    this.attempts.delete(parsed.data)
  }
}

/** Project one notice to its wire shape. */
function noticeOf(notice: AuthorizationNotice): PendingNotice {
  return {
    message: notice.message,
    ...(notice.url === undefined ? {} : { url: notice.url }),
    ...(notice.code === undefined ? {} : { code: notice.code }),
  }
}

/** Turn one `apemind/<id>` string back into a branded credential key. */
function keyOf(key: string): ReturnType<typeof credentialKey> {
  const slash = key.indexOf('/')
  return slash === -1 ? credentialKey(key, 'account') : credentialKey(key.slice(0, slash), key.slice(slash + 1))
}

export default AuthorizationController

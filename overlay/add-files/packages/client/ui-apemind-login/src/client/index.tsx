/**
 * ApeMind sign-in settings section, browser half. It lists the ApeMind
 * credential flow and runs one attempt at a time, driving the host
 * `authorization` Remote namespace: start an attempt, poll its pending
 * prompt, and answer it.
 *
 * @module @deepseek-ai/dsh-client-ui-apemind-login/client
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry) and InjectFace.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated `ctx.remote.authorization` namespace into this program.
import type {} from '@deepseek-ai/dsh-apemind-login/remote'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthorizationAttemptView, AuthorizationFlowView } from '@deepseek-ai/dsh-apemind-login/types'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'remote', 'remote.authorization']

/** The credential key the ApeMind flow owns. */
const APEMIND_KEY = 'apemind/account'

/** What the section component is injected with (spread directly onto props). */
export interface LoginSectionInjected {
  /** The plugin context, carrying `ctx.remote.authorization`. */
  readonly login: ClientContext
}

/** Full component props. */
export type LoginSectionProps = PropsRuntime<'settings.section'> & InjectFace<LoginSectionInjected>

/**
 * Mount the ApeMind sign-in settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const injected = (): LoginSectionInjected => ({ login: ctx })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'apemind-login',
    order: 30,
    label: () => 'ApeMind 登录',
    inject: injected,
  }, LoginSection))
}

const box: Record<string, unknown> = { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }
const row: Record<string, unknown> = { display: 'flex', gap: 8, alignItems: 'center' }
const field: Record<string, unknown> = { flex: 1, padding: '8px 10px', borderRadius: 8 }

/**
 * Render the sign-in section: pick a method, start the attempt, answer prompts.
 * @param props - the runtime props plus this plugin's injected context.
 */
export function LoginSection(props: LoginSectionProps): ReactNode {
  const ctx = props.login
  const [flows, setFlows] = useState<AuthorizationFlowView[]>([])
  const [method, setMethod] = useState<string>('api-key')
  const [view, setView] = useState<AuthorizationAttemptView | undefined>(undefined)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<string>('未登录')
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const refreshFlows = useCallback(async (): Promise<void> => {
    const res = await ctx.remote.authorization.list()
    if (res.ok) {
      setFlows(res.value)
      const m = res.value.find(f => f.key === APEMIND_KEY)?.methods[0]?.id
      if (m !== undefined) setMethod(m)
    }
  }, [ctx])

  useEffect(() => { void refreshFlows() }, [refreshFlows])

  const stopPolling = useCallback((): void => {
    if (timer.current !== undefined) { clearInterval(timer.current); timer.current = undefined }
  }, [])

  const poll = useCallback(async (): Promise<void> => {
    const res = await ctx.remote.authorization.view(APEMIND_KEY)
    if (res.ok) {
      setView(res.value)
      if (res.value === undefined) { setStatus('已完成（凭据已提交）'); stopPolling() }
    }
  }, [ctx, stopPolling])

  const begin = useCallback(async (): Promise<void> => {
    setError(undefined)
    setStatus('登录中…')
    const res = await ctx.remote.authorization.begin(APEMIND_KEY, method)
    if (!res.ok) { setError(res.error.message); setStatus('未登录'); return }
    stopPolling()
    timer.current = setInterval(() => { void poll() }, 500)
    void poll()
  }, [ctx, method, poll, stopPolling])

  const submit = useCallback(async (): Promise<void> => {
    const p = view?.prompt
    if (p === undefined) return
    const res = await ctx.remote.authorization.answer({ id: p.id, value: answer })
    setAnswer('')
    if (!res.ok) { setError(res.error.message); return }
    void poll()
  }, [ctx, view, answer, poll])

  const cancel = useCallback(async (): Promise<void> => {
    await ctx.remote.authorization.cancel(APEMIND_KEY)
    stopPolling(); setView(undefined); setStatus('未登录')
  }, [ctx, stopPolling])

  const methods = flows.find(f => f.key === APEMIND_KEY)?.methods ?? [{ id: 'api-key', label: '粘贴 API Key' }]

  return (
    <div style={box}>
      <h3 style={{ margin: 0 }}>ApeMind 登录</h3>
      <div>状态：{status}</div>
      <div style={row}>
        <select value={method} onChange={e => { setMethod(e.target.value) }} style={field}>
          {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button type="button" onClick={() => { void begin() }}>开始登录</button>
        <button type="button" onClick={() => { void cancel() }}>取消</button>
      </div>
      {view?.notice !== undefined && (
        <div style={{ padding: 10, borderRadius: 8 }}>
          <div>{view.notice.message}</div>
          {view.notice.url !== undefined && <a href={view.notice.url} target="_blank" rel="noreferrer">{view.notice.url}</a>}
        </div>
      )}
      {view?.prompt !== undefined && (
        <div style={box}>
          <div>{view.prompt.message}</div>
          <div style={row}>
            <input
              style={field}
              type={view.prompt.kind === 'secret' ? 'password' : 'text'}
              placeholder={view.prompt.placeholder ?? ''}
              value={answer}
              onChange={e => { setAnswer(e.target.value) }}
              onKeyDown={e => { if (e.key === 'Enter') void submit() }}
            />
            <button type="button" onClick={() => { void submit() }}>提交</button>
          </div>
        </div>
      )}
      {error !== undefined && <div style={{ color: '#c00' }}>{error}</div>}
    </div>
  )
}

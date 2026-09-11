import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-apemind-login/remote'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountState, KnowledgeBaseView } from '@deepseek-ai/dsh-apemind-login/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { zh, en, type LoginLocaleKey } from './locales.ts'
import './style.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.apemind': LoginLocaleKey }
}
const NS = 'settings.apemind'

export const inject = ['slots', 'locale', 'remote', 'remote.apemindAuth']
export interface LoginSectionInjected { readonly login: ClientContext }
export type LoginSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.apemind'> & InjectFace<LoginSectionInjected>

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'apemind-login: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'apemind-login', order: 30,
    label: () => t('brand'), locale: NS, inject: (): LoginSectionInjected => ({ login: ctx }),
  }, LoginSection))
}

export function LoginSection(props: LoginSectionProps): ReactNode {
  const { t } = props
  const remote = useMemo(() => props.login.remote.apemindAuth, [props.login])
  const [state, setState] = useState<AccountState>({ activeId: null, connections: [] })
  const [origin, setOrigin] = useState('https://apemind.ai')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [keyItems, setKeyItems] = useState<KnowledgeBaseView[] | null>(null)
  const [oauthItems, setOAuthItems] = useState<KnowledgeBaseView[] | null>(null)
  const [waiting, setWaiting] = useState(false)
  const alive = useRef(false)
  const pending = useRef(false)
  const active = state.connections.find(item => item.id === state.activeId)

  useEffect(() => {
    alive.current = true
    let cancelled = false
    pending.current = true
    setBusy(true)
    void remote.state().then((result) => {
      if (cancelled) return
      if (result.ok) { setState(current => ({ ...current, ...result.value })); setWaiting(result.value.browserLoginPending ?? false) }
      else setError(result.error.message)
    }).catch(() => { if (!cancelled) setError(t('readError')) }).finally(() => {
      if (!cancelled) { pending.current = false; setBusy(false) }
    })
    return () => { cancelled = true; alive.current = false }
  }, [remote])

  async function run(operation: () => Promise<void>): Promise<void> {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError(''); setMessage(''); setKeyItems(null); setOAuthItems(null)
    try { await operation() } catch { if (alive.current) setError(t('operationError')) }
    finally {
      if (alive.current) {
        const latest = await remote.state().catch(() => undefined)
        if (latest?.ok) { setState(latest.value); setWaiting(latest.value.browserLoginPending ?? false) }
        setBusy(false)
      }
      pending.current = false
    }
  }

  async function connect(): Promise<void> {
    const secret = apiKey
    setApiKey(''); setShowKey(false)
    const result = await remote.connect(origin, secret)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, ...result.value })); setMessage(t('keyConnected')) }
    else setError(result.error.message)
  }

  async function browserLogin(): Promise<void> {
    setWaiting(true)
    const result = await remote.startBrowserLogin(origin)
    setWaiting(false)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setMessage(t('loggedIn')) }
    else if (result.error.code === 'gateway/cancelled') { setError(''); setMessage(t('cancelled')) }
    else setError(result.error.message)
  }

  async function selectWorkspace(id: string): Promise<void> {
    const result = await remote.selectWorkspace(id)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setMessage(t('workspaceChanged')) }
    else setError(result.error.message)
  }

  async function oauthCollections(): Promise<void> {
    const result = await remote.oauthCollections()
    if (!alive.current) return
    if (result.ok) { setOAuthItems(result.value.items); setMessage(t('knowledgeVerified', { name: result.value.workspace.name })) }
    else setError(result.error.message)
  }

  async function oauthLogout(): Promise<void> {
    const result = await remote.oauthLogout()
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: null })); setOAuthItems(null); setKeyItems(null); setMessage(t('loggedOut')) }
    else setError(result.error.message)
  }

  async function select(id: string): Promise<void> {
    const result = await remote.select(id)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, ...result.value })); setMessage(t('keyVerified')) }
    else setError(result.error.message)
  }

  async function disconnect(id: string): Promise<void> {
    const result = await remote.disconnect(id)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, ...result.value })); setMessage(t('keyRemoved')) }
    else setError(result.error.message)
  }

  async function loadKnowledge(): Promise<void> {
    const result = await remote.collections()
    if (!alive.current) return
    if (result.ok) { setKeyItems(result.value.items); setMessage(t('knowledgeVerified', { name: result.value.account.workspaceName })) }
    else setError(result.error.message)
  }

  async function refreshWorkspaces(): Promise<void> {
    const result = await remote.refreshWorkspaces()
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setMessage(t('workspacesRefreshed')) }
    else setError(result.error.message)
  }

  async function cancelLogin(): Promise<void> {
    const result = await remote.cancelBrowserLogin()
    if (!alive.current) return
    if (!result.ok) setError(result.error.message)
    else { setWaiting(false); setMessage(t('cancelled')) }
  }

  const disabled = busy || waiting
  const oauth = state.oauth
  function knowledgeList(values: KnowledgeBaseView[] | null): ReactNode {
    return values !== null && <div className="apemind-knowledge">
      <h4>{t('knowledge')} <small>{t('knowledgeLimit')}</small></h4>
      {values.length === 0 ? <p className="apemind-muted">{t('knowledgeEmpty')}</p>
        : <ul>{values.map(item => <li key={item.id}>{item.name}</li>)}</ul>}
    </div>
  }

  return <section className="apemind-account" aria-busy={busy}>
    <header><h2>{t('brand')}</h2><p className="apemind-muted">{t('subtitle')}</p></header>
    {error && <div className="apemind-error" role="alert">{error}</div>}
    <div role="status" aria-live="polite">{waiting ? t('waiting') : busy ? t('busy') : message}</div>
    <section className="apemind-card">
      <h3>{oauth ? t('connected') : t('signIn')}</h3>
      {oauth ? <>
        <div><strong>{oauth.username}</strong><p className="apemind-muted">{oauth.origin}</p></div>
        <label>{t('currentWorkspace')}
          <select disabled={disabled} value={oauth.activeWorkspaceId ?? ''} onChange={(event) => { void run(() => selectWorkspace(event.target.value)) }}>
            <option value="" disabled>{t('chooseWorkspace')}</option>
            {oauth.workspaces.map(workspace => <option key={workspace.id} value={workspace.id} disabled={workspace.status !== 'active'}>
              {workspace.name}{workspace.status !== 'active' ? t('suspended') : workspace.type === 'personal' ? t('personal') : t('organization')}
            </option>)}
          </select>
        </label>
        <p className="apemind-muted">{t('verifiedAt', { time: new Date(oauth.verifiedAt).toLocaleString() })}</p>
        <div className="apemind-actions">
          <button className="apemind-primary" disabled={disabled || !oauth.activeWorkspaceId} onClick={() => { void run(oauthCollections) }}>{t('viewKnowledge')}</button>
          <button disabled={disabled} onClick={() => { void run(refreshWorkspaces) }}>{t('refreshWorkspaces')}</button>
          <button disabled={disabled} onClick={() => { void run(oauthLogout) }}>{t('signOut')}</button>
        </div>
        {knowledgeList(oauthItems)}
      </> : <>
        <p>{t('oneSignIn')}</p>
        <p className="apemind-muted">{t('browserHint')}</p>
        <div className="apemind-actions">
          <button className="apemind-primary" disabled={disabled} onClick={() => { void run(browserLogin) }}>{t('browserSignIn')}</button>
          {waiting && <button onClick={() => { void cancelLogin() }}>{t('cancelSignIn')}</button>}
        </div>
        <details><summary>{t('serverAddress')}</summary><label>{t('server')}<input required type="url" disabled={disabled} value={origin} onChange={(event) => { setOrigin(event.target.value) }} /></label></details>
      </>}
    </section>
    <details className="apemind-advanced"><summary>{t('advanced')}{state.connections.length > 0 ? t('connectionCount', { count: String(state.connections.length) }) : ''}</summary>
      <p className="apemind-muted">{t('advancedHint')}</p>
      {state.connections.length > 0 && <section className="apemind-card">
        <label>{t('currentKey')}
          <select disabled={disabled} value={state.activeId ?? ''} onChange={(event) => { void run(() => select(event.target.value)) }}>
            <option value="" disabled>{t('chooseConnection')}</option>
            {state.connections.map(item => <option key={item.id} value={item.id}>{item.workspaceName} · {item.username}</option>)}
          </select>
        </label>
        {active && <>
          <p>{active.origin}</p>
          <div className="apemind-actions">
            <button disabled={disabled} onClick={() => { void run(loadKnowledge) }}>{t('viewKnowledge')}</button>
            <button disabled={disabled} onClick={() => { void run(() => select(active.id)) }}>{t('reverify')}</button>
            <button disabled={disabled} onClick={() => { void run(() => disconnect(active.id)) }}>{t('removeConnection')}</button>
          </div>
          {knowledgeList(keyItems)}
        </>}
      </section>}
      <form className="apemind-card" onSubmit={(event) => { event.preventDefault(); void run(connect) }}>
        <h3>{t('addKey')}</h3>
        <label>{t('serverAddress')}<input required type="url" autoComplete="url" disabled={disabled} value={origin} onChange={(event) => { setOrigin(event.target.value) }} /></label>
        <label>{t('apiKey')}<input required type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} disabled={disabled} value={apiKey} onChange={(event) => { setApiKey(event.target.value) }} placeholder={t('keyPlaceholder')} /></label>
        <label className="apemind-checkbox"><input type="checkbox" checked={showKey} disabled={disabled} onChange={(event) => { setShowKey(event.target.checked) }} />{t('showKey')}</label>
        <div className="apemind-actions"><button type="submit" disabled={disabled || !apiKey.trim() || !origin.trim()}>{t('verifyConnect')}</button></div>
      </form>
    </details>
  </section>
}

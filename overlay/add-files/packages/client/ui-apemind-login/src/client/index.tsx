import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-apemind-login/remote'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountState, KnowledgeBaseView, LoginProgress, OAuthAccountView, WorkspaceView } from '@deepseek-ai/dsh-apemind-login/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { zh, en, type LoginLocaleKey } from './locales.ts'
import { APEMIND_MARK_DATA_URI } from './brand-mark.ts'
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

function Mark({ className = '' }: { className?: string }): ReactNode {
  return <img className={`apemind-mark ${className}`} src={APEMIND_MARK_DATA_URI} alt="" aria-hidden="true" />
}

function KnowledgeList({ values, title, empty, hasMore, loadMoreLabel, disabled, onLoadMore }: {
  values: KnowledgeBaseView[] | null
  title: string
  empty: string
  hasMore: boolean
  loadMoreLabel: string
  disabled: boolean
  onLoadMore: () => void
}): ReactNode {
  if (values === null) return null
  return <div className="apemind-knowledge">
    <h4>{title} <small>({values.length})</small></h4>
    {values.length === 0 ? <p className="apemind-muted">{empty}</p>
      : <ul>{values.map(item => <li key={item.id}>{item.name}</li>)}</ul>}
    {hasMore && <button type="button" className="apemind-quiet-action" disabled={disabled} onClick={onLoadMore}>{loadMoreLabel}</button>}
  </div>
}

function WorkspaceRow({ workspace, current, disabled, onSelect, roleLabel, currentLabel }: {
  workspace: WorkspaceView
  current: boolean
  disabled: boolean
  onSelect: () => void
  roleLabel: string
  currentLabel: string
}): ReactNode {
  const initials = workspace.name.trim().slice(0, 1).toUpperCase() || 'A'
  const content = <>
    <span className={`apemind-workspace-icon apemind-workspace-icon-${workspace.type}`} aria-hidden="true">{initials}</span>
    <span className="apemind-workspace-copy">
      <strong>{workspace.name}</strong>
      <small>{workspace.type === 'organization' ? roleLabel : ''}</small>
    </span>
    {current && <span className="apemind-current-badge">{currentLabel}</span>}
    {!current && <span className="apemind-chevron" aria-hidden="true">›</span>}
  </>
  if (current) return <div className="apemind-workspace-row is-current">{content}</div>
  return <button
    type="button"
    className="apemind-workspace-row"
    disabled={disabled || workspace.status !== 'active'}
    onClick={onSelect}
  >{content}</button>
}

function WaitingPanel({ t, disabled, onCancel, onOpenDevicePage, progress }: {
  t: LoginSectionProps['t']
  disabled: boolean
  onCancel: () => void
  onOpenDevicePage: () => Promise<boolean>
  progress: LoginProgress | null | undefined
}): ReactNode {
  const [opening, setOpening] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)
  const device = progress?.type === 'device_code'
  const address = progress?.verificationUriComplete || progress?.verificationUri

  async function openDevicePage(): Promise<void> {
    setOpening(true)
    setOpenFailed(false)
    try { setOpenFailed(!await onOpenDevicePage()) }
    catch { setOpenFailed(true) }
    finally { setOpening(false) }
  }

  return <section className="apemind-state-panel apemind-waiting-panel" aria-live="polite">
    <Mark className="apemind-state-mark" />
    <span className="apemind-spinner" aria-hidden="true" />
    <h3>{t(device ? 'deviceWaitingTitle' : 'waitingTitle')}</h3>
    <p>{t(device ? 'deviceWaitingDescription' : 'waitingDescription')}</p>
    {device && <div className="apemind-device-code">
      <span className="apemind-muted">{t('deviceCodeLabel')}</span>
      <code>{progress.userCode}</code>
      {address && <button type="button" className="apemind-primary apemind-main-action"
        disabled={opening} onClick={() => { void openDevicePage() }}
      >{t(opening ? 'openingDevicePage' : 'openDevicePage')} <span aria-hidden="true">↗</span></button>}
    </div>}
    {openFailed && <div className="apemind-device-open-error">
      <p role="alert">{t('openDevicePageError')}</p>
      <input aria-label={t('authorizationAddress')} value={address ?? ''} readOnly />
    </div>}
    <button type="button" className="apemind-secondary" disabled={disabled} onClick={onCancel}>{t('cancelSignIn')}</button>
  </section>
}

function SignedOutPanel({ t, disabled, onBrowserLogin, onDeviceLogin }: {
  t: LoginSectionProps['t']
  disabled: boolean
  onBrowserLogin: () => void
  onDeviceLogin: () => void
}): ReactNode {
  return <section className="apemind-state-panel apemind-connect-panel">
    <Mark className="apemind-state-mark" />
    <h3>{t('connectTitle')}</h3>
    <p>{t('connectDescription')}</p>
    <button type="button" className="apemind-primary apemind-main-action" disabled={disabled} onClick={onBrowserLogin}>{t('browserSignIn')} <span aria-hidden="true">↗</span></button>
    <button type="button" className="apemind-link-action" disabled={disabled} onClick={onDeviceLogin}>{t('deviceFallback')} <span aria-hidden="true">›</span></button>
    <p className="apemind-security-note"><span aria-hidden="true">▣</span> {t('localOnly')}</p>
  </section>
}

function ConnectedPanel({ t, oauth, disabled, onSelectWorkspace, onRefresh, onLogout, onKnowledge, oauthItems, hasMore, onLoadMore }: {
  t: LoginSectionProps['t']
  oauth: OAuthAccountView
  disabled: boolean
  onSelectWorkspace: (id: string) => void
  onRefresh: () => void
  onLogout: () => void
  onKnowledge: () => void
  oauthItems: KnowledgeBaseView[] | null
  hasMore: boolean
  onLoadMore: () => void
}): ReactNode {
  const active = oauth.workspaces.find(item => item.id === oauth.activeWorkspaceId && item.status === 'active')
  const organizations = oauth.workspaces.filter(item => item.type === 'organization')
  const personal = oauth.workspaces.find(item => item.type === 'personal')
  return <section className="apemind-connected-panel">
    <div className="apemind-connected-heading">
      <Mark className="apemind-connected-mark" />
      <div><h3>{t('connected')}</h3><p>{oauth.username}</p><p>{oauth.origin}</p></div>
      <span className="apemind-connected-status"><span aria-hidden="true">●</span> {t('connectedStatus')}</span>
    </div>
    <section className="apemind-current-space">
      <h4>{t('currentWorkspace')}</h4>
      {active
        ? <WorkspaceRow workspace={active} current disabled={disabled} onSelect={() => undefined} roleLabel={t('member')} currentLabel={t('currentBadge')} />
        : <p className="apemind-muted">{t('chooseWorkspace')}</p>}
      <p className="apemind-workspace-hint">{t('workspaceHint')}</p>
      <button type="button" className="apemind-quiet-action" disabled={disabled || !active} onClick={onKnowledge}>{t('viewKnowledge')}</button>
    </section>
    <section className="apemind-workspace-list">
      <h4>{t('availableSpaces')}</h4>
      {personal && personal.id !== active?.id && <WorkspaceRow workspace={personal} current={false} disabled={disabled} onSelect={() => onSelectWorkspace(personal.id)} roleLabel={t('personalSpace')} currentLabel={t('currentBadge')} />}
      {organizations.length === 0 && !personal
        ? <p className="apemind-muted">{t('noOrganizations')}</p>
        : organizations.map(workspace => <WorkspaceRow key={workspace.id} workspace={workspace} current={workspace.id === active?.id} disabled={disabled} onSelect={() => onSelectWorkspace(workspace.id)} roleLabel={workspace.role ?? t('member')} currentLabel={t('currentBadge')} />)}
    </section>
    <div className="apemind-connected-actions">
      <button type="button" className="apemind-secondary" disabled={disabled} onClick={onRefresh}>{t('refreshWorkspaces')}</button>
      <button type="button" className="apemind-danger-link" disabled={disabled} onClick={onLogout}>{t('signOut')}</button>
    </div>
    <KnowledgeList values={oauthItems} title={t('knowledge')} empty={t('knowledgeEmpty')} hasMore={hasMore} loadMoreLabel={t('loadMore')} disabled={disabled} onLoadMore={onLoadMore} />
  </section>
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
  const [keyCursor, setKeyCursor] = useState<string | null>(null)
  const [oauthCursor, setOAuthCursor] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [loginProgress, setLoginProgress] = useState<LoginProgress | null>(null)
  const alive = useRef(false)
  const pending = useRef(false)
  const active = state.connections.find(item => item.id === state.activeId)

  useEffect(() => {
    setKeyItems(null); setOAuthItems(null); setKeyCursor(null); setOAuthCursor(null)
    setMessage('')
  }, [state.activeId, state.oauth?.id, state.oauth?.activeWorkspaceId])

  useEffect(() => {
    alive.current = true
    let cancelled = false
    pending.current = true
    setBusy(true)
    void remote.state().then((result) => {
      if (cancelled) return
      if (result.ok) { setState(current => ({ ...current, ...result.value })); setWaiting(result.value.browserLoginPending ?? false); setLoginProgress(result.value.loginProgress ?? null) }
      else setError(result.error.message)
    }).catch(() => { if (!cancelled) setError(t('readError')) }).finally(() => {
      if (!cancelled) { pending.current = false; setBusy(false) }
    })
    return () => { cancelled = true; alive.current = false }
  }, [remote])

  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => {
      void remote.state().then(result => {
        if (!result.ok) return
        setLoginProgress(result.value.loginProgress ?? null)
        setWaiting(result.value.browserLoginPending ?? false)
      }).catch(() => undefined)
    }, 700)
    return () => window.clearInterval(timer)
  }, [remote, waiting])

  async function run(operation: () => Promise<void>, append = false): Promise<void> {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError(''); setMessage('')
    if (!append) { setKeyItems(null); setOAuthItems(null); setKeyCursor(null); setOAuthCursor(null) }
    try { await operation() } catch { if (alive.current) setError(t('operationError')) }
    finally {
      if (alive.current) {
        const latest = await remote.state().catch(() => undefined)
        if (latest?.ok) { setState(latest.value); setWaiting(latest.value.browserLoginPending ?? false); setLoginProgress(latest.value.loginProgress ?? null) }
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

  async function browserLogin(server = origin): Promise<void> {
    setWaiting(true)
    const result = await remote.startBrowserLogin(server)
    setWaiting(false)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setLoginProgress(null); setMessage(t('loggedIn')) }
    else if (result.error.code === 'gateway/cancelled') { setError(''); setMessage(t('cancelled')) }
    else setError(result.error.message)
  }

  async function deviceLogin(): Promise<void> {
    setWaiting(true)
    const result = await remote.startDeviceLogin(origin)
    setWaiting(false)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setLoginProgress(null); setMessage(t('loggedIn')) }
    else if (result.error.code === 'gateway/cancelled') { setError(''); setMessage(t('cancelled')) }
    else setError(result.error.message)
  }

  async function selectWorkspace(id: string): Promise<void> {
    if (!state.oauth) return
    const result = await remote.selectWorkspace(state.oauth.id, id)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setMessage(t('workspaceChanged')) }
    else setError(result.error.message)
  }

  async function oauthCollections(cursor?: string): Promise<void> {
    if (!state.oauth?.activeWorkspaceId) return
    const result = await remote.oauthCollections(state.oauth.id, state.oauth.activeWorkspaceId, cursor)
    if (!alive.current) return
    if (result.ok) {
      setOAuthItems(previous => cursor ? [...new Map([...(previous ?? []), ...result.value.items].map(item => [item.id, item])).values()] : result.value.items)
      setOAuthCursor(result.value.nextCursor)
      setMessage(t('knowledgeVerified', { name: result.value.workspace.name }))
    }
    else setError(result.error.message)
  }

  async function oauthLogout(): Promise<void> {
    if (!state.oauth) return
    const result = await remote.oauthLogout(state.oauth.id)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: null })); setOAuthItems(null); setKeyItems(null); setMessage(t('loggedOut')) }
    else setError(result.error.message)
  }

  async function select(id: string): Promise<void> {
    const result = await remote.select(id)
    if (!alive.current) return
    if (result.ok) { setState(result.value); setMessage(t('connectionSelected')) }
    else setError(result.error.message)
  }

  async function disconnect(id: string): Promise<void> {
    const result = await remote.disconnect(id)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, ...result.value })); setMessage(t('keyRemoved')) }
    else setError(result.error.message)
  }

  async function loadKnowledge(cursor?: string): Promise<void> {
    if (!state.activeId) return
    const result = await remote.collections(state.activeId, cursor)
    if (!alive.current) return
    if (result.ok) {
      setKeyItems(previous => cursor ? [...new Map([...(previous ?? []), ...result.value.items].map(item => [item.id, item])).values()] : result.value.items)
      setKeyCursor(result.value.nextCursor)
      setMessage(t('knowledgeVerified', { name: result.value.account.workspaceName }))
    }
    else setError(result.error.message)
  }

  async function refreshWorkspaces(): Promise<void> {
    if (!state.oauth) return
    const result = await remote.refreshWorkspaces(state.oauth.id)
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

  async function retryConnection(): Promise<void> {
    const result = await remote.state()
    if (!alive.current) return
    if (result.ok) setState(result.value)
    else setError(result.error.message)
  }

  const disabled = busy || waiting
  const oauth = state.oauth
  const credential = state.credentialStatus
  const models = state.modelConnections?.find(item => item.connectionId === (oauth?.id ?? state.activeId))
  const credentialAccount = [...(state.oauthConnections ?? []), ...state.connections]
    .find(item => item.id === credential?.connectionId)
  const needsSignIn = credential?.error === 'reauthentication_required'
  const connectionCount = (state.oauthConnections?.length ?? 0) + state.connections.length
  const showConnectionSelector = connectionCount > 1 || (connectionCount > 0 && !oauth && !state.activeId)

  return <section className="apemind-account" aria-busy={busy && !waiting}>
    <header className="apemind-header">
      <div className="apemind-heading-row"><Mark className="apemind-heading-mark" /><div><h2>{t('brand')}</h2><p className="apemind-muted">{t('subtitle')}</p></div></div>
    </header>
    {error && <div className="apemind-error" role="alert">{error}</div>}
    {!error && !waiting && (message || busy) && <div className="apemind-message" role="status" aria-live="polite">{busy ? t('busy') : message}</div>}
    {showConnectionSelector && <label>{t('currentConnection')}
      <select
        disabled={disabled}
        value={state.oauth?.id ?? state.activeId ?? credential?.connectionId ?? ''}
        onChange={(event) => { void run(() => select(event.target.value)) }}
      >
        <option value="" disabled>{t('chooseConnection')}</option>
        {state.oauthConnections?.map(item => <option key={item.id} value={item.id}>{item.username} · {item.origin}</option>)}
        {state.connections.map(item => <option key={item.id} value={item.id}>{item.username} · {item.workspaceName} · {t('apiKey')}</option>)}
      </select>
    </label>}
    {waiting && !oauth
      ? <WaitingPanel t={t} disabled={false} progress={loginProgress} onCancel={() => { void cancelLogin() }}
        onOpenDevicePage={async () => (await remote.openDevicePage()).ok} />
      : credential && !credential.available
        ? <section className="apemind-state-panel">
          <Mark className="apemind-state-mark" />
          <h3>{needsSignIn ? t('reauthenticationTitle') : t('credentialUnavailableTitle')}</h3>
          {credentialAccount && <p>{credentialAccount.username}<br />{credentialAccount.origin}</p>}
          <p role="alert">{needsSignIn ? t('reauthenticationDescription') : t('credentialUnavailableDescription')}</p>
          {needsSignIn && credentialAccount
            ? <button
              type="button" className="apemind-primary apemind-main-action" disabled={disabled}
              onClick={() => { void run(() => browserLogin(credentialAccount.origin)) }}
            >{t('signInAgain')}</button>
            : <button
              type="button" className="apemind-secondary" disabled={disabled}
              onClick={() => { void run(retryConnection) }}
            >{t('retryConnection')}</button>}
        </section>
        : oauth
          ? <ConnectedPanel
            t={t} oauth={oauth} disabled={disabled}
            onSelectWorkspace={(id) => { void run(() => selectWorkspace(id)) }}
            onRefresh={() => { void run(refreshWorkspaces) }} onLogout={() => { void run(oauthLogout) }}
            onKnowledge={() => { void run(oauthCollections) }} oauthItems={oauthItems} hasMore={Boolean(oauthCursor)}
            onLoadMore={() => { void run(() => oauthCollections(oauthCursor ?? undefined), true) }}
          />
          : <SignedOutPanel
            t={t} disabled={disabled} onBrowserLogin={() => { void run(browserLogin) }}
            onDeviceLogin={() => { void run(deviceLogin) }}
          />}
    {(oauth || active) && <section className="apemind-card">
      <h3>{t('modelTitle')}</h3>
      <p>{models?.error === 'model_authorization_required' ? t('modelReauthorize')
        : models?.error ? t('modelUnavailable')
          : !models ? t('modelLoading')
            : models.count ? t('modelReady', { count: models.count }) : t('modelEmpty')}</p>
      <p className="apemind-muted">{t('modelHint')}</p>
      <div className="apemind-actions">
        {models?.error === 'model_authorization_required' && oauth
          ? <button type="button" className="apemind-primary" disabled={disabled}
            onClick={() => { void run(() => browserLogin(oauth.origin)) }}>{t('modelAuthorize')}</button>
          : <button type="button" disabled={disabled} onClick={() => { void run(async () => {
            const result = await remote.refreshModels()
            if (result.ok) setState(result.value)
            else setError(result.error.message)
          }) }}>{t('modelRefresh')}</button>}
      </div>
    </section>}
    <details className="apemind-advanced">
      <summary><span aria-hidden="true">⚙</span> {t('advanced')}</summary>
      <div className="apemind-advanced-content">
        <details className="apemind-service-address"><summary>{t('serverAddress')}</summary><label>{t('server')}<input required type="url" disabled={disabled} value={origin} onChange={(event) => { setOrigin(event.target.value) }} /></label></details>
        {state.connections.length > 0 && <section className="apemind-card apemind-key-connection">
          <label>{t('currentKey')}
            <select disabled={disabled} value={state.activeId ?? ''} onChange={(event) => { void run(() => select(event.target.value)) }}>
              <option value="" disabled>{t('chooseConnection')}</option>
              {state.connections.map(item => <option key={item.id} value={item.id}>{item.workspaceName} · {item.username}</option>)}
            </select>
          </label>
          {active && <><p>{active.origin}</p><div className="apemind-actions"><button disabled={disabled} onClick={() => { void run(loadKnowledge) }}>{t('viewKnowledge')}</button><button disabled={disabled} onClick={() => { void run(() => disconnect(active.id)) }}>{t('removeConnection')}</button></div><KnowledgeList values={keyItems} title={t('knowledge')} empty={t('knowledgeEmpty')} hasMore={Boolean(keyCursor)} loadMoreLabel={t('loadMore')} disabled={disabled} onLoadMore={() => { void run(() => loadKnowledge(keyCursor ?? undefined), true) }} /></>}
        </section>}
        <form className="apemind-card" onSubmit={(event) => { event.preventDefault(); void run(connect) }}>
          <h3>{t('addKey')}</h3>
          <p className="apemind-muted">{t('advancedHint')}</p>
          <label>{t('apiKey')}<input required type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} disabled={disabled} value={apiKey} onChange={(event) => { setApiKey(event.target.value) }} placeholder={t('keyPlaceholder')} /></label>
          <label className="apemind-checkbox"><input type="checkbox" checked={showKey} disabled={disabled} onChange={(event) => { setShowKey(event.target.checked) }} />{t('showKey')}</label>
          <div className="apemind-actions"><button type="submit" disabled={disabled || !apiKey.trim() || !origin.trim()}>{t('verifyConnect')}</button></div>
        </form>
      </div>
    </details>
    <footer className="apemind-runtime-info">
      <p>{t('cliVersion')} <span>{state.cliVersion ?? t('versionUnavailable')}</span></p>
      {credential?.storage && <p>
        {t('credentialStorage')} <span>{credential.storage === 'system' ? t('systemStorage') : t('encryptedFileStorage')}</span>
      </p>}
    </footer>
  </section>
}

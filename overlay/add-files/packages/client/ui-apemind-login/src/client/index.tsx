import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-apemind-login/remote'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountState, AccountView, LoginProgress, OAuthAccountView } from '@deepseek-ai/dsh-apemind-login/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { zh, en, type LoginLocaleKey } from './locales.ts'
import { APEMIND_MARK_DATA_URI } from './brand-mark.ts'
import './style.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.apemind': LoginLocaleKey }
}

const NS = 'settings.apemind'
type ConnectedAccount = AccountView | OAuthAccountView

/** Keep links inside the two web protocols supported by the external browser. */
function webUrl(value: string | undefined): string {
  try {
    const parsed = new URL(value || 'https://apemind.ai')
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.origin
  } catch { /* fall through to the public ApeMind site */ }
  return 'https://apemind.ai'
}

/** The Host keeps the CLI error code in Remote details for localized recovery. */
function cliErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const details = (error as { details?: unknown }).details
  if (!details || typeof details !== 'object') return undefined
  const code = (details as { cliCode?: unknown }).cliCode
  return typeof code === 'string' ? code : undefined
}

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

function WebLink({ t, href, primary = false }: {
  t: LoginSectionProps['t']
  href: string
  primary?: boolean
}): ReactNode {
  return <a
    className={primary ? 'apemind-primary apemind-main-action apemind-web-action' : 'apemind-link-action'}
    href={href} target="_blank" rel="noreferrer"
  >{t('openApeMind')} <span aria-hidden="true">↗</span></a>
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

function SignedOutPanel({ t, disabled, webHref, onBrowserLogin, onDeviceLogin }: {
  t: LoginSectionProps['t']
  disabled: boolean
  webHref: string
  onBrowserLogin: () => void
  onDeviceLogin: () => void
}): ReactNode {
  return <section className="apemind-state-panel apemind-connect-panel">
    <Mark className="apemind-state-mark" />
    <h3>{t('connectTitle')}</h3>
    <p>{t('connectDescription')}</p>
    <button type="button" className="apemind-primary apemind-main-action" disabled={disabled} onClick={onBrowserLogin}>{t('browserSignIn')} <span aria-hidden="true">↗</span></button>
    <button type="button" className="apemind-link-action" disabled={disabled} onClick={onDeviceLogin}>{t('deviceFallback')} <span aria-hidden="true">›</span></button>
    <WebLink t={t} href={webHref} />
    <p className="apemind-security-note"><span aria-hidden="true">▣</span> {t('localOnly')}</p>
  </section>
}

function ConnectedPanel({ t, account, disabled, webHref, onReauthenticate, onSignOut }: {
  t: LoginSectionProps['t']
  account: ConnectedAccount
  disabled: boolean
  webHref: string
  onReauthenticate: (() => void) | undefined
  onSignOut: () => void
}): ReactNode {
  const oauth = onReauthenticate !== undefined
  return <section className="apemind-connected-panel">
    <div className="apemind-connected-heading">
      <Mark className="apemind-connected-mark" />
      <div><h3>{t('connected')}</h3><p>{account.username}</p><p>{account.origin}</p></div>
      <span className="apemind-connected-status"><span aria-hidden="true">●</span> {t('connectedStatus')}</span>
    </div>
    <div className="apemind-connected-body">
      <p>{t('connectedDescription')}</p>
      <WebLink t={t} href={webHref} primary />
    </div>
    <div className="apemind-connected-actions">
      {oauth && <button type="button" className="apemind-secondary" disabled={disabled} onClick={onReauthenticate}>{t('signInAgain')}</button>}
      <button type="button" className="apemind-danger-link" disabled={disabled} onClick={onSignOut}>{t(oauth ? 'signOut' : 'removeConnection')}</button>
    </div>
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
  const [waiting, setWaiting] = useState(false)
  const [loginProgress, setLoginProgress] = useState<LoginProgress | null>(null)
  const [loginConflict, setLoginConflict] = useState(false)
  const alive = useRef(false)
  const pending = useRef(false)
  const active = state.connections.find(item => item.id === state.activeId)
  const oauth = state.oauth
  const connectedAccount = oauth ?? active

  useEffect(() => {
    alive.current = true
    let cancelled = false
    pending.current = true
    setBusy(true)
    void remote.state().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setState(current => ({ ...current, ...result.value }))
        setWaiting(result.value.browserLoginPending ?? false)
        setLoginProgress(result.value.loginProgress ?? null)
      } else setError(result.error.message)
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

  async function run(operation: () => Promise<void>): Promise<void> {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError(''); setMessage('')
    try { await operation() } catch { if (alive.current) setError(t('operationError')) }
    finally {
      if (alive.current) {
        const latest = await remote.state().catch(() => undefined)
        if (latest?.ok) {
          setState(latest.value)
          setWaiting(latest.value.browserLoginPending ?? false)
          setLoginProgress(latest.value.loginProgress ?? null)
        }
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

  async function browserLogin(server = origin, connectionId?: string): Promise<void> {
    setLoginConflict(false)
    setWaiting(true)
    const result = connectionId
      ? await remote.startBrowserLogin(server, connectionId)
      : await remote.startBrowserLogin(server)
    setWaiting(false)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setLoginProgress(null); setMessage(t('loggedIn')) }
    else if (result.error.code === 'gateway/cancelled') { setError(''); setMessage(t('cancelled')) }
    else if (connectionId && cliErrorCode(result.error) === 'identity_changed') {
      setError(''); setLoginConflict(true)
    } else setError(result.error.message)
  }

  async function deviceLogin(): Promise<void> {
    setLoginConflict(false)
    setWaiting(true)
    const result = await remote.startDeviceLogin(origin)
    setWaiting(false)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setLoginProgress(null); setMessage(t('loggedIn')) }
    else if (result.error.code === 'gateway/cancelled') { setError(''); setMessage(t('cancelled')) }
    else setError(result.error.message)
  }

  async function oauthLogout(): Promise<void> {
    if (!oauth) return
    const result = await remote.oauthLogout(oauth.id)
    if (!alive.current) return
    if (result.ok) { setLoginConflict(false); setState(current => ({ ...current, oauth: null })); setMessage(t('loggedOut')) }
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
  const credential = state.credentialStatus
  const credentialAccount = [...(state.oauthConnections ?? []), ...state.connections]
    .find(item => item.id === credential?.connectionId)
  const needsSignIn = credential?.error === 'reauthentication_required'
  const connectionCount = (state.oauthConnections?.length ?? 0) + state.connections.length
  const showConnectionSelector = connectionCount > 1 || (connectionCount > 0 && !connectedAccount)
  const connectedWebHref = webUrl(connectedAccount?.origin ?? origin)

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
        {state.connections.map(item => <option key={item.id} value={item.id}>{item.username} · {item.origin} · {t('apiKey')}</option>)}
      </select>
    </label>}
    {waiting && !connectedAccount
      ? <WaitingPanel t={t} disabled={false} progress={loginProgress} onCancel={() => { void cancelLogin() }}
        onOpenDevicePage={async () => (await remote.openDevicePage()).ok} />
      : credential && !credential.available
        ? <section className="apemind-state-panel">
          <Mark className="apemind-state-mark" />
          <h3>{loginConflict ? t('accountConflictTitle') : needsSignIn ? t('reauthenticationTitle') : t('credentialUnavailableTitle')}</h3>
          {credentialAccount && <p>{credentialAccount.username}<br />{credentialAccount.origin}</p>}
          <p role="alert">{loginConflict ? t('accountConflictDescription') : needsSignIn ? t('reauthenticationDescription') : t('credentialUnavailableDescription')}</p>
          {loginConflict && credentialAccount
            ? <div className="apemind-conflict-actions">
              <button
                type="button" className="apemind-primary apemind-main-action" disabled={disabled}
                onClick={() => { void run(() => browserLogin(credentialAccount.origin)) }}
              >{t('useCurrentAccount')}</button>
              <button
                type="button" className="apemind-secondary" disabled={disabled}
                onClick={() => { void run(() => browserLogin(credentialAccount.origin, credentialAccount.id)) }}
              >{t('retrySavedConnection')}</button>
            </div>
            : needsSignIn && credentialAccount
              ? <button
                type="button" className="apemind-primary apemind-main-action" disabled={disabled}
                onClick={() => { void run(() => browserLogin(credentialAccount.origin, credentialAccount.id)) }}
              >{t('signInAgain')}</button>
            : <button
              type="button" className="apemind-secondary" disabled={disabled}
              onClick={() => { void run(retryConnection) }}
            >{t('retryConnection')}</button>}
          <WebLink t={t} href={webUrl(credentialAccount?.origin ?? origin)} />
        </section>
        : connectedAccount
          ? <ConnectedPanel
            t={t} account={connectedAccount} disabled={disabled} webHref={connectedWebHref}
            onReauthenticate={oauth ? () => { void run(() => browserLogin(oauth.origin, oauth.id)) } : undefined}
            onSignOut={oauth ? () => { void run(oauthLogout) } : () => { void run(() => disconnect(active!.id)) }}
          />
          : <SignedOutPanel
            t={t} disabled={disabled} webHref={webUrl(origin)} onBrowserLogin={() => { void run(browserLogin) }}
            onDeviceLogin={() => { void run(deviceLogin) }}
          />}
    <details className="apemind-advanced">
      <summary><span aria-hidden="true">⚙</span> {t('advanced')}</summary>
      <div className="apemind-advanced-content">
        <details className="apemind-service-address"><summary>{t('serverAddress')}</summary><label>{t('server')}<input required type="url" disabled={disabled} value={origin} onChange={(event) => { setOrigin(event.target.value) }} /></label></details>
        {state.connections.length > 0 && <section className="apemind-card apemind-key-connection">
          <label>{t('currentKey')}
            <select disabled={disabled} value={state.activeId ?? ''} onChange={(event) => { void run(() => select(event.target.value)) }}>
              <option value="" disabled>{t('chooseConnection')}</option>
              {state.connections.map(item => <option key={item.id} value={item.id}>{item.username} · {item.origin}</option>)}
            </select>
          </label>
          {active && !connectedAccount && <div className="apemind-actions"><button disabled={disabled} onClick={() => { void run(() => disconnect(active.id)) }}>{t('removeConnection')}</button></div>}
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

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-apemind-login/remote'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountState, KnowledgeBaseView } from '@deepseek-ai/dsh-apemind-login/types'
import './style.css'

export const inject = ['slots', 'remote', 'remote.apemindAuth']
export interface LoginSectionInjected { readonly login: ClientContext }
export type LoginSectionProps = PropsRuntime<'settings.section'> & InjectFace<LoginSectionInjected>

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'apemind-login', order: 30,
    label: () => 'ApeMind', inject: (): LoginSectionInjected => ({ login: ctx }),
  }, LoginSection))
}

export function LoginSection(props: LoginSectionProps): ReactNode {
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
    }).catch(() => { if (!cancelled) setError('无法读取连接状态，请重新打开设置页。') }).finally(() => {
      if (!cancelled) { pending.current = false; setBusy(false) }
    })
    return () => { cancelled = true; alive.current = false }
  }, [remote])

  async function run(operation: () => Promise<void>): Promise<void> {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError(''); setMessage(''); setKeyItems(null); setOAuthItems(null)
    try { await operation() } catch { if (alive.current) setError('连接操作未完成，请检查网络后重试。') }
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
    if (result.ok) { setState(current => ({ ...current, ...result.value })); setMessage('已通过 ApeMind 验证并保存连接。') }
    else setError(result.error.message)
  }

  async function browserLogin(): Promise<void> {
    setWaiting(true)
    const result = await remote.startBrowserLogin(origin)
    setWaiting(false)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setMessage('已登录 ApeMind，并同步工作空间。') }
    else setError(result.error.message)
  }

  async function selectWorkspace(id: string): Promise<void> {
    const result = await remote.selectWorkspace(id)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setMessage('工作空间已切换。') }
    else setError(result.error.message)
  }

  async function oauthCollections(): Promise<void> {
    const result = await remote.oauthCollections()
    if (!alive.current) return
    if (result.ok) { setOAuthItems(result.value.items); setMessage(`已验证 ${result.value.workspace.name} 的知识库访问权限。`) }
    else setError(result.error.message)
  }

  async function oauthLogout(): Promise<void> {
    const result = await remote.oauthLogout()
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: null })); setOAuthItems(null); setKeyItems(null); setMessage('已退出 ApeMind。') }
    else setError(result.error.message)
  }

  async function select(id: string): Promise<void> {
    const result = await remote.select(id)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, ...result.value })); setMessage('工作空间已验证。后续调用使用该连接的 Key。') }
    else setError(result.error.message)
  }

  async function disconnect(id: string): Promise<void> {
    const result = await remote.disconnect(id)
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, ...result.value })); setMessage('已从此设备移除连接，服务端 Key 未撤销。') }
    else setError(result.error.message)
  }

  async function loadKnowledge(): Promise<void> {
    const result = await remote.collections()
    if (!alive.current) return
    if (result.ok) { setKeyItems(result.value.items); setMessage(`已验证 ${result.value.account.workspaceName} 的知识库访问权限。`) }
    else setError(result.error.message)
  }

  async function refreshWorkspaces(): Promise<void> {
    const result = await remote.refreshWorkspaces()
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: result.value })); setMessage('工作空间列表已更新。') }
    else setError(result.error.message)
  }

  async function cancelLogin(): Promise<void> {
    const result = await remote.cancelBrowserLogin()
    if (!alive.current) return
    if (!result.ok) setError(result.error.message)
    else { setWaiting(false); setMessage('已取消浏览器登录。') }
  }

  const disabled = busy || waiting
  const oauth = state.oauth
  function knowledgeList(values: KnowledgeBaseView[] | null): ReactNode {
    return values !== null && <div className="apemind-knowledge">
      <h4>知识库 <small>最多显示 20 个</small></h4>
      {values.length === 0 ? <p className="apemind-muted">此工作空间暂无可访问的知识库。</p>
        : <ul>{values.map(item => <li key={item.id}>{item.name}</li>)}</ul>}
    </div>
  }

  return <section className="apemind-account" aria-busy={busy}>
    <header><h2>ApeMind</h2><p className="apemind-muted">连接你的个人空间和组织，访问企业知识。</p></header>
    {error && <div className="apemind-error" role="alert">{error}</div>}
    <div role="status" aria-live="polite">{waiting ? '请在系统浏览器中完成授权…' : busy ? '正在连接，请稍候…' : message}</div>
    <section className="apemind-card">
      <h3>{oauth ? '已连接 ApeMind' : '登录 ApeMind'}</h3>
      {oauth ? <>
        <div><strong>{oauth.username}</strong><p className="apemind-muted">{oauth.origin}</p></div>
        <label>当前工作空间
          <select disabled={disabled} value={oauth.activeWorkspaceId ?? ''} onChange={(event) => { void run(() => selectWorkspace(event.target.value)) }}>
            <option value="" disabled>选择工作空间</option>
            {oauth.workspaces.map(workspace => <option key={workspace.id} value={workspace.id} disabled={workspace.status !== 'active'}>
              {workspace.name}{workspace.status !== 'active' ? '（已暂停）' : workspace.type === 'personal' ? ' · 个人' : ' · 组织'}
            </option>)}
          </select>
        </label>
        <p className="apemind-muted">列表更新于 {new Date(oauth.verifiedAt).toLocaleString()}。每次访问均按服务端当前权限校验。</p>
        <div className="apemind-actions">
          <button className="apemind-primary" disabled={disabled || !oauth.activeWorkspaceId} onClick={() => { void run(oauthCollections) }}>查看知识库</button>
          <button disabled={disabled} onClick={() => { void run(refreshWorkspaces) }}>刷新工作空间</button>
          <button disabled={disabled} onClick={() => { void run(oauthLogout) }}>退出登录</button>
        </div>
        {knowledgeList(oauthItems)}
      </> : <>
        <p>一次登录，自动连接个人空间和你加入的组织。</p>
        <p className="apemind-muted">在系统浏览器中安全完成授权，无需创建或复制 API Key。</p>
        <div className="apemind-actions">
          <button className="apemind-primary" disabled={disabled} onClick={() => { void run(browserLogin) }}>在浏览器中登录</button>
          {waiting && <button onClick={() => { void cancelLogin() }}>取消登录</button>}
        </div>
        <details><summary>服务地址</summary><label>ApeMind 服务<input required type="url" disabled={disabled} value={origin} onChange={(event) => { setOrigin(event.target.value) }} /></label></details>
      </>}
    </section>
    <details className="apemind-advanced"><summary>高级连接 · 使用 API Key{state.connections.length > 0 ? `（${String(state.connections.length)} 个连接）` : ''}</summary>
      <p className="apemind-muted">适用于开发者或已有 Key 的部署。每个连接受 Key 的工作空间与权限范围限制。</p>
      {state.connections.length > 0 && <section className="apemind-card">
        <label>当前 API Key 连接
          <select disabled={disabled} value={state.activeId ?? ''} onChange={(event) => { void run(() => select(event.target.value)) }}>
            <option value="" disabled>选择已保存的连接</option>
            {state.connections.map(item => <option key={item.id} value={item.id}>{item.workspaceName} · {item.username}</option>)}
          </select>
        </label>
        {active && <>
          <p>{active.origin}</p>
          <div className="apemind-actions">
            <button disabled={disabled} onClick={() => { void run(loadKnowledge) }}>查看知识库</button>
            <button disabled={disabled} onClick={() => { void run(() => select(active.id)) }}>重新验证</button>
            <button disabled={disabled} onClick={() => { void run(() => disconnect(active.id)) }}>移除此连接</button>
          </div>
          {knowledgeList(keyItems)}
        </>}
      </section>}
      <form className="apemind-card" onSubmit={(event) => { event.preventDefault(); void run(connect) }}>
        <h3>添加 API Key 连接</h3>
        <label>服务地址<input required type="url" autoComplete="url" disabled={disabled} value={origin} onChange={(event) => { setOrigin(event.target.value) }} /></label>
        <label>API Key<input required type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} disabled={disabled} value={apiKey} onChange={(event) => { setApiKey(event.target.value) }} placeholder="粘贴个人或组织 API Key" /></label>
        <label className="apemind-checkbox"><input type="checkbox" checked={showKey} disabled={disabled} onChange={(event) => { setShowKey(event.target.checked) }} />显示 API Key</label>
        <div className="apemind-actions"><button type="submit" disabled={disabled || !apiKey.trim() || !origin.trim()}>验证并连接</button></div>
      </form>
    </details>
  </section>
}

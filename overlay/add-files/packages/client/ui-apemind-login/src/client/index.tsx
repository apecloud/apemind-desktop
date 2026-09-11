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
  const [items, setItems] = useState<KnowledgeBaseView[] | null>(null)
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
      if (result.ok) setState(result.value)
      else setError(result.error.message)
    }).catch(() => { if (!cancelled) setError('无法读取连接状态，请重新打开设置页。') }).finally(() => {
      if (!cancelled) { pending.current = false; setBusy(false) }
    })
    return () => { cancelled = true; alive.current = false }
  }, [remote])

  async function run(operation: () => Promise<void>): Promise<void> {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError(''); setMessage(''); setItems(null)
    try { await operation() } catch { if (alive.current) setError('连接操作未完成，请检查网络后重试。') }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }

  async function connect(): Promise<void> {
    const secret = apiKey
    setApiKey(''); setShowKey(false)
    const result = await remote.connect(origin, secret)
    if (!alive.current) return
    if (result.ok) { setState(result.value); setMessage('已通过 ApeMind 验证并保存连接。') }
    else setError(result.error.message)
  }

  async function browserLogin(): Promise<void> {
    const result = await remote.startBrowserLogin(origin)
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
    if (result.ok) { setItems(result.value.items); setMessage(`已验证 ${result.value.workspace.name} 的知识库访问权限。`) }
    else setError(result.error.message)
  }

  async function oauthLogout(): Promise<void> {
    const result = await remote.oauthLogout()
    if (!alive.current) return
    if (result.ok) { setState(current => ({ ...current, oauth: null })); setItems(null); setMessage('已退出 ApeMind。') }
    else setError(result.error.message)
  }

  async function select(id: string): Promise<void> {
    const result = await remote.select(id)
    if (!alive.current) return
    if (result.ok) { setState(result.value); setMessage('工作空间已验证。后续调用使用该连接的 Key。') }
    else setError(result.error.message)
  }

  async function disconnect(id: string): Promise<void> {
    const result = await remote.disconnect(id)
    if (!alive.current) return
    if (result.ok) { setState(result.value); setMessage('已从此设备移除连接，服务端 Key 未撤销。') }
    else setError(result.error.message)
  }

  async function loadKnowledge(): Promise<void> {
    const result = await remote.collections()
    if (!alive.current) return
    if (result.ok) { setItems(result.value.items); setMessage(`已验证 ${result.value.account.workspaceName} 的知识库访问权限。`) }
    else setError(result.error.message)
  }

  return <section className="apemind-account" aria-busy={busy}>
    <header><h2>ApeMind</h2><p>连接企业知识与业务能力。每个工作空间使用自己的 API Key。</p></header>
    {error && <div className="apemind-error" role="alert">{error}</div>}
    <div role="status" aria-live="polite">{busy ? '正在验证，请稍候…' : message}</div>
    {state.connections.length > 0 && <section className="apemind-card">
      <h3>已连接的工作空间</h3>
      <label>当前工作空间
        <select disabled={busy} value={state.activeId ?? ''} onChange={(event) => { void run(() => select(event.target.value)) }}>
          <option value="" disabled>选择一个已连接的工作空间</option>
          {state.connections.map(item => <option key={item.id} value={item.id}>
            {item.workspaceName} · {item.username} · {item.origin}
          </option>)}
        </select>
      </label>
      <details><summary>管理已保存连接</summary><ul>{state.connections.map(item => <li key={item.id}>
        {item.workspaceName} · {item.username} · {item.origin}
        <button type="button" disabled={busy} aria-label={`移除 ${item.workspaceName} 的连接`} onClick={() => { void run(() => disconnect(item.id)) }}>移除</button>
      </li>)}</ul></details>
      {active && <>
        <dl><dt>账户</dt><dd>{active.username}</dd><dt>服务地址</dt><dd>{active.origin}</dd>
          <dt>工作空间</dt><dd>{active.workspaceName}{active.orgId ? ` (${active.orgId})` : ''}</dd>
          <dt>组织角色</dt><dd>{active.role ?? '个人空间'}</dd>
          <dt>上次验证</dt><dd>{new Date(active.verifiedAt).toLocaleString()}</dd></dl>
        <p className="apemind-muted">保存的账户信息仅供展示，每次操作都由服务端重新校验权限。</p>
        {active.permissions.length > 0 && <details>
          <summary>查看组织权限</summary>
          <ul>{active.permissions.map(permission => <li key={permission}>{permission}</li>)}</ul>
          <p>实际访问同时受 API Key 范围限制。</p>
        </details>}
        <div className="apemind-actions">
          <button disabled={busy} onClick={() => { void run(() => select(active.id)) }}>重新验证</button>
          <button disabled={busy} onClick={() => { void run(loadKnowledge) }}>查看知识库</button>
          <button disabled={busy} onClick={() => { void run(() => disconnect(active.id)) }}>移除此连接</button>
        </div>
        {items !== null && <div>
          <h4>可访问知识库（最多 20 个）</h4>
          {items.length === 0 ? <p>当前工作空间没有可访问的知识库。</p>
            : <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>}
        </div>}
      </>}
    </section>}
    <section className="apemind-card">
      <h3>{state.oauth ? 'ApeMind 已登录' : '浏览器登录 ApeMind'}</h3>
      {state.oauth ? <>
        <p>{state.oauth.username}</p>
        <label>当前工作空间
          <select disabled={busy} value={state.oauth.activeWorkspaceId ?? ''} onChange={(event) => { void run(() => selectWorkspace(event.target.value)) }}>
            {state.oauth.workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.type === 'personal' ? '个人空间' : workspace.role ?? '组织'}</option>)}
          </select>
        </label>
        <div className="apemind-actions"><button disabled={busy} onClick={() => { void run(oauthCollections) }}>查看知识库</button><button disabled={busy} onClick={() => { void run(oauthLogout) }}>退出</button></div>
      </> : <>
        <p className="apemind-muted">将在系统浏览器中完成登录，登录后自动同步个人空间和组织。</p>
        <button disabled={busy} onClick={() => { void run(browserLogin) }}>在浏览器中登录</button>
      </>}
    </section>
    <form className="apemind-card" onSubmit={(event) => { event.preventDefault(); void run(connect) }}>
      <h3>{state.connections.length ? '连接另一个工作空间' : '连接 ApeMind'}</h3>
      <label>服务地址<input required type="url" autoComplete="url" disabled={busy} value={origin} onChange={(event) => { setOrigin(event.target.value) }} placeholder="https://你的 ApeMind 服务地址" /></label>
      <label>API Key<input required type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} disabled={busy} value={apiKey} onChange={(event) => { setApiKey(event.target.value) }} placeholder="粘贴个人或组织 API Key" /></label>
      <label className="apemind-checkbox"><input type="checkbox" checked={showKey} disabled={busy} onChange={(event) => { setShowKey(event.target.checked) }} />显示 API Key</label>
      <p className="apemind-muted">在 ApeMind 的 API Key 设置中创建对应工作空间的 Key。组织 Key 只能访问它绑定的组织。</p>
      <div className="apemind-actions"><button type="submit" disabled={busy || !apiKey.trim() || !origin.trim()}>验证并连接</button></div>
    </form>
  </section>
}

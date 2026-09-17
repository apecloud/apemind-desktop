import { Context, Service } from '@deepseek-ai/cordis'
import { LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-fs'
import { CliError, CliProcess } from './cli-process.ts'
import { startModelBridge, type ModelBridge } from './model-bridge.ts'
import type { ModelConnectionStatus } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { apemindModels: ApeMindModels }
}

interface Connection { id: string; username: string; server: string; user_id: string; kind: string }
interface Model {
  id: string
  name: string
  source: { kind: string; id: string; name: string }
  context_window: number | null
  max_output_tokens: number | null
  supports_vision: boolean
  supports_tool_calling: boolean
}
interface Entry { connection: Connection; bridge: ModelBridge; models: Model[] }

/** Keeps model routes bound to their account, independently of knowledge navigation. */
export class ApeMindModels extends Service {
  static inject = ['llm']
  private readonly cli = new CliProcess()
  private entries = new Map<string, Entry>()
  private profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> = new Map()
  private readonly keys = new WeakMap<ResolvedPiAiProviderProfile, string>()
  private registration: AdapterRegistrationHandle | undefined
  private pending: Promise<void> | undefined
  private disposed = false
  private statuses: ModelConnectionStatus[] = []
  private readonly adapter: PiAiAdapter

  constructor(ctx: Context) {
    super(ctx, 'apemindModels')
    this.adapter = new PiAiAdapter({
      profiles: () => this.profiles,
      resolveApiKey: async (_provider, profile) => {
        const key = this.keys.get(profile)
        if (!key) throw new LlmError('请重新连接 ApeMind 模型。', 'MISSING_CREDENTIAL')
        return key
      },
      // This adapter has no provider login flows or ambient credential lookup.
      // The only key is a Host-private, short-lived loopback capability.
      auth: {
        credentials: {
          read: async provider => {
            const profile = this.profiles.get(provider)
            const key = profile && this.keys.get(profile)
            return key ? { type: 'api_key', key } : undefined
          },
          list: async () => [...this.profiles.keys()].map(providerId => ({ providerId, type: 'api_key' as const })),
          modify: async () => { throw new Error('ApeMind credentials are managed by CLI') },
          delete: async () => {},
        },
        authContext: { env: async () => undefined, fileExists: async () => false },
      },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
        attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref,
      ),
    })
    void this.refresh()
    const timer = setInterval(() => { void this.refresh() }, 5 * 60_000)
    timer.unref()
    ctx.effect(() => () => {
      this.disposed = true
      clearInterval(timer)
      for (const entry of this.entries.values()) entry.bridge.stop()
      this.entries.clear()
    }, 'apemind-models: close CLI bridges')
  }

  state(): ModelConnectionStatus[] { return this.statuses.map(status => ({ ...status })) }

  refresh(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.pending && !force) return this.pending
    const next = (this.pending ?? Promise.resolve()).then(() => this.disposed ? undefined : this.sync())
    this.pending = next
    void next.finally(() => { if (this.pending === next) this.pending = undefined })
    return next
  }

  private publish(): void {
    if (this.disposed) return
    const configs: Record<string, PiAiProviderProfile> = {}
    for (const [id, entry] of this.entries) {
      configs[`apemind-${id}`] = {
        displayName: `ApeMind · ${entry.connection.username} · ${new URL(entry.connection.server).hostname}`,
        api: 'openai-completions', baseURL: entry.bridge.baseURL,
        defaultContextWindow: 32_768, defaultMaxTokens: 4_096,
        // Requests cannot outgrow the CLI bridge's 16 MiB bound.
        maxRequestImageBytes: 8 * 1024 * 1024,
        models: entry.models.map(model => ({
          id: model.id, name: `${model.name} · ${model.source.name}`,
          ...(model.context_window ? { contextWindow: model.context_window } : {}),
          ...(model.max_output_tokens ? { maxTokens: model.max_output_tokens } : {}),
          input: model.supports_vision ? ['text', 'image'] : ['text'],
        })),
      }
    }
    const profiles = resolveProfiles(configs)
    for (const [id, entry] of this.entries) {
      const profile = profiles.get(`apemind-${id}`)
      if (profile) this.keys.set(profile, entry.bridge.apiKey)
    }
    this.profiles = profiles
    const routes = [...profiles.keys()]
    if (this.registration) this.registration.replace(routes)
    else if (routes.length) this.registration = this.ctx.llm.registerAdapter(routes, this.adapter)
  }

  private async sync(): Promise<void> {
    try {
      const { items } = await this.cli.run<{ items: Connection[] }>(['connection', 'list'])
      if (this.disposed) return
      const ids = new Set(items.map(item => item.id))
      for (const [id, entry] of this.entries) {
        if (!ids.has(id)) { entry.bridge.stop(); this.entries.delete(id) }
      }
      this.publish()
      const statuses: ModelConnectionStatus[] = []
      for (const connection of items) {
        try {
          const result = await this.cli.run<{ items: Model[] }>(['model', 'list', '--connection', connection.id])
          if (this.disposed) return
          let entry = this.entries.get(connection.id)
          if (entry && (entry.connection.user_id !== connection.user_id || entry.connection.server !== connection.server || entry.connection.kind !== connection.kind)) {
            entry.bridge.stop(); this.entries.delete(connection.id); entry = undefined
          }
          if (entry && result.items.length === 0) {
            entry.bridge.stop(); this.entries.delete(connection.id); entry = undefined
          }
          if (!entry && result.items.length) {
            const bridge = await startModelBridge(this.cli, connection.id, () => {
              const current = this.entries.get(connection.id)
              if (current?.bridge !== bridge) return
              this.entries.delete(connection.id)
              this.statuses = this.statuses.map(s => s.connectionId === connection.id ? { ...s, error: 'model_unavailable' } : s)
              this.publish()
            })
            if (this.disposed) { bridge.stop(); return }
            entry = { connection, bridge, models: result.items }
          }
          if (entry) {
            entry.models = result.items
            this.entries.set(connection.id, entry)
          }
          statuses.push({ connectionId: connection.id, count: result.items.length, error: null })
        } catch (error) {
          const code = error instanceof CliError ? error.code : 'model_unavailable'
          // Never hide a cached directory for a transient network failure.
          // Authorization failures withdraw it; the server rejects each call too.
          if (['authentication_required', 'model_authorization_required', 'credential_unavailable', 'permission_denied', 'invalid_grant', 'identity_changed', 'reauthentication_required'].includes(code)) {
            this.entries.get(connection.id)?.bridge.stop()
            this.entries.delete(connection.id)
          }
          statuses.push({ connectionId: connection.id, count: this.entries.get(connection.id)?.models.length ?? 0, error: code })
        }
      }
      this.statuses = statuses
      this.publish()
    } catch {
      // A CLI/store failure cannot be repaired by borrowing another identity.
      this.statuses = this.statuses.map(status => ({ ...status, error: 'model_unavailable' }))
    }
  }
}

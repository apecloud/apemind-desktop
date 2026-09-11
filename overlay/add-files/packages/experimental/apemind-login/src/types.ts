/**
 * Client-safe wire types for the `authorization` Remote namespace: the flow
 * catalog, one live attempt's prompt/notice, and the answer payload. Types
 * only — no Host-only symbol reaches this module.
 *
 * @module @deepseek-ai/dsh-apemind-login/types
 */

/** One notice the page shows while an attempt runs. */
export interface PendingNotice {
  readonly message: string
  readonly url?: string | undefined
  readonly code?: string | undefined
}

/** One prompt the page must answer, addressed by its id. */
export interface PendingPrompt {
  readonly id: string
  readonly message: string
  readonly kind: 'text' | 'secret' | 'select'
  readonly placeholder?: string | undefined
  readonly options?: readonly { id: string; label: string }[] | undefined
}

/** Snapshot of one live attempt for a settings page. */
export interface AuthorizationAttemptView {
  readonly key: string
  readonly method: string
  readonly notice?: PendingNotice | undefined
  readonly prompt?: PendingPrompt | undefined
}

/** The flow catalog entry a page renders. */
export interface AuthorizationFlowView {
  readonly key: string
  readonly label: string
  readonly methods: readonly { id: string; label: string }[]
}

/** One answer the page submits for a pending prompt. */
export interface AuthorizationAnswer {
  readonly id: string
  readonly value: string
  readonly declined?: boolean | undefined
}

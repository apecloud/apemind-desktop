import type { Context } from '@deepseek-ai/cordis'
import { AuthorizationController } from './controller.ts'

export { AuthorizationController } from './controller.ts'

export const inject = ['credentials']
export type * from './types.ts'

/** Install the Host-owned ApeMind account API. */
export function apply(ctx: Context): void {
  ctx.plugin(AuthorizationController)
}

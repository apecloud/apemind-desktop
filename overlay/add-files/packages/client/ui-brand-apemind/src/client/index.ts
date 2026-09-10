/**
 * ApeMind brand occupants for the sidebar brand slots.
 *
 * Mirrors the shape of upstream's `ui-brand-official` (same two slots, same
 * registration pattern) but reads ApeMind's identity instead of DeepSeek's.
 *
 * Why a package instead of a config knob: upstream's own README states the only
 * composition route is to occupy the slots — there is no brand configuration
 * surface. See packages/client/ui-brand-official/README.md.
 *
 * Scope note: this package intentionally registers ONLY `sidebar.brand.name`
 * while no ApeMind mark asset exists. The `mark` slot is left unregistered so
 * it keeps the shell's fallback rather than showing a fabricated logo.
 * Registering a placeholder mark would make "logo replaced" look done when it
 * is not — the exact class of false-complete we avoid elsewhere in this repo.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { ApeMindBrandMark, ApeMindBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Register the ApeMind brand occupants.
 *
 * Unlike upstream's official package there is no build-profile gate here: our
 * client build is by definition the ApeMind build, so the occupants always apply.
 *
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name' }, ApeMindBrandName))
  // The mark slot is deliberately NOT registered while no ApeMind mark asset
  // exists -- see the module docblock. Enable the block below once a real mark
  // is provided (and add the asset to the overlay whitelist).
  //
  // ctx.slots.inject('sidebar.brand.mark', () =>
  //   ctx.slots.register({ name: 'sidebar.brand.mark' }, ApeMindBrandMark))
}

// Referenced by the commented-out mark registration above; kept so enabling it
// later is a one-line change rather than a re-derivation.
export { ApeMindBrandMark }

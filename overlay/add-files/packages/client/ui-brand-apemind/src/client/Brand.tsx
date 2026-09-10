import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * ApeMind sidebar brand name.
 *
 * Rendered as type rather than artwork: no ApeMind wordmark asset exists yet,
 * so the name is set in the brand's display face per `apemind-design`'s brand
 * spec (Display: Fraunces, Noto Serif SC, Songti SC, serif).
 *
 * The stack degrades gracefully: if Fraunces is unavailable the platform serif
 * face is used, so the label never renders as a missing-glyph box.
 */
export function ApeMindBrandName() {
  return (
    <span
      style={{
        fontFamily: "'Fraunces', 'Noto Serif SC', 'Songti SC', serif",
        fontWeight: 500,
        letterSpacing: '0.01em',
      }}
    >
      ApeMind
    </span>
  )
}

/**
 * ApeMind sidebar brand mark.
 *
 * ⚠️ NOT currently registered — no ApeMind mark asset exists.
 *
 * This defines the contract only, so that supplying the real asset later is a
 * matter of swapping the body rather than re-deriving the component. Until then
 * the slot stays unregistered and the shell keeps its fallback: shipping a
 * stand-in glyph would misrepresent an unfinished asset as a finished one.
 *
 * @param props - Host-supplied mark presentation.
 */
export function ApeMindBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  // The real implementation will render the provided ApeMind mark at `size`px.
  // Intentionally unimplemented: see docblock.
  void size
  return null
}

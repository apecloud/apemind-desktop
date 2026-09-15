import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { AuthorizationController } from './controller.ts'

export { AuthorizationController } from './controller.ts'

export const inject = ['skills']
export type * from './types.ts'

/** Install the Host-owned ApeMind account API. */
export function apply(ctx: Context): void {
  ctx.plugin(AuthorizationController)
  ctx.skills.register({
    name: 'apemind',
    description: 'Use the ApeMind CLI to authenticate, choose a workspace, and read or modify ApeMind knowledge.',
    source: 'bundled',
    content: [
      '# ApeMind CLI',
      '',
      'Use the `apemind` executable for every ApeMind operation. Desktop and terminal agents share this same authenticated client.',
      'Never inspect credential files or reuse cookies. Never put API keys or tokens in arguments, prompts, logs, or output.',
      '',
      'Start with `apemind auth status --format json` and `apemind workspace list --format json`.',
      'Select an explicit workspace with `apemind workspace use <id>` before reading knowledge across organizations.',
      'Use `apemind knowledge list`, `apemind knowledge search <query>`, and `apemind document list --knowledge-base <id>`.',
      'Use structured JSON output for automation and trust exit codes plus the structured error code.',
      'Writes require an explicit preview and confirmation contract supplied by the CLI.',
      '',
      'Run `apemind skills` for the complete versioned command guidance.',
    ].join('\n'),
  })
}

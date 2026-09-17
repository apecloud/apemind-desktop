import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { AuthorizationController } from './controller.ts'
import { ApeMindModels } from './models.ts'

export { AuthorizationController } from './controller.ts'
export { ApeMindModels } from './models.ts'

export const inject = ['skills']
export type * from './types.ts'

/** Install the Host-owned ApeMind account API. */
export function apply(ctx: Context): void {
  ctx.plugin(AuthorizationController)
  ctx.plugin(ApeMindModels)
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
      'Run `apemind skills` for the command guidance shipped with this executable, and use command-level `--help` to discover parameters.',
      'The current workspace is the default boundary. Use `--workspace <id>` for a single call; do not change the default as a side effect of a read.',
      'Use `--all-workspaces` only for an explicitly cross-workspace request. Keep workspace provenance and report partial results or failed pages.',
      'Use JSON for automation and check both exit codes and structured errors. Never describe a partial result or first page as complete.',
      'Check account or workspace status when unclear. Do not switch identities to work around a permission error.',
      'Use the CLI preview and confirmation contract for writes, according to the user authorization already provided.',
      'Use `apemind model list` to inspect the signed-in account model catalog. Knowledge workspace selection does not change this catalog.',
      '`model serve` is managed by the Host. Never run it in an Agent conversation or display its private connection output.',
      '',
      'CLI capabilities are local support, not proof of server availability or authorization.',
    ].join('\n'),
  })
}

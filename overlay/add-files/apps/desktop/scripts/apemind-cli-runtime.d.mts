export function resolveApeMindCliResources(
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
  arch?: string,
  appRoot?: string,
): { from: string; to: string }[]

export function prepareApeMindCli(
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
  arch?: string,
  appRoot?: string,
): Promise<string>

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')

function cliArtifact(env, platform, arch, appRoot) {
  const lockPath = join(appRoot, 'resources', 'apemind-cli.lock.json')
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  const target = `${platform}-${arch}`
  const artifact = lock.artifacts?.[target]
  if (!/^v\d+\.\d+\.\d+$/.test(lock.version) || !/^[a-f0-9]{40}$/.test(lock.commit)
    || !artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
    throw new Error(`ApeMind CLI: invalid release lock for ${target}`)
  }
  const url = new URL(artifact.url)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('ApeMind CLI: release download must use HTTPS')
  }
  const filename = basename(url.pathname)
  if (!/^apemind-[a-z0-9-]+(?:\.exe)?$/.test(filename)) {
    throw new Error('ApeMind CLI: invalid release filename')
  }
  const binary = env.APEMIND_CLI_BINARY
    ? resolve(env.APEMIND_CLI_BINARY)
    : join(appRoot, '.desktop-build', 'apemind-cli', lock.version, target, filename)
  return { binary, artifact, lockPath }
}

function verifyBinary(binary, checksum) {
  if (!lstatSync(binary).isFile()) throw new Error('ApeMind CLI: expected a regular executable file')
  const actual = createHash('sha256').update(readFileSync(binary)).digest('hex')
  if (actual !== checksum) throw new Error('ApeMind CLI: binary checksum does not match the locked release')
}

/** Validate the exact CLI resource before electron-builder can create a package. */
export function resolveApeMindCliResources(env = process.env, platform = process.platform, arch = process.arch, appRoot = APP_ROOT) {
  const { binary, artifact, lockPath } = cliArtifact(env, platform, arch, appRoot)
  verifyBinary(binary, artifact.sha256)
  return [
    { from: binary, to: `apemind/bin/${platform === 'win32' ? 'apemind.exe' : 'apemind'}` },
    { from: lockPath, to: 'apemind/release.json' },
  ]
}

/** Acquire the pinned CLI before the expensive Desktop build and verify cached copies. */
export async function prepareApeMindCli(env = process.env, platform = process.platform, arch = process.arch, appRoot = APP_ROOT) {
  const { binary, artifact } = cliArtifact(env, platform, arch, appRoot)
  if (env.APEMIND_CLI_BINARY || existsSync(binary)) {
    try {
      verifyBinary(binary, artifact.sha256)
      if (platform !== 'win32') chmodSync(binary, 0o755)
      return binary
    } catch (error) {
      if (env.APEMIND_CLI_BINARY) throw error
    }
  }
  const response = await fetch(artifact.url, { signal: AbortSignal.timeout(90_000) })
  if (!response.ok) throw new Error(`ApeMind CLI: release download failed (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
    throw new Error('ApeMind CLI: downloaded binary does not match the locked release')
  }
  mkdirSync(dirname(binary), { recursive: true })
  const temporary = `${binary}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, bytes, { mode: 0o755, flag: 'wx' })
    renameSync(temporary, binary)
  } finally {
    rmSync(temporary, { force: true })
  }
  verifyBinary(binary, artifact.sha256)
  return binary
}

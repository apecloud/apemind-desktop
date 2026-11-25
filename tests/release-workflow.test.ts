import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const REPO_ROOT = resolve(import.meta.dirname, '..')

test('desktop release workflow keeps caches, artifact-only matrix builds, parallel typecheck gate, and lean artifacts', () => {
  const release = readFileSync(resolve(REPO_ROOT, '.github/workflows/release.yml'), 'utf8')
  const ci = readFileSync(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')
  const overlay = readFileSync(resolve(REPO_ROOT, 'overlay/OVERLAY.md'), 'utf8')
  const patch = readFileSync(resolve(REPO_ROOT, 'overlay/patches/23-desktop-release-speed.patch'), 'utf8')

  // GitHub-hosted US runners must not route Electron downloads through a China mirror.
  assert.doesNotMatch(release, /ELECTRON_MIRROR:\s*https:\/\/registry\.npmmirror\.com/)

  // Parallel Linux typecheck gates publication while matrix runners build artifacts only.
  assert.match(release, /^\s{2}verify-typecheck:/m)
  assert.match(release, /needs:\s*\[build,\s*verify-typecheck\]/)
  assert.match(release, /DSH_DESKTOP_BUILD_SCOPE:\s*artifacts/)
  assert.match(release, /DSH_DESKTOP_PARALLEL_PREPARE:\s*'1'/)

  // Upstream-native packaging caches and macOS signature cache (0700) are wired.
  assert.match(release, /DSH_DESKTOP_PACKAGE_CACHE_DIR:/)
  assert.match(release, /ELECTRON_BUILDER_CACHE:/)
  assert.match(release, /DSH_DESKTOP_MACOS_SIGNATURE_CACHE_DIR=%s/)
  assert.match(release, /chmod 700 "\$SIG_CACHE_DIR"/)
  assert.match(release, /desktop-pnpm-store-/)
  assert.match(release, /desktop-pkg-cache-/)
  assert.match(release, /desktop-eb-cache-/)
  assert.match(release, /desktop-macos-sig-/)

  // Never tar multi-GB .desktop-build trees into desktop-* artifacts.
  assert.doesNotMatch(release, /tar -czf release-assets\/\$\{\{ matrix\.os \}\}-build-receipt\.tgz/)
  assert.match(release, /compression-level:\s*0/)
  assert.match(release, /name:\s*build-receipt-\$\{\{ matrix\.os \}\}/)

  // CI workflow also shares the pnpm store cache.
  assert.match(ci, /desktop-pnpm-store-/)
  assert.match(ci, /pnpm install --frozen-lockfile --prefer-offline/)

  // Overlay patch is registered and strictly opt-in via environment variables.
  assert.match(overlay, /patches\/23-desktop-release-speed\.patch/)
  assert.match(patch, /DSH_DESKTOP_BUILD_SCOPE === 'artifacts'/)
  assert.match(patch, /DSH_DESKTOP_PARALLEL_PREPARE === '1'/)
})

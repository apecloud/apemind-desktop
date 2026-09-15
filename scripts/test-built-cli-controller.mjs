/** Exercise the compiled Host controller against a CLI with deterministic accounts. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.argv[2] ?? 'work/dsh-desktop')
const temp = await mkdtemp(join(tmpdir(), 'apemind-controller-'))
const binary = join(temp, 'apemind')
const callsFile = join(temp, 'calls.jsonl')
const statusFile = join(temp, 'status.json')
const previousBinary = process.env.APEMIND_CLI_BIN

try {
  await writeFile(statusFile, '{}')
  await writeFile(binary, `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args)+'\\n');
const status=JSON.parse(fs.readFileSync(${JSON.stringify(statusFile)},'utf8'));
if (args[0]==='--version') { console.log(status.version??'v0.3.7'); process.exit(status.versionExit??0); }
const option = name => args[args.indexOf(name)+1];
const space = {id:'org-a',name:'A space',type:'organization',status:'active',role:'owner',permissions:[]};
const a = {id:'account-a',kind:'oauth',server:'https://example.invalid',user_id:'a',username:'A',workspace_id:'org-a',workspaces:[space],verified_at:'2026-09-15T00:00:00Z',credential_storage:status.storage??'system'};
const b = {...a,id:'account-b',user_id:'b',username:'B'};
const key = {...a,id:'key-a',kind:'api-key'};
let data;
if (args[0]==='connection' && args[1]==='list') data={current:status.current??a.id,items:[a,b,key]};
else if (args[0]==='auth' && args[1]==='status') {
  // The default switched to B after connection list returned A.
  const selected=args.includes('--connection')?option('--connection'):b.id;
  const connection=[a,b,key].find(item=>item.id===selected);
  data={logged_in:Boolean(connection)&&!status.error,connection:connection??null,credential_available:Boolean(connection)&&!status.error,credential_error:status.error};
} else if (args[0]==='knowledge') {
  if (option('--connection')!=='account-a' && option('--connection')!=='key-a') process.exit(8);
  if (option('--workspace')!=='org-a') process.exit(8);
  const second=args.includes('--cursor');
  data={items:[{id:second?'kb-2':'kb-1',name:second?'Second':'First'}],next_cursor:second?null:'page-two'};
} else if (args[0]==='workspace') data=args[1]==='list'?{items:[space],next_cursor:null}:a;
else if (args[0]==='auth' && args[1]==='logout') data={logged_in:false};
else process.exit(8);
console.log(JSON.stringify({type:'result',data}));
`, { mode: 0o700 })
  process.env.APEMIND_CLI_BIN = binary
  const { Context } = await import(pathToFileURL(join(root, 'vendor/cordis/lib/index.js')).href)
  const { AuthorizationController } = await import(pathToFileURL(join(root, 'packages/experimental/apemind-login/lib/index.js')).href)
  const controller = new AuthorizationController(new Context())
  assert.equal(controller.typertRemote.namespace, 'apemindAuth')
  const state = await controller.state()
  assert.equal(state.cliVersion, 'v0.3.7')
  assert.deepEqual(state.credentialStatus, { connectionId: 'account-a', available: true, error: null, storage: 'system' })
  assert.equal(state.oauth.id, 'account-a')
  assert.deepEqual(state.oauthConnections.map(item => item.id), ['account-a', 'account-b'])
  const page = await controller.oauthCollections('account-a', 'org-a')
  assert.equal(page.nextCursor, 'page-two')
  const next = await controller.oauthCollections('account-a', 'org-a', page.nextCursor)
  assert.equal(next.nextCursor, null)
  assert.deepEqual([...page.items, ...next.items].map(item => item.id), ['kb-1', 'kb-2'])
  assert.equal((await controller.collections('key-a', 'page-two')).items[0].id, 'kb-2')
  await controller.refreshWorkspaces('account-a')
  await controller.selectWorkspace('account-a', 'org-a')
  await controller.oauthLogout('account-a')
  await assert.rejects(controller.oauthCollections('missing', 'org-a'))
  await assert.rejects(controller.oauthLogout('key-a'))
  await writeFile(statusFile, JSON.stringify({ error: 'credential_unavailable' }))
  const unavailable = await controller.state()
  assert.equal(unavailable.oauth, null)
  assert.deepEqual(unavailable.credentialStatus, { connectionId: 'account-a', available: false, error: 'credential_unavailable', storage: 'system' })
  assert.equal(unavailable.oauthConnections[0].id, 'account-a')
  await writeFile(statusFile, JSON.stringify({ error: 'reauthentication_required' }))
  assert.equal((await controller.state()).credentialStatus.error, 'reauthentication_required')
  await writeFile(statusFile, JSON.stringify({ current: 'key-a', error: 'credential_unavailable', storage: 'encrypted-file' }))
  const keyUnavailable = await controller.state()
  assert.equal(keyUnavailable.activeId, null)
  assert.deepEqual(keyUnavailable.credentialStatus, { connectionId: 'key-a', available: false, error: 'credential_unavailable', storage: 'encrypted-file' })
  await writeFile(statusFile, JSON.stringify({ error: 'private-internal-diagnostic', storage: 'private-storage-path' }))
  const unknown = await controller.state()
  assert.equal(unknown.credentialStatus.error, 'credential_unavailable')
  assert.equal(unknown.credentialStatus.storage, null)
  assert.ok(!JSON.stringify(unknown).includes('private-'))
  await writeFile(statusFile, '{}')
  assert.equal((await controller.state()).oauth.id, 'account-a')
  const calls = (await readFile(callsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.ok(calls.filter(args => args[0] === 'auth' && args[1] === 'status').every(args => args.includes('--connection')))
  assert.ok(calls.filter(args => args[0] === 'knowledge').every(args => args.includes('--workspace') && args.includes('--connection')))
  const logout = calls.find(args => args[0] === 'auth' && args[1] === 'logout')
  assert.equal(logout[logout.indexOf('--connection') + 1], 'account-a')
  assert.equal(calls.filter(args => args[0] === '--version').length, 1)
  await writeFile(statusFile, JSON.stringify({ version: 'private-version-diagnostic' }))
  const invalidVersion = await new AuthorizationController(new Context()).state()
  assert.equal(invalidVersion.cliVersion, null)
  assert.equal(invalidVersion.oauth.id, 'account-a')
  assert.ok(!JSON.stringify(invalidVersion).includes('private-version'))
  await writeFile(statusFile, JSON.stringify({ versionExit: 1 }))
  const failedVersion = await new AuthorizationController(new Context()).state()
  assert.equal(failedVersion.cliVersion, null)
  assert.equal(failedVersion.oauth.id, 'account-a')
  console.log('PASS: compiled Host preserves account/workspace, pagination, logout, CLI version, and credential recovery status without exposing diagnostics.')
} finally {
  if (previousBinary === undefined) delete process.env.APEMIND_CLI_BIN
  else process.env.APEMIND_CLI_BIN = previousBinary
  await rm(temp, { recursive: true, force: true })
}

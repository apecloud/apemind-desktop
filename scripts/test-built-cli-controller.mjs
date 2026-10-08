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
const previousPath = process.env.PATH
const openedFile = join(temp, 'opened.jsonl')

try {
  await writeFile(statusFile, '{}')
  await writeFile(binary, `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args)+'\\n');
const status=JSON.parse(fs.readFileSync(${JSON.stringify(statusFile)},'utf8'));
if (args[0]==='--version') { console.log(status.version??'v0.3.7'); process.exit(status.versionExit??0); }
const option = name => args[args.indexOf(name)+1];
const a = {id:'account-a',kind:'oauth',server:'https://example.invalid',user_id:'a',username:'A',verified_at:'2026-09-15T00:00:00Z',credential_storage:status.storage??'system'};
const b = {...a,id:'account-b',user_id:'b',username:'B'};
const key = {...a,id:'key-a',kind:'api-key'};
let data;
if (args[0]==='auth' && args[1]==='status') {
  // One call reports the current account together with every account, so
  // there is no window in which the list and the status disagree.
  const current=status.current??a.id;
  const selected=args.includes('--connection')?option('--connection'):current;
  const connection=[a,b,key].find(item=>item.id===selected);
  data={logged_in:Boolean(connection)&&!status.error,connection:connection??null,credential_available:Boolean(connection)&&!status.error,credential_error:status.error,current,accounts:[a,b,key]};
} else if (args[0]==='auth' && args[1]==='switch') data={...[a,b,key].find(item=>item.id===args[2])};
else if (args[0]==='auth' && args[1]==='logout') data={logged_in:false};
else if (args[0]==='auth' && args[1]==='login') {
  console.log(JSON.stringify({type:'device_code',data:{user_code:'TEST-CODE',verification_uri_complete:status.deviceUri??'https://example.invalid/api/v2/oauth/device/verify?user_code=TEST-CODE'}}));
  setInterval(()=>{},1000);
  await new Promise(()=>{});
}
else process.exit(8);
console.log(JSON.stringify({type:'result',data}));
`, { mode: 0o700 })
  process.env.APEMIND_CLI_BIN = binary
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  await writeFile(join(temp, opener), `#!${process.execPath}
import fs from 'node:fs';
const status=JSON.parse(fs.readFileSync(${JSON.stringify(statusFile)},'utf8'));
if(status.openFail) { console.error('private-opener-diagnostic'); process.exit(1); }
fs.appendFileSync(${JSON.stringify(openedFile)},JSON.stringify(process.argv.slice(2))+'\\n');
`, { mode: 0o700 })
  process.env.PATH = `${temp}:${previousPath ?? ''}`
  const { Context } = await import(pathToFileURL(join(root, 'vendor/cordis/lib/index.js')).href)
  const { AuthorizationController } = await import(pathToFileURL(join(root, 'packages/credentials/apemind-login/lib/index.js')).href)
  const controller = new AuthorizationController(new Context())
  assert.equal(controller.typertRemote.namespace, 'apemindAuth')
  const state = await controller.state()
  assert.equal(state.cliVersion, 'v0.3.7')
  assert.deepEqual(state.credentialStatus, { connectionId: 'account-a', available: true, error: null, storage: 'system' })
  assert.equal(state.oauth.id, 'account-a')
  assert.deepEqual(state.oauthConnections.map(item => item.id), ['account-a', 'account-b'])
  await controller.oauthLogout('account-a')
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
  assert.ok(!calls.some(args => args[0] === 'connection'), 'the removed connection commands must not be called')
  await controller.select('account-b')
  const switched = (await readFile(callsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    .find(args => args[0] === 'auth' && args[1] === 'switch')
  assert.deepEqual(switched, ['auth', 'switch', 'account-b'])
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
  await writeFile(statusFile, '{}')
  await assert.rejects(controller.openDevicePage())
  const login = controller.startDeviceLogin('https://example.invalid').catch(error => error)
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await controller.state()).loginProgress?.type === 'device_code') break
  }
  assert.equal((await controller.state()).loginProgress.userCode, 'TEST-CODE')
  await controller.openDevicePage()
  assert.deepEqual(JSON.parse((await readFile(openedFile, 'utf8')).trim()), ['https://example.invalid/api/v2/oauth/device/verify?user_code=TEST-CODE'])
  await writeFile(statusFile, JSON.stringify({ openFail: true }))
  await assert.rejects(controller.openDevicePage(), error => !String(error).includes('private-opener-diagnostic'))
  assert.equal((await controller.state()).browserLoginPending, true)
  await writeFile(statusFile, '{}')
  await controller.openDevicePage()
  await controller.cancelBrowserLogin()
  await login
  await assert.rejects(controller.openDevicePage())
  assert.equal((await controller.state()).loginProgress, null)
  await writeFile(statusFile, JSON.stringify({ deviceUri: 'file:///tmp/rejected' }))
  const unsafeLogin = controller.startDeviceLogin('https://example.invalid').catch(error => error)
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await controller.state()).loginProgress?.type === 'device_code') break
  }
  await assert.rejects(controller.openDevicePage())
  await controller.cancelBrowserLogin()
  await unsafeLogin
  assert.equal((await readFile(openedFile, 'utf8')).trim().split('\n').length, 2)
  console.log('PASS: compiled Host preserves account authentication, logout, CLI version, and credential recovery status without exposing diagnostics.')
  console.log('PASS: device-page reopening uses the current CLI login, reports opener failure, permits retry, and rejects finished logins and unsafe URLs.')
} finally {
  if (previousBinary === undefined) delete process.env.APEMIND_CLI_BIN
  else process.env.APEMIND_CLI_BIN = previousBinary
  if (previousPath === undefined) delete process.env.PATH
  else process.env.PATH = previousPath
  await rm(temp, { recursive: true, force: true })
}

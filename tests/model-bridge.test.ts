import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliProcess } from '../overlay/add-files/packages/credentials/apemind-login/src/cli-process.ts'
import { startModelBridge } from '../overlay/add-files/packages/credentials/apemind-login/src/model-bridge.ts'

async function withCli(body: string, run: (cli: CliProcess) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'apemind-model-bridge-'))
  const file = join(dir, 'apemind')
  await writeFile(file, `#!${process.execPath}\n${body}`, { mode: 0o700 })
  try { await run(new CliProcess(file)) } finally { await rm(dir, { recursive: true, force: true }) }
}

test('bridge keeps parent stdin open and pins literal connection arguments', async () => {
  await withCli(`
    if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['model','serve','--connection','account-a','--format','stream-json'])) process.exit(2);
    process.stdin.resume();
    process.stdin.on('end',()=>process.exit(0));
    process.stdout.write(JSON.stringify({type:'model_ready',data:{
      connection_id:'account-a',base_url:'http://127.0.0.1:23456/v1',
      api_key:'a'.repeat(64),protocol:'openai-completions'
    }})+'\\n');
  `, async cli => {
    let exited = false
    const bridge = await startModelBridge(cli, 'account-a', () => { exited = true })
    assert.equal(bridge.baseURL, 'http://127.0.0.1:23456/v1')
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(exited, false)
    bridge.stop()
  })
})

test('bridge rejects remote endpoints and mismatched account identifiers', async () => {
  for (const [id, url] of [['account-b', 'http://127.0.0.1:23456/v1'], ['account-a', 'https://other.test/v1']]) {
    await withCli(`
      process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));
      process.stdout.write(JSON.stringify({type:'model_ready',data:{
        connection_id:${JSON.stringify(id)},base_url:${JSON.stringify(url)},
        api_key:'a'.repeat(64),protocol:'openai-completions'
      }})+'\\n');
    `, async cli => { await assert.rejects(startModelBridge(cli, 'account-a', () => {}), /无效信息/) })
  }
})

test('bridge converts old grants into an actionable error without exposing stderr', async () => {
  await withCli(`
    process.stderr.write(JSON.stringify({type:'error',error:{code:'model_authorization_required',message:'SECRET'}}));
    process.exit(3);
  `, async cli => { await assert.rejects(startModelBridge(cli, 'account-a', () => {}), error =>
    error instanceof Error && error.message.includes('重新登录') && !error.message.includes('SECRET')) })
})

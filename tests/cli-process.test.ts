import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliError, CliProcess } from '../overlay/add-files/packages/credentials/apemind-login/src/cli-process.ts'

async function withCli(body: string, run: (cli: CliProcess) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'apemind-cli-process-'))
  const file = join(dir, 'apemind')
  await writeFile(file, `#!${process.execPath}\n${body}`, { mode: 0o700 })
  try { await run(new CliProcess(file)) } finally { await rm(dir, { recursive: true, force: true }) }
}

test('CLI arguments are literal, input stays on stdin, and events lead to one result', async () => {
  await withCli(`let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s => input+=s); process.stdin.on('end',()=>{
    process.stdout.write(JSON.stringify({type:'device_code',data:{user_code:'ABCD-EFGH'}})+'\\n');
    process.stdout.write(JSON.stringify({type:'result',data:{args:process.argv.slice(2),inputLength:input.length}})+'\\n');
  });`, async cli => {
    const events: string[] = []
    const result = await cli.run<{ args: string[]; inputLength: number }>(['knowledge', 'search', 'literal $(echo bad)'], {
      input: 'a-test-key', onEvent: event => events.push(event.type),
    })
    assert.deepEqual(result.args, ['knowledge', 'search', 'literal $(echo bad)', '--format', 'stream-json'])
    assert.equal(result.inputLength, 10)
    assert.deepEqual(events, ['device_code'])
  })
})

test('only structured errors are shown and raw stderr is suppressed', async () => {
  await withCli(`process.stderr.write('raw sensitive diagnostic');process.exit(1)`, async cli => {
    await assert.rejects(cli.run(['auth', 'status']), (error: unknown) => error instanceof CliError && error.code === 'cli_failure' && !error.message.includes('sensitive'))
  })
  await withCli(`process.stderr.write(JSON.stringify({type:'error',error:{code:'authentication_required',message:'请登录'},exit_code:3}));process.exit(3)`, async cli => {
    await assert.rejects(cli.run(['auth', 'status']), (error: unknown) => error instanceof CliError && error.exitCode === 3 && error.message === '请登录')
  })
})

test('cancellation terminates the CLI instead of leaving a login owner alive', async () => {
  await withCli(`process.on('SIGINT',()=>process.exit(3));setInterval(()=>{},1000);`, async cli => {
    const controller = new AbortController()
    const pending = cli.run(['auth', 'login'], { signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    await assert.rejects(pending, (error: unknown) => error instanceof CliError && error.code === 'cancelled')
  })
})

/** Exercise the compiled ApeMind plugin through DSH's actual pi-ai streaming adapter. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.argv[2] ?? 'work/dsh-desktop')
const temp = await mkdtemp(join(tmpdir(), 'apemind-model-integration-'))
const stateFile = join(temp, 'state.json')
const callsFile = join(temp, 'calls.jsonl')
const binary = join(temp, 'apemind')
const original = process.env.APEMIND_CLI_BIN
let ctx
try {
  const state = { current: 'account-a', workspace: 'personal:user-a', removed: false, empty: false }
  await writeFile(stateFile, JSON.stringify(state))
  await writeFile(binary, `#!${process.execPath}
import fs from 'node:fs'; import http from 'node:http';
const args=process.argv.slice(2), state=JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)},'utf8'));
const id=args[args.indexOf('--connection')+1];
const a={id:'account-a',username:'A',user_id:'user-a',kind:'oauth',server:'https://apemind.test',workspace_id:state.workspace};
const b={...a,id:'account-b',username:'B',user_id:'user-b'};
const emit=(type,data)=>console.log(JSON.stringify({type,data}));
if(args[0]==='connection') emit('result',{current:state.current,items:state.removed?[b]:[a,b]});
else if(args[1]==='list') emit('result',{items:state.empty?[]:[{id:'mdl-shared',name:'Shared model',source:{kind:'public',id:'public',name:'ApeMind'},context_window:32768,max_output_tokens:4096,supports_vision:false,supports_tool_calling:true}]});
else if(args[1]==='serve'){
 const server=http.createServer((req,res)=>{
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
   const request=JSON.parse(body);
   if(req.headers.authorization!=='Bearer '+ 'a'.repeat(64)) {res.writeHead(401);res.end();return;}
   fs.appendFileSync(${JSON.stringify(callsFile)},JSON.stringify({account:id,model:request.model,toolCount:request.tools?.length??0})+'\\n');
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   const events=[
    {choices:[{delta:{role:'assistant',content:''},index:0,finish_reason:null}]},
    {choices:[{delta:{content:'ok'},index:0,finish_reason:null}]},
    {choices:[{delta:{},index:0,finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:1}}
   ];
   for(const event of events) res.write('data: '+JSON.stringify(event)+'\\n\\n');
   res.end('data: [DONE]\\n\\n');
  });
 });
 server.listen(0,'127.0.0.1',()=>emit('model_ready',{connection_id:id,base_url:'http://127.0.0.1:'+server.address().port+'/v1',api_key:'a'.repeat(64),protocol:'openai-completions'}));
 process.stdin.resume();process.stdin.on('end',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
} else process.exit(2);
`, { mode: 0o700 })
  process.env.APEMIND_CLI_BIN = binary
  const load = path => import(pathToFileURL(join(root, path)).href)
  const { Context } = await load('vendor/cordis/lib/index.js')
  const { default: LlmRuntime, BlockAssembler, createUserMessage } = await load('packages/llm/llm/lib/index.js')
  const { ApeMindModels } = await load('packages/credentials/apemind-login/lib/index.js')
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ApeMindModels)
  await ctx.apemindModels.refresh()
  const before = ctx.llm.listProviders()
  assert.deepEqual(before.map(provider => provider.id).sort(), ['apemind-account-a', 'apemind-account-b'])
  assert.equal((await ctx.llm.listModels('apemind-account-a'))[0].id, 'mdl-shared')
  async function chat() {
    const result = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: 'apemind-account-a', model: 'mdl-shared', messages: [createUserMessage('synthetic integration test')],
    })) result.push(chunk)
    assert.equal(result.finish.kind, 'stop', JSON.stringify(result.finish))
  }
  await chat()
  state.current = 'account-b'; state.workspace = 'other-knowledge-space'
  await writeFile(stateFile, JSON.stringify(state))
  await ctx.apemindModels.refresh(true)
  assert.deepEqual(ctx.llm.listProviders(), before)
  await chat()
  const calls = (await readFile(callsFile, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.deepEqual(calls.map(call => call.account), ['account-a', 'account-a'])
  assert.ok(!JSON.stringify(ctx.apemindModels.state()).includes('api_key'))
  state.removed = true
  await writeFile(stateFile, JSON.stringify(state))
  await ctx.apemindModels.refresh(true)
  assert.deepEqual(ctx.llm.listProviders().map(provider => provider.id), ['apemind-account-b'])
  state.empty = true
  await writeFile(stateFile, JSON.stringify(state))
  await ctx.apemindModels.refresh(true)
  assert.deepEqual(ctx.llm.listProviders(), [])
  console.log('PASS: compiled DSH adapter streams through the Host-owned CLI bridge, retains model/account bindings across workspace/default-account changes, and withdraws logged-out or unavailable models.')
} finally {
  await ctx?.fiber.dispose()
  if (original === undefined) delete process.env.APEMIND_CLI_BIN
  else process.env.APEMIND_CLI_BIN = original
  await rm(temp, { recursive: true, force: true })
}

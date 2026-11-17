const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const tick=()=>new Promise(r=>setImmediate(r));
// Run only the API composition with mocks: no HTTP listen, Redis, database or WhatsApp.
function bootstrap({enabled=false,fail=false,adapter=false,stopGate,env={}}={}){
 const trace=[],handlers={},resources={pool:{}},exports={};let listen,releaseAdapter;
 let rejectAdapter;const adapterReady=new Promise((r,j)=>{releaseAdapter=r;rejectAdapter=j;});
 const app={use:(...args)=>trace.push(['route',args[0]])};
 const express=()=>app;express.json=()=>({json:true});express.static=()=>({static:true});
 const server={listen:(port,callback)=>{listen=callback;}};
 class SocketServer{constructor(http){assert.equal(http,server);trace.push(['socket-created']);resources.io=this;}adapter(){trace.push(['adapter']);}}
 class Host{
  constructor(shared){assert.equal(shared.database,resources.pool);assert.equal(shared.io,resources.io);trace.push(['host-created']);}
  async start(config){trace.push(['worker-start',config]);if(fail)throw Error('private details');}
  async stop(){trace.push(['worker-stop']);}
 }
 class TenantManager{
  constructor(shared,options){assert.equal(shared.database,resources.pool);assert.equal(shared.io,resources.io);resources.options=options;}
  hasSession(){return false;}
  async restore(){trace.push(['tenant-restore']);return{restored:0,failed:0};}
  async stopAll(){trace.push(['tenant-stop']);await stopGate;}
 }
 const mocks={
  'dotenv/config':{},express,cors:()=>({cors:true}), './routes':{router:{router:true},emailRoutes:{email:true}},path:require('node:path'),
  http:{createServer:()=>server},'socket.io':{Server:SocketServer},'@socket.io/redis-adapter':{createAdapter:()=>({adapter:true})},
  redis:{createClient:()=>{const client={connect:()=>adapterReady,duplicate:()=>client};return client;}},
  './socket/chat':{configureChatSocket:()=>trace.push(['chat-configured'])},
  './socket/orders':{configureOrdersSocket:()=>trace.push(['orders-configured'])},
  './socket/socketInstance':{setSocketInstance:io=>assert.equal(io,resources.io)},
  './database':{pool:resources.pool},'./messaging/worker/apiHost':{ApiWhatsAppHost:Host},
  './messaging/worker/tenantSessionManager':{TenantWhatsAppSessionManager:TenantManager},
  './messaging/http/whatsappRoutes':{createWhatsAppRouter:()=>({whatsappRoutes:true})},
  './messaging/worker/config':{readLocalBotConfig:()=>({realCheckoutEnabled:true,context:{restaurant_id:'00000000-0000-4000-8000-000000000001'}})},
  './messaging/worker/diagnostics':{BotDiagnosticError:Error,formatDiagnostic:()=> '[safe failure]'},
  'qrcode-terminal':{generate:()=>assert.fail('No QR during tests')},
 };
 const proc=Object.assign(new (require('node:events').EventEmitter)(),{env:{TS_NODE_DEV:'true',...(enabled?{GAMA_BOT_API_HOST_ENABLED:'true',WHATSAPP_WORKER_ENABLED:'true'}:{}),...(adapter?{REDIS_URL:'mock'}:{}),...env},cwd:()=>'/tmp/gama',
  stdin:{isTTY:true},stdout:{isTTY:true,write:m=>trace.push(['stdout',m])},stderr:{write:m=>trace.push(['stderr',m])},exit:code=>trace.push(['exit',code])});
 for(const event of ['SIGINT','SIGTERM','disconnect'])handlers[event]=()=>proc.emit(event);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText,
  {exports,require:name=>{assert.ok(name in mocks,name);return mocks[name];},process:proc,__dirname:'/tmp/gama/src',console:{log(){},warn(){},error(){}}});
 return{trace,handlers,exports,proc,options:resources.options,listen:()=>listen(),releaseAdapter,rejectAdapter};
}
test('ordinary API boot registers routes and never starts WhatsApp',async()=>{
 const f=bootstrap();f.listen();await tick();assert.ok(f.trace.some(x=>x[0]==='route'));assert.equal(f.trace.some(x=>x[0]==='worker-start'),false);assert.ok(f.trace.some(x=>x[0]==='route'&&x[1]==='/whatsapp'));
});
test('integrated API waits for adapter, reuses single Socket.IO and can stop worker independently',async()=>{
 const f=bootstrap({enabled:true,adapter:true});f.listen();await tick();assert.equal(f.trace.some(x=>x[0]==='worker-start'),false);
 f.releaseAdapter();await tick();assert.equal(f.trace.filter(x=>x[0]==='worker-start').length,1);
 assert.ok(f.trace.findIndex(x=>x[0]==='orders-configured')<f.trace.findIndex(x=>x[0]==='worker-start'));
 assert.ok(f.trace.findIndex(x=>x[0]==='route')<f.trace.findIndex(x=>x[0]==='worker-start'));
 await f.exports.stopWhatsAppWorker();assert.equal(f.trace.filter(x=>x[0]==='socket-created').length,1);assert.equal(f.trace.some(x=>x[0]==='exit'),false);
});
test('worker startup failure leaves registered HTTP routes available and reports safely',async()=>{
 const f=bootstrap({enabled:true,fail:true});f.listen();await tick();assert.ok(f.trace.some(x=>x[0]==='route'));assert.equal(f.trace.filter(x=>x[0]==='worker-start').length,1);
 assert.deepEqual(f.trace.filter(x=>x[0]==='stderr'),[['stderr','[safe failure]\n']]);assert.equal(f.trace.some(x=>x[0]==='exit'),false);
});
test('adapter startup failure prevents worker startup without affecting HTTP routes',async()=>{
 const f=bootstrap({enabled:true,adapter:true});f.listen();f.rejectAdapter(Error('secret adapter details'));await tick();
 assert.ok(f.trace.some(x=>x[0]==='route'));assert.equal(f.trace.some(x=>x[0]==='worker-start'),false);
 assert.deepEqual(f.trace.filter(x=>x[0]==='stderr'),[['stderr','[safe failure]\n']]);
});
test('integrated process shutdown awaits worker stop',async()=>{
 const f=bootstrap({enabled:true});f.listen();await tick();f.handlers.SIGTERM();await tick();
 const stop=f.trace.findIndex(x=>x[0]==='worker-stop'),exit=f.trace.findIndex(x=>x[0]==='exit');assert.ok(stop>=0&&exit>stop);
 assert.ok(f.trace.findIndex(x=>x[0]==='tenant-stop')<exit);
});
test('shutdown handlers exist before listen and remain installed across repeated signals during drain',async()=>{
 let release;const gate=new Promise(r=>release=r);const f=bootstrap({stopGate:gate});
 assert.equal(f.proc.listenerCount('SIGTERM'),1);
 f.listen();await tick();f.handlers.SIGTERM();await tick();
 assert.equal(f.proc.listenerCount('SIGTERM'),1,'a second SIGTERM must not restore the default immediate exit');
 f.handlers.SIGTERM();f.handlers.SIGINT();await tick();
 assert.equal(f.trace.filter(x=>x[0]==='tenant-stop').length,1);
 assert.equal(f.trace.some(x=>x[0]==='exit'),false);
 release();await tick();assert.equal(f.trace.filter(x=>x[0]==='exit').length,1);
});
test('ts-node-dev IPC disconnect drains workers before exit',async()=>{
 let release;const gate=new Promise(r=>release=r);const f=bootstrap({stopGate:gate});f.listen();await tick();
 f.handlers.disconnect();await tick();assert.equal(f.trace.filter(x=>x[0]==='tenant-stop').length,1);
 assert.equal(f.trace.some(x=>x[0]==='exit'),false);release();await tick();assert.equal(f.trace.filter(x=>x[0]==='exit').length,1);
});
test('connection is opt-in independently of checkout and simulation requires development',async()=>{
 const defaults=bootstrap();
 assert.equal(defaults.options.enabled(),false);
 assert.equal(defaults.options.realCheckoutEnabled,false);
 assert.equal(defaults.options.allowSimulation,false);
 const checkoutOnly=bootstrap({env:{WHATSAPP_REAL_CHECKOUT_ENABLED:'true'}});
 assert.equal(checkoutOnly.options.enabled(),false);
 assert.equal(checkoutOnly.options.realCheckoutEnabled,true);
 for (const NODE_ENV of ['development','production']) {
  const f=bootstrap({env:{NODE_ENV,WHATSAPP_WORKER_ENABLED:'true',WHATSAPP_CONNECTION_ENABLED:'true',WHATSAPP_REAL_CHECKOUT_ENABLED:'false'}});
  assert.equal(f.options.enabled(),true);
  assert.equal(f.options.realCheckoutEnabled,false);
  assert.equal(f.options.allowSimulation,NODE_ENV==='development');
  f.listen();await tick();
  assert.equal(f.trace.some(x=>x[0]==='tenant-restore'),true);
  assert.equal(f.trace.some(x=>x[0]==='worker-start'),false);
 }
});

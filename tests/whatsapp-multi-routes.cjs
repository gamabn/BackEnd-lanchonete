const {test}=require('node:test');const assert=require('node:assert/strict');const {sign}=require('jsonwebtoken');
require('ts-node/register');
const db=require.resolve('../src/database');require.cache[db]={id:db,filename:db,loaded:true,exports:{pool:{}}};
const {createWhatsAppRouter}=require('../src/messaging/http/whatsappRoutes');
const {WhatsAppSessionError}=require('../src/messaging/worker/tenantSessionManager');
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
process.env.JWT_SECRET='isolated-h11-test-secret';
const token=(id=A,options={})=>sign({},process.env.JWT_SECRET,{algorithm:'HS256',subject:id,expiresIn:'5m',...options});
function fixture(){
 const calls=[];const sessions=Object.fromEntries(['connect','disconnect','status','qr'].map(method=>[method,async id=>{calls.push([method,id]);return method==='qr'?{qr:id===A?'QR_A':'QR_B',expires_at:'test'}:{restaurant_id:id,status:'connecting'};}]));
 const router=createWhatsAppRouter(sessions);
 async function request(path,credential,overrides={}){
  const req={headers:{authorization:credential===undefined?undefined:'Bearer '+credential},body:{restaurant_id:B},query:{restaurant_id:B},params:{restaurantId:B},...overrides};
  const res={headers:{},code:200,data:undefined,set(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
  let authenticated=false;router.stack[0].handle(req,res,()=>{authenticated=true;});
  if(authenticated)await router.stack.find(layer=>layer.route?.path===path).route.stack[0].handle(req,res);
  return res;
 }
 return{calls,sessions,request};
}
for(const endpoint of ['/connect','/disconnect','/status','/qr'])test(`${endpoint}: owner from JWT wins over arbitrary IDs in body/query/params`,async()=>{
 const f=fixture(),response=await f.request(endpoint,token());assert.equal(response.code,endpoint==='/connect'?202:200);assert.deepEqual(f.calls,[[endpoint.slice(1),A]]);
 assert.equal(response.headers['Cache-Control'],'no-store, private');assert.equal(response.headers.Vary,'Authorization');
});
for(const credential of [undefined,'invalid',token('not-a-uuid'),token(A,{audience:'customer-profile'}),token(A,{expiresIn:-1})])test('invalid, expired and purpose-specific credentials cannot access any session',async()=>{
 const f=fixture();for(const endpoint of ['/connect','/disconnect','/status','/qr'])assert.equal((await f.request(endpoint,credential)).code,401);assert.deepEqual(f.calls,[]);
});
test('B cannot read QR A by sending A in the request',async()=>{
 const f=fixture();const result=await f.request('/qr',token(B),{body:{restaurant_id:A},query:{restaurant_id:A},params:{restaurantId:A}});assert.equal(result.data.qr,'QR_B');assert.deepEqual(f.calls,[['qr',B]]);
});
test('missing expiration and unexpected JWT algorithms are rejected',async()=>{
 const f=fixture();const noExpiry=sign({},process.env.JWT_SECRET,{subject:A,algorithm:'HS256'});const differentAlg=sign({},process.env.JWT_SECRET,{subject:A,algorithm:'HS384',expiresIn:'5m'});
 assert.equal((await f.request('/connect',noExpiry)).code,401);assert.equal((await f.request('/connect',differentAlg)).code,401);
});
test('internal errors are sanitized and expected service errors retain their status',async()=>{
 const f=fixture();f.sessions.connect=async()=>{throw Error('private-key-content');};let result=await f.request('/connect',token());assert.equal(result.code,503);assert.doesNotMatch(JSON.stringify(result.data),/private-key-content/);
 f.sessions.connect=async()=>{throw new WhatsAppSessionError(409,'LEGACY_WORKER_ACTIVE');};result=await f.request('/connect',token());assert.equal(result.code,409);assert.deepEqual(result.data,{error:'LEGACY_WORKER_ACTIVE'});
});

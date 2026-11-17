const {test}=require('node:test');const assert=require('node:assert/strict');
require('ts-node/register');
const db=require.resolve('../src/database');require.cache[db]={id:db,filename:db,loaded:true,exports:{pool:{}}};
const {session,id}=require('./fixtures/whatsapp-idempotency.cjs');
const {createPersistentWhatsAppCheckout}=require('../src/messaging/checkout/whatsappPersistentCheckout');
function fixture(restaurantId=id(1),sharedIO){
 const live=session(),trace=[],events=[];let submits=0;const f={trace,events,live,replay:false,failSocket:false,unknown:false,completed:false,gate:null};
 live.context.restaurant_id=restaurantId;live.checkout.pickupAddress.restaurantId=restaurantId;
 if(restaurantId!==id(1))live.checkout.customerId=id(14);
 live.checkout.paymentContext=require('../src/messaging/core/checkoutSnapshot').checkoutPaymentSnapshot(live.checkout,restaurantId);
 const io=sharedIO||{of:namespace=>{assert.equal(namespace,'/orders');return{to:room=>({emit:(event,data)=>{trace.push('emit');if(f.failSocket)throw Error('Socket unavailable');events.push({namespace,room,event,data});}})}}};
 const runtime=createPersistentWhatsAppCheckout({},io);
 runtime.authorizer={authorize:async()=>({})};
 runtime.active={inspectBootstrap:async()=>({kind:'no_durable_generation'}),recoverActive:async()=>f.completed?{kind:'completed',orderId:id(900)}:{kind:'no_active_intent'},registerActive:async c=>{const p=c.beginDurableRegistration();c.finishDurableRegistration(p.intent,'PENDING');return{kind:'registered',current:true};}};
 const fullOrder={order_id:id(900),restaurant_id:restaurantId};
 runtime.submission={submit:async()=>{submits++;trace.push('submit');if(f.gate)await f.gate;if(f.unknown)return{kind:'recoverable_failure',reason:'COMMIT_UNKNOWN'};trace.push('commit');return{kind:'success',replayed:f.replay,fullOrder};}};
 return Object.assign(f,{runtime,owner:{},current:()=>live,getSubmits:()=>submits,fullOrder});
}
async function prepare(f){await f.runtime.resume(f.owner,f.current,()=>{});assert.equal(await f.runtime.prepare(f.owner,f.current),true);}
test('existing Socket.IO namespace emits persisted owner/order only after confirmed commit',async()=>{
 const f=fixture();let committed;f.gate=new Promise(r=>{committed=r;});await prepare(f);
 const pending=f.runtime.confirm(f.owner);await new Promise(r=>setImmediate(r));assert.deepEqual(f.events,[]);
 committed();assert.match(await pending,/Pedido confirmado/);
 assert.deepEqual(f.trace,['submit','commit','emit']);assert.deepEqual(f.events,[{namespace:'/orders',room:`restaurant:${id(1)}`,event:'newOrder',data:f.fullOrder}]);
 await f.runtime.confirm(f.owner);assert.equal(f.getSubmits(),1);assert.equal(f.events.length,1);
});
test('Socket.IO exception preserves completion and duplicate confirmation never resubmits',async()=>{
 const f=fixture();f.failSocket=true;await prepare(f);assert.match(await f.runtime.confirm(f.owner),/Pedido confirmado/);await f.runtime.confirm(f.owner);
 assert.equal(f.getSubmits(),1);assert.equal(f.trace.filter(x=>x==='emit').length,1);
});
test('replay never emits newOrder',async()=>{
 const f=fixture();f.replay=true;await prepare(f);assert.match(await f.runtime.confirm(f.owner),/Pedido confirmado/);assert.deepEqual(f.events,[]);
});
test('lost commit response and subsequent durable recovery never emit or create again',async()=>{
 const f=fixture();f.unknown=true;await prepare(f);assert.doesNotMatch(await f.runtime.confirm(f.owner),/Pedido confirmado/);assert.deepEqual(f.events,[]);
 f.completed=true;assert.equal((await f.runtime.resume(f.owner,f.current,()=>{})).kind,'completed');assert.equal(f.getSubmits(),1);assert.deepEqual(f.events,[]);
});
test('two tenant runtimes reuse one Socket.IO and emit only into their persisted restaurant rooms',async()=>{
 const events=[],io={of:namespace=>{assert.equal(namespace,'/orders');return{to:room=>({emit:(event,data)=>events.push({room,event,restaurant:data.restaurant_id})})};}};
 const a=fixture(id(1),io),b=fixture(id(2),io);await prepare(a);await prepare(b);
 await Promise.all([a.runtime.confirm(a.owner),b.runtime.confirm(b.owner)]);
 assert.deepEqual(events.map(e=>e.room).sort(),[`restaurant:${id(1)}`,`restaurant:${id(2)}`]);
 for(const e of events){assert.equal(e.event,'newOrder');assert.equal(e.room,`restaurant:${e.restaurant}`);}
 await a.runtime.confirm(a.owner);await b.runtime.confirm(b.owner);assert.equal(events.length,2);assert.equal(a.getSubmits(),1);assert.equal(b.getSubmits(),1);
});

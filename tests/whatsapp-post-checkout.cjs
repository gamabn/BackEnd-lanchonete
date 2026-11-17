const {test}=require('node:test');const assert=require('node:assert/strict');
require('ts-node/register');
const db=require.resolve('../src/database');require.cache[db]={id:db,filename:db,loaded:true,exports:{pool:new Proxy({},{get:()=>()=>{throw Error('Production database forbidden');}})}};
const {session,id}=require('./fixtures/whatsapp-idempotency.cjs');
const {PersistentWhatsAppCheckout}=require('../src/messaging/checkout/whatsappPersistentCheckout');
const {ConversationMenu}=require('../src/messaging/core/conversationMenu');
const {nextCheckoutScope}=require('../src/messaging/core/nextCheckoutScope');
const {customerOrdersReply}=require('../src/messaging/core/customerOrders');
const {GetOrderItemService}=require('../src/service/order_item/GetOrderItemService');
function fixture(){
 const live=session(),durable=new Map(),trace=[],requests=[],notifications=[];
 const f={live,durable,trace,requests,notifications,rows:[],count:0,identity:live.transportIdentity};
 const customer={findByWhatsAppPhone:async args=>{trace.push(['identify',args.restaurant_id]);return[{id:id(4),restaurant_id:args.restaurant_id,international_format:true}];}};
 const active={inspectBootstrap:async()=>({kind:'no_durable_generation'}),recoverActive:async current=>durable.get(current().context.session_id)||{kind:'no_active_intent'},registerActive:async c=>{
  const p=c.beginDurableRegistration();c.finishDurableRegistration(p.intent,'PENDING');
  const current=c.readCurrentSession();requests.push(p.intent);durable.set(current.context.session_id,{kind:'review_required',intent:p.intent,state:'PENDING',storedIdentityRevision:0,session:{...current,checkout:{...current.checkout}}});
  return{kind:'registered',current:true};
 },replaceActive:()=>assert.fail('Completed scopes must never be replaced')};
 const authorizer={authorize:async()=>({})},submission={submit:async dto=>{
  const order_id=id(900+(++f.count));trace.push('committed');durable.set(dto.context.session_id,{kind:'completed',orderId:order_id});
  return{kind:'success',replayed:false,fullOrder:{order_id,restaurant_id:id(1)}};
 }};
 const deny=new Proxy({},{get:()=>()=>assert.fail('Unexpected IO')});
 const menuReader={reply:async()=> 'MENU PRINCIPAL\n1 - Ver cardápio\n2 - Meus pedidos',load:async()=>({available:true,reply:'MENU PRINCIPAL\n1 - Ver cardápio\n2 - Meus pedidos'})};
 const orders={listByCustomer:async(r,c)=>{trace.push(['orders',r,c]);return f.rows;}};
 const catalog=async()=>[{id:id(50),name:'Produto novo',price:'5.00',category:'Lanches',has_variants:false}];
 f.restart=()=>{f.runtime=new PersistentWhatsAppCheckout(authorizer,active,submission,result=>{trace.push('notify');notifications.push(result.fullOrder.order_id);});f.menu=new ConversationMenu(customer,deny,deny,deny,deny,menuReader,f.runtime,orders,catalog);};
 f.restart();
 const key=JSON.stringify([id(1),'key',live.sender.subject_id]);
 const state={...live.checkout,step:'PAYMENT_SELECTION',categories:[],checkoutTransport:{context:live.context,sender:live.sender,identity:live.transportIdentity}};
 f.menu.sessions.set(key,state);
 f.state=()=>f.menu.sessions.get(key);
 f.send=text=>f.menu.handle('key',id(1),text,live.sender.subject_id,f.identity,{context:live.context,sender:live.sender});
 f.confirm=async()=>{assert.match(await f.send('1'),/REVISÃO/);return f.send('1');};
 f.prepareNext=()=>{
  const current=f.state(),pickup=session().checkout;
  current.cart.add({productId:id(50),productName:'Produto novo',quantity:1,unitPrice:'5.00'});
  Object.assign(current,{step:'PAYMENT_SELECTION',customerId:id(4),fulfillmentMode:'PICKUP',pickupConfirmed:true,pickupAddress:pickup.pickupAddress,paymentMethod:undefined,paymentContext:undefined});
 };
 return f;
}
for(const text of ['Oi','Menu','0'])test(`successful confirmation followed by ${text} opens main menu`,async()=>{
 const f=fixture();const result=await f.confirm();assert.match(result,/Pedido confirmado/);
 for(const option of ['1 - Fazer novo pedido','2 - Consultar meus pedidos','3 - Ver cardápio','0 - Menu principal'])assert.ok(result.includes(option));
 assert.equal(f.state().step,'POST_CHECKOUT');assert.equal(f.state().cart.isEmpty(),true);
 const reply=await f.send(text);assert.match(reply,/MENU PRINCIPAL/);assert.doesNotMatch(reply,/Pedido confirmado/);assert.equal(f.count,1);
});
test('two concurrent confirms replay one completion; later new order uses a fresh cart and distinct scope',async()=>{
 const f=fixture();const oldCart=f.state().cart;await f.send('1');const [a,b]=await Promise.all([f.send('1'),f.send('1')]);
 assert.equal(a,b);assert.equal(f.count,1);assert.equal(f.notifications.length,1);assert.ok(f.trace.indexOf('notify')>f.trace.indexOf('committed'));
 assert.match(await f.send('1'),/Lanches/);assert.notEqual(f.state().cart,oldCart);assert.equal(f.state().cart.isEmpty(),true);assert.equal(f.count,1);
 const root=f.requests[0].scope.context.session_id,child=f.state().checkoutScopeId;assert.equal(child,nextCheckoutScope(root,id(901)));assert.notEqual(child,root);
 f.prepareNext();await f.confirm();assert.equal(f.count,2);assert.equal(f.requests.length,2);assert.equal(f.requests[1].scope.context.session_id,child);
 const payload=JSON.parse(f.requests[1].canonicalCheckout);assert.equal(payload.items.length,1);assert.equal(payload.items[0].productId,id(50));
 assert.equal(f.durable.get(root).orderId,id(901));assert.equal(f.durable.get(child).orderId,id(902));
});
test('catalog option after checkout and main-menu catalog both start empty without registering or submitting',async()=>{
 for(const option of ['3','main']){const f=fixture();await f.confirm();if(option==='main')await f.send('0');
  assert.match(await f.send(option==='main'?'1':option),/Lanches/);assert.equal(f.state().cart.isEmpty(),true);assert.equal(f.requests.length,1);assert.equal(f.count,1);
 }
});
test('ordinary messages after completion never reconfirm or resubmit',async()=>{
 const f=fixture();await f.confirm();for(const text of ['confirmar','x','9']){assert.doesNotMatch(await f.send(text),/Pedido confirmado/);}
 assert.equal(f.count,1);assert.equal(f.notifications.length,1);
});
test('confirmation followed by order lookup reidentifies customer and filters restaurant/customer',async()=>{
 const f=fixture();f.rows=[{order_id:id(901),restaurant_id:id(1),customer_id:id(4),status:'pending',total_price:'48.00'}];await f.confirm();
 const reply=await f.send('2');assert.match(reply,/MEUS PEDIDOS/);assert.match(reply,/PENDENTE/);assert.match(reply,/R\$ 48,00/);
 assert.deepEqual(f.trace.filter(x=>Array.isArray(x)&&x[0]==='orders'),[['orders',id(1),id(4)]]);
 assert.match(await f.send('0'),/MENU PRINCIPAL/);assert.equal(f.count,1);
});
test('restart discovers the latest completed checkout without resubmission or notifications',async()=>{
 const f=fixture();await f.confirm();await f.send('1');f.prepareNext();await f.confirm();const notifications=f.notifications.length;
 f.restart();assert.match(await f.send('Oi'),/MENU PRINCIPAL/);assert.equal(f.state().completedOrderId,id(902));assert.equal(f.count,2);assert.equal(f.notifications.length,notifications);
 const previousScope=f.state().completedCheckoutScope;await f.send('1');assert.equal(f.state().checkoutScopeId,nextCheckoutScope(previousScope,id(902)));assert.equal(f.state().cart.isEmpty(),true);
});
test('restart discovers pending next purchase and requires a fresh review before confirmation',async()=>{
 const f=fixture();await f.confirm();await f.send('1');f.prepareNext();await f.send('1');const intent=f.requests[1].intentId;
 f.restart();assert.match(await f.send('1'),/Recuperamos/);assert.equal(f.count,1);assert.equal(f.requests.length,2);
 await f.send('1');assert.equal(f.count,2);assert.equal(f.requests[1].intentId,intent);
});
test('unverified identity cannot query orders even after successful checkout',async()=>{
 const f=fixture();await f.confirm();f.identity=undefined;
 await f.send('0');const reply=await f.send('2');assert.match(reply,/identificar seu cadastro com segurança/);
 assert.equal(f.trace.some(x=>Array.isArray(x)&&x[0]==='orders'),false);
});
test('empty orders reply, real status labels and unknown database status are not invented',async()=>{
 const customers={findByWhatsAppPhone:async()=>[{id:id(4),restaurant_id:id(1),international_format:true}]},phone=session().transportIdentity;
 assert.match(await customerOrdersReply(id(1),phone,customers,{listByCustomer:async()=>[]}),/ainda não tem pedidos/);
 for(const [status,label] of [['pending','PENDENTE'],['enviado','ENVIADO'],['completed','CONCLUÍDO'],['custom_db_status','custom_db_status']]){
  const reply=await customerOrdersReply(id(1),phone,customers,{listByCustomer:async()=>[{order_id:id(901),restaurant_id:id(1),customer_id:id(4),status,total_price:'32.00'}]});assert.ok(reply.includes('Status: '+label));
 }
});
for(const field of ['restaurant_id','customer_id'])test(`wrong ${field} in returned orders is rejected without exposing orders`,async()=>{
 const customers={findByWhatsAppPhone:async()=>[{id:id(4),restaurant_id:id(1),international_format:true}]};
 const reply=await customerOrdersReply(id(1),session().transportIdentity,customers,{listByCustomer:async()=>[{order_id:'PRIVATE_ORDER',restaurant_id:id(1),customer_id:id(4),[field]:id(99),status:'pending',total_price:'1.00'}]});
 assert.doesNotMatch(reply,/PRIVATE_ORDER/);assert.match(reply,/Não foi possível consultar/);
});
test('ambiguous, missing and failed customer lookup never execute order reads',async()=>{
 for(const matches of [[],[{id:id(4),restaurant_id:id(1),international_format:true},{id:id(5),restaurant_id:id(1),international_format:true}]]){
  await customerOrdersReply(id(1),session().transportIdentity,{findByWhatsAppPhone:async()=>matches},{listByCustomer:()=>assert.fail('Unauthenticated order read')});
 }
});
test('existing order service binds both owner IDs in SQL, returns summaries and caps results',async()=>{
 const calls=[],rows=[{order_id:id(901),restaurant_id:id(1),customer_id:id(4),status:'pending',total_price:'48.00'}];
 const client={query:async(sql,args)=>{calls.push({sql,args});return{rows};}};
 assert.equal(await new GetOrderItemService().listByCustomer(id(1),id(4),client),rows);
 assert.deepEqual(calls[0].args,[id(1),id(4)]);assert.match(calls[0].sql,/WHERE o.restaurant_id = \$1 AND o.customer_id = \$2/);assert.match(calls[0].sql,/LIMIT 10/);assert.doesNotMatch(calls[0].sql,/c\.phone|c\.name|c\.street/);
 await assert.rejects(()=>new GetOrderItemService().listByCustomer('',id(4),client));assert.equal(calls.length,1);
});
test('same WhatsApp phone with customer records in two restaurants sees only the selected restaurant',async()=>{
 const records=[{order_id:'ORDER_A',restaurant_id:id(1),customer_id:id(4),status:'pending',total_price:'48.00'},
  {order_id:'ORDER_B',restaurant_id:id(9),customer_id:id(14),status:'completed',total_price:'32.00'},
  {order_id:'OTHER_CUSTOMER',restaurant_id:id(1),customer_id:id(99),status:'pending',total_price:'20.00'}];
 const client={query:async(sql,args)=>{assert.match(sql,/WHERE o.restaurant_id = \$1 AND o.customer_id = \$2/);return{rows:records.filter(o=>o.restaurant_id===args[0]&&o.customer_id===args[1])};}};
 const service=new GetOrderItemService(),orders={listByCustomer:(r,c)=>service.listByCustomer(r,c,client)};
 const customers={findByWhatsAppPhone:async({restaurant_id})=>[{id:restaurant_id===id(1)?id(4):id(14),restaurant_id,international_format:true}]};
 const a=await customerOrdersReply(id(1),session().transportIdentity,customers,orders);
 const b=await customerOrdersReply(id(9),session().transportIdentity,customers,orders);
 assert.match(a,/ORDER_A/);assert.doesNotMatch(a,/ORDER_B|OTHER_CUSTOMER/);assert.match(b,/ORDER_B/);assert.doesNotMatch(b,/ORDER_A|OTHER_CUSTOMER/);
});
test('identity changing while order lookup is pending discards the reply',async()=>{
 const f=fixture();await f.confirm();let resolve,entered;
 const started=new Promise(r=>{entered=r;});f.menu.customerOrders={listByCustomer:()=>{entered();return new Promise(r=>{resolve=r;});}};
 const pending=f.send('2');await started;f.state().whatsappPhone={phone:'5511999999999',source:'senderPn'};
 resolve([{order_id:'PRIVATE_ORDER',restaurant_id:id(1),customer_id:id(4),status:'pending',total_price:'48.00'}]);
 const reply=await pending;assert.doesNotMatch(reply,/PRIVATE_ORDER/);assert.match(reply,/identificação ou conversa mudou/);
});
test('database failure during order reads is recoverable and hides internal details',async()=>{
 const customers={findByWhatsAppPhone:async()=>[{id:id(4),restaurant_id:id(1),international_format:true}]};
 const reply=await customerOrdersReply(id(1),session().transportIdentity,customers,{listByCustomer:async()=>{throw Error('secret database details');}});
 assert.match(reply,/Tente novamente/);assert.doesNotMatch(reply,/secret database details/);assert.match(reply,/0 - Voltar/);
});

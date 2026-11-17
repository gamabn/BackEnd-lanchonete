const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const { audit } = require('../ops/whatsapp-session-audit.cjs');
test('audit reports locks and duplicate accounts without leaking credentials or modifying files', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gama-audit-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 await fs.mkdir(path.join(root, '.tenants'));await fs.mkdir(path.join(root, '.session-bindings'));await fs.mkdir(path.join(root, '.session-locks'));
 for (const n of [1,2]) {
  const id = `00000000-0000-4000-8000-00000000000${n}`, session = `00000000-0000-4000-8000-00000000001${n}`;
  const context = {restaurant_id:id,session_id:session,channel:'whatsapp'}, dir = path.join(id,session);
  await fs.mkdir(path.join(root,dir),{recursive:true});
  const put = (file,value) => fs.writeFile(path.join(root,file),JSON.stringify(value));
  await put(path.join('.tenants',id+'.json'),{version:1,restaurantId:id,sessionId:session,enabled:true});
  await put(path.join(dir,'.context.json'),context);
  await put(path.join(dir,'creds.json'),{me:{id:`559999999999:${n}@s.whatsapp.net`},noiseKey:'PRIVATE_KEY'});
  const scope = createHash('sha256').update(JSON.stringify(context)).digest('hex');
  await put(path.join('.session-bindings',scope+'.json'),dir);
  if(n===2){await fs.mkdir(path.join(root,'.session-locks',scope+'-test.lock'));await fs.mkdir(path.join(root,dir,'.worker-test.lock'));}
 }
 const snapshot = async () => {
  const files = await fs.readdir(root,{recursive:true});const result = {};
  for(const file of files){const full=path.join(root,file),s=await fs.lstat(full);result[file]={mode:s.mode,mtime:s.mtimeMs,content:s.isFile()?await fs.readFile(full,'utf8'):null};}return result;
 };
 const before = await snapshot(), report = await audit(root,'test');
 assert.equal(report.processOwnership,'unknown');assert.equal(report.tenants.length,2);
 for(const tenant of report.tenants){assert.equal(tenant.duplicateLinkedAccount,true);assert.equal(tenant.contextMatches,true);assert.equal(tenant.bindingMatches,true);}
 assert.deepEqual(report.tenants[0].locks,{legacy:false,session:false,directory:false});
 assert.deepEqual(report.tenants[1].locks,{legacy:false,session:true,directory:true});
 assert.doesNotMatch(JSON.stringify(report),/PRIVATE_KEY|559999999999|s.whatsapp.net/);
 assert.deepEqual(await snapshot(),before);
});
test('audit refuses symbolic links without reading credentials outside its root',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gama-audit-link-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.symlink(os.tmpdir(),path.join(root,'.tenants'));
 await assert.rejects(()=>audit(root,'test'),/Unsafe audit path/);
});

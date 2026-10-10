import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import * as local from '../dist/local-store.js';
import {syncOwner} from '../dist/sync.js';
import {normalizePhone} from '../dist/auth-utils.js';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const session=uid=>local.setMeta(local.AUTH_KEY,JSON.stringify({user:{id:uid}}));
const model=(id,uid=owner)=>({id,user_id:uid,name:'Robe bébé',reference:null,category:'Robes',subcategory:'Robe bébé',favorite:false,images:[],created_at:new Date().toISOString()});
const rows=new Map(),uploads=new Set();let uploadCalls=0,insertCalls=0,failAfterUpload=true,favoriteWhileSending=false;
const cloud={auth:{getUser:async()=>({data:{user:{id:owner}},error:null})},storage:{from(){return {upload:async path=>{uploadCalls++;if(uploads.has(path))return {error:{statusCode:'409',message:'already exists'}};uploads.add(path);return {error:null}}}}},from(){
  const chain={filters:{},select(){return this},eq(k,v){this.filters[k]=v;return this},order(){return this},async maybeSingle(){return {data:rows.has(this.filters.id)?{id:this.filters.id}:null,error:null}},async range(){return {data:[...rows.values()],error:null}},then(resolve){if(this.values){const row=rows.get(this.filters.id);if(row)Object.assign(row,this.values);resolve({data:row?[{id:row.id}]:[],error:null})}},update(values){chain.values=values;return chain},async insert(row){insertCalls++;if(row.reference==='DUP')return {error:{code:'23505'}};if(failAfterUpload){failAfterUpload=false;throw Error('Network interrupted')};rows.set(row.id,{...row});if(favoriteWhileSending){favoriteWhileSending=false;await local.changeModel(owner,row.id,{favorite:true})};return {error:null}}};return chain;
}};
await session(owner);
const id=crypto.randomUUID(),path=`${owner}/${id}/0.png`,row={...model(id),images:[{path}]};

// All fields and photos can be omitted; the draft survives local persistence.
const emptyId=crypto.randomUUID();
await local.saveLocalModel({...model(emptyId),category:null,subcategory:null,name:'Modèle sans catégorie'});
assert.equal((await local.getModel(owner,emptyId)).images.length,0);
await local.deleteLocalModel(owner,emptyId);await local.acknowledgeDeletes(owner,[emptyId]);

await local.saveLocalModel(row,[{path,blob:new Blob(['image-bytes'],{type:'image/png'})}]);
assert.equal((await local.listModels(owner)).length,1);
assert.equal((await local.listModels(other)).length,0);
assert.equal(await (await local.getPhoto(path)).text(),'image-bytes');
await assert.rejects(local.saveLocalModel({...model(crypto.randomUUID()),images:[{path:`${other}/bad.png`}]},[{path:`${other}/bad.png`,blob:new Blob(['bad'])}]),/étrangère/);
await assert.rejects(syncOwner(cloud,owner,()=>{},false),/interrupted/);
assert.equal((await local.getModel(owner,id)).sync_status,'pending');
assert.ok(await local.getPhoto(path));
favoriteWhileSending=true;
await syncOwner(cloud,owner,()=>{},false);
assert.equal(uploadCalls,1);assert.equal(uploads.size,1);assert.equal(rows.size,1);
assert.equal((await local.getModel(owner,id)).dirty,'update');
await syncOwner(cloud,owner,()=>{},false);
assert.equal((await local.getModel(owner,id)).sync_status,'synced');assert.equal(rows.get(id).favorite,true);
assert.equal(uploadCalls,1,'A favourite change must not re-upload photo bytes');
await syncOwner(cloud,owner,()=>{},false);assert.equal(insertCalls,2);

const conflictId=crypto.randomUUID(),conflictPath=`${owner}/${conflictId}/0.png`;
const conflict={...model(conflictId),reference:'DUP',images:[{path:conflictPath}]};
await local.saveLocalModel(conflict,[{path:conflictPath,blob:new Blob(['conflict-img'],{type:'image/png'})}]);
await syncOwner(cloud,owner,()=>{},false);assert.equal((await local.getModel(owner,conflict.id)).sync_status,'conflict');
await local.changeModel(owner,conflict.id,{reference:null});await syncOwner(cloud,owner,()=>{},false);
assert.equal((await local.getModel(owner,conflict.id)).sync_status,'synced');

const pendingId=crypto.randomUUID(),pendingPath=`${owner}/${pendingId}/0.png`;
const pending={...model(pendingId),images:[{path:pendingPath}]};
await local.saveLocalModel(pending,[{path:pendingPath,blob:new Blob(['pending-img'],{type:'image/png'})}]);
await local.mergeRemote(owner,[{...pending,name:'Old server value'}]);assert.equal((await local.getModel(owner,pending.id)).name,'Robe bébé');
await session(other);const previousCalls=insertCalls;await syncOwner(cloud,owner,()=>{},false);assert.equal(insertCalls,previousCalls);
assert.equal((await local.getModel(owner,pending.id)).dirty,'create');
await local.mergeRemote(other,[row]);assert.equal((await local.listModels(other)).length,0);

// Delete local model test
const toDelId=crypto.randomUUID(),toDelPath=`${owner}/${toDelId}/0.png`;
await local.saveLocalModel({...model(toDelId),images:[{path:toDelPath}]},[{path:toDelPath,blob:new Blob(['to-del'])}]);
assert.ok(await local.getModel(owner,toDelId));
await local.deleteLocalModel(owner,toDelId);
assert.equal(await local.getModel(owner,toDelId),undefined);
assert.equal(await local.getPhoto(toDelPath),undefined);
await local.mergeRemote(owner,[{...model(toDelId),images:[{path:toDelPath}]}]);
assert.equal(await local.getModel(owner,toDelId),undefined,'Pending deletion must not resurrect on pull');
await local.acknowledgeDeletes(owner,[toDelId]);
assert.ok((await local.getMeta(`deleted:${owner}`)).every(id=>id!==toDelId));
await local.mergeRemote(owner,[{...model('remote-only'),images:[]}]);
await local.pruneRemoteMissing(owner,new Set());
assert.equal(await local.getModel(owner,'remote-only'),undefined);
assert.ok(await local.getModel(owner,pending.id),'Pruning must preserve pending local creates');

let unlock;const first=local.withLease('test',()=>new Promise(r=>unlock=r));
while(!unlock)await new Promise(r=>setTimeout(r,1));assert.equal(await local.withLease('test',()=>{throw Error('Should not run')}),false);unlock();await first;
await local.setMeta(`draft:${owner}`,{files:[new Blob(['draft'])]});
assert.equal(await (await local.getMeta(`draft:${owner}`)).files[0].text(),'draft');
for(const input of ['90 12 34 56','+228 90 12 34 56','00228 90 12 34 56','22890123456'])assert.equal(normalizePhone(input),'+22890123456');
assert.throws(()=>normalizePhone('1234'),/valide/);
await local.purgeOwner(owner);assert.equal((await local.listModels(owner)).length,0);assert.equal(await local.getPhoto(path),undefined);
console.log('PASS: durable blobs/drafts; validation checks; model deletion; owner isolation; failed upload retry; no duplicates; concurrent edit preservation; conflict correction; exclusive sync lease; phone normalization.');

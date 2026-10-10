import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import * as local from '../dist/local-store.js';
import {syncOwner} from '../dist/sync.js';
import {cleanRemovedPhotos} from '../dist/photo-cleanup.js';

const owner='cleanup-owner',other='other-owner',id='model',a=`${owner}/${id}/a.png`,b=`${owner}/${id}/b.png`,c=`${owner}/${id}/c.png`;
const model={id,user_id:owner,created_at:new Date().toISOString(),images:[{path:a},{path:b}]};
const remote=new Map(),stored=new Set(),removed=[];
let failUpdate=false,failRemoval=false,onUpload=null;
const client={
  auth:{getUser:async()=>({data:{user:{id:owner}}})},
  storage:{from:()=>({
    upload:async path=>{stored.add(path);if(onUpload){const callback=onUpload;onUpload=null;await callback()}return {}},
    remove:async paths=>{if(failRemoval)throw Error('Network interrupted during removal');for(const path of paths){stored.delete(path);removed.push(path)}return {}}
  })},
  from(){const query={filters:{},operation:null,values:null,
    select(){return this},eq(k,v){this.filters[k]=v;return this},in(_k,ids){this.ids=ids;return this},order(){return this},
    maybeSingle:async function(){return {data:remote.get(this.filters.id)||null}},
    range:async()=>({data:[...remote.values()]}),
    insert:async row=>{remote.set(row.id,structuredClone(row));return {}},
    update(values){this.operation='update';this.values=values;return this},
    delete(){this.operation='delete';return this},
    then(resolve,reject){if(this.operation==='delete'){for(const id of this.ids)remote.delete(id);resolve({})}else if(failUpdate){reject(Error('Update failed'))}else{const row=remote.get(this.filters.id);if(row)Object.assign(row,structuredClone(this.values));resolve({data:row?[{id:row.id}]:[]})}}
  };return query}
};
await local.setMeta(local.AUTH_KEY,JSON.stringify({user:{id:owner}}));
await local.saveLocalModel(model,[a,b].map(path=>({path,blob:new Blob([path])})));
await syncOwner(client,owner,()=>{},false);
assert.equal(stored.size,2);
await local.changeModel(owner,id,{images:[{path:b}]});
assert.equal(await local.getPhoto(a),undefined,'removed local bytes are deleted atomically');
assert.equal(await local.cachePhoto(owner,a,new Blob(['late download'])),false,'a late download cannot resurrect a removed photo');
assert.equal(await local.getPhoto(a),undefined);
failUpdate=true;
await assert.rejects(syncOwner(client,owner,()=>{},false),/Update failed/);
assert.ok(stored.has(a),'cloud bytes survive until remote row no longer references them');
failUpdate=false;failRemoval=true;
await assert.rejects(syncOwner(client,owner,()=>{},false),/removal/);
assert.deepEqual(remote.get(id).images,[{path:b}]);
assert.equal((await local.photoCleanupQueue(owner)).length,1,'failed cleanup survives a restart');
failRemoval=false;
await syncOwner(client,owner,()=>{},false);
assert.equal(stored.has(a),false);assert.ok(stored.has(b));
assert.equal((await local.photoCleanupQueue(owner)).length,0);
assert.equal(await local.getMeta(`uploaded:${a}`),undefined);

// Photo edits commit their new bytes and row together; foreign bytes are rejected.
await assert.rejects(local.changeModel(owner,id,{images:[{path:b}]},{photos:[{path:`${other}/x`,blob:new Blob(['bad'])}]}),/étrangère/);
await local.changeModel(owner,id,{images:[{path:c}]},{photos:[{path:c,blob:new Blob(['new'])}]});
assert.ok(await local.getPhoto(c));assert.equal(await local.getPhoto(b),undefined);
await local.deleteLocalModel(owner,id);
const paths=(await local.photoCleanupQueue(owner))[0].paths;
assert.ok(paths.includes(b)&&paths.includes(c),'deletion preserves pending removals from older edits');
await syncOwner(client,owner,()=>{},false);
assert.equal(remote.size,0);assert.equal(stored.size,0);assert.equal((await local.photoCleanupQueue(owner)).length,0);
assert.equal(await local.cachePhoto(owner,c,new Blob(['late deleted model'])),false);

// Removal during an upload is retried with the latest image list.
const race={...model,id:'race',images:[{path:`${owner}/race/a.png`},{path:`${owner}/race/b.png`}]};
await local.saveLocalModel(race,race.images.map(i=>({...i,blob:new Blob(['race'])})));
onUpload=()=>local.changeModel(owner,'race',{images:[race.images[1]]});
await syncOwner(client,owner,()=>{},false);
assert.ok((await local.getModel(owner,'race')).dirty,'an edit during send is not acknowledged prematurely');
await syncOwner(client,owner,()=>{},false);
assert.deepEqual(remote.get('race').images,[race.images[1]]);
assert.equal(stored.has(race.images[0].path),false);
assert.ok(stored.has(race.images[1].path));

// Account changes must stop cloud cleanup.
await local.changeModel(owner,'race',{images:[]});
await local.markSynced(owner,'race',(await local.getModel(owner,'race')).revision);
await local.setMeta(local.AUTH_KEY,JSON.stringify({user:{id:other}}));
const before=removed.length;await cleanRemovedPhotos(client,owner);assert.equal(removed.length,before);
console.log('PASS: atomic photo edits; delayed cloud removal; durable retry; delete after edit; concurrent upload; account isolation.');

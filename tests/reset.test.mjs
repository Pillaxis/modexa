import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import * as local from '../dist/local-store.js';
import {migrateSession} from '../dist/cloud.js';
// Reproduce a prior installation with personal photos, pending uploads and a saved login.
const old=await new Promise((resolve,reject)=>{
 const r=indexedDB.open('modexa-offline-v1',1);
 r.onupgradeneeded=()=>{
  r.result.createObjectStore('models',{keyPath:'key'}).createIndex('owner','user_id');
  r.result.createObjectStore('photos',{keyPath:'path'}).createIndex('owner','user_id');
  r.result.createObjectStore('meta',{keyPath:'key'});
 };
 r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
});
await new Promise(resolve=>{
 const t=old.transaction(['models','photos','meta'],'readwrite');
 t.objectStore('models').put({key:'old:one',id:'one',user_id:'old',dirty:'create',created_at:'2026-10-01'});
 t.objectStore('photos').put({path:'old/photo.png',user_id:'old',blob:new Blob(['private'])});
 t.objectStore('meta').put({key:local.AUTH_KEY,value:JSON.stringify({user:{id:'old'}})});
 t.objectStore('meta').put({key:'draft:old',value:{files:[new Blob(['draft'])]}});
 t.oncomplete=resolve;
});old.close();
const current=await local.openDB();assert.equal(current.version,2);
assert.equal((await local.listModels('old')).length,0);assert.equal(await local.getPhoto('old/photo.png'),undefined);
assert.equal(await local.storedSession(),null);assert.equal(await local.getMeta('draft:old'),undefined);
let removed;globalThis.localStorage={removeItem(key){removed=key},getItem(){throw Error('Must not revive a deleted account')}};
await migrateSession({supabaseUrl:'https://project.supabase.co'});assert.equal(removed,'sb-project-auth-token');
await local.setMeta('new-value','keep');await local.openDB();assert.equal(await local.getMeta('new-value'),'keep');
const reopened=await new Promise(resolve=>{const r=indexedDB.open('modexa-offline-v1',2);r.onsuccess=()=>resolve(r.result)});
const value=await new Promise(resolve=>{const r=reopened.transaction('meta').objectStore('meta').get('new-value');r.onsuccess=()=>resolve(r.result.value)});
assert.equal(value,'keep');reopened.close();current.close();
console.log('PASS: old accounts/photos/drafts/upload queue removed once; new data survives reopen; no legacy session resurrection.');

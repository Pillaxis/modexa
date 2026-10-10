import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const listeners={},entries=new Map(),removed=[];
let online=false,network=0,ran=true,ownerSeen;
const cache={async addAll(paths){for(const path of paths)entries.set(new URL(path,'https://modexa.test/').href,{shell:true})},async match(req){return entries.get(req.url)},async put(req,res){entries.set(req.url,res)}};
const context={URL,console,setTimeout,clearTimeout,
 self:{registration:{scope:'https://modexa.test/'},location:{origin:'https://modexa.test'},addEventListener(name,fn){listeners[name]=fn},skipWaiting:async()=>{},clients:{claim:async()=>{},matchAll:async()=>[{postMessage(){},navigate(){throw Error('Update must not reload an open form')}}]}},
 caches:{open:async()=>cache,keys:async()=>['modexa-shell-v1','unrelated-cache'],delete:async name=>removed.push(name),match:async req=>cache.match(req)},
 fetch:async()=>{network++;if(!online)throw Error('Offline');return {ok:true,clone(){return this}}},
 openDB:async()=>{},storedSession:async()=>({user:{id:'owner-test'}}),makeClient:()=>({}),syncOwner:async(_c,owner,_notify,pull)=>{ownerSeen=owner;assert.equal(pull,false);return ran}
};
const source=fs.readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'');
vm.runInNewContext(source,context);
async function event(name,extra={}){let result;listeners[name]({...extra,waitUntil(p){result=p}});return result}
await event('install');await event('activate');assert.deepEqual(removed,['modexa-shell-v1']);
async function fetchEvent(url,method='GET'){let result;listeners.fetch({request:{url,method},respondWith(p){result=p}});return result}
assert.ok((await fetchEvent('https://modexa.test/app.js')).shell);assert.equal(network,0,'Shell must load instantly from cache');
for(const url of ['https://supabase.test/rest/v1/models','https://modexa.test/private.jpg','https://modexa.test/?code=secret'])assert.equal(await fetchEvent(url),undefined);
assert.equal(await fetchEvent('https://modexa.test/app.js','POST'),undefined);
await event('sync',{tag:'modexa-upload'});assert.equal(ownerSeen,'owner-test');
ran=false;await assert.rejects(event('sync',{tag:'modexa-upload'}),/autre envoi/);
// All initial local scripts/styles must be available in the offline shell.
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
for(const [,path] of html.matchAll(/(?:src|href)="([^"]+)"/g))assert.ok(entries.has(new URL(path,'https://modexa.test/').href),path);
console.log('PASS: cached offline shell; no API/private cache; unrelated cache preserved; background owner scope and retry on busy queue.');

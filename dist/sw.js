import './config.js';
import './vendor/supabase.js';
import {makeClient} from './cloud.js';
import {storedSession,openDB} from './local-store.js';
import {syncOwner} from './sync.js';
const CACHE='modexa-shell-v14';
const ASSETS=['./','./index.html','./style.css','./app.js','./install.js','./plans.js','./billing-ui.js','./photo-share.js','./catalog.js','./config.js','./local-store.js','./cloud.js','./sync.js','./auth-utils.js','./vendor/supabase.js','./favicon.svg','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png','./icons/apple-touch-icon.png'];
const paths=new Set(ASSETS.map(p=>new URL(p,self.registration.scope).pathname));
let client;
const notify=()=>self.clients.matchAll({type:'window'}).then(windows=>windows.forEach(w=>w.postMessage({type:'MODEXA_SYNC'})));
async function sync(){
  const session=await storedSession();if(!session?.user?.id)return;
  client ||= makeClient(true);
  // Background sync only sends pending changes; foreground pulls cloud changes.
  const ran=await syncOwner(client,session.user.id,notify,false);
  if(!ran)throw Error('Un autre envoi est en cours. Réessayer en arrière-plan.');
  await notify();
}
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // One-time owner-requested reset: upgrade erases v1 catalogue, photos, queue and sessions.
  await openDB();
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('modexa-shell-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
  // Keep open forms intact on activation; the next launch uses the cached release.
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  // No API calls, private photos, auth redirects or third-party responses in CacheStorage.
  if(request.method!=='GET'||url.origin!==self.location.origin||!paths.has(url.pathname)||url.search)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(request);
    if(cached)return cached;
    try{
      const response=await fetch(request);
      if(response.ok){
        await cache.put(request,response.clone());
      }
      return response;
    }catch{
      const cached=await caches.match(request);
      if(cached)return cached;
      throw Error('Hors connexion');
    }
  })());
});
self.addEventListener('sync',event=>{if(event.tag==='modexa-upload')event.waitUntil(sync())});
self.addEventListener('message',event=>{if(event.data?.type==='MODEXA_SYNC_NOW')event.waitUntil(sync().catch(()=>{}))});

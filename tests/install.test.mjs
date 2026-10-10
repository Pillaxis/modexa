import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {setupInstallation} from '../dist/install.js';
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),windows=[];
function fixture({standalone=false,remembered=false,ios=false}={}){
 const w=new JSDOM(html,{url:'https://modexa.example/'}).window;windows.push(w);
 const media={matches:standalone,addEventListener(_name,cb){this.changed=cb}};w.matchMedia=()=>media;
 Object.defineProperty(w.navigator,'standalone',{value:ios});
 if(remembered)w.localStorage.setItem('modexa-install-confirmed','1');
 setupInstallation(w,w.document);const q=s=>w.document.querySelector(s);
 return {w,q,media,button:q('[data-install]'),banner:q('#install-banner')};
}
function offer(f,prompt,userChoice){const e=new f.w.Event('beforeinstallprompt',{cancelable:true});e.prompt=prompt;e.userChoice=userChoice;f.w.dispatchEvent(e);assert.ok(e.defaultPrevented)}
const tick=()=>new Promise(r=>setTimeout(r,0));
try{
 const f=fixture();assert.equal(f.banner.hidden,true,'no misleading button without native installation');
 assert.equal(f.q('#install-dialog'),null);f.button.click();assert.equal(f.banner.hidden,true);
 let calls=0,finish;offer(f,()=>{calls++;return new Promise(r=>finish=r)});
 assert.equal(f.banner.hidden,false);f.button.click();assert.equal(calls,1,'prompt opens in original click');f.button.click();assert.equal(calls,1);
 assert.equal(f.button.disabled,true);finish({outcome:'dismissed'});await tick();assert.equal(f.banner.hidden,true);
 offer(f,async()=>({outcome:'accepted'}));f.button.click();await tick();assert.equal(f.button.hidden,true);
 assert.match(f.banner.textContent,/Installation en cours/);assert.doesNotMatch(f.banner.textContent,/100\s*%|installée avec succès|Partager|menu/);
 f.w.dispatchEvent(new f.w.Event('appinstalled'));assert.equal(f.banner.hidden,true);assert.equal(f.w.document.body.classList.contains('has-install'),false);
 assert.equal(f.w.localStorage.getItem('modexa-install-confirmed'),'1');f.w.dispatchEvent(new f.w.Event('pageshow'));assert.equal(f.banner.hidden,true);
 const revisit=fixture({remembered:true});assert.equal(revisit.banner.hidden,true);
 offer(revisit,async()=>({outcome:'dismissed'}));assert.equal(revisit.banner.hidden,false,'native reinstall offer after uninstall');
 const early=fixture();let done;offer(early,()=>new Promise(r=>done=r));early.button.click();early.w.dispatchEvent(new early.w.Event('appinstalled'));done({outcome:'accepted'});await tick();assert.equal(early.banner.hidden,true);
 for(const options of [{standalone:true},{ios:true}]){const app=fixture(options);assert.equal(app.banner.hidden,true);offer(app,()=>{throw Error('must not prompt inside installed app')});assert.equal(app.banner.hidden,true);app.button.click()}
 const changed=fixture();offer(changed,async()=>({outcome:'accepted'}));changed.media.matches=true;changed.media.changed();assert.equal(changed.banner.hidden,true);
 const other=fixture();offer(other,()=>{});other.w.localStorage.setItem('modexa-install-confirmed','1');other.w.dispatchEvent(new other.w.StorageEvent('storage',{key:'modexa-install-confirmed'}));assert.equal(other.banner.hidden,true);
 const blocked=fixture();Object.defineProperty(blocked.w,'localStorage',{get(){throw Error('Blocked')}});blocked.w.dispatchEvent(new blocked.w.Event('appinstalled'));assert.equal(blocked.banner.hidden,true);
 const failure=fixture();offer(failure,async()=>{throw Error('Unavailable')});failure.button.click();await tick();assert.equal(failure.banner.hidden,true);assert.equal(failure.q('#install-dialog'),null);
 const legacy=fixture();offer(legacy,async()=>undefined,Promise.resolve({outcome:'accepted'}));legacy.button.click();await tick();assert.equal(legacy.button.hidden,true);
 const manifest=JSON.parse(fs.readFileSync(new URL('../dist/manifest.webmanifest',import.meta.url),'utf8'));
 assert.equal(manifest.name,'MODEXA');assert.equal(manifest.display,'standalone');assert.ok(manifest.icons.some(i=>i.purpose==='maskable'));
 for(const icon of [...manifest.icons,{src:'icons/apple-touch-icon.png',sizes:'180x180'}]){const png=fs.readFileSync(new URL('../dist/'+icon.src,import.meta.url));assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes)}
 assert.match(html,/<aside id="install-banner" hidden/);
 console.log('PASS: direct native prompt; no instruction modal; hidden when unsupported, installed or standalone; no duplicate prompts; canceled/failed/reinstall/early appinstalled events; valid M icons.');
}finally{windows.forEach(w=>w.close())}

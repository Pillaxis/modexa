import {available} from './plans.js';
// IndexedDB is shared by the page and service worker. All catalogue keys include the owner.
const DB_NAME = 'modexa-offline-v1';
let connection;
export const AUTH_KEY = 'modexa-auth-v1';
export function openDB() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = event => {
      const db = request.result;
      // The owner requested a full data reset on 8 October 2026.
      // Runs once when upgrading from v1; new v2 data survives subsequent opens.
      if(event.oldVersion===1)for(const name of Array.from(db.objectStoreNames))db.deleteObjectStore(name);
      if(!db.objectStoreNames.contains('models'))db.createObjectStore('models', {keyPath:'key'}).createIndex('owner', 'user_id');
      if(!db.objectStoreNames.contains('photos'))db.createObjectStore('photos', {keyPath:'path'}).createIndex('owner', 'user_id');
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta', {keyPath:'key'});
    };
    request.onsuccess = () => {request.result.onversionchange=()=>{request.result.close();connection=null};resolve(request.result)};
    request.onerror = () => {connection=null;reject(request.error)};
    request.onblocked = () => {connection=null;reject(new Error('Fermez les autres onglets MODEXA, puis réessayez.'))};
  });
  return connection;
}
async function tx(stores, mode, run) {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(stores,mode);let result;
    transaction.oncomplete=()=>resolve(result);
    transaction.onabort=transaction.onerror=()=>reject(transaction.error||new Error('Enregistrement local impossible.'));
    run(transaction,value=>{result=value});
  });
}
const key=(owner,id)=>`${owner}:${id}`;
export const getMeta=k=>tx(['meta'],'readonly',(t,done)=>{const r=t.objectStore('meta').get(k);r.onsuccess=()=>done(r.result?.value)});
export const setMeta=(k,value)=>tx(['meta'],'readwrite',t=>t.objectStore('meta').put({key:k,value}));
export const removeMeta=k=>tx(['meta'],'readwrite',t=>t.objectStore('meta').delete(k));
export const authStorage={getItem:async k=>(await getMeta(k))??null,setItem:setMeta,removeItem:removeMeta};
export const getModel=(owner,id)=>tx(['models'],'readonly',(t,done)=>{const r=t.objectStore('models').get(key(owner,id));r.onsuccess=()=>done(r.result)});
export const listModels=owner=>tx(['models'],'readonly',(t,done)=>{const r=t.objectStore('models').index('owner').getAll(owner);r.onsuccess=()=>done(r.result.sort((a,b)=>b.created_at.localeCompare(a.created_at)))});
export const getPhoto=path=>tx(['photos'],'readonly',(t,done)=>{const r=t.objectStore('photos').get(path);r.onsuccess=()=>done(r.result?.blob)});
export const cachePhoto=(owner,path,blob)=>{
  if(!path.startsWith(owner+'/'))throw Error('Photo étrangère au compte.');
  return tx(['photos'],'readwrite',t=>t.objectStore('photos').put({path,user_id:owner,blob}));
};
export async function saveLocalModel(record, photos=[],{limit=Infinity,knownUsed=0,pendingDeletes=0,quota=null}={}) {
  if(!record.user_id)throw Error('Connectez-vous pour enregistrer votre modèle.');
  if([...photos,...(record.images||[])].some(p=>!p.path?.startsWith(record.user_id+'/')))throw Error('Photo étrangère au compte.');
  const model={...record,key:key(record.user_id,record.id),revision:1,dirty:'create',sync_status:'pending',sync_error:null};
  // The row and all image bytes commit atomically; only then may the UI announce success.
  let capacityExceeded=false;
  try{await tx(['models','photos','meta'],'readwrite',t=>{
    const store=t.objectStore('models'),read=store.index('owner').getAll(record.user_id);
    read.onsuccess=()=>{
      const rows=read.result;const usageRead=t.objectStore('meta').get(`usage:${record.user_id}`);usageRead.onsuccess=()=>{
      const cached=usageRead.result?.value;const paidQuota=cached?.quota||quota;const count=Math.max(rows.length,Math.max(0,knownUsed-pendingDeletes)+rows.filter(m=>m.dirty==='create').length);
      if(paidQuota?.ever_paid?available(rows,{quota:paidQuota})<=0:count>=limit){capacityExceeded=true;t.abort();return}
      store.add(model);
      for(const p of photos)t.objectStore('photos').put({...p,user_id:record.user_id});
      t.objectStore('meta').delete(`draft:${record.user_id}`);
      };
    };
  })}catch(error){if(capacityExceeded)throw Object.assign(Error('La capacité de votre catalogue est atteinte.'),{code:'MODEXA_QUOTA_REACHED'});throw error}
  return model;
}
export async function deleteLocalModel(owner, id) {
  return tx(['models','photos','meta'],'readwrite',t=>{
    const models=t.objectStore('models'),photos=t.objectStore('photos'),meta=t.objectStore('meta');
    const k=key(owner,id),r=models.get(k);
    r.onsuccess=()=>{
      const model=r.result;
      if(!model)return;
      models.delete(k);
      if(model.images&&Array.isArray(model.images)){
        for(const img of model.images){if(img.path)photos.delete(img.path)}
      }
      {
        meta.put({key:`deleted-photos:${owner}:${id}`,value:(model.images||[]).map(i=>i.path)});
        const delKey=`deleted:${owner}`,delReq=meta.get(delKey);
        delReq.onsuccess=()=>{
          const list=delReq.result?.value||[];
          if(!list.includes(id))list.push(id);
          meta.put({key:delKey,value:list});
        };
      }
    };
  });
}
export async function changeModel(owner,id,change,{dirty=true}={}) {
  if((change.user_id&&change.user_id!==owner)||(change.id&&change.id!==id)||('key' in change)||change.images?.some(i=>!i.path?.startsWith(owner+'/')))throw Error('Modèle étranger au compte.');
  return tx(['models'],'readwrite',(t,done)=>{
    const store=t.objectStore('models'),r=store.get(key(owner,id));
    r.onsuccess=()=>{
      const current=r.result;if(!current){done(null);return}
      const updated={...current,...change};
      if(dirty){updated.revision=current.revision+1;updated.dirty=current.dirty==='create'?'create':'update';updated.sync_status='pending';updated.sync_error=null}
      store.put(updated);done(updated);
    };
  });
}
export const markSynced=(owner,id,revision)=>tx(['models'],'readwrite',t=>{
  const s=t.objectStore('models'),r=s.get(key(owner,id));r.onsuccess=()=>{
    const row=r.result;if(!row)return;
    // A favourite/ref changed during the upload must remain queued.
    if(row.revision===revision)s.put({...row,dirty:null,sync_status:'synced',sync_error:null});
    else s.put({...row,dirty:'update',sync_status:'pending',sync_error:null});
  };
});
export async function mergeRemote(owner,records) {
  return tx(['models','meta'],'readwrite',t=>{
    const s=t.objectStore('models'),deletions=t.objectStore('meta').get(`deleted:${owner}`);
    deletions.onsuccess=()=>{
    const hidden=new Set(deletions.result?.value||[]);
    for(const remote of records){if(remote.user_id!==owner||hidden.has(remote.id))continue;const k=key(owner,remote.id),r=s.get(k);r.onsuccess=()=>{
      const local=r.result;
      if(!local?.dirty)s.put({...remote,key:k,revision:local?.revision||0,dirty:null,sync_status:'synced',sync_error:null});
    }}}
  });
}
export const acknowledgeDeletes=(owner,ids)=>tx(['meta'],'readwrite',t=>{
  const s=t.objectStore('meta'),k=`deleted:${owner}`,r=s.get(k);
  r.onsuccess=()=>s.put({key:k,value:(r.result?.value||[]).filter(id=>!ids.includes(id))});
});
export const pruneRemoteMissing=(owner,ids)=>tx(['models'],'readwrite',t=>{
  const s=t.objectStore('models'),r=s.index('owner').openCursor(owner);
  r.onsuccess=()=>{const c=r.result;if(c){if(!c.value.dirty&&!ids.has(c.value.id))c.delete();c.continue()}};
});
// Atomic leases prevent two tabs or the service worker from sending the same queue concurrently.
export async function withLease(name,fn) {
  const leaseKey=`lease:${name}`,holder=crypto.randomUUID();
  const won=await tx(['meta'],'readwrite',(t,done)=>{
    const s=t.objectStore('meta'),r=s.get(leaseKey);r.onsuccess=()=>{
      if(r.result?.value.expires>Date.now()){done(false);return}
      s.put({key:leaseKey,value:{holder,expires:Date.now()+90000}});done(true);
    };
  });
  if(!won)return false;
  const keepAlive=setInterval(()=>tx(['meta'],'readwrite',t=>{const s=t.objectStore('meta'),r=s.get(leaseKey);r.onsuccess=()=>{if(r.result?.value.holder===holder)s.put({key:leaseKey,value:{holder,expires:Date.now()+90000}})}}).catch(()=>{}),15000);
  try {await fn();return true} finally {clearInterval(keepAlive);await tx(['meta'],'readwrite',t=>{const s=t.objectStore('meta'),r=s.get(leaseKey);r.onsuccess=()=>{if(r.result?.value.holder===holder)s.delete(leaseKey)}})}
}
export async function storedSession(){const value=await getMeta(AUTH_KEY);try{return value?JSON.parse(value):null}catch{return null}}
export async function purgeOwner(owner){
  return tx(['models','photos','meta'],'readwrite',t=>{
    for(const name of ['models','photos']){const s=t.objectStore(name),r=s.index('owner').openCursor(owner);r.onsuccess=()=>{const cursor=r.result;if(cursor){cursor.delete();cursor.continue()}}}
    t.objectStore('meta').delete(`draft:${owner}`);
    t.objectStore('meta').delete(`subscription:${owner}`);
  });
}

// Keep quota snapshots and upload acknowledgements atomic. Older network responses
// must not restore already-spent credits while another device or tab is active.
export function cacheBilling(owner,data,acknowledged=[]){
  if(data?.user_id!==owner)throw Error('Compte de facturation incorrect.');
  return tx(['meta','models'],'readwrite',(t,done)=>{
    const meta=t.objectStore('meta'),r=meta.get(`usage:${owner}`);
    r.onsuccess=()=>{
      const previous=r.result?.value;
      const value=previous?.server_at&&new Date(previous.server_at)>new Date(data.server_at||0)?previous:{used:Number(data.used)||0,quota:data.quota,server_at:data.server_at,subscription:data.subscription};
      meta.put({key:`usage:${owner}`,value});meta.put({key:`subscription:${owner}`,value:value.subscription});
      for(const {id,revision} of acknowledged){const models=t.objectStore('models'),read=models.get(key(owner,id));read.onsuccess=()=>{const row=read.result;if(row)models.put({...row,dirty:row.revision===revision?null:'update',sync_status:row.revision===revision?'synced':'pending',sync_error:null})}}
      done(value);
    };
  });
}

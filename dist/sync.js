import {cacheBilling,listModels,getModel,getPhoto,changeModel,markSynced,mergeRemote,withLease,storedSession,getMeta,setMeta,removeMeta,acknowledgeDeletes,pruneRemoteMissing} from './local-store.js';
import {entitlement,available} from './plans.js';
const sameOwner=async owner=>(await storedSession())?.user?.id===owner;
export function syncError(error){
  if(error?.code==='PT402')return 'Vos places d’ajout sont épuisées ou expirées. Renouvelez votre offre ou choisissez une recharge.';
  if(error?.code==='23505')return 'Cette référence existe déjà. Modifiez-la puis réessayez.';
  if(error?.status===401||error?.status===403||/jwt|token|session/i.test(error?.message||''))return 'Reconnectez-vous pour terminer la synchronisation.';
  if(error?.name==='AbortError'||/fetch|network|internet/i.test(error?.message||''))return 'Connexion interrompue. Vos données restent sur cet appareil.';
  return 'Envoi interrompu. Vos données restent sur cet appareil. Réessayez.';
}
export async function syncOwner(client,owner,notify=()=>{},pull=true){
  return withLease(`sync:${owner}`,async()=>{
    if(!await sameOwner(owner))return;
    const {data:auth,error:authError}=await client.auth.getUser();
    if(authError||auth.user?.id!==owner)throw authError||Error('Session expirée.');
    const delKey=`deleted:${owner}`,deletedList=(await getMeta(delKey))||[];
    let failure;
    if(deletedList.length){
      try{
        const delRes=await client.from('models').delete().in('id',deletedList).eq('user_id',owner);
        if(delRes.error)throw delRes.error;
        for(const id of deletedList){
          if(!await sameOwner(owner))return;
          const paths=(await getMeta(`deleted-photos:${owner}:${id}`))||[];
          if(paths.length){
            const removed=await client.storage.from('model-images').remove(paths);
            if(removed.error)throw removed.error;
          }
          await removeMeta(`deleted-photos:${owner}:${id}`);
        }
        await acknowledgeDeletes(owner,deletedList);
      }catch(error){failure=error}
    }
    const pending=(await listModels(owner)).filter(m=>m.dirty&&m.sync_status!=='conflict');
    let capacity=Infinity,used=0;const acknowledgements=[];
    if(client.rpc){const {data,error}=await client.rpc('modexa_billing_state');if(error)throw error;if(!await sameOwner(owner))return;if(data?.user_id!==owner)throw Error('Session changée.');capacity=data.quota?.ever_paid?available([],data,0,data.subscription):entitlement(data.subscription).limit;used=data.quota?.ever_paid?0:Number(data.used)||0;await cacheBilling(owner,data)}
    for(const item of pending){
      if(!await sameOwner(owner))return;
      const row=await getModel(owner,item.id);if(!row?.dirty)continue;
      await changeModel(owner,row.id,{sync_status:'syncing',sync_error:null},{dirty:false});notify();
      try{
        if(row.dirty==='create'){
          const present=await client.from('models').select('id').eq('user_id',owner).eq('id',row.id).maybeSingle();
          if(present.error)throw present.error;
          if(!present.data&&used>=capacity)throw {code:'PT402'};
        }
        // Upload local bytes first, including edits made while a create request was in flight.
        for(const image of row.images){
          if(!await sameOwner(owner))return;
          if(await getMeta(`uploaded:${image.path}`))continue;
          const blob=await getPhoto(image.path);
          if(!blob){if(row.dirty==='create')throw Error('Photo locale indisponible.');continue}
          const uploaded=await client.storage.from('model-images').upload(image.path,blob,{contentType:blob.type,upsert:false});
          if(uploaded.error&&!['409','Duplicate'].includes(String(uploaded.error.statusCode||uploaded.error.status))&&!/already exists|duplicate/i.test(uploaded.error.message))throw uploaded.error;
          await setMeta(`uploaded:${image.path}`,true);
        }
        if(!await getModel(owner,row.id))continue;
        if(row.dirty==='create'){
          // Check the deterministic ID before uploading: a previous request may have committed.
          const existing=await client.from('models').select('id').eq('user_id',owner).eq('id',row.id).maybeSingle();
          if(existing.error)throw existing.error;
          if(!existing.data){
            if(!await sameOwner(owner))return;
            const {id,user_id,name,reference,category,subcategory,favorite,images,created_at}=row;
            const inserted=await client.from('models').insert({id,user_id,name,reference,category,subcategory,favorite,images:images.map(({path})=>({path})),created_at});
            if(inserted.error)throw inserted.error;
            used++;
          } else {
            const {name,reference,category,subcategory,favorite,images}=row;
            const updated=await client.from('models').update({name,reference,category,subcategory,favorite,images:images.map(({path})=>({path}))}).eq('id',row.id).eq('user_id',owner);
            if(updated.error)throw updated.error;
          }
        }else{
          const {name,reference,category,subcategory,favorite,images}=row;
          const updated=await client.from('models').update({name,reference,category,subcategory,favorite,images:images.map(({path})=>({path}))}).eq('id',row.id).eq('user_id',owner).select('id');
          if(updated.error)throw updated.error;if(!updated.data?.length)throw Error('Modèle distant introuvable.');
        }
        if(row.dirty==='create'&&client.rpc)acknowledgements.push({id:row.id,revision:row.revision});else await markSynced(owner,row.id,row.revision);
      }catch(error){
        const conflict=error?.code==='23505';
        await changeModel(owner,row.id,{sync_status:conflict?'conflict':error?.code==='PT402'?'quota':'pending',sync_error:syncError(error)},{dirty:false});
        if(!conflict)failure=error;
      }
      notify();
    }
    if(acknowledgements.length&&await sameOwner(owner)){const {data,error}=await client.rpc('modexa_billing_state');if(error)throw error;await cacheBilling(owner,data,acknowledgements);notify()}
    if(pull&&await sameOwner(owner)){
      const remoteIds=new Set();
      // Pagination prevents silently losing models once a catalogue exceeds the API row limit.
      for(let offset=0;;offset+=200){
        const result=await client.from('models').select('*').eq('user_id',owner).order('created_at',{ascending:false}).order('id').range(offset,offset+199);
        if(result.error)throw result.error;
        if(!await sameOwner(owner))return;
        result.data.forEach(m=>remoteIds.add(m.id));await mergeRemote(owner,result.data);notify();
        if(result.data.length<200)break;
      }
      await pruneRemoteMissing(owner,remoteIds);
    }
    if(failure)throw failure;
  });
}

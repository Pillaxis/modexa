import {AUTH_KEY,authStorage} from './local-store.js';
export async function timedFetch(input,options={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  const cancel=()=>controller.abort();options.signal?.addEventListener('abort',cancel,{once:true});
  if(options.signal?.aborted)controller.abort();
  try{return await fetch(input,{...options,signal:controller.signal})}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel)}
}
export async function migrateSession(config) {
  const oldKey=`sb-${new URL(config.supabaseUrl).hostname.split('.')[0]}-auth-token`;
  // Legacy accounts were deleted at the owner's request; never resurrect their sessions.
  try{localStorage.removeItem(oldKey)}catch{}
}
export function makeClient(worker=false){
  const config=globalThis.MODEXA_CONFIG;
  if(!globalThis.supabase||!config?.supabaseUrl)throw Error('Connexion indisponible. Actualisez MODEXA.');
  const auth={storageKey:AUTH_KEY,storage:authStorage,persistSession:true,autoRefreshToken:!worker,detectSessionInUrl:!worker};
  if(globalThis.navigator?.locks)auth.lock=(name,_timeout,run)=>navigator.locks.request(name,run);
  return globalThis.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth,global:{fetch:timedFetch}});
}

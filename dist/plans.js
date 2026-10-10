export const PLANS={free:{name:'Gratuit',limit:10,monthly:0},pro:{name:'Pro',limit:100,monthly:7000},business:{name:'Business',limit:1000,monthly:15000}};
export const DURATIONS=[1,3,12];
export const TOPUPS={pro:[{credits:50,amount:3600},{credits:100,amount:7000}],business:[{credits:500,amount:7600},{credits:1000,amount:15000}]};
export const discount=months=>months===3?10:months===12?30:0;
export const planCredits=(plan,months)=>PLANS[plan].limit*months;
export function planPrice(plan,months){if(!['pro','business'].includes(plan)||!DURATIONS.includes(months))throw Error('Offre invalide');return PLANS[plan].monthly*months*(100-discount(months))/100}
export const money=value=>new Intl.NumberFormat('fr-FR').format(value)+' FCFA';
export function entitlement(sub,now=Date.now()){
  if(sub?.ever_paid){const plan=sub.plan||'pro',active=sub.status==='active'&&new Date(sub.current_period_end).getTime()>now;return {...PLANS[plan],plan,end:sub.current_period_end,active,expired:!active}}
  if(sub?.status==='active'){
    if(new Date(sub.business_until).getTime()>now)return {...PLANS.business,plan:'business',end:sub.business_until,active:true};
    if(new Date(sub.pro_until||sub.current_period_end).getTime()>now)return {...PLANS.pro,plan:'pro',end:sub.pro_until||sub.current_period_end,active:true};
  }
  return {...PLANS.free,plan:'free',end:null,active:false};
}
export function occupied(models,usage,pendingDeletes=0){return Math.max(models.length,Math.max(0,(usage?.used||0)-pendingDeletes)+models.filter(m=>m.dirty==='create').length)}
export function validGrants(usage,now=Date.now()){return (usage?.quota?.grants||[]).filter(g=>new Date(g.starts_at).getTime()<=now&&new Date(g.expires_at).getTime()>now)}
export function available(models,usage,pendingDeletes=0,sub=null,now=Date.now()){
  const q=usage?.quota;
  if(q?.ever_paid){
    if(!q.active||new Date(q.end).getTime()<=now)return 0;
    return Math.max(0,validGrants(usage,now).reduce((sum,g)=>sum+Math.max(0,g.total-g.used),0)-models.filter(m=>m.dirty==='create').length);
  }
  if(sub?.ever_paid)return 0; // Paid rights must be known before an offline addition.
  return Math.max(0,entitlement(sub,now).limit-occupied(models,usage,pendingDeletes));
}

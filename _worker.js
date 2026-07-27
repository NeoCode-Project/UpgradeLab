// UpgradeLab V34 — Cloudflare Pages advanced-mode Worker.
// Deploy the project root to Cloudflare Pages. No API keys are needed.
const JSON_HEADERS={
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':'*',
  'access-control-allow-methods':'GET,OPTIONS',
  'cache-control':'public, max-age=1800'
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
function pickPrice(x){
  const periods=[x.last_24_hours,x.last_7_days,x.last_30_days,x.last_90_days];
  for(const p of periods){
    if(!p)continue;
    for(const key of ['median','avg','min']){
      const n=Number(p[key]); if(Number.isFinite(n)&&n>0)return n;
    }
  }
  return 0;
}
function parseUsd(text=''){
  const raw=String(text).replace(/\s/g,'').replace(/[^0-9.,]/g,'');
  if(!raw)return 0;const c=raw.lastIndexOf(','),d=raw.lastIndexOf('.');
  const n=Number(c>d?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,''));
  return Number.isFinite(n)?n:0;
}
async function getAllPrices(){
  const url='https://api.skinport.com/v1/sales/history?app_id=730&currency=USD';
  const r=await fetch(url,{headers:{'Accept':'application/json','Accept-Encoding':'br'},cf:{cacheEverything:true,cacheTtl:1800}});
  if(!r.ok)throw new Error('Skinport '+r.status);
  const raw=await r.json();
  const items=(Array.isArray(raw)?raw:[]).map(x=>({market_hash_name:x.market_hash_name,price:pickPrice(x)})).filter(x=>x.market_hash_name&&x.price>0);
  return items;
}
export default {
 async fetch(request,env,ctx){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:JSON_HEADERS});
  const url=new URL(request.url);
  if(url.pathname==='/api/prices'){
    try{return json({items:await getAllPrices(),source:'Skinport sales history',updated_at:new Date().toISOString()})}
    catch(e){return json({error:String(e?.message||e)},502)}
  }
  if(url.pathname==='/api/steam-price'){
    const name=String(url.searchParams.get('market_hash_name')||'').trim();
    if(!name)return json({success:false,error:'market_hash_name is required'},400);
    const u=new URL('https://steamcommunity.com/market/priceoverview/');u.searchParams.set('appid','730');u.searchParams.set('currency','1');u.searchParams.set('market_hash_name',name);
    try{const r=await fetch(u,{headers:{Accept:'application/json'},cf:{cacheEverything:true,cacheTtl:1800}});if(!r.ok)return json({success:false,error:'Steam '+r.status},502);const d=await r.json();const p=parseUsd(d.lowest_price||d.median_price);return p>0?json({success:true,price_usd:p,source:'Steam Market'}):json({success:false,error:'Price unavailable'},404)}catch(e){return json({success:false,error:String(e?.message||e)},502)}
  }
  return env.ASSETS.fetch(request);
 }
};

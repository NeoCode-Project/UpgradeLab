// UpgradeLab V35 Cloudflare Pages Worker. Catalog and prices are independent.
const H={'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','cache-control':'public, max-age=1800'};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
function asArray(raw){return Array.isArray(raw)?raw:Array.isArray(raw?.items)?raw.items:Array.isArray(raw?.data)?raw.data:[]}
function parseMarket(raw){const out=[];for(const x of asArray(raw)){const name=String(x.market_hash_name||x.marketHashName||x.name||'').trim();let price=Number(x.price_usd??x.price??x.min_price??0);if(price>100000)price/=100;if(name&&price>0)out.push({market_hash_name:name,price})}return out}
async function marketCsgo(){
 const urls=['https://market.csgo.com/api/v2/prices/USD.json','https://market.csgo.com/api/v2/prices/RUB.json'];
 for(const u of urls){try{const r=await fetch(u,{headers:{Accept:'application/json'},cf:{cacheEverything:true,cacheTtl:1800}});if(!r.ok)continue;const raw=await r.json();let items=parseMarket(raw);if(!items.length)continue;
   if(u.includes('/RUB.')){const rate=Number(raw.usd_rate||raw.rates?.USD||0);if(rate>0)items=items.map(x=>({...x,price:x.price/rate}));else continue}
   return items;
 }catch{}}
 throw new Error('Market.CSGO did not answer');
}
async function skinport(){const r=await fetch('https://api.skinport.com/v1/sales/history?app_id=730&currency=USD',{headers:{Accept:'application/json'},cf:{cacheEverything:true,cacheTtl:1800}});if(!r.ok)throw new Error('Skinport '+r.status);const out=[];for(const x of asArray(await r.json())){const p=x.last_24_hours||x.last_7_days||x.last_30_days||x.last_90_days||{};const price=Number(p.median||p.avg||p.min||0);if(x.market_hash_name&&price>0)out.push({market_hash_name:x.market_hash_name,price})}return out}
function parseUsd(text=''){const raw=String(text).replace(/\s/g,'').replace(/[^0-9.,]/g,'');if(!raw)return 0;const c=raw.lastIndexOf(','),d=raw.lastIndexOf('.');const n=Number(c>d?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,''));return Number.isFinite(n)?n:0}
export default{async fetch(request,env){if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});const u=new URL(request.url);
 if(u.pathname==='/api/prices'){try{return json({items:await marketCsgo(),source:'Market.CSGO'})}catch(e1){try{return json({items:await skinport(),source:'Skinport sales history'})}catch(e2){return json({items:[],source:'рынок временно недоступен',errors:[String(e1),String(e2)]},200)}}}
 if(u.pathname==='/api/steam-price'){const name=u.searchParams.get('market_hash_name');if(!name)return json({success:false},400);try{const p=new URL('https://steamcommunity.com/market/priceoverview/');p.searchParams.set('appid','730');p.searchParams.set('currency','1');p.searchParams.set('market_hash_name',name);const r=await fetch(p,{cf:{cacheEverything:true,cacheTtl:1800}});const d=await r.json();const price=parseUsd(d.lowest_price||d.median_price);return price>0?json({success:true,price_usd:price,source:'Steam Market'}):json({success:false},404)}catch(e){return json({success:false,error:String(e)},502)}}
 return new Response('UpgradeLab price worker',{status:200})}};

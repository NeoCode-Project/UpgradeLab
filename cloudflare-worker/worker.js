// UpgradeLab V33 price Worker.
// Routes:
//   GET /api/steam-price?market_hash_name=...
//   GET /api/prices
// Secrets are optional for /api/prices and must never be placed in app.js.

const JSON_HEADERS = {
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':'*',
  'access-control-allow-methods':'GET,OPTIONS',
  'cache-control':'public, max-age=1800'
};

function json(data, status=200, extra={}) {
  return new Response(JSON.stringify(data), {status, headers:{...JSON_HEADERS,...extra}});
}

function parseUsd(text='') {
  const raw=String(text).replace(/\s/g,'').replace(/[^0-9.,]/g,'');
  if(!raw) return 0;
  const comma=raw.lastIndexOf(','), dot=raw.lastIndexOf('.');
  const normalized=comma>dot ? raw.replace(/\./g,'').replace(',','.') : raw.replace(/,/g,'');
  const n=Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export default {
  async fetch(request, env) {
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers:JSON_HEADERS});
    const url=new URL(request.url);

    if(url.pathname==='/api/steam-price') {
      const marketHashName=String(url.searchParams.get('market_hash_name')||'').trim();
      if(!marketHashName) return json({success:false,error:'market_hash_name is required'},400);
      const upstream=new URL('https://steamcommunity.com/market/priceoverview/');
      upstream.searchParams.set('appid','730');
      upstream.searchParams.set('currency','1'); // USD
      upstream.searchParams.set('market_hash_name',marketHashName);
      try {
        const r=await fetch(upstream.toString(),{
          headers:{Accept:'application/json','User-Agent':'UpgradeLab-PriceWorker/1.0'},
          cf:{cacheEverything:true,cacheTtl:1800}
        });
        if(!r.ok) return json({success:false,error:'Steam '+r.status},502);
        const data=await r.json();
        const price=parseUsd(data.lowest_price||data.median_price);
        if(!data.success || !(price>0)) return json({success:false,error:'Price unavailable',raw:data},404);
        return json({success:true,market_hash_name:marketHashName,price_usd:price,lowest_price:data.lowest_price||null,median_price:data.median_price||null,volume:data.volume||null,source:'Steam Market'});
      } catch(e) {
        return json({success:false,error:String(e?.message||e)},500);
      }
    }

    if(url.pathname==='/api/prices') {
      try {
        const upstream='https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0';
        const h={Accept:'application/json'};
        if(env.SKINPORT_CLIENT_ID && env.SKINPORT_CLIENT_SECRET) {
          h.Authorization='Basic '+btoa(env.SKINPORT_CLIENT_ID+':'+env.SKINPORT_CLIENT_SECRET);
        }
        const r=await fetch(upstream,{headers:h,cf:{cacheTtl:3600,cacheEverything:true}});
        if(!r.ok) return json({error:'Skinport '+r.status},502);
        const raw=await r.json();
        const items=(Array.isArray(raw)?raw:[])
          .map(x=>({market_hash_name:x.market_hash_name,price:Number(x.suggested_price??x.median_price??x.min_price??0)}))
          .filter(x=>x.market_hash_name&&Number.isFinite(x.price)&&x.price>0);
        return json({items,updated_at:new Date().toISOString(),source:'Skinport'});
      } catch(e) {
        return json({error:String(e?.message||e)},500);
      }
    }

    return new Response('Not found',{status:404});
  }
};

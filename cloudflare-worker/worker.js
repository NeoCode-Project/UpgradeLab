// Optional Cloudflare Worker for UpgradeLab V32.
// Route /api/prices to this Worker. Store credentials as Worker secrets, never in app.js.
// npx wrangler secret put SKINPORT_CLIENT_ID
// npx wrangler secret put SKINPORT_CLIENT_SECRET

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/prices') return new Response('Not found', {status:404});
    const headers = {'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','cache-control':'public, max-age=3600'};
    try {
      const upstream='https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0';
      const h={Accept:'application/json'};
      if (env.SKINPORT_CLIENT_ID && env.SKINPORT_CLIENT_SECRET) {
        h.Authorization='Basic '+btoa(env.SKINPORT_CLIENT_ID+':'+env.SKINPORT_CLIENT_SECRET);
      }
      const r=await fetch(upstream,{headers:h,cf:{cacheTtl:3600,cacheEverything:true}});
      if(!r.ok) return new Response(JSON.stringify({error:'Upstream '+r.status}),{status:502,headers});
      const raw=await r.json();
      const items=(Array.isArray(raw)?raw:[]).map(x=>({market_hash_name:x.market_hash_name,price:Number(x.suggested_price??x.median_price??x.min_price??0)})).filter(x=>x.market_hash_name&&x.price>0);
      return new Response(JSON.stringify({items,updated_at:new Date().toISOString()}),{headers});
    } catch (e) {
      return new Response(JSON.stringify({error:String(e?.message||e)}),{status:500,headers});
    }
  }
};

// UpgradeLab V35 price engine: real prices only, no invented catalog values.
export const PRICE_CACHE_TTL=60*60*1000;
export const PRICE_CACHE_KEY='ul-real-market-prices-v35';
export function detectCategory(rawCategory,name=''){
 const raw=String(rawCategory||'').toLowerCase(),text=`${raw} ${String(name||'')}`.toLowerCase();
 if(/agent|character|terrorist|counter-terrorist/.test(raw))return'agent';
 if(/keychain|charm/.test(raw))return'keychain'; if(/sticker/.test(raw))return'sticker'; if(/graffiti|spray/.test(raw))return'graffiti';
 if(raw==='case'||/crate|case|capsule|package/.test(raw))return'case';
 if(/\b(knife|bayonet|karambit|dagger|bowie|falchion|navaja|stiletto|talon|ursus|paracord|survival|skeleton|nomad|kukri)\b/.test(text)||text.includes('★'))return'knife';
 if(/glove|hand wraps|wraps/.test(text))return'glove'; return'weapon';
}
export function fallbackPrice(){return null}
export function validateMarketPrice(apiPrice){const p=Number(apiPrice);return Number.isFinite(p)&&p>0?{price:Math.round(p*100)/100,source:'рыночная цена'}:{price:null,source:'Цена временно недоступна'}}
function readCache(){try{return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY)||'null')}catch{return null}}
function writeCache(entries,source){try{localStorage.setItem(PRICE_CACHE_KEY,JSON.stringify({time:Date.now(),items:entries,source}))}catch{}}
function normalise(raw){
 const sourceList=Array.isArray(raw)?raw:Array.isArray(raw?.items)?raw.items:Array.isArray(raw?.data)?raw.data:[]; const entries=[];
 for(const x of sourceList){
  const name=String(x.market_hash_name||x.marketHashName||x.name||'').trim();
  let price=Number(x.price_usd??x.price??x.min_price??x.suggested_price??x.median_price??0);
  // Some APIs return integer cents.
  if(price>100000)price/=100;
  if(name&&Number.isFinite(price)&&price>0)entries.push([name,Math.round(price*100)/100]);
 }
 return entries;
}
export async function loadBulkPrices(){
 const cached=readCache(); if(cached?.items&&Date.now()-Number(cached.time||0)<PRICE_CACHE_TTL)return{map:new Map(cached.items),source:cached.source||'кэш рынка'};
 for(const url of ['/api/prices','/prices.json']){try{const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)continue;const data=await r.json();const entries=normalise(data);if(entries.length<10)continue;const source=data.source||'Market.CSGO';writeCache(entries,source);return{map:new Map(entries),source}}catch{}}
 return{map:new Map(cached?.items||[]),source:cached?.items?.length?'старый кэш рынка':'рынок временно недоступен'};
}
export function parseSteamMoney(text){const raw=String(text||'').replace(/\s/g,'').replace(/[^0-9.,]/g,'');if(!raw)return 0;const c=raw.lastIndexOf(','),d=raw.lastIndexOf('.');const n=Number(c>d?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,''));return Number.isFinite(n)?n:0}

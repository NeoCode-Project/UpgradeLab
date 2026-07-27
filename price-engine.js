// UpgradeLab V34 real market price engine
// Catalog metadata comes from ByMykel. Market prices should come from a server endpoint
// (same-origin /api/prices) or from Steam priceoverview for visible cards.

export const PRICE_CACHE_TTL = 24 * 60 * 60 * 1000;
export const PRICE_CACHE_KEY = 'ul-market-price-cache-v34';

function stableHash(text='') {
  let h = 2166136261;
  for (const c of String(text)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function detectCategory(rawCategory, name='') {
  const raw = String(rawCategory || '').toLowerCase();
  const text = `${raw} ${String(name || '')}`.toLowerCase();
  if (/agent|character|terrorist|counter-terrorist/.test(raw)) return 'agent';
  if (/keychain|charm/.test(raw)) return 'keychain';
  if (/sticker/.test(raw)) return 'sticker';
  if (/graffiti|spray/.test(raw)) return 'graffiti';
  if (raw === 'case' || /crate|case|capsule|package/.test(raw)) return 'case';
  const knives = /\b(knife|knives|bayonet|karambit|dagger|daggers|bowie|falchion|navaja|stiletto|talon|ursus|paracord|survival|skeleton|nomad|kukri|gut knife|flip knife|huntsman|classic knife)\b/;
  if (knives.test(text) || text.includes('★')) return 'knife';
  if (/glove|gloves|hand wraps|wraps/.test(text)) return 'glove';
  return 'weapon';
}

export function fallbackPrice(name, rarity, category='weapon', wear='Field-Tested') {
  const h = stableHash(name);
  const n = String(name).toLowerCase();
  category = detectCategory(category, name);
  let base = ({consumer:.25, industrial:.8, 'mil-spec':3.5, restricted:14, classified:55, covert:190, contraband:4200, extraordinary:420}[rarity] || 5);

  // Realistic emergency floors, not pretend market prices.
  if (category === 'knife') base = Math.max(base, 45);
  if (category === 'glove') base = Math.max(base, 30);

  if (n.includes('dragon lore')) base = 7200;
  if (n.includes('howl')) base = 5600;
  if (n.includes('gungnir')) base = 6800;
  if (n.includes('wild lotus')) base = 4300;
  if (n.includes('medusa')) base = 3200;
  if (n.includes('lore')) base *= 2.15;
  if (n.includes('doppler')) base *= 2.45;
  if (n.includes('fade')) base *= 2.65;
  if (n.includes('crimson web')) base *= 1.85;
  if (n.includes('case hardened')) base *= 1.55;
  if (n.includes('slaughter')) base *= 1.45;
  if (n.includes('blue steel')) base *= 1.05;
  if (/boreal forest|forest ddpat|safari mesh/.test(n)) base *= .58;
  if (n.includes('sand dune')) base *= .22;

  const wearMul = ({'Factory New':1.28, 'Minimal Wear':1.08, 'Field-Tested':.86, 'Well-Worn':.72, 'Battle-Scarred':.63}[wear] || 1);
  const spread = .72 + ((h % 10000) / 10000) * 1.15;
  let result = base * wearMul * spread;

  if (category === 'knife') result = Math.max(45, result);
  if (category === 'glove') result = Math.max(30, result);
  if (category === 'agent') result = Math.max(2, result * .18);
  if (category === 'sticker') result = Math.max(.08, result * .035);
  if (category === 'graffiti') result = Math.max(.03, result * .012);
  if (category === 'keychain') result = Math.max(.3, result * .07);

  if (category === 'case') {
    const unit = (h % 1000) / 1000;
    let caseBase = .15 + unit * 2.5;
    if (/operation bravo/.test(n)) caseBase = 120 + unit * 330;
    else if (/cs:go weapon case(?!\s*[23])|weapon case 1(?!\d)|esports 2013 winter/.test(n)) caseBase = 25 + unit * 120;
    else if (/hydra|shattered web|breakout|esports 2014|winter offensive/.test(n)) caseBase = 8 + unit * 45;
    else if (/katowice 2014/.test(n)) caseBase = 80 + unit * 550;
    else if (/souvenir package|dreamhack|cologne 2014/.test(n)) caseBase = 5 + unit * 150;
    else if (/capsule/.test(n)) caseBase = .5 + unit * 8;
    else if (/gift package|pallet|parcel|present/.test(n)) caseBase = 1 + unit * 12;
    result = caseBase;
  }
  return Math.max(.03, Math.round(result * 100) / 100);
}

export function validateMarketPrice(apiPrice, name, category, wear, rarity) {
  // V33: market prices are never limited by artificial floors or ceilings.
  // Any positive finite value returned by a configured market source is accepted.
  const p = Number(apiPrice);
  if (Number.isFinite(p) && p > 0) {
    return {price:Math.round(p * 100) / 100, source:'рыночная цена'};
  }
  return {
    price:fallbackPrice(name, rarity, detectCategory(category, name), wear),
    source:'резервная оценка — рынок не ответил'
  };
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || 'null'); } catch { return null; }
}
function writeCache(entries) {
  try { localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({time:Date.now(), items:entries})); } catch {}
}
function normalizePricePayload(raw) {
  const entries=[];
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
  for (const x of list) {
    const name = String(x.market_hash_name || x.name || '');
    const price = Number(x.price ?? x.suggested_price ?? x.median_price ?? x.min_price ?? 0);
    if (name && Number.isFinite(price) && price > 0) entries.push([name, price]);
  }
  return entries;
}

export async function loadBulkPrices() {
  const cached = readCache();
  const stale = cached?.items ? new Map(cached.items) : new Map();
  if (cached?.items && Date.now() - Number(cached.time || 0) < PRICE_CACHE_TTL) {
    return {map:stale, source:'кэш рыночных цен'};
  }
  // Optional same-origin server/Worker. No API secrets are ever placed in app.js.
  const endpoints = ['/api/prices', '/prices.json'];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {headers:{Accept:'application/json'}});
      if (!r.ok) continue;
      const entries = normalizePricePayload(await r.json());
      if (entries.length < 50) continue;
      writeCache(entries);
      return {map:new Map(entries), source:'серверные рыночные цены'};
    } catch {}
  }
  return {map:stale, source:stale.size ? 'старый кэш рыночных цен' : 'резервная оценка'};
}

export function parseSteamMoney(text) {
  const raw = String(text || '').replace(/\s/g, '').replace(/[^0-9.,]/g, '');
  if (!raw) return 0;
  const comma=raw.lastIndexOf(','), dot=raw.lastIndexOf('.');
  const normalized = comma > dot ? raw.replace(/\./g,'').replace(',','.') : raw.replace(/,/g,'');
  const n=Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

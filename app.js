import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc, onSnapshot, collection, query, orderBy, limit, setDoc, updateDoc, runTransaction, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { loadBulkPrices, fallbackPrice, validateMarketPrice, detectCategory, parseSteamMoney } from './price-engine.js';

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const START_BALANCE_USD=10000/41.4;
const API_BASES=['https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/','https://cdn.jsdelivr.net/gh/ByMykel/CSGO-API@main/public/api/en/'];
const ITEM_FILES=[
  ['skins.json','weapon'],
  ['agents.json','agent'],
  ['stickers.json','sticker'],
  ['graffiti.json','graffiti'],
  ['keychains.json','keychain'],
  ['crates.json','case']
];
const rates={USD:1,EUR:.92,UAH:41.4,RUB:87},symbols={USD:'$',EUR:'€',UAH:'₴',RUB:'₽'},HOUSE=.90,MAX_CHANCE=80;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];

const savedTheme=localStorage.getItem('ul-theme')||'classic';
const savedWheelStyle=localStorage.getItem('ul-wheel-style')||'bubble';
const savedArrow=localStorage.getItem('ul-arrow-style')||'1';
const savedSpinStyle=localStorage.getItem('ul-spin-style')||'normal';
document.documentElement.dataset.theme=savedTheme;
document.body.dataset.theme=savedTheme;
document.documentElement.dataset.wheel=savedWheelStyle;
document.documentElement.dataset.arrow=savedArrow;
function setTheme(name,notify=true){
  const allowed=['classic','neon','blue','red'];
  if(!allowed.includes(name))name='classic';
  document.documentElement.dataset.theme=name;
  document.body.dataset.theme=name;
  localStorage.setItem('ul-theme',name);
  $$('.theme-grid button[data-theme]').forEach(b=>b.classList.toggle('active',b.dataset.theme===name));
  if(notify)toast('Тема изменена');
}
let user=null,userDoc=null,profile=null,skins=[],inventory=[],history=[],target=null,sourceItems=[],selected=new Set(),favorites=new Set(),shown=30,spin=false,lastOutcome=null,cashDraft='',currency=localStorage.getItem('ul-currency')||'UAH',fast=localStorage.getItem('ul-fast')==='1',sound=localStorage.getItem('ul-sound')!=='0',soundVolume=Math.max(0,Math.min(1,Number(localStorage.getItem('ul-sound-volume')??0.35))),unsubs=[];
function inventoryKey(x){return String(x?.uid||x?.inventoryId||((x?.id||x?.marketHash||x?.name||'item')+'::'+(x?.obtainedAt||x?.createdAt||x?.wear||'')))}
function parseMoneyInput(v){const n=Number(String(v??'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)&&n>=0?n:0}
const toast=t=>{const e=$('#toast');t=String(t??'');if(t.length>220)t=t.slice(0,217)+'…';e.textContent=t;e.className='show';setTimeout(()=>e.className='',2400)};
const fmt=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2,minimumFractionDigits:2}).format((Number(v)||0)*rates[currency])+' '+symbols[currency];
const priceFor=(name,rarity,category='weapon',wear='Field-Tested')=>fallbackPrice(name,rarity,category,wear);
function sanePrice(apiPrice,name,category,wear,rarity){return validateMarketPrice(apiPrice,name,category,wear,rarity)}
function rarityOf(x){
  const raw=String(x.rarity?.id||x.rarity?.name||'').toLowerCase().replaceAll('_','-');
  if(/consumer|common/.test(raw))return 'consumer';
  if(/industrial|uncommon/.test(raw))return 'industrial';
  if(/mil-spec|rare|distinguished/.test(raw))return 'mil-spec';
  if(/restricted|mythical|exceptional/.test(raw))return 'restricted';
  if(/classified|legendary|superior/.test(raw))return 'classified';
  if(/covert|ancient|master/.test(raw))return 'covert';
  if(/contraband/.test(raw))return 'contraband';
  if(/extraordinary/.test(raw))return 'extraordinary';
  return 'mil-spec';
}
const RARITY_META={consumer:['Ширпотреб','#b0c3d9'],industrial:['Промышленное','#5e98d9'],'mil-spec':['Армейское','#4b69ff'],restricted:['Запрещённое','#8847ff'],classified:['Засекреченное','#d32ce6'],covert:['Тайное','#eb4b4b'],contraband:['Контрабанда','#e4ae39'],extraordinary:['Экстраординарное','#e4ae39']};
function rarityMeta(r){r=String(r||'mil-spec').toLowerCase().replaceAll('_','-');return RARITY_META[r]||RARITY_META['mil-spec']}
function avatarLetter(n){return (n||'U').trim().charAt(0).toUpperCase()||'U'}
function setAuthMode(register){$('#nickname').hidden=!register;$('#authTitle').textContent=register?'Регистрация':'Вход';$('#authSubmit').textContent=register?'Создать аккаунт':'Войти';$('#loginTab').className=register?'ghost':'upgrade-btn';$('#registerTab').className=register?'upgrade-btn':'ghost';$('#authForm').dataset.mode=register?'register':'login'}
$('#loginTab').onclick=()=>setAuthMode(false);$('#registerTab').onclick=()=>setAuthMode(true);setAuthMode(false);
$('#authForm').onsubmit=async e=>{e.preventDefault();$('#authError').textContent='';try{const email=$('#email').value.trim(),pass=$('#password').value;if(e.currentTarget.dataset.mode==='register'){const cred=await createUserWithEmailAndPassword(auth,email,pass);await bootstrapUser($('#nickname').value.trim()||'Игрок');toast('Аккаунт создан')}else await signInWithEmailAndPassword(auth,email,pass)}catch(err){$('#authError').textContent=humanError(err)}};
$('#resetPassword').onclick=async()=>{try{await sendPasswordResetEmail(auth,$('#email').value.trim());toast('Письмо для сброса отправлено')}catch(e){$('#authError').textContent=humanError(e)}};
$('#logoutBtn').onclick=()=>signOut(auth);
function humanError(e){const c=e?.code||'';if(c.includes('invalid-credential'))return 'Неверный email или пароль';if(c.includes('email-already-in-use'))return 'Этот email уже используется';if(c.includes('weak-password'))return 'Пароль должен быть минимум 6 символов';if(c.includes('too-many-requests'))return 'Слишком много попыток. Попробуй позже';if(c.includes('permission-denied'))return 'Обнови правила Firestore из архива';return e?.message||'Ошибка'}
async function bootstrapUser(nickname='Игрок'){if(!user)return;const uref=doc(db,'users',user.uid),pref=doc(db,'profiles',user.uid);const snap=await getDoc(uref);if(!snap.exists())await setDoc(uref,{balanceUSD:START_BALANCE_USD,inventory:[],history:[],favorites:[],createdAt:serverTimestamp()});const ps=await getDoc(pref);if(!ps.exists())await setDoc(pref,{nickname:nickname||'Игрок',stats:{spins:0,wins:0,losses:0,bestWinUSD:0},createdAt:serverTimestamp()})}

onAuthStateChanged(auth,async u=>{unsubs.forEach(x=>x());unsubs=[];user=u;target=null;sourceItems=[];if(!u){$('#authScreen').classList.remove('hidden');return}$('#authScreen').classList.add('hidden');try{await bootstrapUser('Игрок')}catch(e){toast(humanError(e))}subscribeUser();subscribeFeed();await loadCatalog()});
function subscribeUser(){unsubs.push(onSnapshot(doc(db,'users',user.uid),s=>{userDoc=s.data()||{};inventory=Array.isArray(userDoc.inventory)?userDoc.inventory:[];history=Array.isArray(userDoc.history)?userDoc.history:[];favorites=new Set(Array.isArray(userDoc.favorites)?userDoc.favorites.map(String):[]);renderAll();const op=userDoc.lastOperation;if(op?.unseen){$('#pendingBanner').classList.add('show');showOutcome(op.result)}else $('#pendingBanner').classList.remove('show')}));unsubs.push(onSnapshot(doc(db,'profiles',user.uid),s=>{profile=s.data()||{};renderProfile();renderTop()}))}
function subscribeFeed(){const q=query(collection(db,'feed'),orderBy('createdAt','desc'),limit(30));unsubs.push(onSnapshot(q,s=>{document.querySelector('.feed-panel')?.classList.toggle('empty-feed',s.empty);$('#feedList').innerHTML=s.docs.map(d=>{const x=d.data();return `<div class="feed-item" data-uid="${x.uid}"><img src="${x.image||''}"><div><b>${esc(x.nickname||'Игрок')}</b><span>${esc(x.itemName||'Скин')}</span><span>${Number(x.chance||0).toFixed(2)}%</span></div></div>`}).join('')||'<p class="muted">Пока пусто</p>';$$('.feed-item').forEach(e=>e.onclick=()=>openPublicProfile(e.dataset.uid))}))}
async function openPublicProfile(uid){const s=await getDoc(doc(db,'profiles',uid));if(!s.exists())return toast('Профиль не найден');const p=s.data();$('#publicProfile').innerHTML=`<div class="profile-head"><div class="avatar">${avatarLetter(p.nickname)}</div><div><h2>${esc(p.nickname||'Игрок')}</h2><p class="muted">Публичный профиль</p></div></div><div class="stats-grid"><div class="stat"><b>${p.stats?.spins||0}</b><small>апгрейдов</small></div><div class="stat"><b>${p.stats?.wins||0}</b><small>побед</small></div><div class="stat"><b>${p.stats?.losses||0}</b><small>поражений</small></div><div class="stat"><b>${fmt(p.stats?.bestWinUSD||0)}</b><small>лучший выигрыш</small></div></div>`;open('publicProfileModal')}
async function loadPrices(){return loadBulkPrices()}
async function fetchItemFile(file){
  for(const base of API_BASES){
    try{const r=await fetch(base+file);if(!r.ok)throw new Error(String(r.status));const data=await r.json();if(Array.isArray(data))return data}catch{}
  }
  return [];
}
function normalizeExtraItem(x,i,forcedCategory,priceMap){
  const name=String(x.market_hash_name||x.name||'').trim();
  const image=x.image||x.image_inventory||x.image_url||'';
  if(!name||!image)return null;
  const rarity=rarityOf(x),category=forcedCategory;
  const marketHash=name;
  const apiPrice=priceMap.get(marketHash);
  if(!(Number(apiPrice)>0)) return null; // V34: no invented catalog prices
  const checked=sanePrice(apiPrice,marketHash,category,'',rarity);
  return {id:`${forcedCategory}-${x.id||x.def_index||i}`,name,marketHash,wear:'',image,rarity,category,subtype:String(x.type||''),priceUSD:checked.price,priceSource:'Skinport — реальные продажи'};
}
async function loadCatalog(){
  if(skins.length)return;
  const priceResult=await loadPrices(),priceMap=priceResult.map;
  const payloads=await Promise.all(ITEM_FILES.map(async([file,category])=>[category,await fetchItemFile(file)]));
  const out=[],seen=new Set();
  for(const [forcedCategory,raw] of payloads){
    if(forcedCategory==='weapon'){
      raw.filter(x=>x.image&&x.name).forEach((x,i)=>{
        const rarity=rarityOf(x),baseName=x.name.includes('|')?x.name:`${x.weapon?.name||'Skin'} | ${x.name}`;
        const wears=(x.wears?.length?x.wears.map(w=>w.name):['Field-Tested']).slice(0,5);
        for(const wear of wears){
          const category=detectCategory(String(x.category?.name||x.weapon?.name||''),baseName);
          const variants=[{prefix:'',kind:'normal',mul:1}];
          if(category==='weapon'){
            variants.push({prefix:'StatTrak™ ',kind:'stattrak',mul:1.45});
            variants.push({prefix:'Souvenir ',kind:'souvenir',mul:1.20});
          }
          for(const variant of variants){
            const displayName=variant.prefix+baseName;
            const hash=`${displayName} (${wear})`,key=hash.toLowerCase();if(seen.has(key))continue;seen.add(key);
            const api=priceMap.get(hash);
            if(!(Number(api)>0)) continue; // V34: show only items with a real market price
            const checked=sanePrice(api,hash,category,wear,rarity);
            out.push({id:`${x.id||i}-${variant.kind}-${wear}`,name:displayName,marketHash:hash,wear,image:x.image,rarity,category,variant:variant.kind,priceUSD:checked.price,priceSource:'Skinport — реальные продажи'});
          }
        }
      });
    }else{
      raw.forEach((x,i)=>{const item=normalizeExtraItem(x,i,forcedCategory,priceMap);if(!item)return;const key=`${item.category}|${item.marketHash}`.toLowerCase();if(seen.has(key))return;seen.add(key);out.push(item)});
    }
  }
  // Zeus skins are part of skins.json; this fallback keeps the category discoverable if the upstream naming changes.
  skins=out.filter(x=>Number.isFinite(x.priceUSD)&&x.priceUSD>0);
  const counts=Object.fromEntries(['weapon','knife','glove','agent','keychain','sticker','graffiti','case'].map(c=>[c,skins.filter(x=>x.category===c).length]));
  $('#status').textContent=skins.length?`${skins.length} предметов: оружие ${counts.weapon+counts.knife+counts.glove}, агенты ${counts.agent}, брелоки ${counts.keychain}, наклейки ${counts.sticker}, граффити ${counts.graffiti}, кейсы ${counts.case}. Категории: ByMykel API. Цены: ${priceResult.source}. В каталоге показываются только предметы с реальной рыночной ценой; резервные оценки отключены. Кэш: 24 часа.`:'Каталог не загрузился';
  renderCatalog();
}
function esc(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function card(x,mode='catalog'){
  // В каталоге предмет определяется catalog id, а в инвентаре — уникальным uid.
  // У выигранного предмета есть оба поля, поэтому прежний x.id||x.uid ломал выбор ставки.
  const id=String(mode==='catalog'?(x.id||x.marketHash):inventoryKey(x));
  const favKey=String(x.id||x.marketHash||id),fav=favorites.has(favKey)||favorites.has(String(x.marketHash||''));
  const targetId=target?String(target.id||target.marketHash||''):'';
  const [rarityLabel,rarityColor]=rarityMeta(x.rarity);
  return `<article class="skin-card ${mode}-card rarity-${esc(x.rarity||'mil-spec')} ${mode==='catalog'&&targetId===id?'target-selected':''}" style="--rarity-color:${rarityColor}" data-id="${esc(id)}"><button class="fav-btn ${fav?'active':''}" title="${fav?'Убрать из избранного':'Добавить в избранное'}" aria-label="Избранное">${fav?'★':'☆'}</button><div class="skin-img"><img src="${esc(x.image)}" loading="lazy"></div><span class="wear-badge">${esc(x.wear||'')}</span><h3>${esc(x.name)}</h3><small>${esc(x.wear||'')}</small><span class="rarity-badge">${rarityLabel}</span><b>${fmt(x.priceUSD)}</b><em class="price-source">${esc(x.priceSource||'сохранённая цена')}</em>${mode==='catalog'?'<button class="choose compact-pick">＋</button>':mode==='inventory'?'<div class="card-actions"><button class="ghost use">Поставить</button><button class="ghost sell">Продать</button></div>':'<button class="ghost pick">Выбрать</button>'}</article>`
}
function filtered(){
  let q=$('#search').value.toLowerCase(),c=$('#category').value,only=$('#favoriteOnly')?.classList.contains('active');
  let a=skins.filter(x=>(c==='all'||x.category===c)&&(`${x.name} ${x.wear}`).toLowerCase().includes(q)&&(!only||favorites.has(String(x.id))||favorites.has(String(x.marketHash||''))));
  const sort=$('#sort').value;a.sort((x,y)=>sort==='priceDesc'?y.priceUSD-x.priceUSD:sort==='name'?x.name.localeCompare(y.name):x.priceUSD-y.priceUSD);return a
}
async function toggleFavorite(x){
  const key=String(x.id||x.marketHash); favorites.has(key)?favorites.delete(key):favorites.add(key);
  try{await updateDoc(doc(db,'users',user.uid),{favorites:[...favorites]})}catch(e){toast(humanError(e))}
  renderCatalog();renderInventory();
}
function wireFavoriteButtons(root,items){
  $$(`${root} .skin-card`).forEach(e=>{const x=items.find(x=>String(x.uid||x.id||x.marketHash)===String(e.dataset.id)||String(x.id||x.marketHash)===String(e.dataset.id));const b=e.querySelector('.fav-btn');if(b&&x)b.onclick=ev=>{ev.stopPropagation();toggleFavorite(x)}})
}
const steamPriceInFlight=new Set();
const STEAM_CACHE_KEY='ul-steam-price-cache-v2';
function getSteamCache(){try{return JSON.parse(localStorage.getItem(STEAM_CACHE_KEY)||'{}')}catch{return {}}}
async function fetchSteamPrice(item){
  if(!item?.marketHash||item.category==='agent'||item.category==='graffiti')return null;
  const cache=getSteamCache(),entry=cache[item.marketHash];if(entry&&Date.now()-entry.time<12*60*60*1000)return entry.price||null;
  if(steamPriceInFlight.has(item.marketHash))return null;steamPriceInFlight.add(item.marketHash);
  const marketName=encodeURIComponent(item.marketHash);
  const url='https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name='+marketName;
  // Same-origin Worker is tried first. Public CORS proxies are only emergency fallbacks.
  const urls=['/api/steam-price?market_hash_name='+marketName,url,'https://api.allorigins.win/raw?url='+encodeURIComponent(url),'https://api.codetabs.com/v1/proxy?quest='+encodeURIComponent(url),'https://corsproxy.io/?url='+encodeURIComponent(url)];
  try{for(const endpoint of urls){try{const r=await fetch(endpoint);if(!r.ok)continue;const data=await r.json();const price=Number(data.price_usd||0)||parseSteamMoney(data.lowest_price||data.median_price);if((data.success!==false)&&price>0){cache[item.marketHash]={price,time:Date.now()};localStorage.setItem(STEAM_CACHE_KEY,JSON.stringify(cache));return price}}catch{}}}finally{steamPriceInFlight.delete(item.marketHash)}
  return null;
}
async function enrichSteamPrices(items){
  const todo=items.filter(x=>x&&x.priceSource!=='Steam Market' && x.priceSource!=='рыночная цена').slice(0,12);let changed=false;
  for(let i=0;i<todo.length;i+=3){const batch=todo.slice(i,i+3);const prices=await Promise.all(batch.map(fetchSteamPrice));prices.forEach((p,j)=>{if(p>0){batch[j].priceUSD=p;batch[j].priceSource='Steam Market — реальная цена';changed=true}})}
  if(changed){renderCatalog();syncUpgrade()}
}
function renderCatalog(){
  const visible=filtered().slice(0,shown);$('#skinGrid').innerHTML=visible.map(x=>card(x)).join('')||'<div class="empty-state">Ничего не найдено</div>';
  $$(`#skinGrid .skin-card`).forEach(e=>{const b=e.querySelector('.choose');if(b)b.onclick=()=>{const candidate=skins.find(x=>String(x.id)===String(e.dataset.id));const stake=stakeUSD();if(stake>0&&candidate&&candidate.priceUSD<=stake)return toast('Выбери скин дороже текущей ставки');target=candidate;lastOutcome=null;syncUpgrade();scrollTo({top:0,behavior:'smooth'})}});wireFavoriteButtons('#skinGrid',visible); clearTimeout(renderCatalog._steamTimer); renderCatalog._steamTimer=setTimeout(()=>enrichSteamPrices(visible),350)
}
function renderInventory(){$('#inventoryGrid').innerHTML=inventory.map(x=>card(x,'inventory')).join('')||'<div class="empty-state">Инвентарь пуст</div>';$$('#inventoryGrid .skin-card').forEach(e=>{const x=inventory.find(x=>inventoryKey(x)===String(e.dataset.id));e.querySelector('.use').onclick=()=>{sourceItems=[x];lastOutcome=null;target=null;showPage('upgrade');syncUpgrade()};e.querySelector('.sell').onclick=()=>sellItems([inventoryKey(x)])});wireFavoriteButtons('#inventoryGrid',inventory);renderPicker()}
function renderPicker(){
  $('#modalGrid').innerHTML=inventory.map(x=>card(x,'picker')).join('')||'<div class="empty-state">Инвентарь пуст</div>';
  $$('#modalGrid .skin-card').forEach(e=>{
    const id=String(e.dataset.id);
    e.classList.toggle('selected',selected.has(id));
    const toggle=()=>{
      selected.has(id)?selected.delete(id):selected.add(id);
      e.classList.toggle('selected',selected.has(id));
      const apply=$('#applySources');
      if(apply){apply.disabled=selected.size===0;apply.textContent=selected.size?`Применить (${selected.size})`:'Выбери хотя бы один скин'}
    };
    e.querySelector('.pick').onclick=ev=>{ev.stopPropagation();toggle()};
    e.onclick=ev=>{if(!ev.target.closest('.fav-btn,.pick'))toggle()};
  });
  const apply=$('#applySources');
  if(apply){apply.disabled=selected.size===0;apply.textContent=selected.size?`Применить (${selected.size})`:'Выбери хотя бы один скин'}
}
function cashStakeUSD(){return parseMoneyInput(cashDraft)/rates[currency]}
function itemsStakeUSD(items=sourceItems){return items.reduce((a,x)=>a+Number(x.priceUSD||0),0)}
function stakeUSD(){return itemsStakeUSD()+cashStakeUSD()}
function chance(){if(!target)return 0;return Math.min(MAX_CHANCE,stakeUSD()/target.priceUSD*100*HOUSE)}
function outcomeStakeUSD(){
  if(!lastOutcome)return 0;
  return itemsStakeUSD(Array.isArray(lastOutcome.sources)?lastOutcome.sources:[])+Number(lastOutcome.cashUSD||0);
}
function renderSource(){
  const el=$('#sourceSlot');
  const shownSources=sourceItems.length?sourceItems:(lastOutcome?.sources||[]);
  if(shownSources.length){
    const visible=shownSources.slice(0,4);
    el.className='item-slot source-items'+(lastOutcome&&!sourceItems.length?' result-snapshot':'');
    const resultCash=lastOutcome&&!sourceItems.length?Number(lastOutcome.cashUSD||0):cashStakeUSD();
    el.innerHTML=`<div class="mini-source-grid">${visible.map(x=>`<div class="mini-source"><img src="${esc(x.image)}"><span>${esc(x.name)}</span></div>`).join('')}</div>${shownSources.length>4?`<small class="more-sources">+${shownSources.length-4} предметов</small>`:''}${sourceItems.length?`<div class="skin-cash-topup"><label>Доплата с баланса<input id="stake" type="text" inputmode="decimal" autocomplete="off" value="${esc(cashDraft)}" placeholder="0"></label><button id="useAllBalance" type="button">Весь баланс</button></div>`:(resultCash>0?`<small class="cash-added">+ ${fmt(resultCash)} из баланса</small>`:'')}<b class="source-total">${fmt(sourceItems.length?stakeUSD():outcomeStakeUSD())}</b>`;
    if(sourceItems.length){const input=$('#stake');input.oninput=()=>{cashDraft=input.value;lastOutcome=null;updateUpgradeMetrics()};const all=$('#useAllBalance');if(all)all.onclick=()=>{cashDraft=String(Math.max(0,Number(userDoc?.balanceUSD||0))*rates[currency]).replace('.',',');input.value=cashDraft;updateUpgradeMetrics()}}
    return;
  }
  if(lastOutcome&&Number(lastOutcome.cashUSD||0)>0){
    el.className='item-slot cash result-snapshot';
    el.innerHTML=`<div class="cash-result"><span>${symbols[currency]}</span><strong>${fmt(Number(lastOutcome.cashUSD||0))}</strong><em>ставка из баланса</em></div>`;
    return;
  }
  el.className='item-slot cash';
  el.innerHTML=`<div class="cash-entry"><span>${symbols[currency]}</span><label>Сумма ставки<input id="stake" type="text" inputmode="decimal" autocomplete="off" value="${esc(cashDraft)}" placeholder="0,01"></label><em>Минимум 0,01. Можно использовать весь остаток.</em><button id="useAllBalance" type="button">Весь баланс</button></div>`;
  const input=$('#stake');
  input.oninput=()=>{cashDraft=input.value;lastOutcome=null;updateUpgradeMetrics()};
  $('#useAllBalance').onclick=()=>{cashDraft=String(Math.max(0,Number(userDoc?.balanceUSD||0))*rates[currency]).replace('.',',');input.value=cashDraft;updateUpgradeMetrics()};
}
function renderTarget(){const el=$('#targetSlot');if(!target){el.className='item-slot empty';el.innerHTML='<span>Нажми на скин ниже</span>';return}el.className='item-slot'+(lastOutcome?' outcome '+(lastOutcome.win?'won':'lost'):'');el.innerHTML=`${lastOutcome?`<div class="outcome-ribbon">${lastOutcome.win?'✓ ВЫИГРЫШ':'✕ ПРОИГРЫШ'}</div>`:''}<img src="${esc(target.image)}"><div class="target-info"><h3>${esc(target.name)}</h3><small>${esc(target.wear)}</small><b>${fmt(target.priceUSD)}</b></div>`}
function updateUpgradeMetrics(){
  const showingResult=!!lastOutcome&&!sourceItems.length&&!cashDraft;
  const v=showingResult?outcomeStakeUSD():stakeUSD();
  const shownTarget=showingResult?(lastOutcome.target||target):target;
  const c=showingResult?Number(lastOutcome.chance||0):chance();
  const tooCheap=!showingResult&&!!shownTarget&&v>0&&shownTarget.priceUSD<=v;
  $('#chance').textContent=(tooCheap?0:c).toFixed(2)+'%';
  $('#multi').textContent=shownTarget&&v>0?'x'+(Number(shownTarget.priceUSD||0)/v).toFixed(2):'x0.00';
  $('#winArc').style.setProperty('--chance',`${(tooCheap?0:c)*3.6}deg`);
  const btn=$('#upgradeBtn');
  if(showingResult){btn.disabled=spin;btn.textContent='НОВЫЙ АПГРЕЙД';return}
  btn.textContent='АПГРЕЙД';
  btn.disabled=spin||!target||v<=0||tooCheap||c<=0||cashStakeUSD()>Number(userDoc?.balanceUSD||0);
  if(!lastOutcome)$('#result').textContent=!target?'Выбери целевой скин':tooCheap?'Целевой скин должен быть дороже ставки':c>=MAX_CHANCE?'Шанс ограничен 80%':'Готово к апгрейду';
}
function syncUpgrade(){renderSource();renderTarget();updateUpgradeMetrics()}
async function startUpgrade(){if(lastOutcome&&!sourceItems.length&&!cashDraft){lastOutcome=null;target=null;selected.clear();syncUpgrade();return}if(spin||$('#upgradeBtn').disabled)return;spin=true;syncUpgrade();$('#result').textContent='Выполняется апгрейд…';const stake=stakeUSD(),cashPart=cashStakeUSD(),c=chance(),chosenTarget={...target},chosenSources=[...sourceItems];try{const result=await runTransaction(db,async tx=>{const uref=doc(db,'users',user.uid),pref=doc(db,'profiles',user.uid),us=await tx.get(uref),ps=await tx.get(pref);if(!us.exists())throw new Error('Профиль не найден');const data=us.data(),inv=Array.isArray(data.inventory)?data.inventory:[],hist=Array.isArray(data.history)?data.history:[],balance=Number(data.balanceUSD||0);const ids=new Set(chosenSources.map(inventoryKey));if(chosenSources.length&&chosenSources.some(x=>!inv.some(i=>inventoryKey(i)===inventoryKey(x))))throw new Error('Один из предметов уже отсутствует');if(balance<cashPart)throw new Error('Недостаточно виртуального баланса для доплаты');const roll=Math.random()*100,win=roll<c;const wonItem=win?{...chosenTarget,uid:crypto.randomUUID(),obtainedAt:Date.now()}:null;const nextInv=inv.filter(i=>!ids.has(inventoryKey(i)));if(wonItem)nextInv.unshift(wonItem);const entry={id:crypto.randomUUID(),createdAt:Date.now(),win,chance:c,roll,cashUSD:cashPart,sources:chosenSources,target:chosenTarget};const nextBalance=balance-cashPart;tx.update(uref,{balanceUSD:nextBalance,inventory:nextInv,history:[entry,...hist].slice(0,100)});const p=ps.exists()?ps.data():{nickname:'Игрок',stats:{}};const st=p.stats||{};tx.set(pref,{...p,stats:{spins:Number(st.spins||0)+1,wins:Number(st.wins||0)+(win?1:0),losses:Number(st.losses||0)+(win?0:1),bestWinUSD:Math.max(Number(st.bestWinUSD||0),win?chosenTarget.priceUSD:0)}},{merge:true});const arc=Math.max(0.36,Math.min(359.64,c*3.6));const angle=win?(Math.random()*arc):(arc+Math.random()*Math.max(0.36,360-arc));return {win,target:chosenTarget,chance:c,roll,angle}});if(result.win)await addDoc(collection(db,'feed'),{uid:user.uid,nickname:profile?.nickname||'Игрок',itemName:chosenTarget.name,image:chosenTarget.image,chance:c,createdAt:serverTimestamp()});await animateWheel(result);result.sources=chosenSources;result.cashUSD=cashPart;showOutcome(result);sourceItems=[];selected.clear();cashDraft=''}catch(e){toast(humanError(e));$('#result').textContent='Апгрейд не выполнен'}finally{spin=false;syncUpgrade()}}
async function animateWheel(r){const spinStyle=localStorage.getItem('ul-spin-style')||'normal';const d=fast?1800:(spinStyle==='long'?8200:5200),turns=fast?4:10,final=r.angle??Math.random()*360,n=$('#needle');n.getAnimations().forEach(a=>a.cancel());const stopTicks=sound?startSpinTicks(d):()=>{};const a=n.animate([{transform:'rotate(0deg)'},{transform:`rotate(${turns*360+final}deg)`}],{duration:d,easing:'cubic-bezier(.12,.02,.08,1)',fill:'forwards'});try{await a.finished}finally{stopTicks()}if(sound)resultSound(r.win)}
function showOutcome(r){if(!r)return;lastOutcome=r;const roll=Number(r.roll);const detail=Number.isFinite(roll)?`Выпало ${roll.toFixed(2)} из 100 · нужно ≤ ${Number(r.chance||0).toFixed(2)}`:`Шанс ${Number(r.chance||0).toFixed(2)}%`;$('#result').innerHTML=r.win?`<strong class="win">ВЫИГРЫШ — ${esc(r.target?.name||'скин')}</strong><small>${detail}. Предмет добавлен в инвентарь.</small>`:`<strong class="lose">ПРОИГРЫШ</strong><small>${detail}. Ставка списана.</small>`;target=r.target||target;renderTarget()}
let audioCtx=null;function getAudio(){try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();return audioCtx}catch{return null}}
function beep(freq=240,d=.055,volume=.22,type='sine'){if(!sound||soundVolume<=0)return;try{const c=getAudio();if(!c)return;const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(freq,c.currentTime);g.gain.setValueAtTime(Math.max(.0001,volume*soundVolume),c.currentTime);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+d);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+d)}catch{}}
function startSpinTicks(duration){let stopped=false,timer=null,start=performance.now(),count=0;const tick=()=>{if(stopped)return;const p=Math.min(1,(performance.now()-start)/duration);beep(115+80*(1-p),.028,.13,'triangle');count++;const delay=24+Math.pow(p,2.2)*165;timer=setTimeout(tick,delay)};tick();return()=>{stopped=true;if(timer)clearTimeout(timer)}}
function resultSound(win){if(!sound)return;[0,.11,.22].forEach((t,i)=>setTimeout(()=>beep(win?[440,660,880][i]:[220,180,140][i],.15),t*1000))}
async function sellItems(ids){try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),s=await tx.get(ref),d=s.data()||{},inv=Array.isArray(d.inventory)?d.inventory:[],set=new Set(ids.map(String)),selling=inv.filter(x=>set.has(inventoryKey(x))),gain=selling.reduce((a,x)=>a+Number(x.priceUSD||0)*.9,0);tx.update(ref,{inventory:inv.filter(x=>!set.has(inventoryKey(x))),balanceUSD:Number(d.balanceUSD||0)+gain})});toast('Продано за 90% стоимости')}catch(e){toast(humanError(e))}}
function renderHistory(){$('#historyList').innerHTML=history.map(h=>`<article class="history-card"><div class="history-side">${h.sources?.length?h.sources.map(x=>`<div class="hist-item"><img src="${x.image}"><span>${esc(x.name)}</span><b>${fmt(x.priceUSD)}</b></div>`).join(''):`<div class="hist-cash"><b>${fmt(h.cashUSD||0)}</b><small>ставка</small></div>`}</div><div class="history-arrow">⌃</div><div class="history-side"><div class="hist-item"><img src="${h.target?.image||''}"><span>${esc(h.target?.name||'')}</span><b>${fmt(h.target?.priceUSD||0)}</b></div></div><div class="history-meta"><b>${Number(h.chance||0).toFixed(2)}%${Number.isFinite(Number(h.roll))?` · roll ${Number(h.roll).toFixed(2)}`:''}</b><strong class="${h.win?'win':'lose'}">${h.win?'Win':'Lose'}</strong></div></article>`).join('')||'<div class="empty-state">История пуста</div>'}
function renderTop(){if(!userDoc){$('#balance').textContent='Загрузка…';return}$('#balance').textContent=fmt(userDoc.balanceUSD||0);$('#invCount').textContent=inventory.length;$('#currency').value=currency;const n=profile?.nickname||'Игрок';$('#topNick').textContent=n;$('#topAvatar').textContent=avatarLetter(n);$('#soundQuick').textContent=sound?'🔊':'🔇';$('#fastQuick').classList.toggle('active',fast)}
function renderProfile(){if(!profile||!user)return;const n=profile.nickname||'Игрок',st=profile.stats||{};$('#profileNick').textContent=n;$('#profileAvatar').textContent=avatarLetter(n);$('#profileUid').textContent='ID профиля: '+user.uid.slice(0,8);$('#nickInput').value=n;$('#statsGrid').innerHTML=`<div class="stat"><b>${st.spins||0}</b><small>апгрейдов</small></div><div class="stat"><b>${st.wins||0}</b><small>побед</small></div><div class="stat"><b>${st.losses||0}</b><small>поражений</small></div><div class="stat"><b>${fmt(st.bestWinUSD||0)}</b><small>лучший выигрыш</small></div>`}
function renderAll(){renderTop();renderInventory();renderHistory();renderProfile();syncUpgrade()}
function pickByRatio(m){const v=stakeUSD();if(v<=0)return toast('Сначала введи ставку');target=skins.filter(x=>x.priceUSD>v*1.01).sort((a,b)=>Math.abs(a.priceUSD-v*m)-Math.abs(b.priceUSD-v*m))[0]||null;lastOutcome=null;if(!target)return toast('Не найден подходящий более дорогой скин');syncUpgrade()}
function pickByChance(p){const v=stakeUSD();if(v<=0)return toast('Сначала введи ставку');const wanted=v*100*HOUSE/p;target=skins.filter(x=>x.priceUSD>v*1.01).sort((a,b)=>Math.abs(a.priceUSD-wanted)-Math.abs(b.priceUSD-wanted))[0]||null;lastOutcome=null;if(!target)return toast('Не найден подходящий более дорогой скин');syncUpgrade()}
function showPage(id){$$('.nav,.page').forEach(x=>x.classList.remove('active'));$(`.nav[data-page="${id}"]`)?.classList.add('active');$('#'+id).classList.add('active')}
function open(id){const m=$('#'+id);if(!m)return;m.classList.remove('hidden');document.body.classList.add('modal-open')}function close(id){const m=$('#'+id);if(!m)return;m.classList.add('hidden');if(!document.querySelector('.modal:not(.hidden)'))document.body.classList.remove('modal-open')}
$$('.nav').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
document.addEventListener('click',e=>{const closeBtn=e.target.closest('[data-close]');if(closeBtn){e.preventDefault();e.stopPropagation();close(closeBtn.dataset.close);return}const modal=e.target.classList?.contains('modal')?e.target:null;if(modal&&!modal.classList.contains('hidden'))close(modal.id)},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const m=document.querySelector('.modal:not(.hidden)');if(m)close(m.id)}});$('#currency').onchange=e=>{currency=e.target.value;localStorage.setItem('ul-currency',currency);renderAll();renderCatalog()};$('#search').oninput=()=>{shown=30;renderCatalog()};$('#category').onchange=renderCatalog;$('#sort').onchange=renderCatalog;$('#more').onclick=()=>{shown+=30;renderCatalog()};$('#favoriteOnly').onclick=()=>{$('#favoriteOnly').classList.toggle('active');shown=30;renderCatalog()};$('#clearTarget').onclick=()=>{target=null;lastOutcome=null;syncUpgrade()};$('#clearSource').onclick=()=>{sourceItems=[];selected.clear();cashDraft='';lastOutcome=null;syncUpgrade()};$('#sourceMode').onclick=()=>{sourceItems=[];selected.clear();cashDraft='';lastOutcome=null;syncUpgrade()};$('#chooseInventory').onclick=()=>{selected=new Set(sourceItems.map(inventoryKey));renderPicker();open('modal')};$('#applySources').onclick=()=>{const picked=inventory.filter(x=>selected.has(inventoryKey(x)));if(!picked.length)return toast('Сначала выбери хотя бы один скин');sourceItems=picked;cashDraft='';lastOutcome=null;target=null;close('modal');syncUpgrade();toast(`В ставку добавлено: ${picked.length}`)};$('#upgradeBtn').onclick=startUpgrade;$('#autoTarget').onclick=()=>pickByRatio(2);function bindQuickButtons(){
  const q=$('.quick');if(!q||q.dataset.bound==='1')return;q.dataset.bound='1';
  q.addEventListener('click',e=>{const b=e.target.closest('button[data-quick-m],button[data-quick-p],button[data-m],button[data-p]');if(!b)return;e.preventDefault();e.stopPropagation();const m=Number(b.dataset.quickM||b.dataset.m),p=Number(b.dataset.quickP||b.dataset.p);if(Number.isFinite(m)&&m>1)return pickByRatio(m);if(Number.isFinite(p)&&p>0)return openChanceTargets(p)});
}
bindQuickButtons();$('#sellAll').onclick=()=>inventory.length?sellItems(inventory.map(inventoryKey)):toast('Инвентарь пуст');$('#soundQuick').onclick=e=>{e.preventDefault();e.stopPropagation();sound=!sound;localStorage.setItem('ul-sound',sound?'1':'0');renderTop();toast(sound?'Звук включён':'Звук выключен')};$('#fastQuick').onclick=e=>{e.preventDefault();e.stopPropagation();fast=!fast;localStorage.setItem('ul-fast',fast?'1':'0');renderTop();toast(fast?'Быстрый режим включён':'Быстрый режим выключен')};$('#saveNick').onclick=async()=>{try{const nickname=$('#nickInput').value.trim().slice(0,24)||'Игрок';await setDoc(doc(db,'profiles',user.uid),{nickname},{merge:true});toast('Ник сохранён')}catch(e){toast(humanError(e))}};

const customChance=$('#customChance');
if(customChance)customChance.oninput=()=>{customChance.value=customChance.value.replace?.(',','.')||customChance.value};
$('#applyChance').onclick=()=>{const p=Number(String($('#customChance').value).replace(',','.'));if(!Number.isFinite(p)||p<=0||p>MAX_CHANCE)return toast(`Введи шанс от 0,01% до ${MAX_CHANCE}%`);openChanceTargets(p)};
function rebuildQuickButtons(){
  const parseList=(value,min,max)=>String(value||'').split(',').map(x=>Number(x.trim().replace(',','.'))).filter(x=>Number.isFinite(x)&&x>=min&&x<=max).slice(0,3);
  const m=parseList(localStorage.getItem('ul-quick-m')||'2,3,5',1.01,100);
  const p=parseList(localStorage.getItem('ul-quick-p')||'20,40,70',.01,MAX_CHANCE);
  const q=$('.quick');if(!q)return;const custom=q.querySelector('.custom-chance');
  q.querySelectorAll(':scope > button[data-quick-m],:scope > button[data-quick-p],:scope > button[data-m],:scope > button[data-p]').forEach(x=>x.remove());
  for(const value of m){const b=document.createElement('button');b.type='button';b.dataset.quickM=String(value);b.textContent=`x${value}`;q.insertBefore(b,custom)}
  for(const value of p){const b=document.createElement('button');b.type='button';b.dataset.quickP=String(value);b.textContent=`${value}%`;q.insertBefore(b,custom)}
}
function applySettingsUI(){
  const theme=localStorage.getItem('ul-theme')||'classic';
  const wheel=localStorage.getItem('ul-wheel-style')||'bubble';
  const arrow=localStorage.getItem('ul-arrow-style')||'1';
  const spinStyle=localStorage.getItem('ul-spin-style')||'normal';
  for(const el of [document.documentElement,document.body]){el.dataset.theme=theme;el.dataset.wheel=wheel;el.dataset.arrow=arrow;el.dataset.settingArrow=arrow;el.dataset.spin=spinStyle;el.style.setProperty('--arrow-color',localStorage.getItem('ul-arrow-color')||'var(--accent)')}
  $$('.theme-grid button[data-theme]').forEach(b=>b.classList.toggle('active',b.dataset.theme===theme));
  $$('.arrow-options button[data-setting-arrow]').forEach(b=>b.classList.toggle('active',b.dataset.settingArrow===arrow));
  $$('.arrow-color-options button[data-arrow-color]').forEach(b=>b.classList.toggle('active',b.dataset.arrowColor===(localStorage.getItem('ul-arrow-color')||'#55aaff')));
  const wr=$(`input[name="wheelStyle"][value="${wheel}"]`);if(wr)wr.checked=true;
  const sr=$(`input[name="spinStyle"][value="${spinStyle}"]`);if(sr)sr.checked=true;
  const snd=$(`input[name="soundSetting"][value="${sound?'on':'off'}"]`);if(snd)snd.checked=true;
  const vol=$('#soundVolume');if(vol)vol.value=String(Math.round(soundVolume*100));
  const qm=$('#quickMultipliers');if(qm)qm.value=localStorage.getItem('ul-quick-m')||'2,3,5';
  const qp=$('#quickPercents');if(qp)qp.value=localStorage.getItem('ul-quick-p')||'20,40,70';
}
function bindSettingsOnce(){
  $$('.theme-grid button[data-theme]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();localStorage.setItem('ul-theme',btn.dataset.theme);applySettingsUI();toast(`Тема: ${btn.textContent.trim()}`)}));
  $$('input[name="wheelStyle"]').forEach(input=>input.addEventListener('change',()=>{localStorage.setItem('ul-wheel-style',input.value);applySettingsUI();toast(input.value==='classic'?'Старый круг включён':'Новый круг включён')}));
  $$('.arrow-options button[data-setting-arrow]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();localStorage.setItem('ul-arrow-style',btn.dataset.settingArrow);applySettingsUI();toast(`Стрелка ${btn.dataset.settingArrow} выбрана`)}));
  $$('.arrow-color-options button[data-arrow-color]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();localStorage.setItem('ul-arrow-color',btn.dataset.arrowColor);applySettingsUI();toast('Цвет стрелки изменён')}));
  $$('input[name="spinStyle"]').forEach(input=>input.addEventListener('change',()=>{localStorage.setItem('ul-spin-style',input.value);applySettingsUI();toast(input.value==='long'?'Длинная прокрутка включена':'Обычная прокрутка включена')}));
  $$('input[name="soundSetting"]').forEach(input=>input.addEventListener('change',()=>{sound=input.value==='on';localStorage.setItem('ul-sound',sound?'1':'0');applySettingsUI();renderTop();toast(sound?'Звук включён':'Звук выключен')}));
  const vol=$('#soundVolume');if(vol)vol.addEventListener('input',()=>{soundVolume=Math.max(0,Math.min(1,Number(vol.value)/100));localStorage.setItem('ul-sound-volume',String(soundVolume));if(sound)beep(330,.05,.12,'triangle')});
  const save=$('#saveQuickSettings');if(save)save.addEventListener('click',()=>{
    const ms=$('#quickMultipliers').value.split(',').map(x=>Number(x.trim().replace(',','.'))).filter(x=>Number.isFinite(x)&&x>1).slice(0,3);
    const ps=$('#quickPercents').value.split(',').map(x=>Number(x.trim().replace(',','.'))).filter(x=>Number.isFinite(x)&&x>0&&x<=MAX_CHANCE).slice(0,3);
    if(!ms.length||!ps.length)return toast('Укажи коэффициенты и проценты через запятую');
    localStorage.setItem('ul-quick-m',ms.join(','));localStorage.setItem('ul-quick-p',ps.join(','));rebuildQuickButtons();toast('Быстрые кнопки сохранены');
  });
  $('#themeQuick').addEventListener('click',e=>{e.preventDefault();e.stopPropagation();applySettingsUI();open('themeModal')});
}
rebuildQuickButtons();
applySettingsUI();
bindSettingsOnce();
$('#balanceBox').onclick=()=>{if(!user)return;$('#balanceAmount').value='10000';$('#balanceCurrencyLabel').textContent=symbols[currency]+' '+currency;open('balanceModal')};
$('#addBalance').onclick=async()=>{const amount=Number(String($('#balanceAmount').value).replace(',','.'));if(!Number.isFinite(amount)||amount<=0)return toast('Введи сумму больше нуля');try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),s=await tx.get(ref),d=s.data()||{};tx.update(ref,{balanceUSD:Number(d.balanceUSD||0)+amount/rates[currency]})});close('balanceModal');toast('Виртуальный баланс пополнен')}catch(e){toast(humanError(e))}};

$$('[data-add]').forEach(b=>b.onclick=()=>{$('#balanceAmount').value=b.dataset.add});

/* V29 target-range picker. */
function targetChanceFor(item){const v=stakeUSD();return !v||!item?.priceUSD?0:Math.min(MAX_CHANCE,v/Number(item.priceUSD)*100*HOUSE)}
function chanceCandidates(p){
  const v=stakeUSD(); if(v<=0)return [];
  const low=Math.max(.01,p-5), high=Math.min(MAX_CHANCE,p);
  return skins.map(item=>({item,c:targetChanceFor(item)}))
    .filter(x=>x.item.priceUSD>v*1.01&&x.c>=low-.005&&x.c<=high+.005)
    .sort((a,b)=>Math.abs(b.c-p)-Math.abs(a.c-p)||a.item.priceUSD-b.item.priceUSD)
    .slice(0,48);
}
function openChanceTargets(p){
  const v=stakeUSD();if(v<=0)return toast('Сначала введи ставку или выбери предметы');
  const low=Math.max(.01,p-5), list=chanceCandidates(p);
  const title=document.querySelector('#chanceTargetsTitle'),hint=document.querySelector('#chanceTargetsHint'),grid=document.querySelector('#chanceTargetsGrid');
  if(title)title.textContent=`Предметы с шансом ${low.toFixed(low%1?2:0)}–${Number(p).toFixed(p%1?2:0)}%`;
  if(hint)hint.textContent=`Показаны цели, которые дают шанс примерно от ${low.toFixed(2)}% до ${Number(p).toFixed(2)}% для текущей ставки ${fmt(v)}.`;
  if(!grid)return;
  grid.innerHTML=list.length?list.map(({item,c})=>`<article class="skin-card chance-target-card" data-target-id="${esc(item.id)}"><div class="skin-img"><img src="${esc(item.image)}" alt=""></div><h3>${esc(item.name)}</h3><small>${esc(item.wear||item.categoryLabel||'Предмет')}</small><b>${fmt(item.priceUSD)}</b><em class="price-source">${esc(item.priceSource||'резервная оценка')}</em><span class="target-chance-badge">${c.toFixed(2)}%</span><button type="button" class="pick-target">Выбрать</button></article>`).join(''):`<div class="empty-state">В этом диапазоне пока нет подходящих предметов. Попробуй соседний процент.</div>`;
  grid.querySelectorAll('.chance-target-card').forEach(card=>card.onclick=e=>{
    if(e.target.closest('.fav-btn'))return;const id=card.dataset.targetId;const item=skins.find(x=>String(x.id)===String(id));if(!item)return;
    target=item;lastOutcome=null;close('chanceTargetsModal');syncUpgrade();toast(`Выбран шанс ${targetChanceFor(item).toFixed(2)}%`);
  });
  open('chanceTargetsModal');
}


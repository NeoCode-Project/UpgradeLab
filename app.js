import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc, onSnapshot, collection, query, orderBy, limit, setDoc, updateDoc, runTransaction, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const START_BALANCE_USD=10000/41.4;
const APIS=['https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json','https://cdn.jsdelivr.net/gh/ByMykel/CSGO-API@main/public/api/en/skins.json'];
const PRICE_APIS=['https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0','https://api.allorigins.win/raw?url='+encodeURIComponent('https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0')];
const rates={USD:1,EUR:.92,UAH:41.4,RUB:87},symbols={USD:'$',EUR:'€',UAH:'₴',RUB:'₽'},HOUSE=.90,MAX_CHANCE=80;
const PRICE_CACHE_TTL=6*60*60*1000;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let user=null,userDoc=null,profile=null,skins=[],inventory=[],history=[],target=null,sourceItems=[],selected=new Set(),favorites=new Set(),shown=30,spin=false,lastOutcome=null,cashDraft='',currency=localStorage.getItem('ul-currency')||'UAH',fast=localStorage.getItem('ul-fast')==='1',sound=localStorage.getItem('ul-sound')!=='0',unsubs=[];
function inventoryKey(x){return String(x?.uid||x?.inventoryId||((x?.id||x?.marketHash||x?.name||'item')+'::'+(x?.obtainedAt||x?.createdAt||x?.wear||'')))}
function parseMoneyInput(v){const n=Number(String(v??'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)&&n>=0?n:0}
const toast=t=>{const e=$('#toast');e.textContent=t;e.className='show';setTimeout(()=>e.className='',2400)};
const fmt=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2,minimumFractionDigits:2}).format((Number(v)||0)*rates[currency])+' '+symbols[currency];
const priceFor=(name,rarity,category='weapon',wear='Field-Tested')=>{let h=2166136261;for(const c of name){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0}const n=name.toLowerCase();let base={consumer:.25,industrial:.8,'mil-spec':3.5,restricted:14,classified:55,covert:190,contraband:4200,extraordinary:420}[rarity]||5;if(category==='knife'||n.includes('knife')||n.includes('bayonet'))base=Math.max(base,260);if(category==='glove'||n.includes('glove')||n.includes('wraps'))base=Math.max(base,180);if(n.includes('dragon lore'))base=7200;if(n.includes('howl'))base=5600;if(n.includes('gungnir'))base=6800;if(n.includes('wild lotus'))base=4300;if(n.includes('medusa'))base=3200;if(n.includes('lore'))base*=2.15;if(n.includes('doppler'))base*=2.45;if(n.includes('fade'))base*=2.65;if(n.includes('crimson web'))base*=1.85;if(n.includes('case hardened'))base*=1.55;if(n.includes('slaughter'))base*=1.45;if(n.includes('blue steel'))base*=1.05;if(n.includes('boreal forest')||n.includes('forest ddpat')||n.includes('safari mesh'))base*=.58;if(n.includes('sand dune'))base*=.22;const wearMul={'Factory New':1.28,'Minimal Wear':1.08,'Field-Tested':.86,'Well-Worn':.72,'Battle-Scarred':.63}[wear]||1;const spread=.72+((h%10000)/10000)*1.15;return Math.max(.08,Math.round(base*wearMul*spread*100)/100)};
function sanePrice(apiPrice,name,category,wear,rarity){
  const fallback=priceFor(name,rarity,category,wear),n=name.toLowerCase();
  let floor=.05;
  if(category==='knife')floor=Math.max(120,fallback*.42);
  if(category==='glove')floor=Math.max(75,fallback*.38);
  if(n.includes('dragon lore'))floor=Math.max(floor,wear==='Factory New'?7000:1800);
  if(n.includes('howl'))floor=Math.max(floor,2200);
  if(n.includes('gungnir'))floor=Math.max(floor,3500);
  const p=Number(apiPrice||0);
  if(!Number.isFinite(p)||p<=0||p<floor)return {price:fallback,source:'резервная оценка'};
  return {price:p,source:'Skinport API'};
}
function rarityOf(x){return String(x.rarity?.id||x.rarity?.name||'').toLowerCase().replace('_','-')}
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
async function loadPrices(){
  let stale=null;
  try{
    const cached=JSON.parse(localStorage.getItem('ul-price-cache')||'null');
    if(cached?.items){
      stale=new Map(cached.items);
      if(Date.now()-Number(cached.time||0)<PRICE_CACHE_TTL)return {map:stale,source:'кэш Skinport'};
    }
  }catch{}
  for(const url of PRICE_APIS){
    try{
      const r=await fetch(url,{headers:{Accept:'application/json'}});
      if(!r.ok)throw new Error('price api '+r.status);
      const raw=await r.json(),entries=[];
      if(!Array.isArray(raw))throw new Error('bad price payload');
      for(const x of raw){
        const n=String(x.market_hash_name||'');
        const price=Number(x.suggested_price??x.median_price??x.min_price??0);
        if(n&&Number.isFinite(price)&&price>0)entries.push([n,price]);
      }
      if(entries.length<100)throw new Error('too few prices');
      localStorage.setItem('ul-price-cache',JSON.stringify({time:Date.now(),items:entries}));
      return {map:new Map(entries),source:'Skinport API'};
    }catch{}
  }
  return {map:stale||new Map(),source:stale?'старый кэш Skinport':'резервная оценка'};
}
async function loadCatalog(){
  if(skins.length)return;
  const priceResult=await loadPrices(),priceMap=priceResult.map;
  let raw=[];
  for(const url of APIS){try{const r=await fetch(url);if(!r.ok)throw 0;raw=await r.json();break}catch{}}
  const out=[],seen=new Set();
  raw.filter(x=>x.image&&x.name).forEach((x,i)=>{
    const rarity=rarityOf(x),baseName=x.name.includes('|')?x.name:`${x.weapon?.name||'Skin'} | ${x.name}`;
    const wears=(x.wears?.length?x.wears.map(w=>w.name):['Field-Tested']).slice(0,5);
    for(const wear of wears){
      const hash=`${baseName} (${wear})`, key=hash.toLowerCase();
      if(seen.has(key))continue; seen.add(key);
      const apiPrice=priceMap.get(hash);
      const rawCategory=String(x.category?.name||x.weapon?.name||'').toLowerCase();
      const category=rawCategory.includes('knife')?'knife':rawCategory.includes('glove')?'glove':'weapon';
      const checked=sanePrice(apiPrice,hash,category,wear,rarity);
      out.push({id:`${x.id||i}-${wear}`,name:baseName,marketHash:hash,wear,image:x.image,rarity,category,priceUSD:checked.price,priceSource:checked.source});
    }
  });
  const unique=new Map();for(const x of out){const k=`${x.marketHash}|${x.image}`.toLowerCase();if(!unique.has(k))unique.set(k,x)}
  skins=[...unique.values()].filter(x=>Number.isFinite(x.priceUSD)&&x.priceUSD>0);
  $('#status').textContent=skins.length?`${skins.length} вариантов. Цены: ${priceResult.source}; подозрительно низкие значения автоматически заменяются резервной оценкой.`:'Каталог не загрузился';
  renderCatalog();
}
function esc(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function card(x,mode='catalog'){
  // В каталоге предмет определяется catalog id, а в инвентаре — уникальным uid.
  // У выигранного предмета есть оба поля, поэтому прежний x.id||x.uid ломал выбор ставки.
  const id=String(mode==='catalog'?(x.id||x.marketHash):inventoryKey(x));
  const favKey=String(x.id||x.marketHash||id),fav=favorites.has(favKey)||favorites.has(String(x.marketHash||''));
  const targetId=target?String(target.id||target.marketHash||''):'';
  return `<article class="skin-card rarity-${esc(x.rarity||'mil-spec')} ${mode==='catalog'&&targetId===id?'target-selected':''}" data-id="${esc(id)}"><button class="fav-btn ${fav?'active':''}" title="Избранное">${fav?'♥':'♡'}</button><div class="skin-img"><img src="${esc(x.image)}" loading="lazy"></div><span class="wear-badge">${esc(x.wear||'')}</span><h3>${esc(x.name)}</h3><small>${esc(x.wear||'')}</small><b>${fmt(x.priceUSD)}</b><em class="price-source">${esc(x.priceSource||'сохранённая цена')}</em>${mode==='catalog'?'<button class="choose compact-pick">＋</button>':mode==='inventory'?'<div class="card-actions"><button class="ghost use">Поставить</button><button class="ghost sell">Продать</button></div>':'<button class="ghost pick">Выбрать</button>'}</article>`
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
function renderCatalog(){
  const visible=filtered().slice(0,shown);$('#skinGrid').innerHTML=visible.map(x=>card(x)).join('')||'<div class="empty-state">Ничего не найдено</div>';
  $$(`#skinGrid .skin-card`).forEach(e=>{const b=e.querySelector('.choose');if(b)b.onclick=()=>{const candidate=skins.find(x=>String(x.id)===String(e.dataset.id));const stake=stakeUSD();if(stake>0&&candidate&&candidate.priceUSD<=stake)return toast('Выбери скин дороже текущей ставки');target=candidate;lastOutcome=null;syncUpgrade();scrollTo({top:0,behavior:'smooth'})}});wireFavoriteButtons('#skinGrid',visible)
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
function stakeUSD(){if(sourceItems.length)return sourceItems.reduce((a,x)=>a+Number(x.priceUSD||0),0);return parseMoneyInput(cashDraft)/rates[currency]}
function chance(){if(!target)return 0;return Math.min(MAX_CHANCE,stakeUSD()/target.priceUSD*100*HOUSE)}
function renderSource(){
  const el=$('#sourceSlot');
  if(sourceItems.length){
    el.className='item-slot';
    el.innerHTML=sourceItems.slice(0,3).map(x=>`<div class="mini-source"><img src="${esc(x.image)}"><span>${esc(x.name)}</span></div>`).join('')+`<b>${fmt(stakeUSD())}</b>`;
    return;
  }
  el.className='item-slot cash';
  el.innerHTML=`<div class="cash-entry"><span>${symbols[currency]}</span><label>Сумма ставки<input id="stake" type="text" inputmode="decimal" autocomplete="off" value="${esc(cashDraft)}" placeholder="0"></label><em>Можно сразу написать, например, 100</em></div>`;
  const input=$('#stake');
  input.oninput=()=>{cashDraft=input.value;lastOutcome=null;updateUpgradeMetrics()};
}
function renderTarget(){const el=$('#targetSlot');if(!target){el.className='item-slot empty';el.innerHTML='<span>Нажми на скин ниже</span>';return}el.className='item-slot'+(lastOutcome?' outcome '+(lastOutcome.win?'won':'lost'):'');el.innerHTML=`${lastOutcome?`<div class="outcome-ribbon">${lastOutcome.win?'✓ ВЫИГРЫШ':'✕ ПРОИГРЫШ'}</div>`:''}<img src="${esc(target.image)}"><div class="target-info"><h3>${esc(target.name)}</h3><small>${esc(target.wear)}</small><b>${fmt(target.priceUSD)}</b></div>`}
function updateUpgradeMetrics(){const c=chance(),v=stakeUSD(),tooCheap=!!target&&v>0&&target.priceUSD<=v;$('#chance').textContent=(tooCheap?0:c).toFixed(2)+'%';$('#multi').textContent=target&&v>0?'x'+(target.priceUSD/v).toFixed(2):'x0.00';$('#winArc').style.setProperty('--chance',`${(tooCheap?0:c)*3.6}deg`);$('#upgradeBtn').disabled=spin||!target||v<=0||tooCheap||c<=0||(!sourceItems.length&&v>Number(userDoc?.balanceUSD||0));if(!lastOutcome)$('#result').textContent=!target?'Выбери целевой скин':tooCheap?'Целевой скин должен быть дороже ставки':c>=MAX_CHANCE?'Шанс ограничен 80%':'Готово к апгрейду'}
function syncUpgrade(){renderSource();renderTarget();updateUpgradeMetrics()}
async function startUpgrade(){if(spin||$('#upgradeBtn').disabled)return;spin=true;syncUpgrade();$('#result').textContent='Выполняется апгрейд…';const stake=stakeUSD(),c=chance(),chosenTarget={...target},chosenSources=[...sourceItems];try{const result=await runTransaction(db,async tx=>{const uref=doc(db,'users',user.uid),pref=doc(db,'profiles',user.uid),us=await tx.get(uref),ps=await tx.get(pref);if(!us.exists())throw new Error('Профиль не найден');const data=us.data(),inv=Array.isArray(data.inventory)?data.inventory:[],hist=Array.isArray(data.history)?data.history:[],balance=Number(data.balanceUSD||0);const ids=new Set(chosenSources.map(inventoryKey));if(chosenSources.length&&chosenSources.some(x=>!inv.some(i=>inventoryKey(i)===inventoryKey(x))))throw new Error('Один из предметов уже отсутствует');if(!chosenSources.length&&balance<stake)throw new Error('Недостаточно виртуального баланса');const roll=Math.random()*100,win=roll<c;const wonItem=win?{...chosenTarget,uid:crypto.randomUUID(),obtainedAt:Date.now()}:null;const nextInv=inv.filter(i=>!ids.has(inventoryKey(i)));if(wonItem)nextInv.unshift(wonItem);const entry={id:crypto.randomUUID(),createdAt:Date.now(),win,chance:c,roll,cashUSD:chosenSources.length?0:stake,sources:chosenSources,target:chosenTarget};const nextBalance=chosenSources.length?balance:balance-stake;tx.update(uref,{balanceUSD:nextBalance,inventory:nextInv,history:[entry,...hist].slice(0,100)});const p=ps.exists()?ps.data():{nickname:'Игрок',stats:{}};const st=p.stats||{};tx.set(pref,{...p,stats:{spins:Number(st.spins||0)+1,wins:Number(st.wins||0)+(win?1:0),losses:Number(st.losses||0)+(win?0:1),bestWinUSD:Math.max(Number(st.bestWinUSD||0),win?chosenTarget.priceUSD:0)}},{merge:true});const arc=Math.max(1,c*3.6),start=180;const angle=win?(start+Math.random()*arc):(Math.random()<(180/(360-arc))?Math.random()*180:start+arc+Math.random()*Math.max(1,180-arc));return {win,target:chosenTarget,chance:c,roll,angle}});if(result.win)await addDoc(collection(db,'feed'),{uid:user.uid,nickname:profile?.nickname||'Игрок',itemName:chosenTarget.name,image:chosenTarget.image,chance:c,createdAt:serverTimestamp()});await animateWheel(result);showOutcome(result);sourceItems=[];selected.clear();if(!chosenSources.length)cashDraft=''}catch(e){toast(humanError(e));$('#result').textContent='Апгрейд не выполнен'}finally{spin=false;syncUpgrade()}}
async function animateWheel(r){const d=fast?1800:6500,turns=fast?4:10,final=r.angle??Math.random()*360,n=$('#needle');n.getAnimations().forEach(a=>a.cancel());if(sound)beep(110,.08);const a=n.animate([{transform:'rotate(0deg)'},{transform:`rotate(${turns*360+final}deg)`}],{duration:d,easing:'cubic-bezier(.12,.02,.08,1)',fill:'forwards'});await a.finished;if(sound)resultSound(r.win)}
function showOutcome(r){if(!r)return;lastOutcome=r;const roll=Number(r.roll);const detail=Number.isFinite(roll)?`Выпало ${roll.toFixed(2)} из 100 · нужно ≤ ${Number(r.chance||0).toFixed(2)}`:`Шанс ${Number(r.chance||0).toFixed(2)}%`;$('#result').innerHTML=r.win?`<strong class="win">ВЫИГРЫШ — ${esc(r.target?.name||'скин')}</strong><small>${detail}. Предмет добавлен в инвентарь.</small>`:`<strong class="lose">ПРОИГРЫШ</strong><small>${detail}. Ставка списана.</small>`;target=r.target||target;renderTarget()}
function beep(freq=.1,d=.1){try{const C=window.AudioContext||window.webkitAudioContext,c=new C,o=c.createOscillator(),g=c.createGain();o.frequency.value=freq;g.gain.value=.025;o.connect(g);g.connect(c.destination);o.start();g.gain.exponentialRampToValueAtTime(.001,c.currentTime+d);o.stop(c.currentTime+d)}catch{}}
function resultSound(win){if(!sound)return;[0,.11,.22].forEach((t,i)=>setTimeout(()=>beep(win?[440,660,880][i]:[220,180,140][i],.15),t*1000))}
async function sellItems(ids){try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),s=await tx.get(ref),d=s.data()||{},inv=Array.isArray(d.inventory)?d.inventory:[],set=new Set(ids.map(String)),selling=inv.filter(x=>set.has(inventoryKey(x))),gain=selling.reduce((a,x)=>a+Number(x.priceUSD||0)*.9,0);tx.update(ref,{inventory:inv.filter(x=>!set.has(inventoryKey(x))),balanceUSD:Number(d.balanceUSD||0)+gain})});toast('Продано за 90% стоимости')}catch(e){toast(humanError(e))}}
function renderHistory(){$('#historyList').innerHTML=history.map(h=>`<article class="history-card"><div class="history-side">${h.sources?.length?h.sources.map(x=>`<div class="hist-item"><img src="${x.image}"><span>${esc(x.name)}</span><b>${fmt(x.priceUSD)}</b></div>`).join(''):`<div class="hist-cash"><b>${fmt(h.cashUSD||0)}</b><small>ставка</small></div>`}</div><div class="history-arrow">⌃</div><div class="history-side"><div class="hist-item"><img src="${h.target?.image||''}"><span>${esc(h.target?.name||'')}</span><b>${fmt(h.target?.priceUSD||0)}</b></div></div><div class="history-meta"><b>${Number(h.chance||0).toFixed(2)}%${Number.isFinite(Number(h.roll))?` · roll ${Number(h.roll).toFixed(2)}`:''}</b><strong class="${h.win?'win':'lose'}">${h.win?'Win':'Lose'}</strong></div></article>`).join('')||'<div class="empty-state">История пуста</div>'}
function renderTop(){if(!userDoc){$('#balance').textContent='Загрузка…';return}$('#balance').textContent=fmt(userDoc.balanceUSD||0);$('#invCount').textContent=inventory.length;$('#currency').value=currency;const n=profile?.nickname||'Игрок';$('#topNick').textContent=n;$('#topAvatar').textContent=avatarLetter(n);$('#soundQuick').textContent=sound?'🔊':'🔇';$('#fastQuick').classList.toggle('active',fast)}
function renderProfile(){if(!profile||!user)return;const n=profile.nickname||'Игрок',st=profile.stats||{};$('#profileNick').textContent=n;$('#profileAvatar').textContent=avatarLetter(n);$('#profileUid').textContent='ID профиля: '+user.uid.slice(0,8);$('#nickInput').value=n;$('#statsGrid').innerHTML=`<div class="stat"><b>${st.spins||0}</b><small>апгрейдов</small></div><div class="stat"><b>${st.wins||0}</b><small>побед</small></div><div class="stat"><b>${st.losses||0}</b><small>поражений</small></div><div class="stat"><b>${fmt(st.bestWinUSD||0)}</b><small>лучший выигрыш</small></div>`}
function renderAll(){renderTop();renderInventory();renderHistory();renderProfile();syncUpgrade()}
function pickByRatio(m){const v=stakeUSD();if(v<=0)return toast('Сначала введи ставку');target=skins.filter(x=>x.priceUSD>v*1.01).sort((a,b)=>Math.abs(a.priceUSD-v*m)-Math.abs(b.priceUSD-v*m))[0]||null;lastOutcome=null;if(!target)return toast('Не найден подходящий более дорогой скин');syncUpgrade()}
function pickByChance(p){const v=stakeUSD();if(v<=0)return toast('Сначала введи ставку');const wanted=v*100*HOUSE/p;target=skins.filter(x=>x.priceUSD>v*1.01).sort((a,b)=>Math.abs(a.priceUSD-wanted)-Math.abs(b.priceUSD-wanted))[0]||null;lastOutcome=null;if(!target)return toast('Не найден подходящий более дорогой скин');syncUpgrade()}
function showPage(id){$$('.nav,.page').forEach(x=>x.classList.remove('active'));$(`.nav[data-page="${id}"]`)?.classList.add('active');$('#'+id).classList.add('active')}
function open(id){$('#'+id).classList.remove('hidden')}function close(id){$('#'+id).classList.add('hidden')}
$$('.nav').forEach(b=>b.onclick=()=>showPage(b.dataset.page));$$('[data-close]').forEach(b=>b.onclick=()=>close(b.dataset.close));$('#currency').onchange=e=>{currency=e.target.value;localStorage.setItem('ul-currency',currency);renderAll();renderCatalog()};$('#search').oninput=()=>{shown=30;renderCatalog()};$('#category').onchange=renderCatalog;$('#sort').onchange=renderCatalog;$('#more').onclick=()=>{shown+=30;renderCatalog()};$('#favoriteOnly').onclick=()=>{$('#favoriteOnly').classList.toggle('active');shown=30;renderCatalog()};$('#clearTarget').onclick=()=>{target=null;lastOutcome=null;syncUpgrade()};$('#clearSource').onclick=()=>{sourceItems=[];selected.clear();lastOutcome=null;syncUpgrade()};$('#sourceMode').onclick=()=>{sourceItems=[];selected.clear();lastOutcome=null;syncUpgrade()};$('#chooseInventory').onclick=()=>{selected=new Set(sourceItems.map(inventoryKey));renderPicker();open('modal')};$('#applySources').onclick=()=>{const picked=inventory.filter(x=>selected.has(inventoryKey(x)));if(!picked.length)return toast('Сначала выбери хотя бы один скин');sourceItems=picked;lastOutcome=null;target=null;close('modal');syncUpgrade();toast(`В ставку добавлено: ${picked.length}`)};$('#upgradeBtn').onclick=startUpgrade;$('#autoTarget').onclick=()=>pickByRatio(2);$$('.quick button').forEach(b=>b.onclick=()=>b.dataset.m?pickByRatio(+b.dataset.m):pickByChance(+b.dataset.p));$('#sellAll').onclick=()=>inventory.length?sellItems(inventory.map(inventoryKey)):toast('Инвентарь пуст');$('#soundQuick').onclick=()=>{sound=!sound;localStorage.setItem('ul-sound',sound?'1':'0');renderTop()};$('#fastQuick').onclick=()=>{fast=!fast;localStorage.setItem('ul-fast',fast?'1':'0');renderTop()};$('#saveNick').onclick=async()=>{try{const nickname=$('#nickInput').value.trim().slice(0,24)||'Игрок';await setDoc(doc(db,'profiles',user.uid),{nickname},{merge:true});toast('Ник сохранён')}catch(e){toast(humanError(e))}};
$('#balanceBox').onclick=()=>{if(!user)return;$('#balanceAmount').value='10000';$('#balanceCurrencyLabel').textContent=symbols[currency]+' '+currency;open('balanceModal')};
$('#addBalance').onclick=async()=>{const amount=Number(String($('#balanceAmount').value).replace(',','.'));if(!Number.isFinite(amount)||amount<=0)return toast('Введи сумму больше нуля');try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),s=await tx.get(ref),d=s.data()||{};tx.update(ref,{balanceUSD:Number(d.balanceUSD||0)+amount/rates[currency]})});close('balanceModal');toast('Виртуальный баланс пополнен')}catch(e){toast(humanError(e))}};

$$('[data-add]').forEach(b=>b.onclick=()=>{$('#balanceAmount').value=b.dataset.add});

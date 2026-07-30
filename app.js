function safeUUID(){try{return globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}catch{return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}}
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail, sendEmailVerification, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider, deleteUser } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc, onSnapshot, collection, query, orderBy, limit, getDocs, setDoc, updateDoc, runTransaction, writeBatch, addDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { loadBulkPrices, fallbackPrice, validateMarketPrice, detectCategory, parseSteamMoney, canonicalMarketName } from './price-engine.js';

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const START_BALANCE_USD=10000/41.4;
const API_BASES=['https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/','https://cdn.jsdelivr.net/gh/ByMykel/CSGO-API@main/public/api/en/'];
const ITEM_FILES=[
  ['skins_not_grouped.json','weapon'],
  ['agents.json','agent'],
  ['stickers.json','sticker'],
  ['graffiti.json','graffiti'],
  ['keychains.json','keychain'],
  ['crates.json','case']
];
const rates={USD:1,EUR:.92,UAH:41.4,RUB:87},symbols={USD:'$',EUR:'€',UAH:'₴',RUB:'₽'},HOUSE=.90,MAX_CHANCE=80;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const isSandbox=()=>userDoc?.gameMode==='sandbox';
const infiniteMoney=()=>isSandbox()&&Boolean(userDoc?.infiniteMoney);

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
function itemBadgeMeta(item){
  const category=String(item?.category||'').toLowerCase();
  const name=String(item?.name||'').toLowerCase();
  if(category==='knife'||name.includes('knife')||name.startsWith('★'))return ['Нож','#e4ae39'];
  if(category==='glove'||name.includes('gloves')||name.includes('wraps'))return ['Перчатки','#e4ae39'];
  return rarityMeta(item?.rarity);
}
function avatarLetter(n){return (n||'U').trim().charAt(0).toUpperCase()||'U'}
function setAuthMode(register){$('#authTitle').textContent=register?'Регистрация':'Вход';$('#authSubmit').textContent=register?'Создать аккаунт':'Войти';$('#loginTab').className=register?'ghost':'upgrade-btn';$('#registerTab').className=register?'upgrade-btn':'ghost';$('#authForm').dataset.mode=register?'register':'login';$('#password').autocomplete=register?'new-password':'current-password'}
function normalizeUsername(value){return String(value||'').trim().toLowerCase()}
function usernameEmail(value){return `${normalizeUsername(value)}@players.upgradelab.local`}
function validUsername(value){return /^[a-z0-9._-]{3,24}$/i.test(String(value||'').trim())}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim())}
function maskEmail(value){const [a,b]=String(value||'').split('@');if(!a||!b)return '';return `${a.slice(0,1)}${'*'.repeat(Math.max(3,a.length-1))}@${b}`}
async function authEmailForLogin(value){const raw=String(value||'').trim();if(validEmail(raw))return raw.toLowerCase();const key=normalizeUsername(raw);const snap=await getDoc(doc(db,'usernames',key));return snap.exists()&&snap.data()?.authEmail?snap.data().authEmail:usernameEmail(key)}
$('#loginTab').onclick=()=>setAuthMode(false);$('#registerTab').onclick=()=>setAuthMode(true);setAuthMode(false);
$('#authForm').onsubmit=async e=>{e.preventDefault();$('#authError').textContent='';try{const username=$('#username').value.trim(),pass=$('#password').value;if(e.currentTarget.dataset.mode==='register'){if(!validUsername(username))throw new Error('Имя должно содержать 3–24 символа: латиница, цифры, точка, дефис или _');const email=usernameEmail(username);await createUserWithEmailAndPassword(auth,email,pass);await bootstrapUser(username);await setDoc(doc(db,'usernames',normalizeUsername(username)),{uid:auth.currentUser.uid,authEmail:email,updatedAt:serverTimestamp()});toast('Аккаунт создан')}else{const email=await authEmailForLogin(username);await signInWithEmailAndPassword(auth,email,pass)}}catch(err){$('#authError').textContent=humanError(err)}};
$('#forgotPassword').onclick=()=>$('#recoveryBox').classList.toggle('hidden');
$('#sendRecovery').onclick=async()=>{const out=$('#recoveryStatus');out.textContent='';try{const value=$('#recoveryLogin').value.trim();if(!value)throw new Error('Введи имя аккаунта или почту');const email=await authEmailForLogin(value);if(email.endsWith('@players.upgradelab.local'))throw new Error('К этому аккаунту ещё не привязана почта');await sendPasswordResetEmail(auth,email);out.textContent=`Письмо отправлено на ${maskEmail(email)}`}catch(e){out.textContent=humanError(e)}};
async function logoutAccount(){closeAccountMenu();await signOut(auth)}
$('#logoutBtn').onclick=logoutAccount;
$('#mobileLogoutBtn').onclick=logoutAccount;
function closeAccountMenu(){const menu=$('#accountMenu'),btn=$('#accountMenuBtn');menu?.classList.add('hidden');btn?.setAttribute('aria-expanded','false')}
$('#accountMenuBtn').onclick=e=>{e.stopPropagation();const menu=$('#accountMenu');const opening=menu.classList.contains('hidden');menu.classList.toggle('hidden',!opening);e.currentTarget.setAttribute('aria-expanded',opening?'true':'false')};
$$('[data-account-page]').forEach(btn=>btn.onclick=()=>{closeAccountMenu();document.querySelector(`.nav[data-page="${btn.dataset.accountPage}"]`)?.click()});
document.addEventListener('click',e=>{if(!e.target.closest('#accountMenu')&&!e.target.closest('#accountMenuBtn'))closeAccountMenu()});
function openDeleteAccount(){closeAccountMenu();$('#deleteAccountPassword').value='';$('#deleteAccountConfirm').value='';$('#deleteAccountError').textContent='';open('deleteAccountModal')}
$('#deleteAccountBtn').onclick=openDeleteAccount;
$('#menuDeleteAccountBtn').onclick=openDeleteAccount;
$('#confirmDeleteAccountBtn').onclick=async()=>{const out=$('#deleteAccountError'),btn=$('#confirmDeleteAccountBtn');out.textContent='';try{if(!user)throw new Error('Сначала войди в аккаунт');const pass=$('#deleteAccountPassword').value;const confirm=$('#deleteAccountConfirm').value.trim().toUpperCase();if(!pass)throw new Error('Введи текущий пароль');if(confirm!=='УДАЛИТЬ')throw new Error('Напиши слово УДАЛИТЬ');btn.disabled=true;btn.textContent='Удаление…';const cred=EmailAuthProvider.credential(user.email,pass);await reauthenticateWithCredential(user,cred);const uid=user.uid,uname=normalizeUsername(profile?.username||profile?.nickname||'');await setDoc(doc(db,'users',uid),{balanceUSD:0,inventory:[],history:[],favorites:[],deleted:true,deletedAt:serverTimestamp(),lastOperation:null});await setDoc(doc(db,'profiles',uid),{nickname:'Удалённый пользователь',username:'',stats:{spins:0,wins:0,losses:0,bestWinUSD:0},publicHistory:[],deleted:true,deletedAt:serverTimestamp()},{merge:false});if(validUsername(uname))await setDoc(doc(db,'usernames',uname),{uid,authEmail:usernameEmail(uname),deleted:true,updatedAt:serverTimestamp()},{merge:true});await deleteUser(user);close('deleteAccountModal');toast('Аккаунт удалён')}catch(e){out.textContent=humanError(e)}finally{btn.disabled=false;btn.textContent='Удалить навсегда'}};
function humanError(e){const c=e?.code||'';if(c.includes('invalid-credential'))return 'Неверное имя, почта или пароль';if(c.includes('requires-recent-login'))return 'Для этого действия снова введи пароль';if(c.includes('invalid-email'))return 'Неверный адрес почты';if(c.includes('email-already-in-use'))return 'Этот email уже используется';if(c.includes('weak-password'))return 'Пароль должен быть минимум 6 символов';if(c.includes('too-many-requests'))return 'Слишком много попыток. Попробуй позже';if(c.includes('permission-denied'))return 'Обнови правила Firestore из архива';return e?.message||'Ошибка'}
async function bootstrapUser(nickname='Игрок'){if(!user)return;const uref=doc(db,'users',user.uid),pref=doc(db,'profiles',user.uid);const snap=await getDoc(uref);if(!snap.exists())await setDoc(uref,{balanceUSD:START_BALANCE_USD,crystals:0,inventory:[],history:[],favorites:[],gameMode:'normal',infiniteMoney:false,normalState:null,sandboxState:{balanceUSD:1000000/41.4,inventory:[],history:[],favorites:[],infiniteMoney:true},promoRedemptions:{},createdAt:serverTimestamp()});const ps=await getDoc(pref);if(!ps.exists())await setDoc(pref,{nickname:nickname||'Игрок',username:normalizeUsername(nickname),stats:{spins:0,wins:0,losses:0,bestWinUSD:0},createdAt:serverTimestamp()});const p=(await getDoc(pref)).data()||{};const uname=normalizeUsername(p.username||p.nickname||nickname);if(validUsername(uname))await setDoc(doc(db,'usernames',uname),{uid:user.uid,authEmail:user.email||usernameEmail(uname),updatedAt:serverTimestamp()},{merge:true})}

onAuthStateChanged(auth,async u=>{unsubs.forEach(x=>x());unsubs=[];user=u;target=null;sourceItems=[];if(!u){closeAccountMenu();$('#authScreen').classList.remove('hidden');return}$('#authScreen').classList.add('hidden');try{await bootstrapUser('Игрок')}catch(e){toast(humanError(e))}subscribeUser();subscribeFeed();await loadCatalog()});
async function refreshSecurityBox(){if(!user)return;const linked=user.email&&!user.email.endsWith('@players.upgradelab.local');$('#securityEmailState').textContent=linked?`Привязана: ${maskEmail(user.email)}${user.emailVerified?' · подтверждена':' · не подтверждена'}`:'Почта не привязана — восстановление пароля невозможно.';$('#verifyEmailBtn').classList.toggle('hidden',!linked||user.emailVerified)}
$('#linkEmailBtn').onclick=async()=>{try{const email=$('#securityEmail').value.trim().toLowerCase(),pass=$('#securityPassword').value;if(!validEmail(email))throw new Error('Введи правильную почту');if(!pass)throw new Error('Введи текущий пароль');const cred=EmailAuthProvider.credential(user.email,pass);await reauthenticateWithCredential(user,cred);await updateEmail(user,email);await sendEmailVerification(user);const uname=normalizeUsername(profile?.username||profile?.nickname);if(validUsername(uname))await setDoc(doc(db,'usernames',uname),{uid:user.uid,authEmail:email,updatedAt:serverTimestamp()},{merge:true});await user.reload();toast('Почта привязана. Проверь письмо');refreshSecurityBox()}catch(e){toast(humanError(e))}};
$('#verifyEmailBtn').onclick=async()=>{try{await sendEmailVerification(user);toast('Письмо подтверждения отправлено')}catch(e){toast(humanError(e))}};
function subscribeUser(){unsubs.push(onSnapshot(doc(db,'users',user.uid),s=>{userDoc=s.data()||{};inventory=Array.isArray(userDoc.inventory)?userDoc.inventory:[];history=Array.isArray(userDoc.history)?userDoc.history:[];favorites=new Set(Array.isArray(userDoc.favorites)?userDoc.favorites.map(String):[]);renderAll();const op=userDoc.lastOperation;if(op?.unseen){$('#pendingBanner').classList.add('show');showOutcome(op.result)}else $('#pendingBanner').classList.remove('show')}));unsubs.push(onSnapshot(doc(db,'profiles',user.uid),s=>{profile=s.data()||{};renderProfile();renderTop();renderAdminPanel();refreshSecurityBox()}))}
function subscribeFeed(){const q=query(collection(db,'feed'),orderBy('createdAt','desc'),limit(30));unsubs.push(onSnapshot(q,s=>{document.querySelector('.feed-panel')?.classList.toggle('empty-feed',s.empty);$('#feedList').innerHTML=s.docs.map(d=>{const x=d.data();return `<div class="feed-item" data-uid="${x.uid}"><img src="${x.image||''}"><div><b>${esc(x.nickname||'Игрок')}</b><span>${esc(x.itemName||'Скин')}</span><span>${Number(x.chance||0).toFixed(2)}%</span></div></div>`}).join('')||'<p class="muted">Пока пусто</p>';$$('.feed-item').forEach(e=>e.onclick=()=>openPublicProfile(e.dataset.uid))}))}
async function openPublicProfile(uid){const s=await getDoc(doc(db,'profiles',uid));if(!s.exists())return toast('Профиль не найден');const p=s.data(),publicHistory=Array.isArray(p.publicHistory)?p.publicHistory:[];const rows=publicHistory.map(h=>`<article class="public-history-item ${h.win?'is-win':'is-lose'}"><img src="${esc(h.target?.image||'')}" alt=""><div><b>${esc(h.target?.name||'Предмет')}</b><small>${Number(h.chance||0).toFixed(2)}% · ${h.win?'Победа':'Поражение'}</small></div><strong>${fmt(h.target?.priceUSD||0)}</strong></article>`).join('')||'<p class="muted">История игр пока пуста</p>';$('#publicProfile').innerHTML=`<div class="profile-head"><div class="avatar">${avatarLetter(p.nickname)}</div><div><h2>${esc(p.nickname||'Игрок')}</h2><p class="muted">Публичный профиль</p></div></div><div class="stats-grid"><div class="stat"><b>${p.stats?.spins||0}</b><small>апгрейдов</small></div><div class="stat"><b>${p.stats?.wins||0}</b><small>побед</small></div><div class="stat"><b>${p.stats?.losses||0}</b><small>поражений</small></div><div class="stat"><b>${fmt(p.stats?.bestWinUSD||0)}</b><small>лучший выигрыш</small></div></div><div class="public-history"><h3>Последние игры</h3>${rows}</div>`;open('publicProfileModal')}
async function loadPrices(){return loadBulkPrices()}
async function fetchItemFile(file){
  for(const base of API_BASES){
    try{const r=await fetch(base+file);if(!r.ok)throw new Error(String(r.status));const data=await r.json();if(Array.isArray(data))return data}catch{}
  }
  return [];
}
function marketPriceFor(priceMap, marketHash){
  // Strict matching only. Wear, StatTrak™, Souvenir and the star must all match.
  const key=canonicalMarketName(marketHash);
  return Number(priceMap.get(key)||0);
}
function normalizeExtraItem(x,i,forcedCategory,priceMap=new Map()){
  const name=canonicalMarketName(x.market_hash_name||x.name||'');
  const image=x.image||x.image_inventory||x.image_url||'';
  if(!name||!image)return null;
  const rarity=rarityOf(x),category=forcedCategory;
  const apiPrice=marketPriceFor(priceMap,name);
  return {id:`${forcedCategory}-${x.id||x.def_index||i}`,name,marketHash:name,wear:'',image,rarity,category,subtype:String(x.type||''),priceUSD:apiPrice||null,priceSource:apiPrice?'Market.CSGO — реальная цена':'Цена загружается…'};
}
function normalizeWeaponItem(x,i,priceMap=new Map()){
  const marketHash=canonicalMarketName(x.market_hash_name||x.name||'');
  const image=x.image||'';
  if(!marketHash||!image)return null;
  const rarity=rarityOf(x);
  const category=detectCategory(String(x.category?.name||x.weapon?.name||''),marketHash);
  const wear=String(x.wear?.name||'');
  const apiPrice=marketPriceFor(priceMap,marketHash);
  // Keep the exact market_hash_name supplied by ByMykel. This fixes StatTrak/Souvenir matching.
  const displayName=marketHash.replace(/ \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/,'');
  return {id:String(x.id||`weapon-${i}`),name:displayName,marketHash,wear,image,rarity,category,variant:x.stattrak?'stattrak':x.souvenir?'souvenir':'normal',priceUSD:apiPrice||null,priceSource:apiPrice?'Market.CSGO — реальная цена':'Цена загружается…'};
}
function bulkPriceLimit(item){
  // Market.CSGO returns the cheapest active listing. A seller can create one absurdly
  // expensive listing for an illiquid item, so it must not be treated as market value.
  // Expensive weapons/knives remain allowed; stricter limits apply to small collectibles.
  const limits={sticker:5000,graffiti:500,keychain:2500,case:10000,agent:5000,weapon:150000,knife:150000,glove:150000};
  return limits[item?.category]||150000;
}
function isPlausibleBulkPrice(item,price){
  const p=Number(price);
  return Number.isFinite(p)&&p>0&&p<=bulkPriceLimit(item);
}
function applyBulkPrices(priceResult){
  const map=priceResult?.map||new Map();let found=0,rejected=0;
  for(const item of skins){
    const p=marketPriceFor(map,item.marketHash);
    if(isPlausibleBulkPrice(item,p)){
      item.priceUSD=p;item.priceSource=`${priceResult.source} — активное предложение`;found++;
    }else if(p>0){
      // Do not use an unconfirmed outlier in chances, inventory value, or upgrades.
      item.priceUSD=null;item.priceSource='Подозрительное предложение — проверяем Steam Market';rejected++;
    }else if(!(Number(item.priceUSD)>0)){
      item.priceUSD=null;item.priceSource='Цена временно недоступна';
    }
  }
  const counts=Object.fromEntries(['weapon','knife','glove','agent','keychain','sticker','graffiti','case'].map(c=>[c,skins.filter(x=>x.category===c).length]));
  $('#status').textContent=`${skins.length} предметов: оружие ${counts.weapon+counts.knife+counts.glove}, агенты ${counts.agent}, брелоки ${counts.keychain}, наклейки ${counts.sticker}, граффити ${counts.graffiti}, кейсы ${counts.case}. Цены найдены для ${found} предметов${rejected?`; ${rejected} подозрительных лотов отправлены на проверку Steam`:''}. Источник: ${priceResult.source}.`;
  renderCatalog();
}
async function loadCatalog(){
  if(skins.length)return;
  $('#status').textContent='Загружаем каталог предметов…';
  const payloads=await Promise.all(ITEM_FILES.map(async([file,category])=>[category,await fetchItemFile(file)]));
  const out=[],seen=new Set();
  for(const [forcedCategory,raw] of payloads){
    if(forcedCategory==='weapon'){
      raw.forEach((x,i)=>{const item=normalizeWeaponItem(x,i);if(!item)return;const key=item.marketHash.toLowerCase();if(seen.has(key))return;seen.add(key);out.push(item)});
    }else{
      raw.forEach((x,i)=>{const item=normalizeExtraItem(x,i,forcedCategory);if(!item)return;const key=`${item.category}|${item.marketHash}`.toLowerCase();if(seen.has(key))return;seen.add(key);out.push(item)});
    }
  }
  skins=out;
  $('#status').textContent=skins.length?`${skins.length} предметов загружено. Получаем реальные рыночные цены…`:'Каталог ByMykel временно не ответил. Обнови страницу через несколько секунд.';
  renderCatalog();
  // Prices are independent: a failed market API can no longer erase the catalog.
  try{applyBulkPrices(await loadPrices())}catch(e){
    skins.forEach(x=>{if(!(Number(x.priceUSD)>0))x.priceSource='Цена временно недоступна'});
    $('#status').textContent=`${skins.length} предметов загружено. Сервер цен временно не ответил — каталог продолжает работать.`;
    renderCatalog();
  }
}
function esc(s){return String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function card(x,mode='catalog'){
  // В каталоге предмет определяется catalog id, а в инвентаре — уникальным uid.
  // У выигранного предмета есть оба поля, поэтому прежний x.id||x.uid ломал выбор ставки.
  const id=String(mode==='catalog'?(x.id||x.marketHash):inventoryKey(x));
  const favKey=String(x.id||x.marketHash||id),fav=favorites.has(favKey)||favorites.has(String(x.marketHash||''));
  const targetId=target?String(target.id||target.marketHash||''):'';
  const [rarityLabel,rarityColor]=itemBadgeMeta(x);
  return `<article class="skin-card ${mode}-card rarity-${esc(x.rarity||'mil-spec')} ${mode==='catalog'&&targetId===id?'target-selected':''}" style="--rarity-color:${rarityColor}" data-id="${esc(id)}"><button class="fav-btn ${fav?'active':''}" title="${fav?'Убрать из избранного':'Добавить в избранное'}" aria-label="Избранное">${fav?'★':'☆'}</button><div class="skin-img"><img src="${esc(x.image)}" loading="lazy"></div><span class="wear-badge">${esc(x.wear||'')}</span><h3>${esc(x.name)}</h3><small>${esc(x.wear||'')}</small><span class="rarity-badge">${rarityLabel}</span><b>${Number(x.priceUSD)>0?fmt(x.priceUSD):'Цена недоступна'}</b><em class="price-source">${esc(x.priceSource||'')}</em>${mode==='catalog'?`<div class="catalog-card-actions"><button class="inspect-item">Осмотр</button><button class="buy-item" ${Number(x.priceUSD)>0?'':'disabled title="Нет рыночной цены"'}>Купить</button><button class="choose" ${Number(x.priceUSD)>0?'':'disabled title="Нет рыночной цены"'}>В апгрейд</button></div>`:mode==='inventory'?'<div class="card-actions"><button class="ghost use">Поставить</button><button class="ghost sell">Продать</button></div>':'<button class="ghost pick">Выбрать</button>'}</article>`
}
function filtered(){
  let q=$('#search').value.toLowerCase(),c=$('#category').value,only=$('#favoriteOnly')?.classList.contains('active');
  const minLocal=Math.max(0,parseMoneyInput($('#priceMin')?.value||'')),maxLocal=Math.max(0,parseMoneyInput($('#priceMax')?.value||''));
  const minUSD=minLocal/rates[currency],maxUSD=maxLocal/rates[currency];
  let a=skins.filter(x=>{
    const p=Number(x.priceUSD||0);
    return (c==='all'||x.category===c)&&(`${x.name} ${x.wear}`).toLowerCase().includes(q)&&(!only||favorites.has(String(x.id))||favorites.has(String(x.marketHash||'')))&&(!minLocal||p>=minUSD)&&(!maxLocal||p<=maxUSD);
  });
  const sort=$('#sort').value;a.sort((x,y)=>{if(sort==='name')return x.name.localeCompare(y.name);const xp=Number(x.priceUSD)||Infinity,yp=Number(y.priceUSD)||Infinity;if(sort==='priceDesc'){if(!Number(x.priceUSD))return 1;if(!Number(y.priceUSD))return -1;return Number(y.priceUSD)-Number(x.priceUSD)}return xp-yp});return a
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
const STEAM_CACHE_KEY='ul-steam-price-cache-v39';
function getSteamCache(){try{return JSON.parse(localStorage.getItem(STEAM_CACHE_KEY)||'{}')}catch{return {}}}
async function fetchSteamPrice(item){
  if(!item?.marketHash||item.category==='agent'||item.category==='graffiti')return null;
  const cache=getSteamCache(),entry=cache[item.marketHash];if(entry&&Date.now()-entry.time<12*60*60*1000)return entry.price||null;
  if(steamPriceInFlight.has(item.marketHash))return null;steamPriceInFlight.add(item.marketHash);
  const marketName=encodeURIComponent(item.marketHash);
  const url='https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name='+marketName;
  // Same-origin Worker is tried first. Public CORS proxies are only emergency fallbacks.
  const urls=['/api/steam-price?market_hash_name='+marketName,url,'https://api.allorigins.win/raw?url='+encodeURIComponent(url),'https://api.codetabs.com/v1/proxy?quest='+encodeURIComponent(url),'https://corsproxy.io/?url='+encodeURIComponent(url)];
  try{for(const endpoint of urls){try{const r=await fetch(endpoint);if(!r.ok)continue;const data=await r.json();const price=Number(data.price_usd||0)||parseSteamMoney(data.median_price||data.lowest_price);if((data.success!==false)&&price>0){cache[item.marketHash]={price,time:Date.now()};localStorage.setItem(STEAM_CACHE_KEY,JSON.stringify(cache));return price}}catch{}}}finally{steamPriceInFlight.delete(item.marketHash)}
  return null;
}
async function enrichSteamPrices(items){
  const candidates=items.filter(x=>x&&x.marketHash&&x.priceSource!=='Steam Market — подтверждённая цена');
  candidates.sort((a,b)=>Number(String(b.priceSource||'').includes('Подозрительное'))-Number(String(a.priceSource||'').includes('Подозрительное')));
  const todo=candidates.slice(0,18);let changed=false;
  for(let i=0;i<todo.length;i+=3){const batch=todo.slice(i,i+3);const prices=await Promise.all(batch.map(fetchSteamPrice));prices.forEach((p,j)=>{if(p>0){batch[j].priceUSD=p;batch[j].priceSource='Steam Market — медианная/минимальная цена';changed=true}})}
  if(changed){renderCatalog();syncUpgrade()}
}
function renderCatalog(){
  const visible=filtered().slice(0,shown);$('#skinGrid').innerHTML=visible.map(x=>card(x)).join('')||'<div class="empty-state">Ничего не найдено</div>';
  $$(`#skinGrid .skin-card`).forEach(e=>{
    const candidate=skins.find(x=>String(x.id)===String(e.dataset.id));
    const choose=e.querySelector('.choose');if(choose)choose.onclick=()=>{if(!candidate||!(Number(candidate.priceUSD)>0))return toast('Для этого предмета цена пока недоступна');const stake=stakeUSD();if(stake>0&&candidate.priceUSD<=stake)return toast('Выбери предмет дороже текущей ставки');target=candidate;lastOutcome=null;syncUpgrade();scrollTo({top:0,behavior:'smooth'})};
    const inspect=e.querySelector('.inspect-item');if(inspect)inspect.onclick=()=>openInspect(candidate);const buy=e.querySelector('.buy-item');if(buy)buy.onclick=()=>buyItem(candidate);
  });wireFavoriteButtons('#skinGrid',visible); clearTimeout(renderCatalog._steamTimer); renderCatalog._steamTimer=setTimeout(()=>enrichSteamPrices(visible),350)
}

async function buyItem(item){
  if(!item||!(Number(item.priceUSD)>0))return toast('Для этого предмета цена пока недоступна');
  try{
    await runTransaction(db,async tx=>{
      const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');
      const data=snap.data()||{},balance=Number(data.balanceUSD||0),price=Number(item.priceUSD||0),inv=Array.isArray(data.inventory)?data.inventory:[];
      if(!data.infiniteMoney&&balance<price)throw new Error('Недостаточно виртуального баланса');
      const bought={...item,uid:safeUUID(),obtainedAt:Date.now(),purchasePriceUSD:price,purchaseSource:item.priceSource||'Рыночная цена'};
      tx.update(ref,{balanceUSD:data.infiniteMoney?balance:balance-price,inventory:[bought,...inv]});
    });
    toast(`Куплено: ${item.name} за ${fmt(item.priceUSD)}`);
  }catch(e){toast(humanError(e))}
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
function chance(){if(!target)return 0;const bonus=Number(userDoc?.boosters?.lucky||0)>0?5:0;return Math.min(MAX_CHANCE,stakeUSD()/target.priceUSD*100*HOUSE+bonus)}
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
  const shownChance=tooCheap?0:c;
  $('#chance').textContent=shownChance.toFixed(2)+'%';
  const chanceLabel=$('#chanceLabel');
  if(chanceLabel)chanceLabel.textContent=shownChance<15?'очень низкий шанс':shownChance<35?'низкий шанс':shownChance<60?'средний шанс':shownChance<75?'высокий шанс':'очень высокий шанс';
  $('#multi').textContent=shownTarget&&v>0?'x'+(Number(shownTarget.priceUSD||0)/v).toFixed(2):'x0.00';
  $('#winArc').style.setProperty('--chance',`${shownChance*3.6}deg`);
  $('#winArc').style.setProperty('--chance-half',`${shownChance*1.8}deg`);
  const btn=$('#upgradeBtn');
  if(showingResult){btn.disabled=spin;btn.textContent='НОВЫЙ АПГРЕЙД';return}
  btn.textContent='АПГРЕЙД';
  btn.disabled=spin||!target||v<=0||tooCheap||c<=0||!infiniteMoney()&&cashStakeUSD()>Number(userDoc?.balanceUSD||0);
  if(!lastOutcome)$('#result').textContent=!target?'Выбери целевой скин':tooCheap?'Целевой скин должен быть дороже ставки':c>=MAX_CHANCE?'Шанс ограничен 80%':'Готово к апгрейду';
}
function syncUpgrade(){renderSource();renderTarget();updateUpgradeMetrics()}
async function startUpgrade(){if(lastOutcome&&!sourceItems.length&&!cashDraft){const repeatStake=outcomeStakeUSD();const repeatTarget=lastOutcome.target||target;lastOutcome=null;sourceItems=[];selected.clear();target=repeatTarget;cashDraft=repeatStake>0?String(repeatStake*rates[currency]).replace('.',','):'';syncUpgrade();if(!infiniteMoney()&&cashStakeUSD()>Number(userDoc?.balanceUSD||0))toast('Для повтора такой же ставки не хватает баланса');else toast('Та же ставка и тот же предмет выбраны снова');return}if(spin||$('#upgradeBtn').disabled)return;spin=true;syncUpgrade();$('#result').textContent='Выполняется апгрейд…';const stake=stakeUSD(),cashPart=cashStakeUSD(),c=chance(),chosenTarget={...target},chosenSources=[...sourceItems];try{const result=await runTransaction(db,async tx=>{const uref=doc(db,'users',user.uid),pref=doc(db,'profiles',user.uid),us=await tx.get(uref),ps=await tx.get(pref);if(!us.exists())throw new Error('Профиль не найден');const data=us.data(),inv=Array.isArray(data.inventory)?data.inventory:[],hist=Array.isArray(data.history)?data.history:[],balance=Number(data.balanceUSD||0);const ids=new Set(chosenSources.map(inventoryKey));if(chosenSources.length&&chosenSources.some(x=>!inv.some(i=>inventoryKey(i)===inventoryKey(x))))throw new Error('Один из предметов уже отсутствует');if(!data.infiniteMoney&&balance<cashPart)throw new Error('Недостаточно виртуального баланса для доплаты');const boosters=data.boosters||{},useLucky=Number(boosters.lucky||0)>0,useInsurance=Number(boosters.insurance||0)>0;const roll=Math.random()*100,win=roll<c;const protectedLoss=!win&&useInsurance;const wonItem=win?{...chosenTarget,uid:safeUUID(),obtainedAt:Date.now()}:null;const nextInv=protectedLoss?[...inv]:inv.filter(i=>!ids.has(inventoryKey(i)));if(wonItem)nextInv.unshift(wonItem);const entry={id:safeUUID(),createdAt:Date.now(),win,chance:c,roll,cashUSD:cashPart,sources:chosenSources,target:chosenTarget};const nextBalance=data.infiniteMoney?balance:(protectedLoss?balance:balance-cashPart);const nextBoosters={...boosters};if(useLucky)nextBoosters.lucky=Math.max(0,Number(nextBoosters.lucky||0)-1);if(protectedLoss)nextBoosters.insurance=Math.max(0,Number(nextBoosters.insurance||0)-1);entry.protectedLoss=protectedLoss;const bp=data.battlePass||{};tx.update(uref,{balanceUSD:nextBalance,inventory:nextInv,history:[entry,...hist].slice(0,100),boosters:nextBoosters,battlePass:{...bp,xp:Number(bp.xp||0)+25}});const p=ps.exists()?ps.data():{nickname:'Игрок',stats:{}};const st=p.stats||{};const publicEntry={id:entry.id,createdAt:entry.createdAt,win,chance:c,target:{name:chosenTarget.name,image:chosenTarget.image,priceUSD:chosenTarget.priceUSD}};const publicHistory=[publicEntry,...(Array.isArray(p.publicHistory)?p.publicHistory:[])].slice(0,30);tx.set(pref,{...p,publicHistory,stats:{spins:Number(st.spins||0)+1,wins:Number(st.wins||0)+(win?1:0),losses:Number(st.losses||0)+(win?0:1),bestWinUSD:Math.max(Number(st.bestWinUSD||0),win?chosenTarget.priceUSD:0)}},{merge:true});const arc=Math.max(0.36,Math.min(359.64,c*3.6));const start=(180-arc/2+360)%360,end=(180+arc/2)%360;let angle;if(win){angle=(start+Math.random()*arc)%360}else{const loseArc=Math.max(0.36,360-arc);angle=(end+Math.random()*loseArc)%360}return {win,target:chosenTarget,chance:c,roll,angle,protectedLoss}});if(result.win)await addDoc(collection(db,'feed'),{uid:user.uid,nickname:profile?.nickname||'Игрок',itemName:chosenTarget.name,image:chosenTarget.image,chance:c,createdAt:serverTimestamp()});await animateWheel(result);result.sources=chosenSources;result.cashUSD=cashPart;result.totalStakeUSD=stake;showOutcome(result);if(result.protectedLoss)toast('🛡 Защита сработала: ставка возвращена');sourceItems=[];selected.clear();cashDraft=''}catch(e){toast(humanError(e));$('#result').textContent='Апгрейд не выполнен'}finally{spin=false;syncUpgrade()}}
async function animateWheel(r){
  const spinStyle=localStorage.getItem('ul-spin-style')||'normal';
  const duration=fast?1800:(spinStyle==='long'?8200:5200);
  const turns=fast?4:10;
  const finalAngle=r.angle??Math.random()*360;
  const pointer=$('#pointerGroup');
  if(!pointer)throw new Error('Не найдена стрелка рулетки');
  pointer.getAnimations().forEach(animation=>animation.cancel());
  pointer.style.transform='rotate(0deg)';
  void pointer.getBoundingClientRect();
  const stopTicks=sound?startSpinTicks(duration):()=>{};
  const animation=pointer.animate(
    [{transform:'rotate(0deg)'},{transform:`rotate(${turns*360+finalAngle}deg)`}],
    {duration,easing:'cubic-bezier(.12,.02,.08,1)',fill:'forwards'}
  );
  try{await animation.finished}finally{stopTicks()}
  if(sound)resultSound(r.win);
}
function showOutcome(r){if(!r)return;lastOutcome=r;const roll=Number(r.roll);const detail=Number.isFinite(roll)?`Выпало ${roll.toFixed(2)} из 100 · нужно ≤ ${Number(r.chance||0).toFixed(2)}`:`Шанс ${Number(r.chance||0).toFixed(2)}%`;$('#result').innerHTML=r.win?`<strong class="win">ВЫИГРЫШ — ${esc(r.target?.name||'скин')}</strong><small>${detail}. Предмет добавлен в инвентарь.</small>`:`<strong class="lose">ПРОИГРЫШ</strong><small>${detail}. Ставка списана.</small>`;target=r.target||target;renderTarget()}
let audioCtx=null;function getAudio(){try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();return audioCtx}catch{return null}}
function beep(freq=240,d=.055,volume=.22,type='sine'){if(!sound||soundVolume<=0)return;try{const c=getAudio();if(!c)return;const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(freq,c.currentTime);g.gain.setValueAtTime(Math.max(.0001,volume*soundVolume),c.currentTime);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+d);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+d)}catch{}}
function startSpinTicks(duration){let stopped=false,timer=null,start=performance.now(),count=0;const tick=()=>{if(stopped)return;const p=Math.min(1,(performance.now()-start)/duration);beep(115+80*(1-p),.028,.13,'triangle');count++;const delay=24+Math.pow(p,2.2)*165;timer=setTimeout(tick,delay)};tick();return()=>{stopped=true;if(timer)clearTimeout(timer)}}
function resultSound(win){if(!sound)return;[0,.11,.22].forEach((t,i)=>setTimeout(()=>beep(win?[440,660,880][i]:[220,180,140][i],.15),t*1000))}
async function sellItems(ids){try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),s=await tx.get(ref),d=s.data()||{},inv=Array.isArray(d.inventory)?d.inventory:[],set=new Set(ids.map(String)),selling=inv.filter(x=>set.has(inventoryKey(x))),gain=selling.reduce((a,x)=>a+Number(x.priceUSD||0)*.9,0);tx.update(ref,{inventory:inv.filter(x=>!set.has(inventoryKey(x))),balanceUSD:Number(d.balanceUSD||0)+gain})});toast('Продано за 90% стоимости')}catch(e){toast(humanError(e))}}
function renderHistory(){$('#historyList').innerHTML=history.map(h=>`<article class="history-card"><div class="history-side">${h.sources?.length?h.sources.map(x=>`<div class="hist-item"><img src="${x.image}"><span>${esc(x.name)}</span><b>${fmt(x.priceUSD)}</b></div>`).join(''):`<div class="hist-cash"><b>${fmt(h.cashUSD||0)}</b><small>ставка</small></div>`}</div><div class="history-arrow">⌃</div><div class="history-side"><div class="hist-item"><img src="${h.target?.image||''}"><span>${esc(h.target?.name||'')}</span><b>${fmt(h.target?.priceUSD||0)}</b></div></div><div class="history-meta"><b>${Number(h.chance||0).toFixed(2)}%${Number.isFinite(Number(h.roll))?` · roll ${Number(h.roll).toFixed(2)}`:''}</b><strong class="${h.win?'win':'lose'}">${h.win?'Win':'Lose'}</strong></div></article>`).join('')||'<div class="empty-state">История пуста</div>'}
function renderTop(){if(!userDoc){$('#balance').textContent='Загрузка…';return}$('#balance').textContent=infiniteMoney()?'∞':fmt(userDoc.balanceUSD||0);$('#invCount').textContent=inventory.length;$('#currency').value=currency;const n=profile?.nickname||'Игрок';$('#topNick').textContent=n;$('#topAvatar').textContent=avatarLetter(n);$('#soundQuick').textContent=sound?'🔊':'🔇';$('#fastQuick').classList.toggle('active',fast)}
function renderProfile(){if(!profile||!user)return;const n=profile.nickname||'Игрок',st=profile.stats||{};const spins=Number(st.spins||0),wins=Number(st.wins||0),losses=Number(st.losses||0),rate=spins?Math.round(wins/spins*100):0;$('#profileNick').textContent=n;$('#profileAvatar').textContent=avatarLetter(n);$('#profileUid').textContent='ID профиля: '+user.uid.slice(0,8);$('#nickInput').value=n;$('#statsGrid').innerHTML=`<div class="stat"><b>${spins}</b><small>апгрейдов</small></div><div class="stat"><b>${wins}</b><small>побед</small></div><div class="stat"><b>${losses}</b><small>поражений</small></div><div class="stat"><b>${rate}%</b><small>успешность</small></div><div class="stat"><b>${fmt(st.bestWinUSD||0)}</b><small>лучший выигрыш</small></div>`;renderV65Rewards()}
function renderAll(){renderTop();renderInventory();renderHistory();renderProfile();renderAdminPanel();syncUpgrade()}
function pickByRatio(m){const v=stakeUSD();if(v<=0)return toast('Сначала введи ставку');target=skins.filter(x=>x.priceUSD>v*1.01).sort((a,b)=>Math.abs(a.priceUSD-v*m)-Math.abs(b.priceUSD-v*m))[0]||null;lastOutcome=null;if(!target)return toast('Не найден подходящий более дорогой скин');syncUpgrade()}
function pickByChance(p){const v=stakeUSD();if(v<=0)return toast('Сначала введи ставку');const wanted=v*100*HOUSE/p;target=skins.filter(x=>x.priceUSD>v*1.01).sort((a,b)=>Math.abs(a.priceUSD-wanted)-Math.abs(b.priceUSD-wanted))[0]||null;lastOutcome=null;if(!target)return toast('Не найден подходящий более дорогой скин');syncUpgrade()}
function showPage(id){$$('.nav,.page').forEach(x=>x.classList.remove('active'));$(`.nav[data-page="${id}"]`)?.classList.add('active');$('#'+id).classList.add('active')}
function open(id){const m=$('#'+id);if(!m)return;m.classList.remove('hidden');document.body.classList.add('modal-open')}function close(id){const m=$('#'+id);if(!m)return;m.classList.add('hidden');if(!document.querySelector('.modal:not(.hidden)'))document.body.classList.remove('modal-open')}
$$('.nav').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
document.addEventListener('click',e=>{const closeBtn=e.target.closest('[data-close]');if(closeBtn){e.preventDefault();e.stopPropagation();close(closeBtn.dataset.close);return}const modal=e.target.classList?.contains('modal')?e.target:null;if(modal&&!modal.classList.contains('hidden'))close(modal.id)},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const m=document.querySelector('.modal:not(.hidden)');if(m)close(m.id)}});$('#currency').onchange=e=>{currency=e.target.value;localStorage.setItem('ul-currency',currency);renderAll();renderCatalog()};$('#search').oninput=()=>{shown=30;renderCatalog()};$('#priceMin').oninput=$('#priceMax').oninput=()=>{shown=30;renderCatalog()};$('#category').onchange=renderCatalog;$('#sort').onchange=renderCatalog;$('#more').onclick=()=>{shown+=30;renderCatalog()};$('#favoriteOnly').onclick=()=>{$('#favoriteOnly').classList.toggle('active');shown=30;renderCatalog()};$('#clearTarget').onclick=()=>{target=null;lastOutcome=null;syncUpgrade()};$('#clearSource').onclick=()=>{sourceItems=[];selected.clear();cashDraft='';lastOutcome=null;syncUpgrade()};$('#sourceMode').onclick=()=>{sourceItems=[];selected.clear();cashDraft='';lastOutcome=null;syncUpgrade()};$('#chooseInventory').onclick=()=>{selected=new Set(sourceItems.map(inventoryKey));renderPicker();open('modal')};$('#applySources').onclick=()=>{const picked=inventory.filter(x=>selected.has(inventoryKey(x)));if(!picked.length)return toast('Сначала выбери хотя бы один скин');sourceItems=picked;cashDraft='';lastOutcome=null;target=null;close('modal');syncUpgrade();toast(`В ставку добавлено: ${picked.length}`)};$('#upgradeBtn').onclick=startUpgrade;$('#autoTarget').onclick=()=>pickByRatio(2);function bindQuickButtons(){
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
  const sr=$(`input[name="spinStyle"][value="${spinStyle}"]`);if(sr)sr.checked=true;const cr=$(`input[name="caseSpeedSetting"][value="${localStorage.getItem('ul-case-speed')||'normal'}"]`);if(cr)cr.checked=true;
  const snd=$(`input[name="soundSetting"][value="${sound?'on':'off'}"]`);if(snd)snd.checked=true;
  const vol=$('#soundVolume');if(vol)vol.value=String(Math.round(soundVolume*100));
  const qm=$('#quickMultipliers');if(qm)qm.value=localStorage.getItem('ul-quick-m')||'2,3,5';
  const qp=$('#quickPercents');if(qp)qp.value=localStorage.getItem('ul-quick-p')||'20,40,70';
  const im=$('#infiniteMoneySetting');if(im){im.checked=Boolean(userDoc?.infiniteMoney);im.disabled=!isSandbox()}
  const mode=$('#gameModeSetting');if(mode)mode.value=isSandbox()?'sandbox':'normal';
  const exact=$('#setExactBalance');if(exact)exact.disabled=!isSandbox();
  const amount=$('#settingsBalanceAmount');if(amount)amount.disabled=!isSandbox();
  const badge=$('#modeBadge');if(badge){badge.textContent=isSandbox()?'ПЕСОЧНИЦА':'ОБЫЧНЫЙ';badge.classList.toggle('sandbox',isSandbox())}
  const scl=$('#settingsCurrencyLabel');if(scl)scl.textContent=symbols[currency]+' '+currency;
}
function bindSettingsOnce(){
  $$('.theme-grid button[data-theme]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();localStorage.setItem('ul-theme',btn.dataset.theme);applySettingsUI();toast(`Тема: ${btn.textContent.trim()}`)}));
  $$('input[name="wheelStyle"]').forEach(input=>input.addEventListener('change',()=>{localStorage.setItem('ul-wheel-style',input.value);applySettingsUI();toast('Стиль круга изменён')}));
  $$('.arrow-options button[data-setting-arrow]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();localStorage.setItem('ul-arrow-style',btn.dataset.settingArrow);applySettingsUI();toast(`Стрелка ${btn.dataset.settingArrow} выбрана`)}));
  $$('.arrow-color-options button[data-arrow-color]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();localStorage.setItem('ul-arrow-color',btn.dataset.arrowColor);applySettingsUI();toast('Цвет стрелки изменён')}));
  $$('input[name="spinStyle"]').forEach(input=>input.addEventListener('change',()=>{localStorage.setItem('ul-spin-style',input.value);applySettingsUI();toast(input.value==='long'?'Длинная прокрутка включена':'Обычная прокрутка включена')}));
  $$('input[name="caseSpeedSetting"]').forEach(input=>input.addEventListener('change',()=>{caseSpinSpeed=input.value;localStorage.setItem('ul-case-speed',caseSpinSpeed);toast('Скорость кейсов сохранена')}));
  $$('input[name="soundSetting"]').forEach(input=>input.addEventListener('change',()=>{sound=input.value==='on';localStorage.setItem('ul-sound',sound?'1':'0');applySettingsUI();renderTop();toast(sound?'Звук включён':'Звук выключен')}));
  const vol=$('#soundVolume');if(vol)vol.addEventListener('input',()=>{soundVolume=Math.max(0,Math.min(1,Number(vol.value)/100));localStorage.setItem('ul-sound-volume',String(soundVolume));if(sound)beep(330,.05,.12,'triangle')});
  const save=$('#saveQuickSettings');if(save)save.addEventListener('click',()=>{
    const ms=$('#quickMultipliers').value.split(',').map(x=>Number(x.trim().replace(',','.'))).filter(x=>Number.isFinite(x)&&x>1).slice(0,3);
    const ps=$('#quickPercents').value.split(',').map(x=>Number(x.trim().replace(',','.'))).filter(x=>Number.isFinite(x)&&x>0&&x<=MAX_CHANCE).slice(0,3);
    if(!ms.length||!ps.length)return toast('Укажи коэффициенты и проценты через запятую');
    localStorage.setItem('ul-quick-m',ms.join(','));localStorage.setItem('ul-quick-p',ps.join(','));function updateAdminPromoPreview(){const money=parseMoneyInput($('#adminPromoMoney')?.value||0),cr=parseMoneyInput($('#adminPromoCrystals')?.value||0),max=parseMoneyInput($('#adminPromoMax')?.value||0),days=parseMoneyInput($('#adminPromoDays')?.value||0),items=adminPromoItems.length;const parts=[money?`${money.toLocaleString('ru-RU')} ${symbols[currency]}`:'',cr?`💎 ${cr}`:'',items?`${items} предм.`:''].filter(Boolean);const el=$('#adminPromoPreview');if(el)el.textContent=(parts.join(' + ')||'Без награды')+` · ${max?max+' активаций':'без лимита'} · ${days?days+' дн.':'бессрочно'}`}
function resetAdminPromoForm(){['#adminPromoCode','#adminPromoItemSearch'].forEach(x=>{if($(x))$(x).value=''});$('#adminPromoMoney').value=0;$('#adminPromoCrystals').value=0;$('#adminPromoMax').value=0;$('#adminPromoDays').value=30;$('#adminPromoActive').checked=true;adminPromoItems=[];renderAdminPromoItems();renderAdminItemSuggestions();updateAdminPromoPreview()}
$$('[data-promo-preset]').forEach(b=>b.onclick=()=>{const k=b.dataset.promoPreset;resetAdminPromoForm();if(k==='starter'){ $('#adminPromoMoney').value=25000;$('#adminPromoCrystals').value=3;$('#adminPromoMax').value=100;$('#adminPromoDays').value=14 }if(k==='crystals'){ $('#adminPromoCrystals').value=15;$('#adminPromoMax').value=50;$('#adminPromoDays').value=7 }if(k==='vip'){ $('#adminPromoMoney').value=150000;$('#adminPromoCrystals').value=25;$('#adminPromoMax').value=10;$('#adminPromoDays').value=3 }updateAdminPromoPreview()});
$('#resetPromoForm')?.addEventListener('click',resetAdminPromoForm);['#adminPromoCode','#adminPromoMoney','#adminPromoCrystals','#adminPromoMax','#adminPromoDays','#adminPromoActive'].forEach(sel=>$(sel)?.addEventListener('input',updateAdminPromoPreview));
const _renderAdminPromoItemsV73=renderAdminPromoItems;renderAdminPromoItems=function(){_renderAdminPromoItemsV73();updateAdminPromoPreview()};
rebuildQuickButtons();toast('Быстрые кнопки сохранены');
  });
  $('#gameModeSetting')?.addEventListener('change',async e=>{const next=e.target.value;try{await switchGameMode(next);toast(next==='sandbox'?'Песочница включена: прогресс хранится отдельно':'Обычный режим восстановлен')}catch(err){e.target.value=isSandbox()?'sandbox':'normal';toast(humanError(err))}});
  $('#infiniteMoneySetting')?.addEventListener('change',async e=>{if(!isSandbox()){e.target.checked=false;return toast('Бесконечные деньги доступны только в песочнице')}try{await updateDoc(doc(db,'users',user.uid),{infiniteMoney:Boolean(e.target.checked)});toast(e.target.checked?'Бесконечные деньги включены':'В песочнице используется заданный баланс')}catch(err){e.target.checked=!e.target.checked;toast(humanError(err))}});
  $('#setExactBalance')?.addEventListener('click',async()=>{if(!isSandbox())return toast('Свой баланс можно устанавливать только в песочнице');const amount=Number(String($('#settingsBalanceAmount')?.value||'').replace(',','.'));if(!Number.isFinite(amount)||amount<0)return toast('Введи сумму от нуля');try{await updateDoc(doc(db,'users',user.uid),{balanceUSD:amount/rates[currency],infiniteMoney:false});toast('Баланс песочницы установлен')}catch(err){toast(humanError(err))}});
  $('#themeQuick').addEventListener('click',e=>{e.preventDefault();e.stopPropagation();applySettingsUI();open('themeModal')});
}

async function switchGameMode(next){
  if(!user||!['normal','sandbox'].includes(next)||next===(isSandbox()?'sandbox':'normal'))return;
  sourceItems=[];selected.clear();target=null;lastOutcome=null;cashDraft='';
  await runTransaction(db,async tx=>{
    const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');
    const d=snap.data()||{},current={balanceUSD:Number(d.balanceUSD||0),inventory:Array.isArray(d.inventory)?d.inventory:[],history:Array.isArray(d.history)?d.history:[],favorites:Array.isArray(d.favorites)?d.favorites:[],infiniteMoney:Boolean(d.infiniteMoney)};
    if(next==='sandbox'){
      const box=d.sandboxState||{balanceUSD:1000000/41.4,inventory:[],history:[],favorites:[],infiniteMoney:true};
      tx.update(ref,{gameMode:'sandbox',normalState:current,balanceUSD:Number(box.balanceUSD||0),inventory:Array.isArray(box.inventory)?box.inventory:[],history:Array.isArray(box.history)?box.history:[],favorites:Array.isArray(box.favorites)?box.favorites:[],infiniteMoney:box.infiniteMoney!==false});
    }else{
      const box=d.normalState||{balanceUSD:START_BALANCE_USD,crystals:0,inventory:[],history:[],favorites:[],infiniteMoney:false};
      tx.update(ref,{gameMode:'normal',sandboxState:current,balanceUSD:Number(box.balanceUSD||0),inventory:Array.isArray(box.inventory)?box.inventory:[],history:Array.isArray(box.history)?box.history:[],favorites:Array.isArray(box.favorites)?box.favorites:[],infiniteMoney:false});
    }
  });
}
let adminPromoItems=[];

function promoItemForSave(item){
  return {
    id:String(item?.id||item?.marketHash||item?.name||safeUUID()),
    name:String(item?.name||item?.marketHash||'Предмет'),
    marketHash:String(item?.marketHash||item?.name||''),
    image:String(item?.image||item?.imageUrl||''),
    priceUSD:Number(item?.priceUSD||0),
    rarity:String(item?.rarity||''),
    category:String(item?.category||item?.type||'weapon')
  };
}
function renderAdminPromoItems(){
  const box=$('#adminPromoItemsList');if(!box)return;
  box.innerHTML=adminPromoItems.length?adminPromoItems.map((x,i)=>`<div class="admin-item-chip"><img src="${x.image||''}" alt=""><span>${esc(x.name)}<small>${fmt(x.priceUSD||0)}</small></span><button type="button" data-remove-promo-item="${i}">×</button></div>`).join(''):'<span class="muted">Предметы не выбраны</span>';
  box.querySelectorAll('[data-remove-promo-item]').forEach(b=>b.onclick=()=>{adminPromoItems.splice(Number(b.dataset.removePromoItem),1);renderAdminPromoItems()});
}
function renderAdminItemSuggestions(){
  const input=$('#adminPromoItemSearch'),box=$('#adminItemSuggestions');if(!input||!box)return;
  const value=String(input.value||'').trim().toLowerCase();
  if(!value){box.innerHTML='<span class="muted">Напиши часть названия, например: Dragon Lore, Bayonet или AK-47</span>';return;}
  const words=value.split(/\s+/).filter(Boolean);
  const matches=skins.filter(x=>{const n=String(x.name||'').toLowerCase();return words.every(w=>n.includes(w))}).sort((a,b)=>Number(b.priceUSD||0)-Number(a.priceUSD||0)).slice(0,12);
  box.innerHTML=matches.length?matches.map((x,i)=>`<button type="button" class="admin-item-result" data-promo-suggestion="${i}"><img src="${esc(x.image||x.imageUrl||'')}" alt=""><span><b>${esc(x.name)}</b><small>${fmt(x.priceUSD||0)}</small></span></button>`).join(''):'<span class="muted">Ничего не найдено</span>';
  box.querySelectorAll('[data-promo-suggestion]').forEach(b=>b.onclick=()=>{const item=matches[Number(b.dataset.promoSuggestion)];if(!item)return;adminPromoItems.push(promoItemForSave(item));input.value='';renderAdminPromoItems();renderAdminItemSuggestions()});
}
function setupAdminItemPicker(){
  const input=$('#adminPromoItemSearch');if(!input)return;
  if(!input.dataset.pickerReady){input.addEventListener('input',renderAdminItemSuggestions);input.dataset.pickerReady='1';}
  renderAdminItemSuggestions();
}
function addAdminPromoItem(){
  const input=$('#adminPromoItemSearch');if(!input)return;
  const value=String(input.value||'').trim().toLowerCase();
  if(!value)return toast('Начни вводить название предмета');
  const words=value.split(/\s+/).filter(Boolean);
  const matches=skins.filter(x=>{const n=String(x.name||'').toLowerCase();return words.every(w=>n.includes(w))}).sort((a,b)=>Number(b.priceUSD||0)-Number(a.priceUSD||0));
  if(!matches.length)return toast('Предмет не найден');
  if(matches.length>1){renderAdminItemSuggestions();return toast('Выбери нужный предмет из списка ниже');}
  adminPromoItems.push(promoItemForSave(matches[0]));input.value='';renderAdminPromoItems();renderAdminItemSuggestions();
}
async function activatePromo(){
  if(isSandbox())return toast('Промокоды работают только в обычном режиме');
  const code=String($('#promoCode')?.value||'').trim().toUpperCase();
  if(!code)return toast('Введи промокод');
  try{
    const pref=doc(db,'promocodes',code),uref=doc(db,'users',user.uid),profileRef=doc(db,'profiles',user.uid);
    // Сначала выполняем все чтения, затем одной атомарной пачкой — все записи.
    // Так Firestore не выдаёт ошибку порядка чтений/записей в транзакции.
    const [ps,us,profileSnap]=await Promise.all([getDoc(pref),getDoc(uref),getDoc(profileRef)]);
    if(!ps.exists())throw new Error('Промокод не найден');
    if(!us.exists())throw new Error('Профиль пользователя не найден');
    const promo=ps.data()||{},d=us.data()||{},pd=profileSnap.exists()?(profileSnap.data()||{}):{};
    if(d.gameMode==='sandbox')throw new Error('Промокоды недоступны в песочнице');
    if(promo.active===false)throw new Error('Промокод выключен');
    const now=Date.now(),ends=Number(promo.endsAt||0);
    if(ends&&now>ends)throw new Error('Срок промокода истёк');
    const used=d.promoRedemptions||{};
    if(used[code])throw new Error('Ты уже использовал этот промокод');
    const money=Number(promo.moneyUSD||0),crystals=Number(promo.crystals||0),items=Array.isArray(promo.items)?promo.items:[];
    const awarded=items.map(x=>({...x,uid:safeUUID(),obtainedAt:now,source:'promo'}));
    const batch=writeBatch(db);
    batch.update(uref,{
      balanceUSD:Number(d.balanceUSD||0)+money,
      crystals:Number(d.crystals||0)+crystals,
      inventory:[...awarded,...(Array.isArray(d.inventory)?d.inventory:[])].slice(0,500),
      promoRedemptions:{...used,[code]:now}
    });
    await batch.commit();
    const rewardText=[money?fmt(money):'',crystals?`💎 ${crystals}`:'',awarded.length?`${awarded.length} предмет(а)`:'' ].filter(Boolean).join(', ');
    $('#promoCode').value='';
    toast('Промокод активирован: '+(rewardText||'награда получена'));
  }catch(e){
    console.error('PROMO_ACTIVATION_ERROR',e);
    const codeText=e?.code?` [${e.code}]`:'';
    const message=e?.message||'Неизвестная ошибка';
    toast(codeText?`Ошибка промокода:${codeText} ${message}`:message);
  }
}
function isAdmin(){return String(profile?.role||'').trim().toLowerCase()==='admin'}
function renderAdminPanel(){const panel=$('#adminPanel');if(!panel)return;const admin=isAdmin();panel.classList.toggle('hidden',!admin);$('#adminNav')?.classList.toggle('hidden',!admin);if(admin){setupAdminItemPicker();loadAdminPromos()}}
async function createPromoFromAdmin(){
  if(!isAdmin())return toast('Нет доступа');
  const code=String($('#adminPromoCode').value||'').trim().toUpperCase();if(!/^[A-Z0-9_-]{3,32}$/.test(code))return toast('Код: 3–32 символа');
  const money=parseMoneyInput($('#adminPromoMoney').value)/rates[currency],crystals=parseMoneyInput($('#adminPromoCrystals').value),maxUses=parseMoneyInput($('#adminPromoMax').value),days=parseMoneyInput($('#adminPromoDays').value);
  try{const old=await getDoc(doc(db,'promocodes',code));const oldData=old.exists()?old.data():{};await setDoc(doc(db,'promocodes',code),{code,active:$('#adminPromoActive')?.checked!==false,moneyUSD:money,crystals,maxUses,usedCount:Number(oldData.usedCount||0),endsAt:days?Date.now()+days*86400000:0,items:adminPromoItems,createdBy:oldData.createdBy||user.uid,createdAt:oldData.createdAt||Date.now(),updatedAt:Date.now()},{merge:true});toast('Промокод '+code+' сохранён');adminPromoItems=[];renderAdminPromoItems();await loadAdminPromos()}catch(e){console.error(e);toast(humanError(e))}
}
async function deletePromoFromAdmin(code){
  if(!isAdmin())return toast('Нет доступа');
  if(!confirm(`Удалить промокод ${code}? Вернуть его после удаления нельзя.`))return;
  try{await deleteDoc(doc(db,'promocodes',code));toast('Промокод '+code+' удалён');if(String($('#adminPromoCode')?.value||'').toUpperCase()===code)$('#adminPromoCode').value='';await loadAdminPromos()}catch(e){console.error(e);toast(humanError(e))}
}
async function loadAdminPromos(){
  const box=$('#adminPromoList');if(!box||!isAdmin())return;box.innerHTML='<span class="muted">Загрузка…</span>';
  try{const snap=await getDocs(collection(db,'promocodes'));const rows=[];snap.forEach(d=>rows.push({id:d.id,...d.data()}));rows.sort((a,b)=>Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0));
    box.innerHTML=rows.length?rows.map(p=>`<div class="promo-row"><div><b>${esc(p.code||p.id)}</b><span class="promo-status ${p.active===false?'off':'on'}">${p.active===false?'выключен':'активен'}</span><small>${[p.moneyUSD?fmt(p.moneyUSD):'',p.crystals?`💎 ${p.crystals}`:'',Array.isArray(p.items)&&p.items.length?`${p.items.length} предм.`:''].filter(Boolean).join(' · ')||'без награды'}</small>${Array.isArray(p.items)&&p.items.length?`<small>${p.items.map(x=>esc(x.name||'Предмет')).join(', ')}</small>`:''}</div><div class="promo-actions"><button type="button" data-edit-promo="${esc(p.code||p.id)}">Изменить</button><button type="button" class="danger" data-delete-promo="${esc(p.code||p.id)}">Удалить</button></div></div>`).join(''):'<span class="muted">Промокодов пока нет</span>';
    box.querySelectorAll('[data-edit-promo]').forEach(b=>b.onclick=()=>{const p=rows.find(x=>(x.code||x.id)===b.dataset.editPromo);if(!p)return;$('#adminPromoCode').value=p.code||p.id;$('#adminPromoMoney').value=Math.round(Number(p.moneyUSD||0)*rates[currency]*100)/100;$('#adminPromoCrystals').value=Number(p.crystals||0);$('#adminPromoMax').value=Number(p.maxUses||0);$('#adminPromoDays').value=p.endsAt?Math.max(0,Math.ceil((Number(p.endsAt)-Date.now())/86400000)):0;if($('#adminPromoActive'))$('#adminPromoActive').checked=p.active!==false;adminPromoItems=Array.isArray(p.items)?p.items.map(promoItemForSave):[];renderAdminPromoItems();$('#adminPromoCode').scrollIntoView({behavior:'smooth',block:'center'})});
    box.querySelectorAll('[data-delete-promo]').forEach(b=>b.onclick=()=>deletePromoFromAdmin(b.dataset.deletePromo));
  }catch(e){console.error(e);box.innerHTML='<span class="muted">Не удалось загрузить промокоды: '+esc(humanError(e))+'</span>'}
}

function updateAdminPromoPreview(){const money=parseMoneyInput($('#adminPromoMoney')?.value||0),cr=parseMoneyInput($('#adminPromoCrystals')?.value||0),max=parseMoneyInput($('#adminPromoMax')?.value||0),days=parseMoneyInput($('#adminPromoDays')?.value||0),items=adminPromoItems.length;const parts=[money?`${money.toLocaleString('ru-RU')} ${symbols[currency]}`:'',cr?`💎 ${cr}`:'',items?`${items} предм.`:''].filter(Boolean);const el=$('#adminPromoPreview');if(el)el.textContent=(parts.join(' + ')||'Без награды')+` · ${max?max+' активаций':'без лимита'} · ${days?days+' дн.':'бессрочно'}`}
function resetAdminPromoForm(){['#adminPromoCode','#adminPromoItemSearch'].forEach(x=>{if($(x))$(x).value=''});$('#adminPromoMoney').value=0;$('#adminPromoCrystals').value=0;$('#adminPromoMax').value=0;$('#adminPromoDays').value=30;$('#adminPromoActive').checked=true;adminPromoItems=[];renderAdminPromoItems();renderAdminItemSuggestions();updateAdminPromoPreview()}
$$('[data-promo-preset]').forEach(b=>b.onclick=()=>{const k=b.dataset.promoPreset;resetAdminPromoForm();if(k==='starter'){ $('#adminPromoMoney').value=25000;$('#adminPromoCrystals').value=3;$('#adminPromoMax').value=100;$('#adminPromoDays').value=14 }if(k==='crystals'){ $('#adminPromoCrystals').value=15;$('#adminPromoMax').value=50;$('#adminPromoDays').value=7 }if(k==='vip'){ $('#adminPromoMoney').value=150000;$('#adminPromoCrystals').value=25;$('#adminPromoMax').value=10;$('#adminPromoDays').value=3 }updateAdminPromoPreview()});
$('#resetPromoForm')?.addEventListener('click',resetAdminPromoForm);['#adminPromoCode','#adminPromoMoney','#adminPromoCrystals','#adminPromoMax','#adminPromoDays','#adminPromoActive'].forEach(sel=>$(sel)?.addEventListener('input',updateAdminPromoPreview));
const _renderAdminPromoItemsV73=renderAdminPromoItems;renderAdminPromoItems=function(){_renderAdminPromoItemsV73();updateAdminPromoPreview()};
rebuildQuickButtons();
applySettingsUI();
bindSettingsOnce();
$('#balanceBox').onclick=()=>{if(!user)return;if(!isSandbox())return toast('Пополнение вручную доступно только в песочнице. В обычном режиме используй промокоды.');$('#balanceAmount').value='10000';$('#balanceCurrencyLabel').textContent=symbols[currency]+' '+currency;open('balanceModal')};
$('#addBalance').onclick=async()=>{if(!isSandbox())return toast('Пополнение доступно только в песочнице');const amount=Number(String($('#balanceAmount').value).replace(',','.'));if(!Number.isFinite(amount)||amount<=0)return toast('Введи сумму больше нуля');try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),s=await tx.get(ref),d=s.data()||{};tx.update(ref,{balanceUSD:Number(d.balanceUSD||0)+amount/rates[currency]})});close('balanceModal');toast('Виртуальный баланс пополнен')}catch(e){toast(humanError(e))}};

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



/* V40: collapsible desktop feed panel. */
function applyFeedPanelState(){
  const collapsed=localStorage.getItem('ul-feed-collapsed')==='1';
  document.body.classList.toggle('feed-collapsed',collapsed);
  const toggle=document.querySelector('#feedToggle');
  if(toggle){toggle.textContent=collapsed?'›':'‹';toggle.title=collapsed?'Показать панель':'Скрыть панель';toggle.setAttribute('aria-label',toggle.title)}
}
function setFeedPanelCollapsed(value){
  localStorage.setItem('ul-feed-collapsed',value?'1':'0');
  applyFeedPanelState();
}
const feedToggle=document.querySelector('#feedToggle');
const feedRestore=document.querySelector('#feedRestore');
if(feedToggle)feedToggle.addEventListener('click',()=>setFeedPanelCollapsed(true));
if(feedRestore)feedRestore.addEventListener('click',()=>setFeedPanelCollapsed(false));
applyFeedPanelState();

// V44 — Cases
const CASES=[
{slug:"starter",name:"Стартовый",category:"budget",priceUSD:1.0,badge:"HOT",image:"assets/cases/starter.svg"},
{slug:"budget",name:"Бюджетный",category:"budget",priceUSD:2.5,badge:"",image:"assets/cases/budget.svg"},
{slug:"lucky",name:"Счастливый",category:"budget",priceUSD:5,badge:"NEW",image:"assets/cases/lucky.svg"},
{slug:"glock",name:"Glock",category:"weapon",priceUSD:7.5,badge:"",image:"assets/cases/glock.svg"},
{slug:"usp",name:"USP-S",category:"weapon",priceUSD:9,badge:"",image:"assets/cases/usp.svg"},
{slug:"deagle",name:"Desert Eagle",category:"weapon",priceUSD:14,badge:"HOT",image:"assets/cases/deagle.svg"},
{slug:"smg-lab",name:"SMG Lab",category:"weapon",priceUSD:16,badge:"",image:"assets/cases/smg-lab.svg"},
{slug:"famas-lab",name:"FAMAS Lab",category:"weapon",priceUSD:20,badge:"",image:"assets/cases/famas-lab.svg"},
{slug:"galil-lab",name:"Galil Lab",category:"weapon",priceUSD:24,badge:"",image:"assets/cases/galil-lab.svg"},
{slug:"m4-lab",name:"M4 Lab",category:"weapon",priceUSD:35,badge:"NEW",image:"assets/cases/m4-lab.svg"},
{slug:"ak-lab",name:"AK-47 Lab",category:"weapon",priceUSD:45,badge:"HOT",image:"assets/cases/ak-lab.svg"},
{slug:"awp-lab",name:"AWP Lab",category:"weapon",priceUSD:60,badge:"",image:"assets/cases/awp-lab.svg"},
{slug:"milspec",name:"Армейское",category:"rarity",priceUSD:6,badge:"",image:"assets/cases/milspec.svg"},
{slug:"restricted",name:"Запрещённое",category:"rarity",priceUSD:18,badge:"",image:"assets/cases/restricted.svg"},
{slug:"classified",name:"Засекреченное",category:"rarity",priceUSD:55,badge:"",image:"assets/cases/classified.svg"},
{slug:"covert",name:"Тайное",category:"rarity",priceUSD:140,badge:"LIMITED",image:"assets/cases/covert.svg"},
{slug:"sakura",name:"Сакура",category:"theme",priceUSD:22,badge:"NEW",image:"assets/cases/sakura.svg"},
{slug:"galaxy",name:"Галактика",category:"theme",priceUSD:30,badge:"",image:"assets/cases/galaxy.svg"},
{slug:"lightning",name:"Молния",category:"theme",priceUSD:38,badge:"",image:"assets/cases/lightning.svg"},
{slug:"ice",name:"Лёд",category:"theme",priceUSD:50,badge:"",image:"assets/cases/ice.svg"},
{slug:"fire",name:"Пламя",category:"theme",priceUSD:65,badge:"HOT",image:"assets/cases/fire.svg"},
{slug:"neon",name:"Неон",category:"theme",priceUSD:80,badge:"",image:"assets/cases/neon.svg"},
{slug:"dragon",name:"Дракон",category:"theme",priceUSD:120,badge:"",image:"assets/cases/dragon.svg"},
{slug:"gold",name:"Золотой",category:"theme",priceUSD:180,badge:"",image:"assets/cases/gold.svg"},
{slug:"knife",name:"Ножевой",category:"knives",priceUSD:250,badge:"HOT",image:"assets/cases/knife.svg"},
{slug:"elite",name:"Элитный нож",category:"knives",priceUSD:500,badge:"",image:"assets/cases/elite.svg"},
{slug:"gloves",name:"Перчатки",category:"gloves",priceUSD:220,badge:"",image:"assets/cases/gloves.svg"},
{slug:"collector",name:"Коллекционер",category:"premium",priceUSD:120,badge:"",image:"assets/cases/collector.svg"},
{slug:"premium",name:"Премиум",category:"premium",priceUSD:180,badge:"HOT",image:"assets/cases/premium.svg"},
{slug:"diamond",name:"Бриллиант",category:"premium",priceUSD:260,badge:"",image:"assets/cases/diamond.svg"},
{slug:"emerald",name:"Изумруд",category:"premium",priceUSD:340,badge:"",image:"assets/cases/emerald.svg"},
{slug:"ruby",name:"Рубин",category:"premium",priceUSD:450,badge:"",image:"assets/cases/ruby.svg"},
{slug:"sapphire",name:"Сапфир",category:"premium",priceUSD:600,badge:"",image:"assets/cases/sapphire.svg"},
{slug:"royal",name:"Королевский",category:"premium",priceUSD:800,badge:"LIMITED",image:"assets/cases/royal.svg"},
{slug:"titan",name:"Титан",category:"premium",priceUSD:1000,badge:"",image:"assets/cases/titan.svg"},
{slug:"legend",name:"Легенда",category:"premium",priceUSD:1250,badge:"",image:"assets/cases/legend.svg"},
{slug:"millionaire",name:"Миллионер",category:"luxury",priceUSD:1500,badge:"",image:"assets/cases/millionaire.svg"},
{slug:"billion",name:"Миллиардер",category:"luxury",priceUSD:4500,badge:"",image:"assets/cases/billion.svg"},
{slug:"dragon-dream",name:"Dragon Dream",category:"luxury",priceUSD:2200,badge:"LIMITED",image:"assets/cases/dragon-dream.svg"},
{slug:"mystery",name:"Мистический",category:"luxury",priceUSD:2500,badge:"",image:"assets/cases/mystery.svg"}
];
let activeCase=null,caseQty=1,lastCaseDrops=[];
let caseSpinSpeed=localStorage.getItem('ul-case-speed')||'normal',caseOpening=false,caseAbortRequested=false,caseAutoSaving=false;
function casePool(c){let pool=skins.filter(x=>Number(x.priceUSD)>0&&x.image);if(c.category==='weapon'){const key=c.name.split(' ')[0];const map={Glock:'Glock',USP:'USP-S',Deagle:'Desert Eagle',SMG:'MP9|MP7|MAC-10|UMP-45|P90|PP-Bizon',FAMAS:'FAMAS',Galil:'Galil',M4:'M4A4|M4A1-S',AK:'AK-47',AWP:'AWP',Heavy:'Nova|XM1014|MAG-7|Sawed-Off|M249|Negev'};pool=pool.filter(x=>x.category==='weapon'&&new RegExp(map[key]||'.','i').test(x.name))}if(c.category==='knives')pool=pool.filter(x=>x.category==='knife');if(c.category==='gloves')pool=pool.filter(x=>x.category==='glove');if(c.slug==='knife')pool=pool.filter(x=>x.category==='knife');if(c.slug==='gloves')pool=pool.filter(x=>x.category==='glove');if(['milspec','restricted','classified','covert'].includes(c.slug))pool=pool.filter(x=>x.rarity===({'milspec':'mil-spec',restricted:'restricted',classified:'classified',covert:'covert'}[c.slug]));if(!pool.length)pool=skins.filter(x=>Number(x.priceUSD)>0&&x.image);if(c.priceUSD>=500){const base=[...pool].sort((a,b)=>b.priceUSD-a.priceUSD).slice(0,24);const tiers=[.08,.18,.35,.7,1.05,1.8,4,10,25];pool=tiers.flatMap((m,ti)=>base.slice(0,Math.max(4,12-ti)).map((x,i)=>({...x,id:`${c.slug}-${ti}-${i}-${x.id||x.name}`,name:`${x.name} · ${['Потёртый','Обычный','Редкий','Элитный','Особый','Премиум','Джекпот','Легендарный','Мифический'][ti]}`,priceUSD:Math.max(.03,Math.round(c.priceUSD*m*(.82+(i%5)*.09)*100)/100),rarity:ti>=7?'contraband':ti>=5?'covert':ti>=3?'classified':x.rarity})));return pool.sort((a,b)=>a.priceUSD-b.priceUSD)}const max=Math.max(c.priceUSD*35,c.priceUSD+5),min=Math.max(.03,c.priceUSD*.05);let ranged=pool.filter(x=>x.priceUSD>=min&&x.priceUSD<=max);return (ranged.length>=8?ranged:pool).sort((a,b)=>a.priceUSD-b.priceUSD)}
function stableCasePreview(c,pool){const hash=v=>{let h=2166136261;for(const ch of `${c.slug}:${v}`){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};return [...pool].sort((a,b)=>hash(a.id||a.name)-hash(b.id||b.name)).slice(0,12)}
function weightedDrop(pool,c){
  if(!Array.isArray(pool)||!pool.length)throw new Error('В этом кейсе пока нет доступных предметов');
  const price=Math.max(.01,Number(c?.priceUSD||1)),roll=Math.random();
  let min=.05,max=.75;
  if(roll>.995){min=8;max=30}else if(roll>.975){min=2.5;max=8}else if(roll>.90){min=.9;max=2.5}else if(roll>.55){min=.35;max=.9}
  const candidates=pool.filter(x=>{const r=Number(x.priceUSD||0)/price;return r>=min&&r<=max});
  const source=candidates.length?candidates:pool,item=source[Math.floor(Math.random()*source.length)]||pool[0];
  return {...item,id:item.id||safeUUID(),name:String(item.name||'Предмет'),image:String(item.image||'assets/cases/premium.svg'),priceUSD:Math.max(.01,Number(item.priceUSD||.01)),rarity:String(item.rarity||'common'),category:String(item.category||'weapon')};
}
function renderCases(){
  const grid=$('#casesGrid');if(!grid)return;
  let list=[...CASES],q=$('#caseSearch')?.value.trim().toLowerCase()||'',cat=$('#caseCategory')?.value||'all',sort=$('#caseSort')?.value||'default';
  const favOnly=$('#caseFavoriteOnly')?.classList.contains('active');
  const caseFavs=new Set(JSON.parse(localStorage.getItem('ul-case-favorites')||'[]'));
  if(q)list=list.filter(c=>c.name.toLowerCase().includes(q));if(cat!=='all')list=list.filter(c=>c.category===cat);if(favOnly)list=list.filter(c=>caseFavs.has(c.slug));
  if(sort==='priceAsc')list.sort((a,b)=>a.priceUSD-b.priceUSD);else if(sort==='priceDesc')list.sort((a,b)=>b.priceUSD-a.priceUSD);
  const labels={budget:'БЮДЖЕТ',colors:'ЦВЕТА',weapon:'ОРУЖИЕ',rarity:'РЕДКОСТЬ',theme:'ТЕМА',knives:'НОЖИ',gloves:'ПЕРЧАТКИ',premium:'PREMIUM',luxury:'LUXURY'};
  grid.innerHTML=list.map(c=>`<article class="case-card case-${c.category} ${c.badge?'has-badge':''}" data-case="${c.slug}"><button class="case-fav ${caseFavs.has(c.slug)?'active':''}" type="button">${caseFavs.has(c.slug)?'★':'☆'}</button><div class="case-glow"></div>${c.badge?`<span class="case-badge">${esc(c.badge)}</span>`:''}<span class="case-tag">${labels[c.category]||'КЕЙС'}</span><div class="case-image-wrap"><img src="${c.image}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src='assets/cases/premium.svg'"></div><div class="case-card-body"><h3>${esc(c.name)}</h3><div class="case-card-meta"><span>Открыть кейс</span><span class="case-card-price">${fmt(c.priceUSD)}</span></div></div></article>`).join('')||'<div class="case-empty">Кейсы не найдены</div>';
  $$('.case-card').forEach(e=>{const c=CASES.find(c=>c.slug===e.dataset.case);e.onclick=()=>openCase(c);const f=e.querySelector('.case-fav');f.onclick=ev=>{ev.stopPropagation();const s=new Set(JSON.parse(localStorage.getItem('ul-case-favorites')||'[]'));s.has(c.slug)?s.delete(c.slug):s.add(c.slug);localStorage.setItem('ul-case-favorites',JSON.stringify([...s]));renderCases()}});
  if($('#casesBalance'))$('#casesBalance').textContent=infiniteMoney()?'∞':fmt(userDoc?.balanceUSD||0)
}
function caseDelay(){return caseSpinSpeed==='fast'?650:caseSpinSpeed==='slow'?2600:1400}
async function animateCaseDrop(pool,drop,index,total){
  const box=$('#caseModalContent');if(!box)return;
  const reel=Array.from({length:22},(_,i)=>i===18?drop:pool[Math.floor(Math.random()*pool.length)]||drop);
  box.innerHTML=`<div class="case-spin-wrap"><div class="case-spin-head"><span>Открытие ${index+1} из ${total}</span><button id="caseSkipBtn" class="ghost" type="button">Пропустить</button></div><div class="case-spin-window"><div class="case-spin-marker"></div><div id="caseSpinTrack" class="case-spin-track">${reel.map(x=>`<div class="case-spin-item"><img src="${esc(x.image||'assets/cases/premium.svg')}"><b>${esc(x.name||'Предмет')}</b><small>${fmt(Number(x.priceUSD||0))}</small></div>`).join('')}</div></div></div>`;
  let skipped=false;$('#caseSkipBtn').onclick=()=>{skipped=true};
  const track=$('#caseSpinTrack'),duration=caseDelay();
  if(track){const distance=Math.max(0,(reel.length-4)*150);const a=track.animate([{transform:'translateX(0)'},{transform:`translateX(-${distance}px)`}],{duration,easing:'cubic-bezier(.08,.72,.12,1)',fill:'forwards'});while(!skipped){const done=await Promise.race([a.finished.then(()=>true).catch(()=>true),new Promise(r=>setTimeout(()=>r(false),50))]);if(done)break}if(skipped)a.finish()}
  box.innerHTML=`<div class="case-drop-reveal"><span>Выпало</span><img src="${esc(drop.image)}"><h2>${esc(drop.name)}</h2><b>${fmt(drop.priceUSD)}</b></div>`;
  await new Promise(r=>setTimeout(r,caseSpinSpeed==='fast'?180:caseSpinSpeed==='slow'?900:450));
}
async function addPendingCaseDropsToInventory(silent=false){
  if(caseAutoSaving)return;const items=lastCaseDrops.filter(x=>!x.sold&&!x.kept);if(!items.length)return;
  caseAutoSaving=true;
  try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');const d=snap.data()||{},inv=Array.isArray(d.inventory)?d.inventory:[];const added=items.map(x=>({id:x.id||safeUUID(),uid:safeUUID(),name:String(x.name||'Предмет'),image:String(x.image||'assets/cases/premium.svg'),priceUSD:Number(x.priceUSD||0),rarity:String(x.rarity||'common'),category:String(x.category||'weapon'),obtainedAt:Date.now(),source:'case'}));tx.update(ref,{inventory:[...added,...inv].slice(0,500)})});items.forEach(x=>x.kept=true);if(!silent)toast(`${items.length} предметов добавлено в инвентарь`)}catch(e){if(!silent)toast(humanError(e))}finally{caseAutoSaving=false}
}
function openCase(c){if(!c)return toast('Кейс не найден. Обнови страницу.');activeCase=c;caseQty=1;caseAbortRequested=false;const pool=casePool(c),preview=stableCasePreview(c,pool);$('#caseModalContent').innerHTML=`<div class="case-open-layout"><div class="case-open-cover"><img src="${c.image}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src='assets/cases/premium.svg'"></div><div class="case-open-info"><span class="eyebrow">${({budget:'БЮДЖЕТ',colors:'ЦВЕТА',weapon:'ОРУЖИЕ',rarity:'РЕДКОСТЬ',theme:'ТЕМА',knives:'НОЖИ',gloves:'ПЕРЧАТКИ',premium:'PREMIUM',luxury:'LUXURY'})[c.category]||'КЕЙС'}</span><h2>${esc(c.name)}</h2><p class="muted">Выбери от 1 до 10 кейсов. Скорость меняется в настройках ⚙️.</p><div class="case-open-price">${fmt(c.priceUSD)} за кейс</div><div class="case-qty-stepper"><button id="caseQtyMinus" class="ghost" type="button">−</button><strong id="caseQtyValue">1</strong><button id="caseQtyPlus" class="ghost" type="button">＋</button></div><div class="case-open-summary"><span>Итого</span><b id="caseOpenTotal">${fmt(c.priceUSD)}</b></div><button id="openCaseBtn" class="upgrade-btn">Открыть ×1</button></div></div><div class="case-contents"><h3>Что может выпасть</h3><div class="case-contents-grid">${preview.map(x=>`<div class="case-content-item"><img src="${esc(x.image)}"><b>${esc(x.name)}</b><small>${fmt(x.priceUSD)}</small></div>`).join('')}</div></div>`;const syncQty=()=>{caseQty=Math.max(1,Math.min(10,caseQty));$('#caseQtyValue').textContent=caseQty;$('#caseOpenTotal').textContent=fmt(c.priceUSD*caseQty);$('#openCaseBtn').textContent=`Открыть ×${caseQty}`;$('#caseQtyMinus').disabled=caseQty<=1;$('#caseQtyPlus').disabled=caseQty>=10};$('#caseQtyMinus').onclick=()=>{caseQty--;syncQty()};$('#caseQtyPlus').onclick=()=>{caseQty++;syncQty()};syncQty();$('#openCaseBtn').onclick=openSelectedCase;open('caseModal')}
async function openSelectedCase(){if(!activeCase||caseQty<1||caseQty>10||caseOpening)return;const cost=activeCase.priceUSD*caseQty;if(!infiniteMoney()&&Number(userDoc?.balanceUSD||0)<cost)return toast('Недостаточно виртуального баланса');const btn=$('#openCaseBtn');btn.disabled=true;const pool=casePool(activeCase);const drops=Array.from({length:caseQty},()=>weightedDrop(pool,activeCase));const old=$('#caseModalContent').innerHTML;try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),snap=await tx.get(ref),d=snap.data()||{},balance=Number(d.balanceUSD||0);if(!d.infiniteMoney&&balance<cost)throw new Error('Недостаточно виртуального баланса');const hist=Array.isArray(d.history)?d.history:[];const entry={id:safeUUID(),type:'case',caseName:activeCase.name,caseSlug:activeCase.slug,count:caseQty,costUSD:cost,drops:drops.map(x=>({name:String(x.name||'Предмет'),image:String(x.image||'assets/cases/premium.svg'),priceUSD:Number(x.priceUSD||0),rarity:String(x.rarity||'common')})),createdAt:Date.now()};tx.update(ref,{balanceUSD:d.infiniteMoney?balance:balance-cost,history:[entry,...hist].slice(0,100)})});lastCaseDrops=drops.map(x=>({...x,selected:false,sold:false,kept:false}));caseOpening=true;caseAbortRequested=false;for(let i=0;i<drops.length&&!caseAbortRequested;i++)await animateCaseDrop(pool,drops[i],i,drops.length);caseOpening=false;if(caseAbortRequested){await addPendingCaseDropsToInventory(true);return}close('caseModal');renderCaseResults();open('caseResultModal')}catch(e){caseOpening=false;toast(humanError(e));$('#caseModalContent').innerHTML=old;const retry=$('#openCaseBtn');if(retry)retry.onclick=openSelectedCase}finally{if(btn)btn.disabled=false}}
function renderCaseResults(){const grid=$('#caseResultGrid');if(!grid)return;const total=lastCaseDrops.filter(x=>!x.sold).reduce((a,x)=>a+Number(x.priceUSD||0),0),cost=Number(activeCase?.priceUSD||0)*lastCaseDrops.length,diff=total-cost,ratio=cost?total/cost:0;let label='СИЛЬНЫЙ НЕОКУП',cls='loss';if(ratio>=10){label='ДЖЕКПОТ',cls='jackpot'}else if(ratio>=2){label='БОЛЬШОЙ ОКУП',cls='bigwin'}else if(ratio>=1){label='ОКУП',cls='win'}else if(ratio>=.8){label='ПОЧТИ ОКУП',cls='near'}else if(ratio>=.4){label='НЕОКУП',cls='loss'}$('#caseResultTotal').innerHTML=`<div class="case-profit ${cls}"><strong>${label}</strong><span>Потрачено: ${fmt(cost)} · Выпало: ${fmt(total)} · ${diff>=0?'+':''}${fmt(diff)}</span></div>`;grid.innerHTML=lastCaseDrops.map((x,i)=>`<article class="drop-card ${x.selected?'selected':''} ${x.sold?'sold':''}" data-drop="${i}"><input class="drop-select" type="checkbox" ${x.selected?'checked':''} ${x.sold?'disabled':''}><img src="${esc(x.image)}"><h4>${esc(x.name)}</h4><b>${fmt(x.priceUSD)}</b><div class="drop-card-actions"><button class="ghost sell-drop" ${x.sold?'disabled':''}>${x.sold?'Продано':'Продать'}</button></div></article>`).join('');$$('.drop-card').forEach(e=>{const i=Number(e.dataset.drop),x=lastCaseDrops[i];e.querySelector('.drop-select').onchange=ev=>{x.selected=ev.target.checked;renderCaseResults()};e.querySelector('.sell-drop').onclick=()=>sellCaseDrops([i])})}
async function sellCaseDrops(indexes){const unsold=indexes.filter(i=>lastCaseDrops[i]&&!lastCaseDrops[i].sold);if(!unsold.length)return toast('Нечего продавать');const gain=unsold.reduce((a,i)=>a+Number(lastCaseDrops[i].priceUSD||0)*.9,0);try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),s=await tx.get(ref),d=s.data()||{};tx.update(ref,{balanceUSD:Number(d.balanceUSD||0)+gain})});unsold.forEach(i=>{lastCaseDrops[i].sold=true;lastCaseDrops[i].selected=false});renderCaseResults();toast(`Продано за ${fmt(gain)}`)}catch(e){toast(humanError(e))}}
async function keepCaseDrops(){const items=lastCaseDrops.filter(x=>!x.sold&&!x.kept);if(!items.length)return toast('Все предметы уже обработаны');await addPendingCaseDropsToInventory(false);close('caseResultModal');toast(`${items.length} предметов добавлено в инвентарь`)}
$$('[data-case-filter]').forEach(b=>b.addEventListener('click',()=>{$$('[data-case-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');const sel=$('#caseCategory');if(sel)sel.value=b.dataset.caseFilter;renderCases()}));
$('#caseSearch')?.addEventListener('input',renderCases);$('#caseCategory')?.addEventListener('change',renderCases);$('#caseSort')?.addEventListener('change',renderCases);$('#sellSelectedDrops')?.addEventListener('click',()=>sellCaseDrops(lastCaseDrops.map((x,i)=>x.selected?i:-1).filter(i=>i>=0)));$('#sellAllDrops')?.addEventListener('click',()=>{if(confirm('Продать все выпавшие предметы за 90% стоимости?'))sellCaseDrops(lastCaseDrops.map((_,i)=>i))});$('#keepAllDrops')?.addEventListener('click',keepCaseDrops);
const _renderTop=renderTop;renderTop=function(){_renderTop();renderCases()};renderCases();
$('#activatePromo')?.addEventListener('click',activatePromo);$('#createPromoBtn')?.addEventListener('click',createPromoFromAdmin);$('#addPromoItemBtn')?.addEventListener('click',addAdminPromoItem);$('#refreshPromosBtn')?.addEventListener('click',loadAdminPromos);

// V46: закрытие открытия/результатов безопасно сохраняет все необработанные предметы.
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-close]'),overlay=e.target.classList?.contains('modal')?e.target:null,id=b?.dataset.close||overlay?.id;if(id==='caseModal'&&caseOpening){caseAbortRequested=true;addPendingCaseDropsToInventory(true)}else if(id==='caseResultModal'){addPendingCaseDropsToInventory(true)}},true);
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const m=document.querySelector('.modal:not(.hidden)');if(m?.id==='caseModal'&&caseOpening){caseAbortRequested=true;addPendingCaseDropsToInventory(true)}else if(m?.id==='caseResultModal'){addPendingCaseDropsToInventory(true)}},true);

/* V51 — автоматический апгрейд и контракты */
let autoUpgradeRunning=false,autoUpgradeDone=0,autoUpgradeLimit=0;
function setAutoUpgradeUI(){
  const start=$('#autoUpgradeStart'),stop=$('#autoUpgradeStop'),out=$('#autoUpgradeProgress');
  if(start)start.disabled=autoUpgradeRunning;if(stop)stop.disabled=!autoUpgradeRunning;
  if(out)out.textContent=autoUpgradeRunning?`Выполнено: ${autoUpgradeDone}${autoUpgradeLimit?` / ${autoUpgradeLimit}`:' · до остановки'}`:'Авто выключено';
}
async function runAutoUpgrade(){
  if(autoUpgradeRunning)return;
  if(sourceItems.length)return toast('Автокрутка апгрейда работает со ставкой из баланса. Очисти выбранные предметы.');
  const amount=cashStakeUSD(),savedTarget=target?{...target}:null;
  if(!(amount>0)||!savedTarget)return toast('Введи ставку из баланса и выбери целевой предмет');
  autoUpgradeLimit=Number($('#autoUpgradeCount')?.value||5);autoUpgradeDone=0;autoUpgradeRunning=true;setAutoUpgradeUI();
  const delay=()=>Number($('#autoUpgradeDelay')?.value||1000);
  while(autoUpgradeRunning&&(autoUpgradeLimit===0||autoUpgradeDone<autoUpgradeLimit)){
    if(!infiniteMoney()&&Number(userDoc?.balanceUSD||0)<amount){toast('Автокрутка остановлена: не хватает виртуального баланса');break}
    target={...savedTarget};cashDraft=String(amount*rates[currency]).replace('.',',');lastOutcome=null;syncUpgrade();
    await startUpgrade();autoUpgradeDone++;setAutoUpgradeUI();
    if($('#autoStopWin')?.checked&&lastOutcome?.win){toast('Автокрутка остановлена после выигрыша');break}
    if(autoUpgradeRunning)await new Promise(r=>setTimeout(r,delay()));
  }
  autoUpgradeRunning=false;setAutoUpgradeUI();
}
$('#autoUpgradeToggle')?.addEventListener('click',()=>{const d=$('#autoUpgradeDrawer');d?.classList.toggle('collapsed');$('#autoUpgradeToggle')?.classList.toggle('active',!d?.classList.contains('collapsed'))});
$('#autoUpgradeStart')?.addEventListener('click',()=>{$('#autoUpgradeDrawer')?.classList.remove('collapsed');runAutoUpgrade()});
$('#autoUpgradeStop')?.addEventListener('click',()=>{autoUpgradeRunning=false;setAutoUpgradeUI();toast('Автокрутка остановлена')});
setAutoUpgradeUI();

let contractSelected=new Set(),contractRunning=false,contractDone=0,contractLimit=1,contractBatchSize=3;
function contractSelectedItems(){return inventory.filter(x=>contractSelected.has(inventoryKey(x))).slice(0,10)}
function renderContracts(){
  const grid=$('#contractInventory');if(!grid)return;
  const chosen=contractSelectedItems();
  $('#contractTotal').textContent=fmt(chosen.reduce((s,x)=>s+Number(x.priceUSD||0),0));
  $('#contractProgress').textContent=contractRunning?`Контрактов: ${contractDone}${contractLimit?` / ${contractLimit}`:' · до остановки'}`:`Выбрано ${chosen.length} из 10`;const cc=$('#contractSelectedCount');if(cc)cc.textContent=`${chosen.length} / 10`;
  $('#contractStart').disabled=contractRunning||chosen.length<3||chosen.length>10;$('#contractStop').disabled=!contractRunning;
  grid.innerHTML=inventory.map(x=>card(x,'picker')).join('')||'<div class="empty-state">Инвентарь пуст</div>';
  $$('#contractInventory .skin-card').forEach(el=>{
    const id=String(el.dataset.id),item=inventory.find(x=>inventoryKey(x)===id);el.classList.toggle('selected',contractSelected.has(id));
    const toggle=()=>{if(contractRunning)return;if(contractSelected.has(id))contractSelected.delete(id);else if(contractSelected.size<10)contractSelected.add(id);else return toast('Можно выбрать максимум 10 предметов');renderContracts()};
    el.querySelector('.pick')?.addEventListener('click',e=>{e.stopPropagation();toggle()});el.addEventListener('click',e=>{if(!e.target.closest('.fav-btn,.pick'))toggle()});
    el.querySelector('.pick').textContent=contractSelected.has(id)?'Убрать':'Выбрать';
  });
}
function pickContractOutput(total){
  const r=Math.random();let mult;
  if(r<.50)mult=.35+Math.random()*.45;else if(r<.84)mult=.8+Math.random()*.35;else if(r<.97)mult=1.15+Math.random()*.85;else mult=2+Math.random()*2;
  const wanted=Math.max(.01,total*mult),pool=skins.filter(x=>Number(x.priceUSD)>0);
  return pool.sort((a,b)=>Math.abs(Number(a.priceUSD)-wanted)-Math.abs(Number(b.priceUSD)-wanted))[0]||pool[0];
}
async function animateContract(result,pool){
  const track=$('#contractTrack');if(!track)return;const list=[];for(let i=0;i<24;i++)list.push(pool[Math.floor(Math.random()*pool.length)]||result);list[19]=result;
  track.style.transition='none';track.style.transform='translateX(0)';track.innerHTML=list.map(x=>`<div class="contract-roll-item"><img src="${esc(x.image)}"><b>${esc(x.name)}</b><small>${fmt(x.priceUSD)}</small></div>`).join('');
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const itemW=152,box=$('#contractRoulette').clientWidth;track.style.transition='transform 3.2s cubic-bezier(.12,.72,.12,1)';track.style.transform=`translateX(${-19*itemW+box/2-itemW/2}px)`;await new Promise(r=>setTimeout(r,3300));
}
async function executeContract(items){
  const ids=new Set(items.map(inventoryKey)),total=items.reduce((s,x)=>s+Number(x.priceUSD||0),0),chosen={...pickContractOutput(total),uid:safeUUID(),obtainedAt:Date.now(),contractValueUSD:total};
  const pool=skins.filter(x=>Number(x.priceUSD)>0).slice(0,200);await animateContract(chosen,pool);
  await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');const d=snap.data()||{},inv=Array.isArray(d.inventory)?d.inventory:[];if(items.some(x=>!inv.some(i=>inventoryKey(i)===inventoryKey(x))))throw new Error('Один из выбранных предметов уже отсутствует');const next=inv.filter(x=>!ids.has(inventoryKey(x)));next.unshift(chosen);const ch=Array.isArray(d.contractHistory)?d.contractHistory:[];tx.update(ref,{inventory:next,contractHistory:[{id:safeUUID(),createdAt:Date.now(),sources:items,result:chosen,totalUSD:total},...ch].slice(0,50)})});
  toast(`Контракт готов: ${chosen.name} · ${fmt(chosen.priceUSD)}`);return chosen;
}
async function startContracts(){
  if(contractRunning)return;contractLimit=Number($('#contractAutoCount')?.value||1);contractDone=0;contractBatchSize=contractSelectedItems().length;if(contractBatchSize<3||contractBatchSize>10)return toast('Выбери от 3 до 10 предметов');contractRunning=true;renderContracts();
  try{while(contractRunning&&(contractLimit===0||contractDone<contractLimit)){
    let items=contractSelectedItems();if(items.length!==contractBatchSize){items=[...inventory].sort((a,b)=>Number(a.priceUSD)-Number(b.priceUSD)).slice(0,contractBatchSize)}
    if(items.length<contractBatchSize){toast('Автоконтракт остановлен: недостаточно предметов');break}
    await executeContract(items);contractDone++;contractSelected.clear();renderContracts();await new Promise(r=>setTimeout(r,900));
  }}catch(e){toast(humanError(e))}finally{contractRunning=false;renderContracts()}
}
$('#contractStart')?.addEventListener('click',startContracts);$('#contractStop')?.addEventListener('click',()=>{contractRunning=false;renderContracts();toast('Автоконтракт остановлен')});$('#contractClear')?.addEventListener('click',()=>{if(contractRunning)return;contractSelected.clear();renderContracts()});
const _renderAllV51=renderAll;renderAll=function(){_renderAllV51();renderContracts()};
renderContracts();


/* V59 — режимы, осмотр, события */
function openInspect(item){if(!item)return;$('#inspectContent').innerHTML=`<div class="inspect-view"><img src="${esc(item.image)}"><div><span class="eyebrow">ОСМОТР СКИНА</span><h2>${esc(item.name)}</h2><p>${esc(item.wear||item.categoryLabel||'Предмет CS2')}</p><b>${fmt(Number(item.priceUSD||0))}</b><small>${esc(item.priceSource||'Виртуальная оценка')}</small></div></div>`;open('inspectModal')}
function modeCaseOptions(){return CASES.filter(c=>c.priceUSD<=500).map(c=>`<option value="${c.slug}">${esc(c.name)} — ${fmt(c.priceUSD)}</option>`).join('')}
function renderModes(){if(!$('#battleCase'))return;$('#battleCase').innerHTML=modeCaseOptions();$('#modeInventory').innerHTML=inventory.map(x=>`<option value="${esc(inventoryKey(x))}">${esc(x.name)} — ${fmt(x.priceUSD)}</option>`).join('')||'<option value="">Инвентарь пуст</option>';}
async function withModeBusy(buttonId,fn){const btn=$(buttonId),card=btn?.closest('.mode-card');if(btn?.disabled)return;try{if(btn)btn.disabled=true;card?.classList.add('busy');await fn()}catch(e){console.error(e);toast(humanError(e))}finally{if(btn)btn.disabled=false;card?.classList.remove('busy')}}
async function playBattle(){return withModeBusy('#battlePlay',async()=>{const c=CASES.find(x=>x.slug===$('#battleCase')?.value);if(!c)throw new Error('Выбери кейс');const cost=Number(c.priceUSD||0);if(Number(userDoc?.balanceUSD||0)<cost)throw new Error('Недостаточно баланса');const pool=casePool(c);if(!pool.length)throw new Error('Для этого кейса не найден дроп');const mine=weightedDrop(pool,c),bot=weightedDrop(pool,c);const draw=Math.abs(Number(mine.priceUSD)-Number(bot.priceUSD))<.001,win=!draw&&Number(mine.priceUSD)>Number(bot.priceUSD);await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');const d=snap.data()||{},bal=Number(d.balanceUSD||0),inv=Array.isArray(d.inventory)?d.inventory:[];if(bal<cost)throw new Error('Недостаточно баланса');let prize=[];if(win)prize=[mine,bot];else if(draw)prize=[mine];prize=prize.map(x=>({...x,uid:safeUUID(),obtainedAt:Date.now(),source:'battle'}));tx.update(ref,{balanceUSD:bal-cost,inventory:[...prize,...inv].slice(0,500)})});$('#battleResult').innerHTML=`<div class="duel-result"><div><b>Ты</b><img src="${esc(mine.image)}"><span>${esc(mine.name)} · ${fmt(mine.priceUSD)}</span></div><strong>${draw?'НИЧЬЯ':win?'ПОБЕДА':'ПОРАЖЕНИЕ'}</strong><div><b>Бот</b><img src="${esc(bot.image)}"><span>${esc(bot.name)} · ${fmt(bot.priceUSD)}</span></div></div><div class="mode-result">${win?'Оба предмета добавлены в инвентарь':draw?'Твой предмет возвращён в инвентарь':'Бот забрал банк'}</div>`;renderModes()})}
async function playJackpot(){return withModeBusy('#jackpotPlay',async()=>{const key=$('#modeInventory')?.value,item=inventory.find(x=>inventoryKey(x)===key);if(!item)throw new Error('Выбери предмет из инвентаря');const itemPrice=Math.max(.01,Number(item.priceUSD||0)),botBank=Math.max(5,Math.round(itemPrice*(1.2+Math.random()*2.8)*100)/100),chance=itemPrice/(itemPrice+botBank),won=Math.random()<chance;await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');const d=snap.data()||{},inv=Array.isArray(d.inventory)?[...d.inventory]:[],idx=inv.findIndex(x=>inventoryKey(x)===key);if(idx<0)throw new Error('Предмет уже отсутствует');inv.splice(idx,1);tx.update(ref,{inventory:inv,balanceUSD:Number(d.balanceUSD||0)+(won?itemPrice+botBank:0)})});$('#jackpotResult').innerHTML=`<div class="mode-result ${won?'win':'loss'}"><b>${won?'ПОБЕДА':'ПОРАЖЕНИЕ'}</b><br>${won?'Ты выиграл банк '+fmt(itemPrice+botBank):'Банк стоимостью '+fmt(itemPrice+botBank)+' забрал бот'}<br>Твой шанс: ${(chance*100).toFixed(1)}%</div>`;renderModes()})}
async function spinBonusWheel(){return withModeBusy('#wheelPlay',async()=>{const cost=10;if(Number(userDoc?.balanceUSD||0)<cost)throw new Error('Нужно '+fmt(cost));const prizes=[0,2,5,10,15,25,50,100],weights=[25,22,18,14,10,6,4,1];let r=Math.random()*weights.reduce((a,b)=>a+b,0),prize=0;for(let i=0;i<prizes.length;i++){r-=weights[i];if(r<=0){prize=prizes[i];break}}await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');const d=snap.data()||{},bal=Number(d.balanceUSD||0);if(bal<cost)throw new Error('Недостаточно баланса');tx.update(ref,{balanceUSD:bal-cost+prize})});const w=$('#bonusWheel');if(w){w.style.transition='none';w.style.transform='rotate(0deg)';void w.offsetWidth;w.style.transition='transform 1.2s cubic-bezier(.12,.72,.12,1)';w.style.transform=`rotate(${1440+Math.floor(Math.random()*360)}deg)`}await new Promise(r=>setTimeout(r,1250));$('#wheelResult').innerHTML=prize?`<b>Выигрыш: ${fmt(prize)}</b><br>Стоимость прокрутки: ${fmt(cost)}`:`<b>Без приза</b><br>Стоимость прокрутки: ${fmt(cost)}`})}
$('#battlePlay')?.addEventListener('click',playBattle);$('#jackpotPlay')?.addEventListener('click',playJackpot);$('#wheelPlay')?.addEventListener('click',spinBonusWheel);$('#caseFavoriteOnly')?.addEventListener('click',e=>{e.currentTarget.classList.toggle('active');renderCases()});
const _renderInventoryV59=renderInventory;renderInventory=function(){_renderInventoryV59();renderModes()};


/* V65 — crystals, daily rewards and achievements */
const V65_DAY=24*60*60*1000;
const V65_ACHIEVEMENTS=[
  {id:'first_upgrade',title:'Первый апгрейд',desc:'Сделай хотя бы 1 апгрейд',moneyUSD:250,crystals:1,ok:()=>Number(profile?.stats?.spins||0)>=1},
  {id:'first_win',title:'Первая победа',desc:'Выиграй первый апгрейд',moneyUSD:500,crystals:1,ok:()=>Number(profile?.stats?.wins||0)>=1},
  {id:'ten_wins',title:'Опытный апгрейдер',desc:'Выиграй 10 апгрейдов',moneyUSD:1500,crystals:3,ok:()=>Number(profile?.stats?.wins||0)>=10},
  {id:'first_knife',title:'Первый нож',desc:'Получи нож в инвентарь',moneyUSD:2500,crystals:5,ok:()=>inventory.some(x=>itemBadgeMeta(x)[0]==='Нож')},
  {id:'rich_inventory',title:'Коллекционер',desc:'Собери инвентарь на 100 000 ₴',moneyUSD:3000,crystals:5,ok:()=>inventory.reduce((a,x)=>a+Number(x.priceUSD||0),0)*rates.UAH>=100000}
];
function crystalsCount(){return Math.max(0,Math.floor(Number(userDoc?.crystals||0)))}
function renderV65Rewards(){
  const crystal=$('#crystalCount');if(crystal)crystal.textContent=crystalsCount();
  const daily=$('#dailyRewardState');if(daily){const left=Math.max(0,V65_DAY-(Date.now()-Number(userDoc?.lastDailyRewardAt||0)));daily.textContent=left?`Следующая награда через ${Math.ceil(left/3600000)} ч.`:'Награда готова';}
  const box=$('#achievementsList');if(box){const claimed=userDoc?.achievements||{};box.innerHTML=V65_ACHIEVEMENTS.map(a=>{const done=Boolean(claimed[a.id]),ready=!done&&a.ok();return `<div class="achievement-row ${done?'done':ready?'ready':''}"><div><b>${done?'✓ ':''}${esc(a.title)}</b><small>${esc(a.desc)} · ${fmt(a.moneyUSD)} + 💎 ${a.crystals}</small></div><button data-claim-achievement="${a.id}" ${done||!ready?'disabled':''}>${done?'Получено':ready?'Забрать':'Не выполнено'}</button></div>`}).join('');box.querySelectorAll('[data-claim-achievement]').forEach(b=>b.onclick=()=>claimAchievement(b.dataset.claimAchievement));}
}
async function claimDailyReward(){
  if(isSandbox())return toast('Ежедневная награда доступна только в обычном режиме');
  try{let reward=null;await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');const d=snap.data()||{},now=Date.now(),last=Number(d.lastDailyRewardAt||0);if(now-last<V65_DAY)throw new Error('Ежедневная награда уже получена');const moneyUSD=(10000+Math.floor(Math.random()*40001))/rates.UAH;const crystals=Math.random()<.25?1+Math.floor(Math.random()*3):0;reward={moneyUSD,crystals};tx.update(ref,{balanceUSD:Number(d.balanceUSD||0)+moneyUSD,crystals:Number(d.crystals||0)+crystals,lastDailyRewardAt:now})});toast(`Ежедневная награда: ${fmt(reward.moneyUSD)}${reward.crystals?` и 💎 ${reward.crystals}`:''}`)}catch(e){toast(humanError(e))}
}
async function claimAchievement(id){
  const a=V65_ACHIEVEMENTS.find(x=>x.id===id);if(!a||!a.ok())return toast('Условие ещё не выполнено');
  try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');const d=snap.data()||{},claimed=d.achievements||{};if(claimed[id])throw new Error('Награда уже получена');tx.update(ref,{balanceUSD:Number(d.balanceUSD||0)+a.moneyUSD,crystals:Number(d.crystals||0)+a.crystals,achievements:{...claimed,[id]:Date.now()}})});toast(`Достижение: ${a.title} · ${fmt(a.moneyUSD)} + 💎 ${a.crystals}`)}catch(e){toast(humanError(e))}
}
$('#claimDailyReward')?.addEventListener('click',claimDailyReward);


/* V65.1 — crystal shop */
const CRYSTAL_SHOP_PRODUCTS=[
  {id:'cash25',icon:'💰',title:'25 000 ₴',desc:'Моментально пополняет обычный баланс на 25 000 ₴.',cost:2,type:'cash',moneyUSD:25000/rates.UAH},
  {id:'starter',icon:'🔵',title:'Случайный предмет',desc:'Гарантированный предмет примерной стоимостью от 200 до 1 200 ₴.',cost:5,type:'item',minUSD:5,maxUSD:30},
  {id:'premium',icon:'🟣',title:'Premium-предмет',desc:'Гарантированный дорогой предмет примерной стоимостью от 2 000 до 10 000 ₴.',cost:15,type:'item',minUSD:50,maxUSD:250},
  {id:'knife',icon:'🔪',title:'Нож или перчатки',desc:'Гарантированный нож либо перчатки из доступного каталога.',cost:40,type:'special'}
];
function crystalShopPool(product){
  const priced=skins.filter(x=>Number(x.priceUSD||0)>0&&x.image);
  if(product.type==='special'){
    const special=priced.filter(x=>x.category==='knife'||x.category==='glove'||/knife|gloves?/i.test(String(x.name||'')));
    return special.length?special:priced.sort((a,b)=>Number(b.priceUSD||0)-Number(a.priceUSD||0)).slice(0,50);
  }
  return priced.filter(x=>Number(x.priceUSD)>=Number(product.minUSD||0)&&Number(x.priceUSD)<=Number(product.maxUSD||Infinity));
}
function renderCrystalShop(){
  const count=crystalsCount();
  const top=$('#shopCrystalCount');if(top)top.textContent=count;
  const grid=$('#crystalShopGrid');if(!grid)return;
  grid.innerHTML=CRYSTAL_SHOP_PRODUCTS.map(p=>`<article class="crystal-product"><div class="crystal-product-icon">${p.icon}</div><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p><b class="shop-price">💎 ${p.cost}</b><button class="upgrade-btn" type="button" data-buy-crystal="${p.id}" ${count<p.cost?'disabled':''}>${count<p.cost?'Не хватает кристаллов':'Купить'}</button></article>`).join('');
  grid.querySelectorAll('[data-buy-crystal]').forEach(b=>b.onclick=()=>buyCrystalProduct(b.dataset.buyCrystal,b));
}
async function buyCrystalProduct(id,button){
  const product=CRYSTAL_SHOP_PRODUCTS.find(x=>x.id===id);if(!product)return;
  if(isSandbox())return toast('Магазин за кристаллы доступен только в обычном режиме');
  if(!confirm(`Купить «${product.title}» за 💎 ${product.cost}?`))return;
  let rewardItem=null;
  if(product.type!=='cash'){
    const pool=crystalShopPool(product);if(!pool.length)return toast('Подходящие предметы ещё не загрузились');
    const base=pool[Math.floor(Math.random()*pool.length)];
    rewardItem={...base,uid:safeUUID(),obtainedAt:Date.now(),source:'crystal-shop'};
  }
  try{
    button.disabled=true;button.textContent='Покупка…';
    await runTransaction(db,async tx=>{
      const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');
      const d=snap.data()||{},have=Math.max(0,Math.floor(Number(d.crystals||0)));if(have<product.cost)throw new Error('Недостаточно кристаллов');
      const patch={crystals:have-product.cost,crystalPurchases:Number(d.crystalPurchases||0)+1,lastCrystalPurchaseAt:Date.now()};
      if(product.type==='cash')patch.balanceUSD=Number(d.balanceUSD||0)+Number(product.moneyUSD||0);
      else patch.inventory=[rewardItem,...(Array.isArray(d.inventory)?d.inventory:[])].slice(0,500);
      tx.update(ref,patch);
    });
    toast(product.type==='cash'?`Получено ${fmt(product.moneyUSD)}`:`Получено: ${rewardItem.name} · ${fmt(rewardItem.priceUSD)}`);
  }catch(e){toast(humanError(e))}finally{button.disabled=false;renderCrystalShop()}
}
const _renderAllV651=renderAll;renderAll=function(){_renderAllV651();renderCrystalShop()};
renderCrystalShop();


/* V66 — full crystal shop, cosmetics and boosters */
let V66_SHOP_TAB='cases';
const V66_PRODUCTS={
 cases:[
  {id:'case_premium',icon:'🟣',title:'Premium Case',desc:'Редкий предмет из дорогого пула.',cost:10,type:'case',pool:'premium'},
  {id:'case_knife',icon:'🔪',title:'Knife Case',desc:'Шанс получить нож; при нехватке пула — дорогой предмет.',cost:30,type:'case',pool:'knife'},
  {id:'case_gloves',icon:'🧤',title:'Gloves Case',desc:'Гарантированные перчатки из каталога.',cost:30,type:'case',pool:'glove'},
  {id:'case_secret',icon:'🌌',title:'Secret Case',desc:'Один из самых дорогих предметов каталога.',cost:60,type:'case',pool:'secret'}
 ],
 boosters:[
  {id:'boost_lucky',icon:'🍀',title:'+5% к шансу',desc:'Добавляет 5 процентных пунктов к следующему апгрейду.',cost:8,type:'booster',key:'lucky'},
  {id:'boost_insurance',icon:'🛡️',title:'Защита ставки',desc:'При следующем проигрыше ставка полностью возвращается.',cost:18,type:'booster',key:'insurance'},
  {id:'boost_daily',icon:'🎁',title:'Бонусные 50 000 ₴',desc:'Моментально добавляет 50 000 ₴ на основной баланс.',cost:4,type:'cash',moneyUSD:50000/rates.UAH}
 ],
 custom:[
  {id:'theme_neon',icon:'💚',title:'Neon Lime',desc:'Яркая зелёная тема интерфейса.',cost:12,type:'cosmetic',key:'neon'},
  {id:'theme_ice',icon:'🧊',title:'Crystal Ice',desc:'Холодная голубая тема интерфейса.',cost:12,type:'cosmetic',key:'ice'},
  {id:'theme_gold',icon:'👑',title:'Royal Gold',desc:'Золотая премиальная тема.',cost:20,type:'cosmetic',key:'gold'}
 ],
 exclusive:[
  {id:'exclusive_knife',icon:'⭐🔪',title:'Эксклюзивный нож',desc:'Случайный нож из верхней части каталога.',cost:75,type:'item',pool:'knife'},
  {id:'exclusive_glove',icon:'⭐🧤',title:'Эксклюзивные перчатки',desc:'Случайные дорогие перчатки.',cost:65,type:'item',pool:'glove'},
  {id:'exclusive_top',icon:'💠',title:'Legendary Drop',desc:'Случайный предмет из TOP-25 по цене.',cost:100,type:'item',pool:'secret'}
 ]
};
function v66Pool(kind){
 const all=skins.filter(x=>Number(x.priceUSD||0)>0&&x.image);
 const byPrice=[...all].sort((a,b)=>Number(b.priceUSD||0)-Number(a.priceUSD||0));
 if(kind==='knife')return all.filter(x=>x.category==='knife'||/knife/i.test(x.name||''));
 if(kind==='glove')return all.filter(x=>x.category==='glove'||/gloves?/i.test(x.name||''));
 if(kind==='premium')return all.filter(x=>Number(x.priceUSD||0)>=50).slice(0,800);
 if(kind==='secret')return byPrice.slice(0,25);
 return all;
}
function v66ApplyCosmetics(){
 const active=userDoc?.cosmetics?.activeTheme||'';
 document.documentElement.dataset.shopTheme=active;
}
function v66OwnedText(p){
 if(p.type==='booster')return `В запасе: ${Number(userDoc?.boosters?.[p.key]||0)}`;
 if(p.type==='cosmetic')return (userDoc?.cosmetics?.owned||[]).includes(p.key)?((userDoc?.cosmetics?.activeTheme||'')===p.key?'Активно':'Куплено'):'';
 return '';
}
renderCrystalShop=function(){
 v66ApplyCosmetics();
 const count=crystalsCount(),top=$('#shopCrystalCount');if(top)top.textContent=count;
 $$('#shopTabs [data-shop-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.shopTab===V66_SHOP_TAB);b.onclick=()=>{V66_SHOP_TAB=b.dataset.shopTab;renderCrystalShop()}});
 const boosts=userDoc?.boosters||{};const st=$('#shopStatus');if(st)st.innerHTML=`<span>🍀 +5%: <b>${Number(boosts.lucky||0)}</b></span><span>🛡 Защита: <b>${Number(boosts.insurance||0)}</b></span><span>Тема: <b>${esc(userDoc?.cosmetics?.activeTheme||'стандартная')}</b></span>`;
 const grid=$('#crystalShopGrid');if(!grid)return;const products=V66_PRODUCTS[V66_SHOP_TAB]||[];
 grid.innerHTML=products.map(p=>{const owned=v66OwnedText(p);const isOwned=p.type==='cosmetic'&&(userDoc?.cosmetics?.owned||[]).includes(p.key);const active=isOwned&&(userDoc?.cosmetics?.activeTheme||'')===p.key;const label=p.type==='case'?'Открыть':active?'Активно':isOwned?'Применить':'Купить';return `<article class="crystal-product v66-${p.type} ${active?'is-active':''}">${p.type==='cosmetic'?`<div class="theme-preview theme-${p.key}"><i></i><i></i><i></i></div>`:`<div class="crystal-product-icon">${p.icon}</div>`}<div class="product-kicker">${p.type==='cosmetic'?'ТЕМА ИНТЕРФЕЙСА':p.type==='booster'?'УСИЛИТЕЛЬ':p.type==='case'?'КРИСТАЛЬНЫЙ КЕЙС':'ЭКСКЛЮЗИВ'}</div><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p>${owned?`<small class="owned-label">${esc(owned)}</small>`:''}<div class="product-footer"><b class="shop-price">${isOwned?'Куплено':`💎 ${p.cost}`}</b><button class="upgrade-btn" data-v66-buy="${p.id}" ${(count<p.cost&&!isOwned)||active?'disabled':''}>${label}</button></div></article>`}).join('');
 grid.querySelectorAll('[data-v66-buy]').forEach(b=>b.onclick=()=>v66Buy(b.dataset.v66Buy,b));
};
async function v66Buy(id,button){
 const p=Object.values(V66_PRODUCTS).flat().find(x=>x.id===id);if(!p)return;if(isSandbox())return toast('Магазин доступен только в обычном режиме');
 const owned=(userDoc?.cosmetics?.owned||[]).includes(p.key);
 if(p.type==='cosmetic'&&owned){await updateDoc(doc(db,'users',user.uid),{'cosmetics.activeTheme':p.key});toast('Тема применена');return}
 if(!confirm(`${p.type==='case'?'Открыть':'Купить'} «${p.title}» за 💎 ${p.cost}?`))return;
 let reward=null;if(p.pool){const pool=v66Pool(p.pool);if(!pool.length)return toast('В каталоге пока нет подходящих предметов');const base=pool[Math.floor(Math.random()*pool.length)];reward={...base,uid:safeUUID(),obtainedAt:Date.now(),source:'crystal-shop-v66'} }
 try{button.disabled=true;button.textContent='Подождите…';await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),s=await tx.get(ref);if(!s.exists())throw new Error('Профиль не найден');const d=s.data()||{},have=Number(d.crystals||0);if(have<p.cost)throw new Error('Недостаточно кристаллов');const patch={crystals:have-p.cost,lastCrystalPurchaseAt:Date.now()};if(reward)patch.inventory=[reward,...(Array.isArray(d.inventory)?d.inventory:[])].slice(0,500);if(p.type==='cash')patch.balanceUSD=Number(d.balanceUSD||0)+Number(p.moneyUSD||0);if(p.type==='booster')patch.boosters={...(d.boosters||{}),[p.key]:Number(d.boosters?.[p.key]||0)+1};if(p.type==='cosmetic')patch.cosmetics={...(d.cosmetics||{}),owned:[...new Set([...(d.cosmetics?.owned||[]),p.key])],activeTheme:p.key};tx.update(ref,patch)});toast(reward?`Выпало: ${reward.name} · ${fmt(reward.priceUSD)}`:`Покупка «${p.title}» выполнена`)}catch(e){toast(humanError(e))}finally{renderCrystalShop()}
}
const _renderAllV66=renderAll;renderAll=function(){_renderAllV66();v66ApplyCosmetics();renderCrystalShop()};


/* V73 — season pass */
const BATTLE_PASS_COST=100;
const BATTLE_PASS_XP_PER_LEVEL=100;
const BATTLE_PASS_LEVELS=[
 {free:{crystals:2},premium:{crystals:5}}, {free:{moneyUSD:300},premium:{moneyUSD:1200}},
 {free:{moneyUSD:450},premium:{crystals:7}}, {free:{crystals:3},premium:{moneyUSD:1800}},
 {free:{moneyUSD:650},premium:{crystals:8}}, {free:{moneyUSD:800},premium:{moneyUSD:2600}},
 {free:{crystals:4},premium:{crystals:10}}, {free:{moneyUSD:1100},premium:{moneyUSD:3400}},
 {free:{moneyUSD:1400},premium:{crystals:12}}, {free:{crystals:5,moneyUSD:1800},premium:{moneyUSD:4500,crystals:15}},
 {free:{moneyUSD:2000},premium:{crystals:8}}, {free:{crystals:4},premium:{moneyUSD:5200}},
 {free:{moneyUSD:2400},premium:{crystals:12}}, {free:{moneyUSD:2800},premium:{moneyUSD:6500}},
 {free:{crystals:5},premium:{crystals:15}}, {free:{moneyUSD:3200},premium:{moneyUSD:7800}},
 {free:{moneyUSD:3800},premium:{crystals:18}}, {free:{crystals:6},premium:{moneyUSD:9000}},
 {free:{moneyUSD:4500},premium:{crystals:25}}, {free:{moneyUSD:7000,crystals:10},premium:{moneyUSD:15000,crystals:30}}
];
function bpRewardText(r){return [r.moneyUSD?fmt(r.moneyUSD):'',r.crystals?`💎 ${r.crystals}`:''].filter(Boolean).join(' + ')}
function renderBattlePass(){
 const box=$('#battlePassTrack');if(!box)return;
 const bp=userDoc?.battlePass||{},xp=Math.max(0,Number(bp.xp||0)),max=BATTLE_PASS_LEVELS.length,level=Math.min(max,Math.floor(xp/BATTLE_PASS_XP_PER_LEVEL)+1),progress=level>=max?100:xp%BATTLE_PASS_XP_PER_LEVEL;
 const premium=bp.premium===true,freeClaimed=new Set(Array.isArray(bp.claimedFree)?bp.claimedFree.map(Number):[]),premiumClaimed=new Set(Array.isArray(bp.claimedPremium)?bp.claimedPremium.map(Number):[]);
 $('#bpLevel').textContent=`Уровень ${level} из ${max}`;$('#bpXpText').textContent=level>=max?`${xp} XP · сезон пройден`:`${xp%BATTLE_PASS_XP_PER_LEVEL} / ${BATTLE_PASS_XP_PER_LEVEL} XP`;$('#bpProgress').style.width=progress+'%';
 const buy=$('#buyBattlePass');buy.textContent=premium?'✓ PREMIUM открыт':`Открыть PREMIUM за 💎 ${BATTLE_PASS_COST}`;buy.disabled=premium;
 box.innerHTML=BATTLE_PASS_LEVELS.map((rw,i)=>{const n=i+1,reached=xp>=i*BATTLE_PASS_XP_PER_LEVEL,fc=freeClaimed.has(n),pc=premiumClaimed.has(n);return `<article class="bp-stage ${reached?'reached':''}"><div class="bp-node"><span>${n}</span><small>${i*BATTLE_PASS_XP_PER_LEVEL} XP</small></div><div class="bp-lane free ${fc?'claimed':''} ${!reached?'locked':''}"><strong>${bpRewardText(rw.free)}</strong><button data-bp-claim="free:${n}" ${!reached||fc?'disabled':''}>${fc?'✓':'Забрать'}</button></div><div class="bp-lane premium ${pc?'claimed':''} ${!reached||!premium?'locked':''}"><strong>${bpRewardText(rw.premium)}</strong><button data-bp-claim="premium:${n}" ${!reached||!premium||pc?'disabled':''}>${pc?'✓':premium?'Забрать':'🔒'}</button></div></article>`}).join('');
 box.querySelectorAll('[data-bp-claim]').forEach(b=>b.onclick=()=>claimBattlePassReward(b.dataset.bpClaim));
 const current=box.querySelector('.bp-stage.reached:last-of-type');if(current&&!box.dataset.initialScroll){current.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});box.dataset.initialScroll='1'}
}
async function buyBattlePass(){if(!user)return;try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');const d=snap.data()||{},bp=d.battlePass||{},cr=Number(d.crystals||0);if(bp.premium)throw new Error('Пропуск уже открыт');if(cr<BATTLE_PASS_COST)throw new Error('Недостаточно кристаллов');tx.update(ref,{crystals:cr-BATTLE_PASS_COST,battlePass:{...bp,premium:true}})});toast('🎫 PREMIUM-дорожка открыта')}catch(e){toast(humanError(e))}}
async function claimBattlePassReward(key){const [track,nRaw]=String(key).split(':'),n=Number(nRaw),reward=BATTLE_PASS_LEVELS[n-1]?.[track];if(!reward||!user)return;try{await runTransaction(db,async tx=>{const ref=doc(db,'users',user.uid),snap=await tx.get(ref);if(!snap.exists())throw new Error('Профиль не найден');const d=snap.data()||{},bp=d.battlePass||{},xp=Number(bp.xp||0);if(xp<(n-1)*BATTLE_PASS_XP_PER_LEVEL)throw new Error('Уровень ещё не открыт');if(track==='premium'&&bp.premium!==true)throw new Error('Нужен PREMIUM');const field=track==='premium'?'claimedPremium':'claimedFree',claimed=Array.isArray(bp[field])?bp[field].map(Number):[];if(claimed.includes(n))throw new Error('Награда уже получена');tx.update(ref,{balanceUSD:Number(d.balanceUSD||0)+Number(reward.moneyUSD||0),crystals:Number(d.crystals||0)+Number(reward.crystals||0),battlePass:{...bp,[field]:[...claimed,n]}})});toast('Награда получена')}catch(e){toast(humanError(e))}}
$('#buyBattlePass')?.addEventListener('click',buyBattlePass);
const _renderAllV72=renderAll;renderAll=function(){_renderAllV72();renderBattlePass()};

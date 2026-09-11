const API = "https://graphql.anilist.co";
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> toastEl.classList.remove('show'), 3200);
}

async function gql(query, variables){
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if(!res.ok) throw new Error('AniList request failed');
  const json = await res.json();
  if(json.errors) throw new Error(json.errors[0]?.message || 'AniList error');
  return json.data;
}

function fmtTitle(t){ return t.english || t.romaji || t.native || 'Untitled'; }

function timeUntil(ts){
  const diff = ts*1000 - Date.now();
  if(diff <= 0) return 'airing now';
  const mins = Math.floor(diff/60000);
  const days = Math.floor(mins/1440);
  const hours = Math.floor((mins%1440)/60);
  const m = mins%60;
  if(days > 0) return days + 'd ' + hours + 'h';
  if(hours > 0) return hours + 'h ' + m + 'm';
  return m + 'm';
}

/* ---------------- watchlist storage ---------------- */
let watchlist = {}; // id -> {id,title,cover,siteUrl}
async function loadWatchlist(){
  try{
    const raw = localStorage.getItem('seasonwatch_watchlist');
    watchlist = raw ? JSON.parse(raw) : {};
  }catch(e){ watchlist = {}; }
  renderWatchlist();
}
async function saveWatchlist(){
  try{ localStorage.setItem('seasonwatch_watchlist', JSON.stringify(watchlist)); }
  catch(e){ console.error('storage save failed', e); }
}
function isWatched(id){ return !!watchlist[id]; }
async function toggleWatch(media, btnEl){
  const id = media.id;
  if(watchlist[id]){
    delete watchlist[id];
    toast(fmtTitle(media.title) + ' removed from watchlist');
  } else {
    watchlist[id] = { id, title: fmtTitle(media.title), cover: media.coverImage?.large || '', siteUrl: media.siteUrl || '' };
    toast(fmtTitle(media.title) + ' added — you\\'ll be notified when it airs');
  }
  document.querySelectorAll('.star[data-id="'+id+'"]').forEach(el=>{
    el.classList.toggle('active', !!watchlist[id]);
    el.textContent = watchlist[id] ? '★' : '☆';
  });
  await saveWatchlist();
  renderWatchlist();
}
function renderWatchlist(){
  const body = document.getElementById('watchlistBody');
  const sub = document.getElementById('watchlistSub');
  const items = Object.values(watchlist);
  if(items.length === 0){
    body.innerHTML = '<div class="empty">Nothing tracked yet.</div>';
    sub.textContent = 'Star a series anywhere on the page to add it here';
    return;
  }
  sub.textContent = items.length + ' series tracked';
  body.innerHTML = items.map(it => `
    <div class="watch-row">
      <img src="${it.cover}" alt="">
      <div class="wtitle">${it.title}</div>
      <div class="wmeta">tracked</div>
      <button class="remove-btn" data-remove="${it.id}">Remove</button>
    </div>
  `).join('');
  body.querySelectorAll('[data-remove]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-remove');
      const title = watchlist[id]?.title;
      delete watchlist[id];
      await saveWatchlist();
      renderWatchlist();
      document.querySelectorAll('.star[data-id="'+id+'"]').forEach(el=>{
        el.classList.remove('active'); el.textContent = '☆';
      });
      if(title) toast(title + ' removed from watchlist');
    });
  });
}

/* ---------------- notifications ---------------- */
let notifPermission = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
const notifyBtn = document.getElementById('notifyBtn');
function refreshNotifBtn(){
  if(notifPermission === 'granted'){
    notifyBtn.textContent = 'Notifications on'; notifyBtn.classList.add('on');
  } else {
    notifyBtn.textContent = 'Turn on notifications'; notifyBtn.classList.remove('on');
  }
}
refreshNotifBtn();
notifyBtn.addEventListener('click', async ()=>{
  if(typeof Notification === 'undefined'){ toast('Notifications aren\\'t supported in this browser'); return; }
  if(Notification.permission === 'granted'){ toast('Notifications are already on'); return; }
  const perm = await Notification.requestPermission();
  notifPermission = perm;
  refreshNotifBtn();
  toast(perm === 'granted' ? 'Notifications enabled' : 'Notifications blocked — you can allow them in your browser settings');
});

const alerted = new Set();
function checkWatchlistAirings(schedules){
  if(notifPermission !== 'granted') return;
  const now = Date.now();
  schedules.forEach(s=>{
    const mediaId = s.media.id;
    if(!watchlist[mediaId]) return;
    const key = mediaId + '-' + s.episode;
    const diff = s.airingAt*1000 - now;
    if(diff <= 0 && diff > -120000 && !alerted.has(key)){
      alerted.add(key);
      try{
        new Notification(fmtTitle(s.media.title) + ' — episode ' + s.episode + ' is airing now', {
          body: 'Just went live. Tap to open on AniList.'
        }).onclick = ()=> window.open(s.media.siteUrl, '_blank');
      }catch(e){}
    }
  });
}

/* ---------------- ticker ---------------- */
async function loadTicker(){
  const now = Math.floor(Date.now()/1000);
  const query = `query($start:Int,$end:Int){
    Page(page:1, perPage:25){
      airingSchedules(airingAt_greater:$start, airingAt_lesser:$end, sort: TIME){
        airingAt episode
        media{ id title{ romaji english } }
      }
    }
  }`;
  try{
    const data = await gql(query, { start: now - 3600, end: now + 43200 });
    const items = data.Page.airingSchedules;
    const track = document.getElementById('tickerTrack');
    if(items.length === 0){
      track.innerHTML = '<div class="ticker-empty">Nothing airing in the next 12 hours — check the weekly schedule below</div>';
      return;
    }
    const pieces = items.map(s => `<div class="ticker-item"><b>${fmtTitle(s.media.title)}</b> · ep ${s.episode} · ${timeUntil(s.airingAt)}</div>`);
    track.innerHTML = pieces.join('') + pieces.join(''); // duplicate for seamless loop
  }catch(e){
    document.getElementById('tickerTrack').innerHTML = '<div class="ticker-empty">Couldn\\'t load the live ticker right now</div>';
  }
}

/* ---------------- weekly schedule ---------------- */
let scheduleByDay = {};
const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
let allSchedules = [];

async function loadWeeklySchedule(){
  const now = Math.floor(Date.now()/1000);
  const query = `query($start:Int,$end:Int,$page:Int){
    Page(page:$page, perPage:50){
      pageInfo{ hasNextPage }
      airingSchedules(airingAt_greater:$start, airingAt_lesser:$end, sort: TIME){
        airingAt episode
        media{ id title{ romaji english } coverImage{ large } siteUrl }
      }
    }
  }`;
  let page = 1, hasNext = true, results = [];
  try{
    while(hasNext && page <= 4){
      const data = await gql(query, { start: now, end: now + 7*86400, page });
      results = results.concat(data.Page.airingSchedules);
      hasNext = data.Page.pageInfo.hasNextPage;
      page++;
    }
  }catch(e){
    document.getElementById('scheduleGrid').innerHTML = '<div class="empty">Couldn\\'t load the schedule. Try refreshing.</div>';
    return;
  }
  allSchedules = results;
  scheduleByDay = {};
  results.forEach(s=>{
    const d = new Date(s.airingAt*1000);
    const key = d.toDateString();
    (scheduleByDay[key] = scheduleByDay[key] || []).push(s);
  });
  buildDayTabs();
  checkWatchlistAirings(allSchedules);
}

function buildDayTabs(){
  const tabsEl = document.getElementById('dayTabs');
  const today = new Date();
  const keys = [];
  for(let i=0;i<7;i++){
    const d = new Date(today.getTime() + i*86400000);
    keys.push(d.toDateString());
  }
  tabsEl.innerHTML = keys.map((k,i)=>{
    const d = new Date(k);
    const label = i===0 ? 'Today' : (i===1 ? 'Tomorrow' : dayNames[d.getDay()] + ' ' + d.getDate());
    return `<button class="day-tab ${i===0?'active':''}" data-key="${k}">${label}</button>`;
  }).join('');
  tabsEl.querySelectorAll('.day-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      tabsEl.querySelectorAll('.day-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderDay(btn.getAttribute('data-key'));
    });
  });
  renderDay(keys[0]);
}

function renderDay(key){
  const grid = document.getElementById('scheduleGrid');
  const items = (scheduleByDay[key] || []).sort((a,b)=>a.airingAt-b.airingAt);
  if(items.length === 0){
    grid.innerHTML = '<div class="empty">Nothing scheduled to air this day.</div>';
    return;
  }
  grid.innerHTML = items.map(s => cardHTML(s)).join('');
  attachCardHandlers(grid, items);
}

function cardHTML(s){
  const m = s.media;
  const watched = isWatched(m.id);
  const premiere = s.episode === 1;
  const d = new Date(s.airingAt*1000);
  const timeStr = d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  return `
    <div class="card" data-id="${m.id}">
      <div class="cover-wrap">
        <img class="cover" src="${m.coverImage.large}" alt="" loading="lazy">
        <div class="dots"></div>
        ${premiere ? '<div class="badge premiere">premiere</div>' : `<div class="badge">ep ${s.episode}</div>`}
        <div class="star ${watched?'active':''}" data-id="${m.id}">${watched?'★':'☆'}</div>
      </div>
      <div class="card-body">
        <p class="card-title">${fmtTitle(m.title)}</p>
        <p class="card-meta">${timeStr} · ${timeUntil(s.airingAt)}</p>
      </div>
    </div>`;
}

function attachCardHandlers(container, items){
  container.querySelectorAll('.star').forEach(star=>{
    star.addEventListener('click', (e)=>{
      e.stopPropagation();
      const id = star.getAttribute('data-id');
      const s = items.find(x=>String(x.media.id)===String(id));
      if(s) toggleWatch(s.media, star);
    });
  });
  container.querySelectorAll('.card').forEach(card=>{
    card.addEventListener('click', ()=>{
      const id = card.getAttribute('data-id');
      const s = items.find(x=>String(x.media.id)===String(id));
      if(s && s.media.siteUrl) window.open(s.media.siteUrl, '_blank');
    });
  });
}

/* ---------------- upcoming premieres ---------------- */
async function loadUpcoming(){
  const query = `query{
    Page(page:1, perPage:12){
      media(status: NOT_YET_RELEASED, sort: POPULARITY_DESC, type: ANIME){
        id title{ romaji english } coverImage{ large } siteUrl
        startDate{ year month day }
      }
    }
  }`;
  try{
    const data = await gql(query, {});
    const grid = document.getElementById('upcomingGrid');
    const items = data.Page.media;
    if(items.length === 0){ grid.innerHTML = '<div class="empty">No upcoming premieres listed right now.</div>'; return; }
    grid.innerHTML = items.map(m=>{
      const watched = isWatched(m.id);
      const sd = m.startDate;
      const dateStr = sd.year ? [sd.year, sd.month, sd.day].filter(Boolean).join('-') : 'Date TBA';
      return `
        <div class="card" data-id="${m.id}">
          <div class="cover-wrap">
            <img class="cover" src="${m.coverImage.large}" alt="" loading="lazy">
            <div class="dots"></div>
            <div class="badge premiere">new</div>
            <div class="star ${watched?'active':''}" data-id="${m.id}">${watched?'★':'☆'}</div>
          </div>
          <div class="card-body">
            <p class="card-title">${fmtTitle(m.title)}</p>
            <p class="card-date">${dateStr}</p>
          </div>
        </div>`;
    }).join('');
    grid.querySelectorAll('.star').forEach(star=>{
      star.addEventListener('click', (e)=>{
        e.stopPropagation();
        const id = star.getAttribute('data-id');
        const m = items.find(x=>String(x.id)===String(id));
        if(m) toggleWatch(m, star);
      });
    });
    grid.querySelectorAll('.card').forEach(card=>{
      card.addEventListener('click', ()=>{
        const id = card.getAttribute('data-id');
        const m = items.find(x=>String(x.id)===String(id));
        if(m && m.siteUrl) window.open(m.siteUrl, '_blank');
      });
    });
  }catch(e){
    document.getElementById('upcomingGrid').innerHTML = '<div class="empty">Couldn\\'t load upcoming premieres.</div>';
  }
}

/* ---------------- search ---------------- */
let searchTimer = null;
document.getElementById('searchInput').addEventListener('input', (e)=>{
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if(q.length < 2){
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('mainContent').style.display = '';
    return;
  }
  searchTimer = setTimeout(()=> runSearch(q), 350);
});

async function runSearch(q){
  const query = `query($q:String){
    Page(page:1, perPage:12){
      media(search:$q, type: ANIME, sort: POPULARITY_DESC){
        id title{ romaji english } coverImage{ large } siteUrl status
      }
    }
  }`;
  try{
    const data = await gql(query, { q });
    const items = data.Page.media;
    document.getElementById('mainContent').style.display = 'none';
    const resultsWrap = document.getElementById('searchResults');
    resultsWrap.style.display = '';
    const grid = document.getElementById('searchGrid');
    if(items.length === 0){ grid.innerHTML = '<div class="empty">No matches. Try a different title.</div>'; return; }
    grid.innerHTML = items.map(m=>{
      const watched = isWatched(m.id);
      return `
        <div class="card" data-id="${m.id}">
          <div class="cover-wrap">
            <img class="cover" src="${m.coverImage.large}" alt="" loading="lazy">
            <div class="dots"></div>
            <div class="star ${watched?'active':''}" data-id="${m.id}">${watched?'★':'☆'}</div>
          </div>
          <div class="card-body">
            <p class="card-title">${fmtTitle(m.title)}</p>
            <p class="card-meta">${m.status.replace(/_/g,' ').toLowerCase()}</p>
          </div>
        </div>`;
    }).join('');
    grid.querySelectorAll('.star').forEach(star=>{
      star.addEventListener('click', (e)=>{
        e.stopPropagation();
        const id = star.getAttribute('data-id');
        const m = items.find(x=>String(x.id)===String(id));
        if(m) toggleWatch(m, star);
      });
    });
    grid.querySelectorAll('.card').forEach(card=>{
      card.addEventListener('click', ()=>{
        const id = card.getAttribute('data-id');
        const m = items.find(x=>String(x.id)===String(id));
        if(m && m.siteUrl) window.open(m.siteUrl, '_blank');
      });
    });
  }catch(e){
    document.getElementById('searchGrid').innerHTML = '<div class="empty">Search failed. Try again.</div>';
  }
}

/* ---------------- init ---------------- */
document.getElementById('tzNote').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;

(async function init(){
  await loadWatchlist();
  await Promise.all([loadTicker(), loadWeeklySchedule(), loadUpcoming()]);
  setInterval(loadTicker, 5*60*1000);
  setInterval(()=>{ checkWatchlistAirings(allSchedules); }, 30*1000);
  setInterval(()=>{
    const activeKey = document.querySelector('.day-tab.active')?.getAttribute('data-key');
    if(activeKey) renderDay(activeKey);
  }, 60*1000);
})();

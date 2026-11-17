// 화면의 시작점: 서버에 기록을 묻고, 마을(town.js)을 움직여 그리고(world.js), 층 안내·사람 목록·활동 로그·알림을 맡는다.
import { buildWorld, render, iso, GW, GH, ROOMS, THEMES, themeForFloor } from './world.js';
import { SPECIES, portrait } from './critters.js';
import { sleep, esc, short, ago, dur, tokens, clock } from './util.js';
import { Town } from './town.js';

const POLL_MS = 250;
const FLOORS_MS = 2000;
const OLD_FLOOR_MS = 3 * 86400e3;

const $ = sel => document.querySelector(sel);

// ---------------------------------------------------------------- 앱

const app = {
  floors: [], user: 'me', floor: null, session: null, autoFollow: true,
  town: null, world: null, cursor: null, sessionToken: 0, sessionActive: false,
  cam: { x: 0, y: 0, scale: 1, dpr: 1, fitted: false }, showOld: false, showAllSessions: false,
  title: '',
};

const canvas = $('#town');
const ctx = canvas.getContext('2d');

function resize() {
  // 무대 테두리 안쪽 크기 (getBoundingClientRect는 테두리까지 재서 오른쪽·아래가 몇 px 가려진다)
  const st = canvas.parentElement;
  const r = { width: st.clientWidth, height: st.clientHeight };
  app.cam.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * app.cam.dpr);
  canvas.height = Math.round(r.height * app.cam.dpr);
  canvas.style.width = r.width + 'px';
  canvas.style.height = r.height + 'px';
  if (!app.cam.touched) fit();
}

// 가장자리 숲은 조금 잘라도 되니, 방들이 있는 부분이 화면에 꽉 차게 맞춘다
function fit() {
  const w = canvas.width / app.cam.dpr, h = canvas.height / app.cam.dpr;
  const minX = iso(1, GH - 1).x - 20, maxX = iso(GW - 1, 1).x + 20;
  const minY = iso(1, 1).y - 110, maxY = iso(GW - 1, GH - 1).y + 40;
  const s = Math.min(w / (maxX - minX), (h - 70) / (maxY - minY));
  app.cam.scale = s;
  app.cam.x = (w - (maxX - minX) * s) / 2 - minX * s;
  app.cam.y = (h + 50 - (maxY - minY) * s) / 2 - minY * s;
}

function zoom(f, cx, cy) {
  const cam = app.cam;
  const w = canvas.width / cam.dpr, h = canvas.height / cam.dpr;
  cx = cx == null ? w / 2 : cx; cy = cy == null ? h / 2 : cy;
  const ns = Math.max(0.35, Math.min(3, cam.scale * f));
  cam.x = cx - (cx - cam.x) * ns / cam.scale;
  cam.y = cy - (cy - cam.y) * ns / cam.scale;
  cam.scale = ns;
  cam.touched = true;
}

(function setupCamera() {
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: app.cam.x, cy: app.cam.y }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    app.cam.x = drag.cx + e.clientX - drag.x; app.cam.y = drag.cy + e.clientY - drag.y; app.cam.touched = true;
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $('#zoomIn').onclick = () => zoom(1.2);
  $('#zoomOut').onclick = () => zoom(1 / 1.2);
  $('#zoomFit').onclick = () => { app.cam.touched = false; fit(); };
  window.addEventListener('resize', resize);
  // 층별 안내를 접고 펴면 지도 크기가 바뀐다
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(canvas.parentElement);
})();

// -------- 패널 접기 (접은 상태는 이 브라우저에 기억한다)

const FOLDS = {
  left: { cls: 'left-folded', panel: '#left', btn: '#leftToggle', name: '층별 안내' },
  right: { cls: 'right-folded', panel: '#right', btn: '#rightToggle', name: '사무실 현황' },
};
const isFolded = side => $('#app').classList.contains(FOLDS[side].cls);
function setFolded(side, folded) {
  const f = FOLDS[side];
  $('#app').classList.toggle(f.cls, folded);
  const btn = $(f.btn);
  const label = `${f.name} ${folded ? '펼치기' : '접기'}`;
  btn.title = label; btn.setAttribute('aria-label', label); btn.setAttribute('aria-expanded', String(!folded));
  try { localStorage.setItem(`clawd-village:${side}-folded`, folded ? '1' : '0'); } catch { /* 저장소를 못 쓰는 브라우저 */ }
  resize();
}
for (const side of Object.keys(FOLDS)) {
  $(FOLDS[side].btn).addEventListener('click', e => { e.stopPropagation(); setFolded(side, !isFolded(side)); });
  // 접힌 띠는 어디를 눌러도 펼친다
  $(FOLDS[side].panel).addEventListener('click', () => { if (isFolded(side)) setFolded(side, false); });
  try { if (localStorage.getItem(`clawd-village:${side}-folded`) === '1') setFolded(side, true); } catch { /* 저장소를 못 쓰는 브라우저 */ }
}

// -------- 데이터

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
}

async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
}

async function refreshFloors() {
  try {
    const data = await getJson('/api/floors');
    app.floors = data.floors;
    app.user = data.user || 'me';
    $('#rootPath').textContent = data.root + (data.demo ? ' (데모)' : '');
    if (!app.floor && app.floors.length) {
      const fromHash = new URLSearchParams(location.hash.slice(1));
      const hf = app.floors.find(f => f.id === fromHash.get('floor'));
      const latest = [...app.floors].sort((a, b) => b.lastActive - a.lastActive)[0];
      const f = hf || latest;
      const sid = hf && fromHash.get('session') && f.sessions.some(s => s.id === fromHash.get('session')) ? fromHash.get('session') : null;
      if (sid) app.autoFollow = false;
      await enterFloor(f, sid, false);
    } else if (app.floor) {
      const f = app.floors.find(x => x.id === app.floor.id);
      if (f) {
        app.floor = f;
        // /clear 하면 같은 층의 새 세션으로 따라간다
        const newest = [...f.sessions].sort((a, b) => b.birth - a.birth)[0];
        const cur = f.sessions.find(s => s.id === app.session);
        if (app.autoFollow && !app.riding && newest && cur && newest.id !== app.session && newest.birth > cur.birth) {
          toast(`🆕 ${f.floor}F 새 세션으로 따라갑니다`);
          openSession(f, newest.id);
        }
      }
    }
    renderFloors();
    renderHeader();
    $('#empty').hidden = app.floors.length > 0;
    $('#emptyRoot').textContent = data.root;
  } catch (e) {
    console.warn(e);
  }
}

function newestStarted(f) {
  const newest = [...f.sessions].sort((a, b) => b.birth - a.birth)[0];
  return newest && newest.id;
}

async function enterFloor(f, sessionId, animate = true) {
  const prev = app.floor ? app.floor.floor : 1;
  if (sessionId === undefined || sessionId === null) app.autoFollow = true;
  // 따로 고르지 않았으면 자동 따라가기와 같은 기준(가장 나중에 시작한 세션)으로 연다
  const sid = sessionId || newestStarted(f);
  // 엘리베이터가 도는 동안에는 이전 층에 머문다. 층과 세션은 도착할 때 함께 바꾼다.
  if (animate && prev !== f.floor) {
    app.riding = true;
    try { await elevatorRide(prev, f.floor); } finally { app.riding = false; }
  }
  app.floor = f;
  openSession(f, sid);
  renderFloors();
}

function elevatorRide(from, to) {
  const el = $('#elevator');
  const num = $('#elevatorNum');
  const arrow = $('#elevatorArrow');
  arrow.textContent = to > from ? '▲' : '▼';
  el.hidden = false;
  el.classList.add('show');
  const steps = Math.abs(to - from);
  const each = Math.max(45, Math.min(160, 900 / Math.max(1, steps)));
  return new Promise(resolve => {
    let cur = from;
    num.textContent = cur + 'F';
    const tick = () => {
      if (cur === to) {
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 250); resolve(); }, 380);
        return;
      }
      cur += to > from ? 1 : -1;
      num.textContent = cur + 'F';
      setTimeout(tick, each);
    };
    setTimeout(tick, each);
  });
}

function openSession(f, sid) {
  if (!sid) return;
  app.session = sid;
  app.cursor = null;
  app.title = '';
  const token = ++app.sessionToken;
  const themeIndex = themeForFloor(f.floor);
  if (!app.world || app.world.themeIndex !== themeIndex) app.world = buildWorld(themeIndex);
  app.world.todos = [];
  app.town = new Town(app.world, { userName: app.user, onTitle: t => { app.title = t; renderHeader(); }, onNotify: notify });
  history.replaceState(null, '', `#floor=${encodeURIComponent(f.id)}${app.autoFollow ? '' : '&session=' + encodeURIComponent(sid)}`);
  renderHeader();
  poll(token, f.id, sid);
}

async function poll(token, floorId, sid) {
  let first = true;
  while (token === app.sessionToken) {
    let data = null;
    try {
      data = await postJson('/api/session', { floor: floorId, session: sid, c: app.cursor || null });
    } catch (e) {
      await sleep(1000);
      continue;
    }
    if (token !== app.sessionToken) return;
    const town = app.town;
    Object.assign(town.subsMeta, data.subs || {});
    if (data.reset) { openSession(app.floor, sid); return; }
    if (first || data.initial) { town.replay(data.events, data.session.active); first = false; }
    else for (const ev of data.events) town.handle(ev);
    // 기록 파일이 2분 넘게 조용해도 끝나지 않은 도구를 기다리는 중이면 LIVE로 본다
    app.sessionActive = data.session.active || town.waiting();
    app.cursor = data.cursor;
    renderHeader();
    if (!data.session.more) await sleep(POLL_MS);
  }
}

// -------- 화면 패널

function renderHeader() {
  const f = app.floor;
  if (!f) return;
  $('#floorBadge').textContent = f.floor + 'F';
  $('#floorName').textContent = f.name;
  const s = f.sessions.find(x => x.id === app.session);
  $('#sessionTitle').textContent = app.title || (s ? s.title : '');
  $('#themeLabel').textContent = THEMES[themeForFloor(f.floor)].label + ' 마을';
  const live = $('#live');
  live.classList.toggle('on', app.sessionActive);
  live.lastChild.textContent = app.sessionActive ? 'LIVE' : '쉬는 중';
  $('#cwd').textContent = f.cwd;
  $('#sid').textContent = app.session ? app.session.slice(0, 8) : '';
}

function renderFloors() {
  const box = $('#floors');
  const now = Date.now();
  const sorted = [...app.floors].sort((a, b) => b.floor - a.floor);
  const recent = sorted.filter(f => f.active || now - f.lastActive < OLD_FLOOR_MS || (app.floor && f.id === app.floor.id));
  const old = sorted.filter(f => !recent.includes(f));
  const item = f => {
    const cur = app.floor && f.id === app.floor.id;
    const lit = f.active || (cur && app.sessionActive);
    let html = `<li class="floor ${cur ? 'current' : ''} ${lit ? 'lit' : ''}" data-floor="${esc(f.id)}">
      <div class="frow"><span class="fnum">${f.floor}F</span><span class="fname">${esc(f.name)}</span><span class="light" title="${lit ? '지금 일하는 중' : '불 꺼짐'}"></span></div>
      <div class="fmeta">세션 ${f.sessionCount}개 · ${ago(now - f.lastActive)}</div>`;
    if (cur) {
      const list = app.showAllSessions ? f.sessions : f.sessions.slice(0, 8);
      html += `<ul class="sessions">
        <li class="follow ${app.autoFollow ? 'on' : ''}" data-follow="1">${app.autoFollow ? '✅' : '⬜'} 최근 세션 자동으로 따라가기</li>
        ${list.map(s => `<li class="sess ${s.id === app.session ? 'sel' : ''} ${s.active ? 'act' : ''}" data-session="${esc(s.id)}">
          <span class="stitle">${esc(s.title)}</span><span class="sago">${ago(now - s.mtime)}</span></li>`).join('')}
        ${f.sessions.length > 8 ? `<li class="more" data-more="1">${app.showAllSessions ? '접기' : `세션 ${f.sessions.length - 8}개 더 보기`}</li>` : ''}
      </ul>`;
    }
    return html + '</li>';
  };
  box.innerHTML = recent.map(item).join('') +
    (old.length ? `<li class="oldtoggle" data-old="1">${app.showOld ? '▾' : '▸'} 불 꺼진 지 오래된 층 ${old.length}개</li>` + (app.showOld ? old.map(item).join('') : '') : '');
}

// 이미 열린 탭에서 북마크를 누르거나 주소창의 #floor=… 를 고치면 그 층·세션으로 옮긴다
window.addEventListener('hashchange', () => {
  const h = new URLSearchParams(location.hash.slice(1));
  const f = app.floors.find(x => x.id === h.get('floor'));
  if (!f) return;
  const want = h.get('session');
  const sid = want && f.sessions.some(s => s.id === want) ? want : null;
  if (app.floor && f.id === app.floor.id) {
    if (sid ? sid === app.session && !app.autoFollow : app.autoFollow) return;
    app.autoFollow = !sid;
    openSession(f, sid || newestStarted(f));
    renderFloors();
    return;
  }
  app.autoFollow = !sid;
  enterFloor(f, sid, true);
});

$('#floors').addEventListener('click', e => {
  const t = e.target.closest('[data-session],[data-follow],[data-more],[data-old],[data-floor]');
  if (!t) return;
  e.stopPropagation();
  if (t.dataset.old) { app.showOld = !app.showOld; return renderFloors(); }
  if (t.dataset.more) { app.showAllSessions = !app.showAllSessions; return renderFloors(); }
  if (t.dataset.follow) {
    app.autoFollow = !app.autoFollow;
    const newest = newestStarted(app.floor);
    if (app.autoFollow && newest && newest !== app.session) openSession(app.floor, newest);
    else history.replaceState(null, '', `#floor=${encodeURIComponent(app.floor.id)}${app.autoFollow ? '' : '&session=' + encodeURIComponent(app.session)}`);
    return renderFloors();
  }
  if (t.dataset.session) {
    if (t.dataset.session === app.session) return;
    app.autoFollow = false;
    openSession(app.floor, t.dataset.session);
    return renderFloors();
  }
  const f = app.floors.find(x => x.id === t.dataset.floor);
  if (f && (!app.floor || f.id !== app.floor.id)) { app.showAllSessions = false; enterFloor(f, null, true); }
});

const STATE_LABEL = { working: '작업 중', idle: '대기', arriving: '출근 중', reporting: '보고 중', leaving: '퇴근 중' };

// 패널에 쓰는 캐릭터 얼굴 그림 (한 번 그려 두고 재사용)
const portraits = new Map();
function portraitUrl(species) {
  if (!portraits.has(species)) portraits.set(species, portrait(species, 40).toDataURL());
  return portraits.get(species);
}

function renderPeople() {
  const town = app.town;
  if (!town) return;
  const now = Date.now();
  const people = town.chars.filter(c => c.kind === 'claude' || c.kind === 'sub');
  $('#peopleCount').textContent = `${people.length}명 근무 중`;
  $('#people').innerHTML = people.map(a => {
    let st = STATE_LABEL[a.state] || a.state;
    if (a.emote === 'ponder') st = '고민 중';
    if (a.emote === 'sleep') st = '졸음';
    const al = a.alert;
    if (al === 'error') st = '⚠ 오류';
    else if (al === 'attention') st = a.bubble.type === 'wait' ? '⏳ 승인 대기?' : '❓ 답변 기다림';
    const sp = SPECIES[a.species];
    return `<li class="person ${al ? 'alert-' + al : ''}">
      <span class="avatar" style="border-color:${a.color}"><img src="${portraitUrl(a.species)}" alt=""></span>
      <div class="pbody">
        <div class="prow"><b>${esc(a.kind === 'claude' ? 'Claude' : a.type)}</b><span class="species">${esc(sp ? sp.name : '')}</span><span class="pill s-${esc(a.state)} ${al ? 'a-' + al : ''}">${esc(st)}</span></div>
        ${a.desc ? `<div class="pdesc">${esc(a.desc)}</div>` : ''}
        <div class="pact">${esc(a.activity)}</div>
        <div class="pmeta">도구 ${a.tools}회 · ${dur(now - a.since)}</div>
      </div></li>`;
  }).join('');
}

function renderLogs() {
  const town = app.town;
  if (!town || !town.dirty) return;
  town.dirty = false;
  $('#logs').innerHTML = town.logs.slice(0, 80).map(l => `<li class="${l.err ? 'err' : l.warn ? 'warn' : ''}">
    <span class="ltime">${clock(l.t)}</span><span class="lwho" style="color:${l.color}">● ${esc(l.who)}</span>
    <span class="ltext">${esc(l.text)}</span></li>`).join('');
}

// 오류나 확인할 일이 있으면 상단 표지, 무대 테두리, 브라우저 탭 제목으로도 알린다
const BASE_TITLE = document.title;
function renderAlerts() {
  const people = app.town ? app.town.chars.filter(c => c.kind === 'claude' || c.kind === 'sub') : [];
  const err = people.filter(c => c.alert === 'error').length;
  const att = people.filter(c => c.alert === 'attention').length;
  // 사용량 한도: 풀리는 시각이 지나면 표지를 거둔다
  const now = Date.now();
  const lim = app.town && app.town.limit && app.town.limit.until > now ? app.town.limit : null;
  const box = $('#alerts');
  const key = err + '/' + att + '/' + (lim ? lim.until : 0);
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    const at = lim ? new Date(lim.until).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
    box.innerHTML = (lim ? `<span class="chip limit" title="${esc(lim.text)}">⛔ 사용 한도 · ${at} 재개 <span id="limitLeft" aria-hidden="true"></span></span>` : '') +
      (err ? `<span class="chip err">⚠ 오류 ${err}</span>` : '') + (att ? `<span class="chip warn">❓ 확인 필요 ${att}</span>` : '');
  }
  if (lim) {
    // 남은 시간은 분 단위로만 고친다 (표지 전체를 다시 그리면 보조기술이 매번 다시 읽는다)
    const m = Math.ceil((lim.until - now) / 60000);
    const left = '(' + (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`) + ' 남음)';
    const el = $('#limitLeft');
    if (el && el.textContent !== left) el.textContent = left;
  }
  const stage = $('#stage');
  stage.classList.toggle('alert-error', err > 0);
  stage.classList.toggle('alert-attention', !err && att > 0);
  const title = (err ? '⚠ ' : att ? '❓ ' : lim ? '⛔ ' : '') + BASE_TITLE;
  if (document.title !== title) document.title = title;
}

// 오른쪽 패널의 모델 줄: 모델 · 지금 컨텍스트 크기 · 브랜치
function renderStats() {
  const st = (app.town && app.town.stats) || {};
  const text = [st.model, st.ctx ? `컨텍스트 ${tokens(st.ctx)} 토큰` : '', st.branch ? `브랜치 ${st.branch}` : ''].filter(Boolean).join(' · ');
  const row = $('#statRow');
  if (row.hidden !== !text) row.hidden = !text;
  if ($('#stats').textContent !== text) $('#stats').textContent = text;
}

// -------- 데스크톱 알림 (켜 둔 경우에만, 이 탭을 보고 있지 않을 때만)

const NOTIFY_TITLES = { ask: '❓ Claude가 물어봐요', wait: '⏳ 승인을 기다리는 것 같아요', done: '✅ Claude가 답변을 마쳤어요', limit: '⛔ 사용 한도에 걸렸어요' };
const canNotify = 'Notification' in window && window.isSecureContext;
let notifyOn = false;
function notify(kind, text) {
  if (!notifyOn || !document.hidden || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(NOTIFY_TITLES[kind] || BASE_TITLE, { body: short(text, 120), tag: 'clawd-village-' + kind });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* 알림을 못 띄우는 환경 */ }
}
function setNotify(on) {
  notifyOn = on;
  const btn = $('#notifyToggle');
  const label = on ? '알림 끄기 (지금 켜짐: 이 탭을 안 볼 때 질문·승인 대기·답변 완료·사용 한도를 알려요)' : '알림 켜기 (이 탭을 안 볼 때 질문·승인 대기·답변 완료·사용 한도를 알려요)';
  btn.title = label; btn.setAttribute('aria-label', label); btn.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem('clawd-village:notify', on ? '1' : '0'); } catch { /* 저장소를 못 쓰는 브라우저 */ }
}
if (canNotify) {
  $('#notifyToggle').hidden = false;
  let saved = false;
  try { saved = localStorage.getItem('clawd-village:notify') === '1'; } catch { /* 저장소를 못 쓰는 브라우저 */ }
  setNotify(saved && Notification.permission === 'granted');
  $('#notifyToggle').addEventListener('click', async () => {
    if (notifyOn) return setNotify(false);
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm === 'granted') { setNotify(true); toast('알림을 켰어요. 이 탭을 안 볼 때만 알려요'); }
    else toast('브라우저 설정에서 이 주소의 알림을 허용해 주세요');
  });
}

function renderLegend() {
  const rooms = ['library', 'dev', 'server', 'info', 'meeting', 'lobby', 'elevator'];
  const cast = [['clawd', 'Claude', '방마다 작업 모자'], ['sprout', 'Explore', '탐험 모자 · 돋보기'], ['owl', 'Plan', '안경 · 설계도'],
    ['bunny', '범용', '파란 목도리'], ['chick', '그 밖의 에이전트', ''], ['human', '나', '']];
  $('#legend').innerHTML = rooms.map(k => `<li><span>${ROOMS[k].icon}</span><b>${ROOMS[k].name}</b><em>${ROOMS[k].desc}</em></li>`).join('') +
    cast.map(([sp, who, note]) => `<li class="cast"><img src="${portraitUrl(sp)}" alt=""><b>${SPECIES[sp].name}</b><em>${who}${note ? ' · ' + note : ''}</em></li>`).join('');
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// -------- 루프

let last = performance.now();
let panelAt = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.town && app.world) {
    app.town.update(dt, app.sessionActive);
    const live = app.town.liveFlags(app.floor ? app.floor.floor + 'F' : '', app.user);
    render(ctx, app.world, app.cam, app.town.chars, live, now / 1000);
    if (now - panelAt > 500) { panelAt = now; renderPeople(); renderLogs(); renderAlerts(); renderStats(); }
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#d9f1ff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(frame);
}

resize();
renderLegend();
refreshFloors();
setInterval(refreshFloors, FLOORS_MS);
setInterval(() => renderFloors(), 15000);
// 다른 탭을 보는 동안에는 화면을 그리지 않으니(requestAnimationFrame 멈춤) 상태와 탭 제목만 따로 갱신한다
setInterval(() => {
  if (!document.hidden || !app.town) return;
  app.town.settle();
  app.town.update(0, app.sessionActive);
  renderAlerts();
}, 1000);
requestAnimationFrame(frame);

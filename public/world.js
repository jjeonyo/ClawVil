// 등각(isometric) 블록 마을. 방 배치, 가구, 길찾기, 그리기를 맡는다.
import { drawCharacter } from './pokemon.js';

export const TW = 64, TH = 32;
export const GW = 24, GH = 20;

export const iso = (x, y, z = 0) => ({ x: (x - y) * TW / 2, y: (x + y) * TH / 2 - z });

// ---------------------------------------------------------------- 색

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  return '#' + ((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0');
}

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const THEMES = [
  { key: 'meadow', label: '초원', grass: ['#9fd86d', '#94d064', '#a8de78'], side: '#b3824f', path: '#ead39d',
    leaf: ['#5dbb5a', '#4ca94c', '#76c95e'], trunk: '#9a6b43', flowers: ['#ff8fb1', '#fff27a', '#ffffff', '#b9a2ff'], sky: ['#bfe8ff', '#eaf8ff'], water: '#7fd3f0' },
  { key: 'beach', label: '해변', grass: ['#f3e3aa', '#efdc9f', '#f7e9b9'], side: '#d9b779', path: '#fff3d1',
    leaf: ['#4fbf7a', '#3fae6c', '#6ccf8c'], trunk: '#b9884f', flowers: ['#ff9f8f', '#ffd35c', '#ffffff', '#7fd8ff'], sky: ['#9fe1ff', '#e9fbff'], water: '#5fcde6', palm: true },
  { key: 'autumn', label: '단풍숲', grass: ['#cfd67b', '#c6cf70', '#d8dd8a'], side: '#a4734a', path: '#efd6a8',
    leaf: ['#f39a45', '#e7703c', '#f6be4f'], trunk: '#8a5d3b', flowers: ['#ff8a65', '#ffe082', '#fff', '#d7a0ff'], sky: ['#ffe2c4', '#fff6ea'], water: '#86c9e0' },
  { key: 'snow', label: '설원', grass: ['#f4f8fb', '#eaf1f6', '#fbfdff'], side: '#9fb3c6', path: '#dfe7ee',
    leaf: ['#6fae96', '#5f9e86', '#84c2a8'], trunk: '#8a6b55', flowers: ['#ffb3c7', '#bfe3ff', '#ffffff', '#d7c4ff'], sky: ['#d6e6f5', '#f6fbff'], water: '#a9dcf2', snow: true },
];

// 층마다 다른 마을 풍경. 초원이 가장 자주 나온다.
const FLOOR_THEMES = [0, 1, 0, 2, 0, 3];
export const themeForFloor = n => FLOOR_THEMES[(Math.max(1, n) - 1) % FLOOR_THEMES.length];

// ---------------------------------------------------------------- 방 배치

export const ROOMS = {
  library: { name: '자료실', en: 'LIBRARY', icon: '📚', x: 1, y: 1, w: 6, h: 6, floor: ['#e8c592', '#e1bb84'], desc: '파일 읽기 · 검색' },
  dev: { name: '개발실', en: 'DEV', icon: '💻', x: 8, y: 1, w: 8, h: 6, floor: ['#e3ecf2', '#d8e3eb'], desc: '코드 수정' },
  server: { name: '서버실', en: 'SERVER', icon: '🗄️', x: 17, y: 1, w: 6, h: 6, floor: ['#c8d0dc', '#bec7d4'], desc: '명령 실행 · git' },
  meeting: { name: '회의실', en: 'MEETING', icon: '📝', x: 1, y: 8, w: 6, h: 5, floor: ['#f0d9b5', '#e8cfa6'], desc: '계획 · 할 일' },
  lobby: { name: '내 자리', en: 'MY DESK', icon: '🧑‍💻', x: 8, y: 8, w: 8, h: 5, floor: ['#f6e7c8', '#efdcb8'], desc: '질문 · 보고' },
  info: { name: '정보검색실', en: 'SEARCH', icon: '🌐', x: 17, y: 8, w: 6, h: 5, floor: ['#d9eef3', '#cde6ec'], desc: '웹 검색 · MCP' },
  lounge: { name: '쉼터', en: 'CAFE', icon: '☕', x: 1, y: 14, w: 6, h: 5, floor: ['#f3dcc9', '#ecd1bb'], desc: '쉬는 곳' },
  elevator: { name: '엘리베이터', en: 'LIFT', icon: '🛗', x: 17, y: 14, w: 6, h: 5, floor: ['#e2dccf', '#d8d1c2'], desc: '서브에이전트 출퇴근' },
};

export function buildWorld(themeIndex) {
  const theme = THEMES[themeIndex % THEMES.length];
  const R = rand(1234 + themeIndex * 77);
  const objects = [];
  const blocked = new Set();
  const key = (x, y) => x + ',' + y;
  const block = (x, y, w = 1, d = 1) => { for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) blocked.add(key(x + i, y + j)); };
  const add = (o, solid = true) => { objects.push(o); if (solid) block(o.x, o.y, o.w || 1, o.d || 1); return o; };
  const spots = {};
  const spot = (room, x, y, face = 1, extra = {}) => { (spots[room] = spots[room] || []).push({ x: x + 0.5, y: y + 0.5, face, room, ...extra }); };

  // 바닥 타일 종류
  const ground = [];
  for (let x = 0; x < GW; x++) {
    ground[x] = [];
    for (let y = 0; y < GH; y++) ground[x][y] = { kind: 'grass', v: R() };
  }
  for (const [id, r] of Object.entries(ROOMS)) {
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) ground[x][y] = { kind: 'room', room: id, v: R() };
  }
  for (let i = 1; i < GW - 1; i++) { ground[i][7].kind = 'path'; ground[i][13].kind = 'path'; }
  for (let j = 1; j < GH - 1; j++) { ground[7][j].kind = 'path'; ground[16][j].kind = 'path'; }
  // 연못
  const pond = [[9, 15], [10, 15], [11, 15], [12, 15], [9, 16], [10, 16], [11, 16], [12, 16], [13, 16], [10, 17], [11, 17], [12, 17]];
  for (const [x, y] of pond) { ground[x][y] = { kind: 'water', v: R() }; blocked.add(key(x, y)); }

  // 자료실: 책장, 독서 테이블
  for (let x = 1; x <= 6; x++) add({ type: 'shelf', x, y: 1, w: 1, d: 1, face: 'y', seed: R() });
  for (let y = 2; y <= 5; y++) add({ type: 'shelf', x: 1, y, w: 1, d: 1, face: 'x', seed: R() });
  add({ type: 'table', x: 3, y: 3, w: 2, d: 2, color: '#c48a52' });
  add({ type: 'plant', x: 6, y: 6 });
  for (const [x, y] of [[2, 2], [3, 2], [4, 2], [5, 2], [2, 4], [5, 3], [5, 4], [3, 5], [4, 5]]) spot('library', x, y);

  // 개발실: 책상 두 줄
  for (const row of [2, 5]) for (let x = 9; x <= 14; x++) {
    add({ type: 'desk', x, y: row, w: 1, d: 1, monitor: true, seed: R() });
    spot('dev', x, row + 1, 1, { desk: key(x, row) });
  }
  add({ type: 'plant', x: 8, y: 1 }); add({ type: 'plant', x: 15, y: 1 });

  // 서버실: 랙
  for (const row of [2, 5]) for (let x = 18; x <= 21; x++) {
    add({ type: 'rack', x, y: row, seed: R() });
    spot('server', x, row + 1);
  }

  // 회의실: 테이블과 게시판
  add({ type: 'board', x: 2, y: 8, w: 4, d: 1 });
  add({ type: 'table', x: 2, y: 10, w: 3, d: 2, color: '#d9a066' });
  for (const [x, y] of [[2, 9], [3, 9], [4, 9], [5, 10], [5, 11], [2, 12], [3, 12], [4, 12], [1, 10]]) spot('meeting', x, y);

  // 로비: 내 책상과 Claude 책상
  add({ type: 'rug', x: 9, y: 9, w: 6, d: 3 }, false);
  add({ type: 'desk', x: 9, y: 10, w: 2, d: 1, monitor: true, owner: 'user' });
  add({ type: 'desk', x: 13, y: 10, w: 2, d: 1, monitor: true, owner: 'claude', phone: true });
  add({ type: 'plant', x: 15, y: 8 }); add({ type: 'plant', x: 8, y: 12 });
  const userSeat = { x: 9.5, y: 11.5, face: 1, room: 'lobby' };
  const claudeSeat = { x: 13.5, y: 11.5, face: 1, room: 'lobby' };
  spots.ask = [{ x: 10.5, y: 11.5, face: -1, room: 'lobby' }, { x: 11.5, y: 10.5, face: -1, room: 'lobby' }];
  spots.report = [[12, 11], [15, 11], [12, 12], [14, 12], [15, 12], [12, 10]].map(([x, y]) => ({ x: x + 0.5, y: y + 0.5, face: x < 13 ? 1 : -1, room: 'lobby' }));

  // 정보검색실: 검색대, 지구본, 안테나
  for (const x of [18, 20]) { add({ type: 'kiosk', x, y: 9 }); spot('info', x, 10); }
  add({ type: 'globe', x: 22, y: 11 });
  add({ type: 'antenna', x: 22, y: 8 });
  spot('info', 21, 11, -1); spot('info', 19, 11); spot('info', 18, 11); spot('info', 20, 11);

  // 쉼터
  for (const [x, y] of [[2, 15], [5, 15], [2, 17], [5, 17]]) add({ type: 'cafeTable', x, y });
  add({ type: 'sofa', x: 3, y: 14, w: 2, d: 1 });
  for (const [x, y] of [[3, 15], [4, 16], [3, 17], [4, 18], [1, 16], [6, 16]]) spot('lounge', x, y);

  // 엘리베이터
  add({ type: 'elevator', x: 19, y: 14, w: 2, d: 2 });
  const elevatorDoor = { x: 20, y: 16.6, face: 1, room: 'elevator' };
  for (const [x, y] of [[18, 17], [21, 17], [19, 18], [20, 18]]) spot('elevator', x, y);
  add({ type: 'plant', x: 22, y: 14 }); add({ type: 'plant', x: 17, y: 14 });

  // 방 팻말
  for (const [id, r] of Object.entries(ROOMS)) {
    const sx = id === 'lobby' ? r.x + r.w - 1 : r.x + r.w - 1;
    objects.push({ type: 'sign', x: sx, y: r.y + r.h - 1, room: id, label: r.name, icon: r.icon });
  }

  // 가장자리 나무, 꽃
  const treeSpots = [];
  for (let x = 0; x < GW; x++) { treeSpots.push([x, 0]); treeSpots.push([x, GH - 1]); }
  for (let y = 1; y < GH - 1; y++) { treeSpots.push([0, y]); treeSpots.push([GW - 1, y]); }
  for (const [x, y] of [[8, 18], [15, 14], [14, 18], [8, 14]]) treeSpots.push([x, y]);
  for (const [x, y] of treeSpots) {
    if (ground[x][y].kind === 'path') continue;
    const r = R();
    if (r < 0.42) add({ type: theme.palm && R() < 0.6 ? 'palm' : 'tree', x, y, seed: R(), size: 0.8 + R() * 0.4 });
    else if (r < 0.62) add({ type: 'bush', x, y, seed: R() });
    else if (r < 0.9) objects.push({ type: 'flowers', x, y, seed: R() });
  }
  for (let i = 0; i < 16; i++) {
    const x = 8 + Math.floor(R() * 8), y = 14 + Math.floor(R() * 5);
    if (ground[x][y].kind === 'grass' && !blocked.has(key(x, y))) objects.push({ type: 'flowers', x, y, seed: R() });
  }
  for (const [x, y] of [[0, 7], [0, 13], [23, 7], [23, 13], [7, 0], [16, 0], [7, 19], [16, 19]]) { blocked.delete(key(x, y)); }
  // 가로등
  for (const [x, y] of [[4, 7], [12, 7], [20, 7], [12, 13], [4, 13]]) objects.push({ type: 'lamp', x: x + 0.1, y: y + 0.1, w: 0.2, d: 0.2 });

  const world = { theme, themeIndex, objects, blocked, ground, spots, userSeat, claudeSeat, elevatorDoor, todos: [], elevatorOpen: 0, key };
  world.groundCanvas = renderGround(world);
  return world;
}

// ---------------------------------------------------------------- 길찾기 (8방향 A*)

export function findPath(world, from, to) {
  const sx = Math.floor(from.x), sy = Math.floor(from.y);
  const tx = Math.floor(to.x), ty = Math.floor(to.y);
  const free = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && (!world.blocked.has(world.key(x, y)) || (x === tx && y === ty) || (x === sx && y === sy));
  const k = (x, y) => y * GW + x;
  const open = [[sx, sy]];
  const g = new Map([[k(sx, sy), 0]]);
  const prev = new Map();
  const h = (x, y) => Math.hypot(x - tx, y - ty);
  let guard = 0;
  while (open.length && guard++ < 4000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const [ax, ay] = open[i], [bx, by] = open[bi];
      if (g.get(k(ax, ay)) + h(ax, ay) < g.get(k(bx, by)) + h(bx, by)) bi = i;
    }
    const [cx, cy] = open.splice(bi, 1)[0];
    if (cx === tx && cy === ty) break;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!free(nx, ny)) continue;
      if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue;
      const cost = g.get(k(cx, cy)) + (dx && dy ? 1.414 : 1);
      if (cost < (g.has(k(nx, ny)) ? g.get(k(nx, ny)) : Infinity)) {
        g.set(k(nx, ny), cost); prev.set(k(nx, ny), [cx, cy]);
        if (!open.some(([ox, oy]) => ox === nx && oy === ny)) open.push([nx, ny]);
      }
    }
  }
  if (!prev.has(k(tx, ty))) return [{ x: to.x, y: to.y }];
  const pts = [];
  let cur = [tx, ty];
  while (cur && !(cur[0] === sx && cur[1] === sy)) { pts.unshift({ x: cur[0] + 0.5, y: cur[1] + 0.5 }); cur = prev.get(k(cur[0], cur[1])); }
  if (pts.length) pts[pts.length - 1] = { x: to.x, y: to.y };
  // 같은 방향으로 이어지는 점은 합친다
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    if (a && c && Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-6) continue;
    out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------- 기본 도형

function face(ctx, pts, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

// 격자 (x,y)에서 w×d 크기, 바닥 높이 z에서 h 만큼 솟은 상자
export function box(ctx, x, y, z, w, d, h, color, opts = {}) {
  const top = [iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)];
  const left = [iso(x, y + d, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x, y + d, z)];
  const right = [iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x + w, y, z)];
  const line = opts.line === false ? null : shade(color, -0.35);
  face(ctx, left, opts.left || shade(color, -0.12), line);
  face(ctx, right, opts.right || shade(color, -0.25), line);
  face(ctx, top, opts.top || shade(color, 0.12), line);
}

function diamond(ctx, x, y, z, fill, stroke) {
  face(ctx, [iso(x, y, z), iso(x + 1, y, z), iso(x + 1, y + 1, z), iso(x, y + 1, z)], fill, stroke);
}

// ---------------------------------------------------------------- 바닥 (미리 그려 둔다)

export const BOUNDS = (() => {
  const minX = iso(0, GH).x - 40, maxX = iso(GW, 0).x + 40;
  const minY = iso(0, 0).y - 140, maxY = iso(GW, GH).y + 60;
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
})();

function renderGround(world) {
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = BOUNDS.w * scale; c.height = BOUNDS.h * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.translate(-BOUNDS.minX, -BOUNDS.minY);
  const th = world.theme;
  const DEPTH = 26;
  // 섬 옆면(흙 블록)
  for (let x = 0; x < GW; x++) box(ctx, x, GH - 1, -DEPTH, 1, 1, DEPTH, th.side, { top: th.side });
  for (let y = 0; y < GH; y++) box(ctx, GW - 1, y, -DEPTH, 1, 1, DEPTH, th.side, { top: th.side });
  // 위쪽 잔디 띠
  for (let x = 0; x < GW; x++) face(ctx, [iso(x, GH, 0), iso(x + 1, GH, 0), iso(x + 1, GH, -6), iso(x, GH, -6)], shade(th.grass[0], -0.15));
  for (let y = 0; y < GH; y++) face(ctx, [iso(GW, y, 0), iso(GW, y + 1, 0), iso(GW, y + 1, -6), iso(GW, y, -6)], shade(th.grass[0], -0.3));

  for (let x = 0; x < GW; x++) for (let y = 0; y < GH; y++) {
    const g = world.ground[x][y];
    let fill;
    if (g.kind === 'grass') fill = th.grass[Math.floor(g.v * th.grass.length)];
    else if (g.kind === 'path') fill = shade(th.path, (g.v - 0.5) * 0.06);
    else if (g.kind === 'water') fill = th.water;
    else { const f = ROOMS[g.room].floor; fill = f[(x + y) % 2]; }
    diamond(ctx, x, y, 0, fill, g.kind === 'room' ? shade(fill, -0.08) : null);
    if (g.kind === 'grass' && g.v > 0.7) {
      const p = iso(x + 0.3 + g.v * 0.4, y + 0.6, 0);
      ctx.strokeStyle = shade(fill, -0.18); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p.x - 3, p.y); ctx.lineTo(p.x - 4, p.y - 4); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 5); ctx.moveTo(p.x + 3, p.y); ctx.lineTo(p.x + 4, p.y - 4); ctx.stroke();
    }
    if (g.kind === 'path' && g.v > 0.6) {
      const p = iso(x + g.v * 0.7, y + 0.4, 0);
      ctx.fillStyle = shade(th.path, -0.12);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 방 테두리 낮은 울타리 선
  for (const r of Object.values(ROOMS)) {
    const pts = [iso(r.x, r.y), iso(r.x + r.w, r.y), iso(r.x + r.w, r.y + r.h), iso(r.x, r.y + r.h)];
    ctx.strokeStyle = 'rgba(120,80,40,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
  }
  // 바닥에 쓰인 방 이름
  ctx.font = 'bold 13px "Jua", "Gowun Dodum", sans-serif';
  ctx.textAlign = 'center';
  for (const r of Object.values(ROOMS)) {
    const p = iso(r.x + 0.9, r.y + r.h - 0.35);
    ctx.save(); ctx.translate(p.x, p.y); ctx.transform(1, -0.5, 1, 0.5, 0, 0);
    ctx.fillStyle = 'rgba(110,80,50,.35)'; ctx.textAlign = 'left';
    ctx.fillText(r.en, 0, 0);
    ctx.restore();
  }
  // 연못 물결
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5;
  for (const [x, y] of [[10, 16], [12, 16], [11, 15]]) { const p = iso(x + 0.5, y + 0.5); ctx.beginPath(); ctx.ellipse(p.x, p.y, 9, 3, 0, 0, Math.PI * 2); ctx.stroke(); }
  return c;
}

// ---------------------------------------------------------------- 가구 그리기

const BOOK_COLORS = ['#e8604c', '#4fa3e0', '#f2c14e', '#6cc070', '#b07fd8', '#f08fb0'];

function drawObject(ctx, o, world, t, live) {
  const th = world.theme;
  switch (o.type) {
    case 'shelf': {
      box(ctx, o.x + 0.05, o.y + 0.1, 0, 0.9, 0.8, 58, '#a8713f');
      // 책등: 보이는 면에 칸칸이
      const R = rand(Math.floor(o.seed * 1e6));
      for (let shelf = 0; shelf < 3; shelf++) {
        const z0 = 6 + shelf * 17;
        for (let i = 0; i < 5; i++) {
          const c = BOOK_COLORS[Math.floor(R() * BOOK_COLORS.length)];
          if (o.face === 'y') {
            const a = iso(o.x + 0.12 + i * 0.16, o.y + 0.9, z0), b = iso(o.x + 0.25 + i * 0.16, o.y + 0.9, z0);
            ctx.fillStyle = c; ctx.fillRect(a.x, a.y - 13 + (b.y - a.y), Math.max(3, b.x - a.x), 13);
          } else {
            const a = iso(o.x + 0.95, o.y + 0.15 + i * 0.15, z0);
            ctx.fillStyle = c; ctx.beginPath();
            ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - 4, a.y + 2); ctx.lineTo(a.x - 4, a.y - 11); ctx.lineTo(a.x, a.y - 13); ctx.fill();
          }
        }
      }
      break;
    }
    case 'table':
      for (const [dx, dy] of [[0.1, 0.1], [o.w - 0.2, 0.1], [0.1, o.d - 0.2], [o.w - 0.2, o.d - 0.2]]) box(ctx, o.x + dx, o.y + dy, 0, 0.1, 0.1, 14, shade(o.color, -0.2));
      box(ctx, o.x, o.y, 14, o.w, o.d, 5, o.color);
      break;
    case 'desk': {
      const busy = live.desks.get(world.key(o.x, o.y)) || (o.owner && live.owners[o.owner]);
      box(ctx, o.x + 0.05, o.y + 0.1, 0, o.w - 0.1, 0.8, 16, '#f2f2ee');
      box(ctx, o.x + 0.02, o.y + 0.05, 16, o.w - 0.04, 0.9, 3, '#d9c3a0');
      if (o.monitor) {
        const mx = o.x + o.w / 2 - 0.3;
        box(ctx, mx + 0.25, o.y + 0.35, 19, 0.1, 0.1, 6, '#9aa3ad');
        box(ctx, mx, o.y + 0.3, 25, 0.6, 0.12, 20, '#3b4048');
        // 화면(앞면)
        const p0 = iso(mx + 0.05, o.y + 0.43, 28), p1 = iso(mx + 0.55, o.y + 0.43, 28);
        const sw = p1.x - p0.x, sh = 14;
        ctx.save();
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p1.x, p1.y - sh); ctx.lineTo(p0.x, p0.y - sh); ctx.closePath();
        ctx.fillStyle = busy ? '#1f2a3a' : '#5a6878'; ctx.fill(); ctx.clip();
        if (busy) {
          // 코드가 흐르는 화면
          const colors = ['#7fdcff', '#ffd36e', '#a6f08b', '#ff9bd2'];
          const off = (t * 14 + (o.seed || 0) * 50) % 4;
          for (let i = -1; i < 6; i++) {
            const yy = p0.y - sh + i * 3 + 4 - off;
            const len = 4 + ((i * 7 + Math.floor(t * 3)) % 9);
            ctx.fillStyle = colors[(i + 4) % 4];
            ctx.fillRect(p0.x + 2 + (i % 3) * 2, yy + (p1.y - p0.y) * 0.3, len, 1.4);
          }
        }
        ctx.restore();
      }
      if (o.phone) {
        const ring = live.owners.phone;
        const p = iso(o.x + 1.6, o.y + 0.4, 19 + (ring ? Math.abs(Math.sin(t * 25)) * 2 : 0));
        ctx.fillStyle = '#e8483f'; ctx.strokeStyle = '#8f2620';
        ctx.beginPath(); ctx.roundRect(p.x - 6, p.y - 6, 12, 6, 2); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case 'rack': {
      box(ctx, o.x + 0.1, o.y + 0.15, 0, 0.8, 0.7, 64, '#3d434d');
      const speed = live.serverBusy ? 14 : 2.2;
      for (let i = 0; i < 6; i++) {
        const p = iso(o.x + 0.25, o.y + 0.85, 8 + i * 9);
        const on = Math.sin(t * speed + i * 1.7 + o.seed * 20) > 0;
        ctx.fillStyle = on ? (i % 3 === 0 ? '#ff6b6b' : '#6dff9c') : '#244033';
        ctx.fillRect(p.x, p.y - 2, 3, 2);
        const q = iso(o.x + 0.55, o.y + 0.85, 8 + i * 9);
        ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(q.x, q.y - 2, 9, 1.5);
      }
      break;
    }
    case 'board': {
      box(ctx, o.x, o.y + 0.4, 0, 0.12, 0.12, 30, '#8a6440');
      box(ctx, o.x + o.w - 0.12, o.y + 0.4, 0, 0.12, 0.12, 30, '#8a6440');
      box(ctx, o.x, o.y + 0.4, 22, o.w, 0.12, 40, '#b07b48');
      const a = iso(o.x + 0.15, o.y + 0.52, 58), b = iso(o.x + o.w - 0.15, o.y + 0.52, 58);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x, b.y + 32); ctx.lineTo(a.x, a.y + 32); ctx.closePath();
      ctx.fillStyle = '#fffdf5'; ctx.fill();
      ctx.clip();
      ctx.translate(a.x, a.y); ctx.transform(1, (b.y - a.y) / (b.x - a.x), 0, 1, 0, 0);
      ctx.font = '6.5px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const todos = world.todos.slice(0, 4);
      if (!todos.length) { ctx.fillStyle = '#c9b89a'; ctx.fillText('오늘의 할 일', 6, 4); }
      todos.forEach((td, i) => {
        ctx.fillStyle = td.s === 'completed' ? '#5aa65a' : td.s === 'in_progress' ? '#e08a2e' : '#8a7a66';
        ctx.fillText((td.s === 'completed' ? '✔ ' : td.s === 'in_progress' ? '▶ ' : '・') + td.c, 4, 2 + i * 7.6);
      });
      ctx.restore();
      break;
    }
    case 'kiosk': {
      box(ctx, o.x + 0.3, o.y + 0.3, 0, 0.4, 0.4, 30, '#7b67c9');
      box(ctx, o.x + 0.2, o.y + 0.2, 30, 0.6, 0.6, 14, '#5b4aa8', { top: live.infoBusy ? '#9be8ff' : '#c9d5ff' });
      break;
    }
    case 'globe': {
      box(ctx, o.x + 0.35, o.y + 0.35, 0, 0.3, 0.3, 14, '#8a6440');
      const p = iso(o.x + 0.5, o.y + 0.5, 30);
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fillStyle = '#5ab4e8'; ctx.fill(); ctx.strokeStyle = '#2f7fb0'; ctx.stroke();
      const spin = t * (live.infoBusy ? 2.5 : 0.4);
      ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#7ccf6a';
      for (let i = 0; i < 3; i++) { const lx = p.x + ((spin * 10 + i * 9) % 30) - 15; ctx.beginPath(); ctx.ellipse(lx, p.y - 3 + i * 3, 4, 3, 0.4, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      break;
    }
    case 'antenna': {
      box(ctx, o.x + 0.4, o.y + 0.4, 0, 0.2, 0.2, 70, '#b9c2cc');
      const p = iso(o.x + 0.5, o.y + 0.5, 74);
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#ff6b6b'; ctx.fill();
      if (live.infoBusy) {
        ctx.strokeStyle = 'rgba(255,107,107,.7)'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) { const r = ((t * 20 + i * 10) % 30) + 6; ctx.globalAlpha = 1 - r / 36; ctx.beginPath(); ctx.arc(p.x, p.y, r, -2.6, -0.5); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'cafeTable':
      box(ctx, o.x + 0.42, o.y + 0.42, 0, 0.16, 0.16, 14, '#8a6440');
      box(ctx, o.x + 0.15, o.y + 0.15, 14, 0.7, 0.7, 3, '#f7f0e2');
      { const p = iso(o.x + 0.5, o.y + 0.5, 22); ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 3, p.y - 2, 6, 5); ctx.fillStyle = '#8a5a2b'; ctx.fillRect(p.x - 2, p.y - 2, 4, 1.5); }
      break;
    case 'sofa':
      box(ctx, o.x, o.y + 0.1, 0, o.w, 0.8, 10, '#e98a7a');
      box(ctx, o.x, o.y + 0.1, 10, o.w, 0.25, 14, '#e98a7a');
      break;
    case 'rug': {
      const pts = [iso(o.x, o.y, 0.5), iso(o.x + o.w, o.y, 0.5), iso(o.x + o.w, o.y + o.d, 0.5), iso(o.x, o.y + o.d, 0.5)];
      face(ctx, pts, '#9bd4e8', '#6fb5cf');
      const inner = [iso(o.x + 0.3, o.y + 0.3, 0.6), iso(o.x + o.w - 0.3, o.y + 0.3, 0.6), iso(o.x + o.w - 0.3, o.y + o.d - 0.3, 0.6), iso(o.x + 0.3, o.y + o.d - 0.3, 0.6)];
      ctx.setLineDash([4, 3]); face(ctx, inner, 'rgba(0,0,0,0)', 'rgba(255,255,255,.8)'); ctx.setLineDash([]);
      break;
    }
    case 'elevator': {
      box(ctx, o.x, o.y, 0, o.w, o.d, 96, '#d4c6b0');
      box(ctx, o.x - 0.05, o.y - 0.05, 96, o.w + 0.1, o.d + 0.1, 8, '#b08a5c');
      // 문 (앞쪽 왼면)
      const open = world.elevatorOpen;
      const gap = 0.35 * open;
      const L = (a, b, z0, z1, col) => face(ctx, [iso(a, o.y + o.d, z1), iso(b, o.y + o.d, z1), iso(b, o.y + o.d, z0), iso(a, o.y + o.d, z0)], col, shade(col, -0.3));
      L(o.x + 0.45, o.x + 1.55, 0, 62, '#3a3f47');
      L(o.x + 0.45, o.x + 1.0 - gap, 0, 62, '#c9ced6');
      L(o.x + 1.0 + gap, o.x + 1.55, 0, 62, '#c9ced6');
      // 층 표시등
      const p = iso(o.x + 1, o.y + o.d, 80);
      ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.roundRect(p.x - 16, p.y - 8, 32, 14, 3); ctx.fill();
      ctx.fillStyle = '#ffb347'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
      ctx.fillText((open > 0.05 ? '▲' : '') + live.floorLabel, p.x, p.y + 3);
      break;
    }
    case 'plant': {
      box(ctx, o.x + 0.3, o.y + 0.3, 0, 0.4, 0.4, 12, '#d97a4a');
      const p = iso(o.x + 0.5, o.y + 0.5, 22);
      for (const [dx, dy, r] of [[-5, 2, 7], [5, 2, 7], [0, -5, 8]]) { ctx.beginPath(); ctx.arc(p.x + dx, p.y + dy, r, 0, Math.PI * 2); ctx.fillStyle = th.leaf[0]; ctx.fill(); ctx.strokeStyle = shade(th.leaf[0], -0.3); ctx.stroke(); }
      break;
    }
    case 'tree': {
      const s = o.size || 1;
      box(ctx, o.x + 0.38, o.y + 0.38, 0, 0.24, 0.24, 22 * s, th.trunk);
      const leaf = th.leaf[Math.floor(o.seed * th.leaf.length)];
      box(ctx, o.x + 0.05, o.y + 0.05, 20 * s, 0.9, 0.9, 26 * s, leaf);
      box(ctx, o.x + 0.2, o.y + 0.2, 46 * s, 0.6, 0.6, 16 * s, shade(leaf, 0.08));
      if (th.snow) box(ctx, o.x + 0.2, o.y + 0.2, 62 * s, 0.6, 0.6, 3, '#ffffff');
      if (o.seed > 0.6 && !th.snow) { const p = iso(o.x + 0.9, o.y + 0.6, 34 * s); ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'palm': {
      box(ctx, o.x + 0.42, o.y + 0.42, 0, 0.16, 0.16, 50, th.trunk);
      const p = iso(o.x + 0.5, o.y + 0.5, 52);
      ctx.fillStyle = th.leaf[0]; ctx.strokeStyle = shade(th.leaf[0], -0.3);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + o.seed * 3 + Math.sin(t * 1.5 + i) * 0.05;
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 6 - 8, p.x + Math.cos(a) * 24, p.y + Math.sin(a) * 10 + 4);
        ctx.quadraticCurveTo(p.x + Math.cos(a) * 12, p.y + Math.sin(a) * 6, p.x, p.y);
        ctx.fill(); ctx.stroke();
      }
      break;
    }
    case 'bush': {
      const leaf = th.leaf[Math.floor(o.seed * th.leaf.length)];
      box(ctx, o.x + 0.15, o.y + 0.15, 0, 0.7, 0.7, 16, leaf);
      if (th.snow) box(ctx, o.x + 0.15, o.y + 0.15, 16, 0.7, 0.7, 2, '#ffffff');
      break;
    }
    case 'flowers': {
      const R = rand(Math.floor(o.seed * 1e6));
      for (let i = 0; i < 4; i++) {
        const p = iso(o.x + 0.2 + R() * 0.6, o.y + 0.2 + R() * 0.6, 3);
        ctx.fillStyle = th.flowers[Math.floor(R() * th.flowers.length)];
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(p.x, p.y, 0.9, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'lamp': {
      box(ctx, o.x, o.y, 0, 0.2, 0.2, 44, '#6b5a4a');
      const p = iso(o.x + 0.1, o.y + 0.1, 50);
      ctx.fillStyle = '#fff3b0'; ctx.strokeStyle = '#b08a5c';
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'sign': {
      const p = iso(o.x + 0.85, o.y + 0.85, 0);
      ctx.fillStyle = '#8a6440'; ctx.fillRect(p.x - 1.5, p.y - 22, 3, 22);
      ctx.font = 'bold 10px "Jua", "Gowun Dodum", sans-serif';
      const label = o.label;
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = '#c99a5b'; ctx.strokeStyle = '#7a5530'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(p.x - w / 2, p.y - 36, w, 16, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fffaf0'; ctx.textAlign = 'center'; ctx.fillText(label, p.x, p.y - 24.5);
      break;
    }
  }
}

function depthOf(o) {
  if (o.type === 'rug') return -1;
  if (o.type === 'flowers') return o.x + o.y + 0.2;
  return o.x + (o.w || 1) / 2 + o.y + (o.d || 1) / 2 + (o.type === 'sign' ? 0.5 : 0);
}

// ---------------------------------------------------------------- 말풍선

function wrap(ctx, text, maxW, maxLines) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (ch === '\n') { lines.push(cur); cur = ''; continue; }
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch.trim() ? ch : ''; }
    else cur += ch;
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && text.length > lines.join('').length + 2) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  return lines;
}

const BUBBLE = {
  say: { bg: '#ffffff', line: '#c8b79c', text: '#4a3b2c' },
  think: { bg: '#f4efff', line: '#b7a3e6', text: '#4b3a7a' },
  err: { bg: '#ffe6e6', line: '#e2575a', text: '#a02a2d' },
  ask: { bg: '#fff6c9', line: '#e0b43a', text: '#6b5210' },
  report: { bg: '#e7f8e3', line: '#6ab865', text: '#2f6b2b' },
  call: { bg: '#ffe9e0', line: '#e58a6a', text: '#8a3a20' },
};

function drawBubble(ctx, x, y, b, placed) {
  const st = BUBBLE[b.type] || BUBBLE.say;
  ctx.save();
  ctx.font = `${12}px "Gowun Dodum", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  const lines = wrap(ctx, b.text || '…', 168, b.type === 'think' ? 2 : 3);
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 18;
  const lh = 15;
  const h = lines.length * lh + 10;
  const bx = Math.round(x - w / 2);
  let by = Math.round(y - h - 12);
  // 다른 말풍선과 겹치면 위로 올린다
  for (let moved = true, n = 0; moved && n < 8; n++) {
    moved = false;
    for (const r of placed) {
      if (bx < r.x + r.w && bx + w > r.x && by < r.y + r.h && by + h > r.y) { by = r.y - h - 4; moved = true; }
    }
  }
  placed.push({ x: bx, y: by, w, h });
  const tailY = Math.min(y - 4, by + h + 8);
  ctx.globalAlpha = b.alpha == null ? 1 : b.alpha;
  ctx.fillStyle = st.bg; ctx.strokeStyle = st.line; ctx.lineWidth = 1.6;
  if (b.type === 'think') {
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, h / 2); ctx.fill(); ctx.stroke();
    for (const [dx, dy, r] of [[-4, 6, 4], [-9, 13, 2.5]]) { ctx.beginPath(); ctx.arc(x + dx, by + h + dy - 2, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  } else {
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 9);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 6, by + h - 1); ctx.lineTo(x, tailY); ctx.lineTo(x + 6, by + h - 1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 6, by + h); ctx.lineTo(x, tailY); ctx.lineTo(x + 6, by + h); ctx.stroke();
  }
  ctx.fillStyle = st.text; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 9, by + 6 + i * lh));
  ctx.restore();
}

function drawTag(ctx, x, y, ch) {
  ctx.save();
  ctx.font = 'bold 10px "Jua", "Gowun Dodum", sans-serif';
  const label = ch.label;
  const w = ctx.measureText(label).width + 14;
  ctx.globalAlpha = ch.alpha == null ? 1 : ch.alpha;
  ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.strokeStyle = ch.color || '#999'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x - w / 2, y + 4, w, 15, 7.5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = ch.color || '#444';
  ctx.beginPath(); ctx.arc(x - w / 2 + 7, y + 11.5, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a3b2c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 2, y + 12);
  ctx.restore();
}

// ---------------------------------------------------------------- 한 프레임 그리기

export function render(ctx, world, cam, chars, live, t) {
  const { width, height } = ctx.canvas;
  const dpr = cam.dpr;
  const th = world.theme;
  // 하늘
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  // 구름
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (let i = 0; i < 5; i++) {
    const cx = ((t * 8 * (0.5 + i * 0.15) + i * 330) % (width / dpr + 300)) - 150;
    const cy = 40 + i * 47 % 160;
    ctx.save(); ctx.scale(dpr, dpr);
    for (const [dx, dy, r] of [[0, 0, 22], [24, -8, 26], [50, 0, 20], [24, 6, 22]]) { ctx.beginPath(); ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  const s = cam.scale * dpr;
  ctx.setTransform(s, 0, 0, s, cam.x * dpr, cam.y * dpr);
  ctx.drawImage(world.groundCanvas, BOUNDS.minX, BOUNDS.minY, BOUNDS.w, BOUNDS.h);
  if (th.key === 'meadow' || th.key === 'beach') {
    // 물 반짝임
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    for (let i = 0; i < 4; i++) { const p = iso(9.5 + ((t * 0.3 + i * 0.9) % 4), 15.5 + (i % 2), 0); ctx.fillRect(p.x, p.y, 3, 1.5); }
  }

  // 깊이 순서대로 가구와 캐릭터
  const drawables = [];
  for (const o of world.objects) drawables.push({ d: depthOf(o), o });
  for (const ch of chars) { if (!ch.hidden) drawables.push({ d: ch.x + ch.y, ch }); }
  drawables.sort((a, b) => a.d - b.d);
  const tops = new Map();
  for (const it of drawables) {
    if (it.o) drawObject(ctx, it.o, world, t, live);
    else {
      const p = iso(it.ch.x, it.ch.y, 0);
      it.ch.sx = p.x; it.ch.sy = p.y;
      tops.set(it.ch, drawCharacter(ctx, it.ch, t));
    }
  }
  // 이름표와 말풍선은 확대 배율과 상관없이 같은 크기로, 화면 좌표에서 그린다
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toScreen = (x, y) => ({ x: cam.x + x * cam.scale, y: cam.y + y * cam.scale });
  for (const ch of chars) {
    if (ch.hidden) continue;
    const p = toScreen(ch.sx, ch.sy);
    drawTag(ctx, p.x, p.y, ch);
  }
  const placed = [];
  const bubbles = chars.filter(ch => !ch.hidden && ch.bubble)
    .map(ch => ({ ch, p: toScreen(ch.sx, tops.get(ch) - 2) }))
    .sort((a, b) => b.p.y - a.p.y);
  for (const { ch, p } of bubbles) drawBubble(ctx, p.x, p.y, ch.bubble, placed);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

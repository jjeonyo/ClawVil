// 아기자기한 등각 블록 마을. 방 배치, 지형, 소품, 길찾기, 그리기를 맡는다.
import { TW, TH, iso, shade, mix, rgba, rand, path, face, box, puff, ellipse, groundShadow, sprite } from './art.js';
import { drawCharacter } from './critters.js';

export { TW, TH, iso };
export const GW = 24, GH = 20;
const BH = 22;          // 언덕 한 칸 높이
const DEPTH = 40;       // 섬 옆면 깊이
const ROOM_Z = 4;       // 방 바닥은 살짝 높은 마루
const WATER_Z = -9;

// ---------------------------------------------------------------- 풍경

export const THEMES = [
  { key: 'meadow', label: '초원',
    grass: ['#93d35a', '#8ecf55', '#98d75f'], lip: '#5fae3c', dirt: '#d39a5d', path: '#f3e8cb', mortar: '#d9c79e',
    leaf: ['#5cba4b', '#4fae45', '#69c452'], trunk: '#9b6a42', berries: ['#ff5d5d', '#4d9bff', '#ff8cc6', '#ffb13b'],
    flowers: ['#ff9fc0', '#ffffff', '#ffd84d', '#c7a6ff'], sky: ['#62c0f2', '#d9f3ff'], water: '#45c3ea', mesa: '#d9b98a' },
  { key: 'beach', label: '해변',
    grass: ['#f4e1a2', '#f0db97', '#f6e6b0'], lip: '#e3c47c', dirt: '#e6c588', path: '#fff6dc', mortar: '#e8d4a6',
    leaf: ['#3fbf78', '#34ad6a', '#5acf8a'], trunk: '#bf8c52', berries: ['#ffb13b', '#ff6b5b', '#ffd84d', '#ff8cc6'],
    flowers: ['#ff9f8f', '#ffd35c', '#ffffff', '#7fd8ff'], sky: ['#4fc0f0', '#e2fbff'], water: '#2fc4e2', mesa: '#efd8a8', palm: true },
  { key: 'mesa', label: '황금 고원',
    grass: ['#ecc55a', '#e6bd50', '#f0cb66'], lip: '#c99b38', dirt: '#dcae6b', path: '#f6e9c8', mortar: '#ddc28f',
    leaf: ['#f0a043', '#e57a3a', '#f5c24c'], trunk: '#8a5d3b', berries: ['#ff5d5d', '#ffffff', '#ff8cc6', '#7a4bd8'],
    flowers: ['#ff8a65', '#fff1a8', '#ffffff', '#d7a0ff'], sky: ['#76c8f0', '#fdf1d8'], water: '#5ec4e0', mesa: '#e4c08a' },
  { key: 'snow', label: '설원',
    grass: ['#f4f9fd', '#ebf3f9', '#fbfdff'], lip: '#cfe0ee', dirt: '#a8bccf', path: '#e3ebf2', mortar: '#c8d5e0',
    leaf: ['#5f9e86', '#6fae96', '#4f8e76'], trunk: '#8a6b55', berries: ['#ff5d5d', '#4d9bff', '#ffffff', '#ff8cc6'],
    flowers: ['#ffb3c7', '#bfe3ff', '#ffffff', '#d7c4ff'], sky: ['#9fd3f2', '#f3fbff'], water: '#8fd6f2', mesa: '#c9d6e2', snow: true },
];

// 층마다 다른 마을 풍경. 초원이 가장 자주 나온다.
const FLOOR_THEMES = [0, 1, 0, 2, 0, 3];
export const themeForFloor = n => FLOOR_THEMES[(Math.max(1, n) - 1) % FLOOR_THEMES.length];

// ---------------------------------------------------------------- 방 배치

export const ROOMS = {
  library: { name: '자료실', icon: '📚', x: 1, y: 1, w: 6, h: 6, floor: 'wood', color: '#dba66b', desc: '파일 읽기 · 검색' },
  dev: { name: '개발실', icon: '💻', x: 8, y: 1, w: 8, h: 6, floor: 'tile', color: '#eef3f6', color2: '#dde7ee', desc: '코드 수정' },
  server: { name: '서버실', icon: '🗄️', x: 17, y: 1, w: 6, h: 6, floor: 'metal', color: '#bcc7d4', desc: '명령 실행 · git' },
  meeting: { name: '회의실', icon: '📝', x: 1, y: 8, w: 6, h: 5, floor: 'wood', color: '#e6b97f', desc: '계획 · 할 일' },
  lobby: { name: '내 자리', icon: '🧑‍💻', x: 8, y: 8, w: 8, h: 5, floor: 'wood', color: '#ecc690', desc: '질문 · 보고' },
  info: { name: '정보검색실', icon: '🌐', x: 17, y: 8, w: 6, h: 5, floor: 'tile', color: '#d8f1ee', color2: '#c3e5e1', desc: '웹 검색 · MCP' },
  lounge: { name: '쉼터', icon: '☕', x: 1, y: 14, w: 6, h: 5, floor: 'deck', color: '#cf9a64', desc: '쉬는 곳' },
  elevator: { name: '엘리베이터', icon: '🛗', x: 17, y: 14, w: 6, h: 5, floor: 'brick', color: '#e6a690', desc: '서브에이전트 출퇴근' },
};

export function buildWorld(themeIndex) {
  const theme = THEMES[themeIndex % THEMES.length];
  const R = rand(1234 + themeIndex * 77);
  const objects = [];
  const blocked = new Set();
  const key = (x, y) => x + ',' + y;
  const block = (x, y, w = 1, d = 1) => { for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) blocked.add(key(x + i, y + j)); };
  const add = (o, solid = true) => { o.seed = o.seed == null ? R() : o.seed; objects.push(o); if (solid) block(o.x, o.y, o.w || 1, o.d || 1); return o; };
  const spots = {};
  const spot = (room, x, y, face = 1, extra = {}) => { (spots[room] = spots[room] || []).push({ x: x + 0.5, y: y + 0.5, face, room, ...extra }); };

  // 바닥: 잔디, 길, 방, 물, 뒤쪽 언덕
  const ground = [];
  for (let x = 0; x < GW; x++) {
    ground[x] = [];
    for (let y = 0; y < GH; y++) ground[x][y] = { kind: 'grass', v: R(), h: 0 };
  }
  for (let x = 0; x < GW; x++) for (let y = 0; y < GH; y++) {
    if (x === 0 || y === 0) ground[x][y].h = R() < 0.35 ? 3 : 2;
  }
  ground[0][0].h = 4;
  for (const [id, r] of Object.entries(ROOMS)) {
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) ground[x][y] = { kind: 'room', room: id, v: R(), h: 0 };
  }
  for (let i = 1; i < GW - 1; i++) { ground[i][7].kind = 'path'; ground[i][13].kind = 'path'; }
  for (let j = 1; j < GH - 1; j++) { ground[7][j].kind = 'path'; ground[16][j].kind = 'path'; }
  const pond = [[9, 15], [10, 15], [11, 15], [12, 15], [9, 16], [10, 16], [11, 16], [12, 16], [13, 16], [10, 17], [11, 17], [12, 17]];
  for (const [x, y] of pond) { ground[x][y] = { kind: 'water', v: R(), h: 0 }; blocked.add(key(x, y)); }

  // 자료실: 책장, 독서 테이블
  for (let x = 1; x <= 6; x++) add({ type: 'shelf', x, y: 1, face: 'y' });
  for (let y = 2; y <= 5; y++) add({ type: 'shelf', x: 1, y, face: 'x' });
  add({ type: 'table', x: 3, y: 3, w: 2, d: 2, color: '#c98e55' });
  add({ type: 'plant', x: 6, y: 6 });
  for (const [x, y] of [[2, 2], [3, 2], [4, 2], [5, 2], [2, 4], [5, 3], [5, 4], [3, 5], [4, 5]]) spot('library', x, y);

  // 개발실: 책상 두 줄 (앞줄이 뒷사람을 가리지 않도록 두 칸 간격)
  for (const row of [2, 5]) for (let x = 9; x <= 14; x++) {
    add({ type: 'desk', x, y: row, monitor: true });
    spot('dev', x, row + 1, 1, { desk: key(x, row) });
  }
  add({ type: 'plant', x: 8, y: 1 }); add({ type: 'plant', x: 15, y: 1 });

  // 서버실: 랙
  for (const row of [2, 5]) for (let x = 18; x <= 21; x++) {
    add({ type: 'rack', x, y: row });
    spot('server', x, row + 1);
  }

  // 회의실: 코르크 게시판과 테이블
  add({ type: 'board', x: 2, y: 8, w: 4, d: 1 });
  add({ type: 'table', x: 2, y: 10, w: 3, d: 2, color: '#d9a066' });
  for (const [x, y] of [[2, 9], [3, 9], [4, 9], [5, 10], [5, 11], [2, 12], [3, 12], [4, 12], [1, 10]]) spot('meeting', x, y);

  // 내 자리: 내 책상과 Claude 책상
  add({ type: 'rug', x: 9, y: 9, w: 6, d: 3 }, false);
  add({ type: 'desk', x: 9, y: 10, w: 2, d: 1, monitor: true, owner: 'user', lamp: true });
  add({ type: 'desk', x: 13, y: 10, w: 2, d: 1, monitor: true, owner: 'claude', phone: true });
  add({ type: 'plant', x: 15, y: 8 }); add({ type: 'plant', x: 8, y: 8 });
  const userSeat = { x: 9.5, y: 11.5, face: 1, room: 'lobby' };
  const claudeSeat = { x: 13.5, y: 11.5, face: 1, room: 'lobby' };
  spots.ask = [{ x: 10.5, y: 11.5, face: -1, room: 'lobby' }, { x: 11.5, y: 10.5, face: -1, room: 'lobby' }];
  spots.report = [[12, 11], [15, 11], [12, 12], [14, 12], [15, 12], [12, 10]].map(([x, y]) => ({ x: x + 0.5, y: y + 0.5, face: x < 13 ? 1 : -1, room: 'lobby' }));

  // 정보검색실
  for (const x of [18, 20]) { add({ type: 'kiosk', x, y: 9 }); spot('info', x, 10); }
  add({ type: 'globe', x: 22, y: 11 });
  add({ type: 'antenna', x: 22, y: 8 });
  spot('info', 21, 11, -1); spot('info', 19, 11); spot('info', 18, 11); spot('info', 20, 11);

  // 쉼터: 파라솔 테이블, 소파, 낮잠 자는 양 자리
  for (const [x, y] of [[2, 15], [5, 15], [2, 17], [5, 17]]) add({ type: 'cafeTable', x, y });
  add({ type: 'sofa', x: 3, y: 14, w: 2, d: 1 });
  for (const [x, y] of [[3, 15], [4, 16], [3, 17], [4, 18], [1, 16], [6, 16]]) spot('lounge', x, y);
  block(6, 18);
  const napSpot = { x: 6.5, y: 18.4, face: -1 };

  // 엘리베이터 건물
  add({ type: 'elevator', x: 19, y: 14, w: 2, d: 2 });
  const elevatorDoor = { x: 20, y: 16.6, face: 1, room: 'elevator' };
  for (const [x, y] of [[18, 17], [21, 17], [19, 18], [20, 18]]) spot('elevator', x, y);
  add({ type: 'plant', x: 22, y: 14 }); add({ type: 'plant', x: 17, y: 14 });

  // 연못 옆 텃밭
  add({ type: 'farm', x: 14, y: 15, w: 2, d: 3 });

  // 방 팻말 (방 앞쪽 왼 모서리)
  for (const [id, r] of Object.entries(ROOMS)) add({ type: 'sign', x: r.x, y: r.y + r.h - 1, room: id, label: r.name });

  // 가로등
  for (const [x, y] of [[4, 7], [12, 7], [20, 7], [12, 13], [4, 13]]) add({ type: 'lamp', x, y });

  // 가장자리: 언덕 위 나무, 앞쪽 풀숲과 꽃
  const edge = [];
  for (let x = 0; x < GW; x++) { edge.push([x, 0]); edge.push([x, GH - 1]); }
  for (let y = 1; y < GH - 1; y++) { edge.push([0, y]); edge.push([GW - 1, y]); }
  for (const [x, y] of [[8, 18], [15, 14], [8, 14]]) edge.push([x, y]);
  for (const [x, y] of edge) {
    if (ground[x][y].kind === 'path' || blocked.has(key(x, y))) continue;
    const r = R();
    const back = x === 0 || y === 0;
    if (r < (back ? 0.55 : 0.4)) add({ type: theme.palm && R() < 0.5 ? 'palm' : 'tree', x, y, size: 0.85 + R() * 0.35 });
    else if (r < 0.62) add({ type: 'bush', x, y });
    else if (r < 0.72) add({ type: 'rock', x, y });
    else if (r < 0.88) add({ type: 'tallgrass', x, y }, false);
    else add({ type: 'flowers', x, y }, false);
  }
  // 정원 풀숲과 꽃
  for (let i = 0; i < 22; i++) {
    const x = 8 + Math.floor(R() * 8), y = 14 + Math.floor(R() * 5);
    if (ground[x][y].kind !== 'grass' || blocked.has(key(x, y)) || objects.some(o => o.x === x && o.y === y)) continue;
    add({ type: R() < 0.5 ? 'tallgrass' : 'flowers', x, y }, false);
  }

  // 마을 주민: 연못가 개구리 자리, 오리가 도는 물길, 꽃 위의 나비
  const isWater = (x, y) => ground[x] && ground[x][y] && ground[x][y].kind === 'water';
  const frogSpots = [];
  for (let x = 8; x <= 15; x++) for (let y = 14; y <= 18; y++) {
    if (ground[x][y].kind !== 'grass' || blocked.has(key(x, y))) continue;
    if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => isWater(x + dx, y + dy))) frogSpots.push({ x: x + 0.5, y: y + 0.5 });
  }
  const duckLoop = [[9, 15], [10, 15], [11, 15], [12, 15], [13, 16], [12, 17], [11, 17], [10, 17], [9, 16]].map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
  const flowerSpots = objects.filter(o => o.type === 'flowers' && ground[o.x][o.y].h === 0);
  const butterflies = [0, 1, 2].map(i => {
    const f = flowerSpots[Math.floor(i * flowerSpots.length / 3)] || { x: 10 + i, y: 18 };
    return { x: f.x + 0.5, y: f.y + 0.5, seed: R() * 10, color: ['#ffffff', '#ffd84d', '#ff9fc0'][i] };
  });

  const world = {
    theme, themeIndex, objects, blocked, ground, spots, userSeat, claudeSeat, elevatorDoor, napSpot, frogSpots, duckLoop, butterflies,
    todos: [], elevatorOpen: 0, key,
    zAt(x, y) {
      const gx = Math.floor(x), gy = Math.floor(y);
      const g = ground[gx] && ground[gx][gy];
      if (!g) return 0;
      if (g.kind === 'room') return ROOM_Z;
      if (g.kind === 'water') return WATER_Z + 2;
      return g.h * BH;
    },
  };
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
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    if (a && c && Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-6) continue;
    out.push(b);
  }
  return out;
}

// ---------------------------------------------------------------- 면 위에 그리기

// 'L'은 x축을 따라 뻗은 면(앞-왼쪽에서 보이는 면), 'R'은 y축을 따라 뻗은 면. 한 칸 = u 32, v는 위로 픽셀.
function onFace(ctx, which, x, y, z, fn) {
  const o = iso(x, y, z);
  ctx.save();
  if (which === 'L') ctx.transform(TW / 2 / 32, TH / 2 / 32, 0, -1, o.x, o.y);
  else ctx.transform(-TW / 2 / 32, TH / 2 / 32, 0, -1, o.x, o.y);
  fn(ctx);
  ctx.restore();
}

// 흙 절벽 옆면: 위에 풀 테두리, 아래로 지층 줄무늬. kind가 색이면 그 색의 단순한 옆면.
function earthSide(ctx, which, x, y, z0, z1, th, seed, kind = 'earth') {
  const h = z1 - z0;
  if (h <= 0) return;
  const R = rand(seed);
  const dark = which === 'R';
  onFace(ctx, which, x, y, z0, g => {
    const base = kind === 'earth' ? th.dirt : kind;
    const c = shade(base, dark ? -0.2 : -0.04);
    const grd = g.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, shade(c, 0.06)); grd.addColorStop(1, shade(c, -0.14));
    g.fillStyle = grd; g.fillRect(0, 0, 32, h);
    if (kind === 'earth') {
      for (let v = h - 12; v > 2; v -= 9 + R() * 4) {
        g.fillStyle = rgba(shade(c, R() < 0.5 ? 0.18 : -0.15), 0.55);
        g.fillRect(0, v - 2, 32, 2.2);
      }
      for (let i = 0; i < 3; i++) ellipse(g, 3 + R() * 26, 3 + R() * Math.max(1, h - 10), 1.6, 1.1, shade(c, -0.25));
      const lip = dark ? shade(th.lip, -0.12) : th.lip;
      g.fillStyle = lip; g.fillRect(0, h - 5, 32, 5);
      for (let u = 2; u < 32; u += 5 + R() * 2) { g.beginPath(); g.arc(u, h - 5, 1.8 + R() * 1.6, Math.PI, 0); g.fill(); }
    }
    g.strokeStyle = rgba(shade(c, -0.45), 0.55); g.lineWidth = 0.8;
    g.strokeRect(0, 0, 32, h);
  });
}

// ---------------------------------------------------------------- 바닥 윗면

function diamondPts(x, y, z, inset = 0) {
  return [iso(x + inset, y + inset, z), iso(x + 1 - inset, y + inset, z), iso(x + 1 - inset, y + 1 - inset, z), iso(x + inset, y + 1 - inset, z)];
}

function grassTop(ctx, x, y, z, g, th, R) {
  const base = th.grass[Math.floor(g.v * th.grass.length)];
  face(ctx, diamondPts(x, y, z), base, rgba(shade(base, -0.3), 0.18), 0.8);
  ctx.save(); path(ctx, diamondPts(x, y, z)); ctx.clip();
  for (let i = 0; i < 2; i++) { const p = iso(x + R(), y + R(), z); ellipse(ctx, p.x, p.y, 9, 4, rgba(shade(base, 0.35), 0.35)); }
  ctx.strokeStyle = shade(base, -0.2); ctx.lineWidth = 1.1; ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const p = iso(x + 0.15 + R() * 0.7, y + 0.15 + R() * 0.7, z);
    ctx.beginPath(); ctx.moveTo(p.x - 2, p.y + 1); ctx.lineTo(p.x - 3, p.y - 3); ctx.moveTo(p.x, p.y + 1); ctx.lineTo(p.x + 0.5, p.y - 4); ctx.moveTo(p.x + 2, p.y + 1); ctx.lineTo(p.x + 3.5, p.y - 2.5); ctx.stroke();
  }
  // 잔디에 흩어진 작은 별꽃
  if (R() < 0.18 && !th.snow) {
    const p = iso(x + 0.2 + R() * 0.6, y + 0.2 + R() * 0.6, z);
    ctx.fillStyle = R() < 0.6 ? '#ffe45c' : '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 1.2 : 3; ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.6); }
    ctx.fill();
  }
  ctx.restore();
}

function pathTop(ctx, x, y, z, th, R) {
  face(ctx, diamondPts(x, y, z), th.mortar);
  ctx.save(); path(ctx, diamondPts(x, y, z)); ctx.clip();
  for (const [u, v] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]]) {
    const p = iso(x + u + (R() - 0.5) * 0.12, y + v + (R() - 0.5) * 0.12, z);
    const rx = 9 + R() * 4, ry = rx * 0.5;
    const c = shade(th.path, (R() - 0.5) * 0.1);
    ellipse(ctx, p.x, p.y + 1, rx, ry, shade(c, -0.22));
    ellipse(ctx, p.x, p.y, rx, ry, c);
    ellipse(ctx, p.x - rx * 0.25, p.y - ry * 0.3, rx * 0.45, ry * 0.35, rgba('#ffffff', 0.4));
  }
  ctx.restore();
}

function plankTop(ctx, x, y, z, color, R, alongX = true, n = 3) {
  for (let j = 0; j < n; j++) {
    const a = j / n, b = (j + 1) / n;
    const c = shade(color, (R() - 0.5) * 0.12);
    const pts = alongX
      ? [iso(x, y + a, z), iso(x + 1, y + a, z), iso(x + 1, y + b, z), iso(x, y + b, z)]
      : [iso(x + a, y, z), iso(x + b, y, z), iso(x + b, y + 1, z), iso(x + a, y + 1, z)];
    face(ctx, pts, c, shade(color, -0.28), 0.8);
    const u = 0.15 + R() * 0.7;
    const s = alongX ? [iso(x + u, y + a, z), iso(x + u, y + b, z)] : [iso(x + a, y + u, z), iso(x + b, y + u, z)];
    ctx.strokeStyle = shade(color, -0.25); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke();
    ctx.strokeStyle = rgba(shade(color, -0.12), 0.6); ctx.lineWidth = 0.6;
    const m = (a + b) / 2, w0 = R() * 0.3, w1 = w0 + 0.3;
    const q = alongX ? [iso(x + w0, y + m, z), iso(x + w1, y + m, z)] : [iso(x + m, y + w0, z), iso(x + m, y + w1, z)];
    ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y); ctx.stroke();
  }
}

function tileTop(ctx, x, y, z, r) {
  const c = (x + y) % 2 ? r.color : r.color2;
  face(ctx, diamondPts(x, y, z), shade(c, -0.12));
  face(ctx, diamondPts(x, y, z, 0.05), c);
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1;
  const a = iso(x + 0.1, y + 0.85, z), b = iso(x + 0.1, y + 0.1, z), d = iso(x + 0.85, y + 0.1, z);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.stroke();
}

function metalTop(ctx, x, y, z, color) {
  face(ctx, diamondPts(x, y, z), shade(color, -0.15));
  face(ctx, diamondPts(x, y, z, 0.04), color, shade(color, -0.3), 0.8);
  for (const [u, v] of [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]) {
    const p = iso(x + u, y + v, z);
    ellipse(ctx, p.x, p.y, 1.6, 0.9, shade(color, -0.35));
    ellipse(ctx, p.x - 0.4, p.y - 0.3, 0.7, 0.4, '#ffffff');
  }
  ctx.strokeStyle = rgba(shade(color, -0.3), 0.6); ctx.lineWidth = 0.8;
  for (const v of [0.4, 0.6]) { const a = iso(x + 0.3, y + v, z), b = iso(x + 0.7, y + v, z); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
}

function brickTop(ctx, x, y, z, color, R) {
  face(ctx, diamondPts(x, y, z), '#f3e4d6');
  const rows = 4;
  for (let j = 0; j < rows; j++) {
    const off = j % 2 ? 0.25 : 0;
    for (let i = -1; i < 2; i++) {
      const u0 = Math.max(0, i * 0.5 + off), u1 = Math.min(1, i * 0.5 + off + 0.5);
      if (u1 <= u0) continue;
      const pts = [iso(x + u0 + 0.02, y + j / rows + 0.02, z), iso(x + u1 - 0.02, y + j / rows + 0.02, z), iso(x + u1 - 0.02, y + (j + 1) / rows - 0.02, z), iso(x + u0 + 0.02, y + (j + 1) / rows - 0.02, z)];
      face(ctx, pts, shade(color, (R() - 0.5) * 0.14));
    }
  }
}

function waterPit(ctx, world, x, y, th, R) {
  const isW = (a, b) => world.ground[a] && world.ground[a][b] && world.ground[a][b].kind === 'water';
  if (!isW(x - 1, y)) earthSide(ctx, 'R', x, y, WATER_Z - 4, 0, th, R() * 1e6 | 0, shade(th.dirt, -0.15));
  if (!isW(x, y - 1)) earthSide(ctx, 'L', x, y, WATER_Z - 4, 0, th, R() * 1e6 | 0, shade(th.dirt, -0.05));
  const pts = diamondPts(x, y, WATER_Z);
  const a = iso(x, y, WATER_Z), b = iso(x + 1, y + 1, WATER_Z);
  const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  g.addColorStop(0, shade(th.water, -0.12)); g.addColorStop(1, shade(th.water, 0.18));
  face(ctx, pts, g);
  ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  if (!isW(x - 1, y)) { const p = iso(x, y + 0.08, WATER_Z), q = iso(x, y + 0.92, WATER_Z); ctx.beginPath(); ctx.moveTo(p.x + 3, p.y); ctx.lineTo(q.x + 3, q.y); ctx.stroke(); }
  if (!isW(x, y - 1)) { const p = iso(x + 0.08, y, WATER_Z), q = iso(x + 0.92, y, WATER_Z); ctx.beginPath(); ctx.moveTo(p.x - 3, p.y); ctx.lineTo(q.x - 3, q.y); ctx.stroke(); }
}

// ---------------------------------------------------------------- 바닥 전체를 미리 그려 둔다

export const BOUNDS = (() => {
  const minX = iso(-4, GH + 2).x, maxX = iso(GW + 2, -4).x;
  const minY = iso(-4, -4).y - 200, maxY = iso(GW, GH).y + DEPTH + 30;
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
})();

function renderGround(world) {
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = Math.ceil(BOUNDS.w * scale); c.height = Math.ceil(BOUNDS.h * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.translate(-BOUNDS.minX, -BOUNDS.minY);
  const th = world.theme;
  const R = rand(99 + world.themeIndex);

  // 멀리 보이는 계단식 고원 (안개 낀 색)
  const haze = th.sky[1];
  const far = [];
  for (let i = -4; i < GW - 4; i += 2) far.push([i, -4]);
  for (let j = -2; j < GH - 6; j += 2) far.push([-4, j]);
  far.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  for (const [x, y] of far) {
    const hgt = 70 + R() * 90;
    const dirt = mix(th.mesa, haze, 0.45);
    box(ctx, x, y, -DEPTH, 2, 2, hgt + DEPTH, dirt, { top: mix(th.grass[0], haze, 0.5), line: mix(dirt, '#7a6a5a', 0.25), bevel: false });
  }

  const order = [];
  for (let x = 0; x < GW; x++) for (let y = 0; y < GH; y++) order.push([x, y]);
  order.sort((a, b) => a[0] + a[1] - b[0] - b[1] || a[0] - b[0]);
  const G = world.ground;
  const topZ = (x, y) => {
    if (x < 0 || y < 0 || x >= GW || y >= GH) return -DEPTH;
    const g = G[x][y];
    return g.kind === 'room' ? ROOM_Z : g.kind === 'water' ? 0 : g.h * BH;
  };
  for (const [x, y] of order) {
    const g = G[x][y];
    const z = topZ(x, y);
    const seed = (x * 73 + y * 151 + world.themeIndex * 7) | 0;
    // 옆면: 섬 가장자리, 언덕, 방 마루
    if (y === GH - 1) earthSide(ctx, 'L', x, y + 1, -DEPTH, z, th, seed);
    if (x === GW - 1) earthSide(ctx, 'R', x + 1, y, -DEPTH, z, th, seed + 1);
    if (g.kind === 'room') {
      const r = ROOMS[g.room];
      if (y < GH - 1 && topZ(x, y + 1) < z) earthSide(ctx, 'L', x, y + 1, topZ(x, y + 1), z, th, seed, shade(r.color, -0.3));
      if (x < GW - 1 && topZ(x + 1, y) < z) earthSide(ctx, 'R', x + 1, y, topZ(x + 1, y), z, th, seed, shade(r.color, -0.3));
    } else if (g.h > 0) {
      if (y < GH - 1 && topZ(x, y + 1) < z) earthSide(ctx, 'L', x, y + 1, Math.max(0, topZ(x, y + 1)), z, th, seed);
      if (x < GW - 1 && topZ(x + 1, y) < z) earthSide(ctx, 'R', x + 1, y, Math.max(0, topZ(x + 1, y)), z, th, seed + 1);
    }
    // 윗면
    if (g.kind === 'grass') grassTop(ctx, x, y, z, g, th, R);
    else if (g.kind === 'path') pathTop(ctx, x, y, z, th, R);
    else if (g.kind === 'water') waterPit(ctx, world, x, y, th, R);
    else {
      const r = ROOMS[g.room];
      if (r.floor === 'wood') plankTop(ctx, x, y, z, r.color, R, true);
      else if (r.floor === 'deck') plankTop(ctx, x, y, z, r.color, R, false, 4);
      else if (r.floor === 'tile') tileTop(ctx, x, y, z, r);
      else if (r.floor === 'metal') metalTop(ctx, x, y, z, r.color);
      else if (r.floor === 'brick') brickTop(ctx, x, y, z, r.color, R);
    }
  }
  return c;
}

// ---------------------------------------------------------------- 소품 (모두 자기 자리 (0,0)을 기준으로 그린다)

const BOOKS = ['#e8604c', '#4fa3e0', '#f2c14e', '#6cc070', '#b07fd8', '#f08fb0', '#ffffff', '#ff9a4d'];

function shelfArt(g, o) {
  const wood = '#b97a45';
  box(g, 0.04, 0.08, 0, 0.92, 0.84, 60, wood);
  const R = rand(Math.floor(o.seed * 1e6));
  const which = o.face === 'y' ? 'L' : 'R';
  const ox = o.face === 'y' ? 0.04 : 0.96, oy = o.face === 'y' ? 0.92 : 0.08;
  onFace(g, which, ox, oy, 0, f => {
    const W = 0.92 * 32;
    f.fillStyle = shade(wood, -0.15); f.fillRect(0, 0, W, 60);
    for (let s = 0; s < 3; s++) {
      const v0 = 5 + s * 18, v1 = v0 + 15;
      f.fillStyle = '#5b3a22'; f.fillRect(2, v0, W - 4, 15);
      let u = 3;
      while (u < W - 4) {
        const bw = 2.2 + R() * 2;
        const bh = 9 + R() * 5;
        if (u + bw > W - 3) break;
        const col = BOOKS[Math.floor(R() * BOOKS.length)];
        f.fillStyle = col; f.fillRect(u, v0, bw, bh);
        f.fillStyle = rgba('#ffffff', 0.35); f.fillRect(u, v0 + bh - 2, bw, 1);
        f.fillStyle = rgba(shade(col, -0.4), 0.6); f.fillRect(u + bw - 0.5, v0, 0.5, bh);
        u += bw + 0.3;
        if (R() < 0.12) u += 2;
      }
      f.fillStyle = shade(wood, 0.1); f.fillRect(0, v1, W, 2.5);
    }
    f.fillStyle = shade(wood, 0.12); f.fillRect(0, 0, 2.5, 60); f.fillRect(W - 2.5, 0, 2.5, 60);
  });
}

function tableArt(g, o) {
  const c = o.color || '#c98e55';
  groundShadow(g, 0, 0, o.w, o.d, 0.2);
  for (const [dx, dy] of [[0.12, 0.12], [o.w - 0.22, 0.12], [0.12, o.d - 0.22], [o.w - 0.22, o.d - 0.22]]) box(g, dx, dy, 0, 0.1, 0.1, 14, shade(c, -0.2), { bevel: false });
  box(g, 0.02, 0.02, 14, o.w - 0.04, o.d - 0.04, 5, c);
  // 테이블 위 소품: 책 한 권과 머그컵
  const p = iso(o.w * 0.35, o.d * 0.4, 19);
  g.fillStyle = '#4fa3e0'; g.beginPath(); g.moveTo(p.x - 8, p.y); g.lineTo(p.x, p.y - 4); g.lineTo(p.x + 8, p.y); g.lineTo(p.x, p.y + 4); g.closePath(); g.fill();
  const q = iso(o.w * 0.7, o.d * 0.6, 19);
  g.fillStyle = '#fff'; g.fillRect(q.x - 3, q.y - 5, 6, 5);
  ellipse(g, q.x, q.y - 5, 3, 1.4, '#8a5a2b');
}

function deskArt(g, o) {
  const w = o.w || 1;
  groundShadow(g, 0, 0.05, w, 0.95, 0.2);
  // 노란 상판에 하얀 몸통의 작업대
  box(g, 0.08, 0.15, 0, w - 0.16, 0.75, 15, '#f7f4ec');
  box(g, 0.03, 0.08, 15, w - 0.06, 0.88, 4, o.owner ? '#f6d25a' : '#ffe08a');
  if (o.monitor) {
    const mx = w / 2 - 0.3;
    box(g, mx + 0.22, 0.3, 19, 0.16, 0.16, 4, '#cfc6b4');
    // 동글동글한 옛날 컴퓨터
    box(g, mx, 0.2, 23, 0.6, 0.32, 20, '#efe6d2', { line: '#9c8f74' });
  }
  if (o.lamp) {
    // 주황색 스탠드
    const p = iso(w - 0.25, 0.3, 19);
    g.strokeStyle = '#e07a2e'; g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - 3, p.y - 12); g.lineTo(p.x + 5, p.y - 20); g.stroke();
    ellipse(g, p.x, p.y, 5, 2, '#e07a2e');
    g.fillStyle = '#f39a3d'; g.beginPath(); g.moveTo(p.x + 2, p.y - 24); g.lineTo(p.x + 12, p.y - 18); g.lineTo(p.x + 6, p.y - 13); g.closePath(); g.fill();
    g.strokeStyle = '#b85f20'; g.lineWidth = 1; g.stroke();
  }
  if (o.phone) {
    const p = iso(w - 0.35, 0.35, 19);
    ellipse(g, p.x, p.y, 7, 3.5, '#e8483f', '#8f2620');
    ellipse(g, p.x, p.y - 3, 6, 2.2, '#f06a5f', '#8f2620');
  }
}

function deskLive(g, o, t, busy, ring) {
  const w = o.w || 1;
  if (o.monitor) {
    const mx = w / 2 - 0.3;
    onFace(g, 'L', mx + 0.06, 0.52, 26, f => {
      f.fillStyle = busy ? '#1f2c3d' : '#7aa6b8'; f.fillRect(0, 0, 0.48 * 32, 14);
      if (busy) {
        const colors = ['#7fdcff', '#ffd36e', '#a6f08b', '#ff9bd2'];
        const off = (t * 10 + o.seed * 30) % 3;
        f.save(); f.beginPath(); f.rect(0, 0, 0.48 * 32, 14); f.clip();
        for (let i = 0; i < 6; i++) {
          const v = 14 - (i * 2.6 + off);
          const len = 3 + ((i * 7 + Math.floor(t * 3)) % 8);
          f.fillStyle = colors[(i + Math.floor(t)) % 4]; f.fillRect(1.5 + (i % 3) * 1.5, v - 1.2, len, 1.2);
        }
        f.restore();
      } else {
        f.fillStyle = 'rgba(255,255,255,.45)'; f.fillRect(1.5, 9, 4, 3);
      }
    });
  }
  if (o.phone && ring) {
    const p = iso(w - 0.35, 0.35, 24);
    g.strokeStyle = 'rgba(232,72,63,.8)'; g.lineWidth = 1.4;
    for (let i = 1; i <= 2; i++) { g.beginPath(); g.arc(p.x, p.y, 5 * i + (t * 10 % 4), -2.5, -0.6); g.stroke(); }
  }
}

function rackArt(g) {
  groundShadow(g, 0, 0.05, 1, 0.95, 0.22);
  box(g, 0.12, 0.18, 0, 0.76, 0.66, 62, '#4f5d73', { line: '#2b3444' });
  box(g, 0.1, 0.16, 62, 0.8, 0.7, 4, '#6b7b94', { line: '#2b3444' });
  onFace(g, 'L', 0.12, 0.84, 0, f => {
    for (let i = 0; i < 6; i++) {
      f.fillStyle = i % 2 ? '#3e4a5d' : '#465469'; f.fillRect(2, 5 + i * 9.5, 0.76 * 32 - 4, 8);
      f.fillStyle = 'rgba(255,255,255,.12)'; f.fillRect(9, 8 + i * 9.5, 12, 1.2);
    }
  });
}

function rackLive(g, o, t, busy) {
  onFace(g, 'L', 0.12, 0.84, 0, f => {
    const speed = busy ? 14 : 2.2;
    for (let i = 0; i < 6; i++) {
      const on = Math.sin(t * speed + i * 1.7 + o.seed * 20) > 0;
      f.fillStyle = on ? (i % 3 === 0 ? '#ff7a7a' : '#7dffaa') : '#29443a';
      f.fillRect(4, 8 + i * 9.5, 2.4, 2.4);
      const on2 = Math.sin(t * speed * 1.3 + i * 2.3 + o.seed * 9) > 0.3;
      f.fillStyle = on2 ? '#ffd36e' : '#3a3a2a'; f.fillRect(4, 11.5 + i * 9.5, 2.4, 1.4);
    }
  });
}

function boardArt(g, o) {
  for (const x of [0.1, o.w - 0.22]) box(g, x, 0.42, 0, 0.12, 0.12, 30, '#8a5d36', { bevel: false });
  box(g, 0, 0.42, 22, o.w, 0.12, 42, '#a8703f');
  onFace(g, 'L', 0, 0.54, 22, f => {
    f.fillStyle = '#d9a86a'; f.fillRect(3, 3, o.w * 32 - 6, 36);
    const R = rand(7);
    f.fillStyle = 'rgba(140,90,40,.25)';
    for (let i = 0; i < 40; i++) f.fillRect(4 + R() * (o.w * 32 - 8), 4 + R() * 34, 0.8, 0.8);
  });
}

const NOTE = ['#fff3a3', '#ffd1e3', '#cdeaff', '#d8f5c4'];
function boardLive(g, o, world) {
  const todos = world.todos.slice(0, 6);
  onFace(g, 'L', 0, 0.54, 22, f => {
    if (!todos.length) {
      f.save(); f.translate(0, 36); f.scale(1, -1);
      f.fillStyle = '#7a5530'; f.font = '6px sans-serif'; f.fillText('오늘의 할 일', 6, 8);
      f.restore();
      return;
    }
    todos.forEach((td, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const w = (o.w * 32 - 10) / 3 - 3;
      const u = 5 + col * (w + 3), v = 36 - 3 - row * 17;
      f.fillStyle = td.s === 'completed' ? '#d8f5c4' : NOTE[i % NOTE.length];
      f.fillRect(u, v - 14, w, 14);
      f.fillStyle = '#e8483f'; f.beginPath(); f.arc(u + w / 2, v - 1.5, 1.2, 0, Math.PI * 2); f.fill();
      f.save(); f.translate(u, v); f.scale(1, -1);
      f.fillStyle = td.s === 'completed' ? '#3f7a2e' : td.s === 'in_progress' ? '#b45a12' : '#5a4a36';
      f.font = 'bold 4.6px sans-serif';
      const mark = td.s === 'completed' ? '✔' : td.s === 'in_progress' ? '▶' : '・';
      const txt = (mark + td.c).slice(0, 14);
      f.fillText(txt.slice(0, 7), 1.5, 6.5);
      f.fillText(txt.slice(7, 14), 1.5, 11.5);
      f.restore();
    });
  });
}

function kioskArt(g) {
  groundShadow(g, 0, 0, 1, 1, 0.2);
  box(g, 0.32, 0.32, 0, 0.36, 0.36, 26, '#7b67c9');
  box(g, 0.18, 0.18, 26, 0.64, 0.64, 6, '#5b4aa8');
}

function kioskLive(g, t, busy) {
  const pts = [iso(0.22, 0.22, 33), iso(0.78, 0.22, 33), iso(0.78, 0.78, 33), iso(0.22, 0.78, 33)];
  face(g, pts, busy ? `hsl(${190 + Math.sin(t * 4) * 15},90%,${70 + Math.sin(t * 6) * 8}%)` : '#cfd8ff', '#3a2f80');
  const c = iso(0.5, 0.5, 33);
  ellipse(g, c.x - 1, c.y - 1, 4, 2.2, null, '#4a3fa0', 1.4);
  g.strokeStyle = '#4a3fa0'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(c.x + 2, c.y + 1); g.lineTo(c.x + 5, c.y + 3); g.stroke();
}

function globeLive(g, t, busy) {
  box(g, 0.36, 0.36, 0, 0.28, 0.28, 8, '#8a5d36');
  const c = iso(0.5, 0.5, 8);
  g.strokeStyle = '#8a5d36'; g.lineWidth = 2; g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(c.x, c.y - 14); g.stroke();
  const p = iso(0.5, 0.5, 28);
  const grd = g.createRadialGradient(p.x - 4, p.y - 5, 1, p.x, p.y, 13);
  grd.addColorStop(0, '#9be0ff'); grd.addColorStop(1, '#2f8fc8');
  g.beginPath(); g.arc(p.x, p.y, 12, 0, Math.PI * 2); g.fillStyle = grd; g.fill(); g.strokeStyle = '#1f6a99'; g.lineWidth = 1.2; g.stroke();
  const spin = t * (busy ? 2.5 : 0.35);
  g.save(); g.beginPath(); g.arc(p.x, p.y, 12, 0, Math.PI * 2); g.clip();
  for (let i = 0; i < 4; i++) { const lx = p.x + ((spin * 10 + i * 8) % 32) - 16; ellipse(g, lx, p.y - 4 + (i % 3) * 4, 4.5, 3, '#7ccf6a'); }
  g.restore();
  g.strokeStyle = '#c99a5b'; g.lineWidth = 1.6; g.beginPath(); g.arc(p.x, p.y, 14, -2.2, 0.9); g.stroke();
}

function antennaArt(g) {
  groundShadow(g, 0, 0, 1, 1, 0.18);
  const b = iso(0.5, 0.5, 0), t = iso(0.5, 0.5, 74);
  g.strokeStyle = '#e8eef4'; g.lineWidth = 2.4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(b.x - 9, b.y); g.lineTo(t.x, t.y); g.lineTo(b.x + 9, b.y); g.stroke();
  g.strokeStyle = '#e8483f'; g.lineWidth = 1.4;
  for (let i = 1; i < 5; i++) {
    const y = b.y - i * 15, w = 9 * (1 - i / 5);
    g.beginPath(); g.moveTo(b.x - w, y); g.lineTo(b.x + w, y - 4); g.stroke();
  }
}

function antennaLive(g, t, busy) {
  const p = iso(0.5, 0.5, 76);
  ellipse(g, p.x, p.y, 4, 4, Math.sin(t * 5) > 0 || busy ? '#ff5a5a' : '#a23a3a', '#7a1f1f');
  if (busy) {
    g.strokeStyle = 'rgba(255,90,90,.75)'; g.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) { const r = ((t * 20 + i * 10) % 30) + 6; g.globalAlpha = 1 - r / 36; g.beginPath(); g.arc(p.x, p.y, r, -2.6, -0.5); g.stroke(); }
    g.globalAlpha = 1;
  }
}

function cafeArt(g, o) {
  groundShadow(g, 0, 0, 1, 1, 0.22);
  box(g, 0.44, 0.44, 0, 0.12, 0.12, 14, '#8a5d36', { bevel: false });
  const top = iso(0.5, 0.5, 14);
  ellipse(g, top.x, top.y + 1.5, 15, 7.5, '#d7cbb5');
  ellipse(g, top.x, top.y, 15, 7.5, '#fbf7ee', '#b9a98c');
  ellipse(g, top.x + 4, top.y - 2, 2.6, 1.3, '#ffffff', '#c9b9a0', 0.8);
  // 줄무늬 파라솔
  const pole = iso(0.5, 0.5, 46);
  g.strokeStyle = '#8a5d36'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(pole.x, pole.y); g.stroke();
  const cols = o.seed > 0.5 ? ['#ff6b6b', '#ffffff'] : ['#4fb3f0', '#ffffff'];
  for (let i = 0; i < 8; i++) {
    const a0 = i / 8 * Math.PI * 2, a1 = (i + 1) / 8 * Math.PI * 2;
    g.beginPath(); g.moveTo(pole.x, pole.y - 5);
    g.lineTo(pole.x + Math.cos(a0) * 24, pole.y + Math.sin(a0) * 11 + 3);
    g.lineTo(pole.x + Math.cos(a1) * 24, pole.y + Math.sin(a1) * 11 + 3);
    g.closePath(); g.fillStyle = cols[i % 2]; g.fill();
  }
  g.strokeStyle = 'rgba(120,60,60,.45)'; g.lineWidth = 1;
  g.beginPath(); g.ellipse(pole.x, pole.y + 3, 24, 11, 0, 0, Math.PI * 2); g.stroke();
}

function sofaArt(g, o) {
  groundShadow(g, 0, 0, o.w, 1, 0.2);
  const c = '#ef8e7c';
  box(g, 0.02, 0.15, 0, o.w - 0.04, 0.75, 10, c);
  box(g, 0.02, 0.15, 10, o.w - 0.04, 0.22, 14, shade(c, 0.05));
  box(g, 0.02, 0.15, 10, 0.18, 0.75, 8, shade(c, -0.05));
  box(g, o.w - 0.2, 0.15, 10, 0.18, 0.75, 8, shade(c, -0.05));
  const p = iso(o.w * 0.35, 0.55, 13);
  ellipse(g, p.x, p.y - 2, 6, 4, '#fff2c4', '#d9b45a');
}

// 엘리베이터 건물: 돌 기단, 크림색 벽, 민트색 뾰족 지붕, 꼭대기에 별꽃 풍향계
function elevatorArt(g, o) {
  groundShadow(g, -0.15, -0.15, o.w + 0.3, o.d + 0.4, 0.26);
  box(g, -0.05, -0.05, 0, o.w + 0.1, o.d + 0.1, 10, '#bdb5a8', { line: '#7a746a' });
  for (const [which, x, y, len] of [['L', -0.05, o.d + 0.05, o.w + 0.1], ['R', o.w + 0.05, -0.05, o.d + 0.1]]) {
    onFace(g, which, x, y, 0, f => {
      f.strokeStyle = 'rgba(90,84,76,.55)'; f.lineWidth = 0.8;
      f.beginPath(); f.moveTo(0, 5); f.lineTo(len * 32, 5); f.stroke();
      for (let u = 6; u < len * 32; u += 12) { f.beginPath(); f.moveTo(u, 5); f.lineTo(u, 10); f.moveTo(u + 6, 0); f.lineTo(u + 6, 5); f.stroke(); }
    });
  }
  box(g, 0, 0, 10, o.w, o.d, 62, '#fbf3e4', { line: '#b8a88a' });
  // 모서리 나무 기둥
  for (const [x, y] of [[0, o.d - 0.12], [o.w - 0.12, o.d - 0.12], [o.w - 0.12, 0]]) box(g, x, y, 10, 0.12, 0.12, 62, '#c98e55', { bevel: false });
  // 오른쪽 벽 창문과 꽃 상자
  onFace(g, 'R', o.w, 0.3, 30, f => {
    f.fillStyle = '#9fe0ea'; f.beginPath(); f.roundRect(4, 4, 20, 24, [10, 10, 2, 2]); f.fill();
    f.strokeStyle = '#ffffff'; f.lineWidth = 2.2; f.stroke();
    f.beginPath(); f.moveTo(14, 4); f.lineTo(14, 28); f.moveTo(4, 14); f.lineTo(24, 14); f.stroke();
    f.fillStyle = 'rgba(255,255,255,.5)'; f.fillRect(6, 17, 3, 8);
  });
  box(g, o.w, 0.35, 26, 0.12, 0.7, 5, '#c98e55', { bevel: false });
  for (const [v, col] of [[0.45, '#ff8fb1'], [0.65, '#ffd84d'], [0.85, '#ffffff']]) {
    const p = iso(o.w + 0.06, v, 33);
    ellipse(g, p.x, p.y, 3.4, 2.4, '#5cba4b', '#3d7a2c', 0.8);
    ellipse(g, p.x, p.y - 2, 2, 2, col, shade(col, -0.35), 0.8);
  }
  // 처마 띠
  box(g, -0.12, -0.12, 72, o.w + 0.24, o.d + 0.24, 5, '#c98e55', { line: '#7a5530' });
  // 뾰족 지붕 (네 면 중 앞 두 면이 보인다)
  const e = 0.16, z0 = 77;
  const A = iso(-e, -e, z0), B = iso(o.w + e, -e, z0), C = iso(o.w + e, o.d + e, z0), D = iso(-e, o.d + e, z0);
  const apex = iso(o.w / 2, o.d / 2, z0 + 58);
  const roof = '#4fb8a6';
  const tri = (p, q, col) => face(g, [p, q, apex], col, '#2c7a6c', 1.3);
  tri(A, B, shade(roof, -0.3)); tri(A, D, shade(roof, -0.1));
  tri(D, C, roof); tri(B, C, shade(roof, -0.22));
  // 기와 비늘
  const lerp = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  for (const [p, q, col] of [[D, C, roof], [B, C, shade(roof, -0.22)]]) {
    for (let k = 1; k <= 4; k++) {
      const a = lerp(p, apex, k / 5), b = lerp(q, apex, k / 5);
      const n = 7 - k;
      g.strokeStyle = shade(col, -0.25); g.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const m0 = lerp(a, b, i / n), m1 = lerp(a, b, (i + 1) / n);
        const mx = (m0.x + m1.x) / 2, my = (m0.y + m1.y) / 2;
        g.beginPath(); g.moveTo(m0.x, m0.y); g.quadraticCurveTo(mx, my + 4, m1.x, m1.y); g.stroke();
      }
    }
  }
  g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(lerp(D, apex, 0.08).x, lerp(D, apex, 0.08).y); g.lineTo(lerp(D, apex, 0.85).x, lerp(D, apex, 0.85).y); g.stroke();
  // 둥근 지붕창
  const w0 = lerp(lerp(D, C, 0.5), apex, 0.32);
  ellipse(g, w0.x, w0.y, 7, 7, '#fbf3e4', '#2c7a6c', 1.3);
  ellipse(g, w0.x, w0.y, 4.6, 4.6, '#9fe0ea', '#ffffff', 1.2);
  // 별꽃 풍향계
  g.strokeStyle = '#6b4a30'; g.lineWidth = 1.8;
  g.beginPath(); g.moveTo(apex.x, apex.y); g.lineTo(apex.x, apex.y - 16); g.stroke();
  const st = { x: apex.x, y: apex.y - 20 };
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    g.save(); g.translate(st.x + Math.cos(a) * 3.6, st.y + Math.sin(a) * 3.6); g.rotate(a + Math.PI / 2);
    ellipse(g, 0, 0, 1.9, 3.6, '#ffcf3a', '#b88a10', 1);
    g.restore();
  }
  ellipse(g, st.x, st.y, 2, 2, '#ff9a5a', '#b05a20', 1);
}

function elevatorLive(g, o, world, live) {
  const open = world.elevatorOpen;
  onFace(g, 'L', 0.45, o.d, 10, f => {
    const W = 1.1 * 32;
    f.fillStyle = '#2f4d58'; f.fillRect(0, 0, W, 50);
    const gap = W * 0.5 * open * 0.9;
    f.fillStyle = '#6fd0dc';
    f.fillRect(0, 0, W / 2 - gap, 50); f.fillRect(W / 2 + gap, 0, W / 2 - gap, 50);
    f.fillStyle = 'rgba(255,255,255,.45)';
    f.fillRect(3, 6, 3, 38); f.fillRect(W / 2 + gap + 3, 6, 3, 38);
    f.strokeStyle = '#3a8a96'; f.lineWidth = 1.4; f.strokeRect(0, 0, W, 50);
  });
  const p = iso(1, o.d, 66);
  g.fillStyle = '#2b2621'; g.beginPath(); g.roundRect(p.x - 17, p.y - 8, 34, 14, 4); g.fill();
  g.fillStyle = '#ffb347'; g.font = 'bold 10px monospace'; g.textAlign = 'center';
  g.fillText((open > 0.05 ? '▲' : '') + live.floorLabel, p.x, p.y + 3);
}

function plantArt(g, o, th) {
  groundShadow(g, 0.15, 0.15, 0.7, 0.7, 0.2);
  box(g, 0.3, 0.3, 0, 0.4, 0.4, 12, '#e4834f');
  box(g, 0.27, 0.27, 12, 0.46, 0.46, 3, '#f09a62');
  const p = iso(0.5, 0.5, 26);
  puff(g, [[p.x - 6, p.y + 2, 7], [p.x + 6, p.y + 2, 7], [p.x, p.y - 5, 8], [p.x, p.y + 4, 6]], th.leaf[0]);
}

function treeArt(g, o, th) {
  const s = o.size || 1;
  const R = rand(Math.floor(o.seed * 1e6));
  groundShadow(g, -0.1, -0.1, 1.2, 1.2, 0.28);
  const c = iso(0.5, 0.5);
  // 줄기
  const tw = 5 * s, tTop = c.y - 30 * s;
  const tg = g.createLinearGradient(c.x - tw, 0, c.x + tw, 0);
  tg.addColorStop(0, shade(th.trunk, 0.15)); tg.addColorStop(1, shade(th.trunk, -0.25));
  g.beginPath(); g.moveTo(c.x - tw - 3, c.y + 2); g.quadraticCurveTo(c.x - tw, c.y - 6, c.x - tw * 0.8, tTop);
  g.lineTo(c.x + tw * 0.8, tTop); g.quadraticCurveTo(c.x + tw, c.y - 6, c.x + tw + 3, c.y + 2); g.closePath();
  g.fillStyle = tg; g.fill(); g.strokeStyle = shade(th.trunk, -0.45); g.lineWidth = 1.2; g.stroke();
  // 몽글몽글한 수관
  const cy = c.y - 46 * s;
  const leaf = th.leaf[Math.floor(o.seed * th.leaf.length)];
  const blobs = [[0, 8, 17], [-15, 4, 13], [15, 4, 13], [-8, -8, 14], [9, -8, 14], [0, -16, 12], [-17, -6, 9], [17, -6, 9], [0, 14, 12]]
    .map(([x, y, r]) => [c.x + x * s, cy + y * s, r * s]);
  puff(g, blobs, leaf);
  if (th.snow) {
    for (const [x, y, r] of blobs) if (y < cy) ellipse(g, x, y - r * 0.55, r * 0.75, r * 0.35, '#ffffff');
  }
  // 열매
  const berry = th.berries[Math.floor(R() * th.berries.length)];
  const n = 2 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    const [bx, by, br] = blobs[1 + Math.floor(R() * (blobs.length - 1))];
    const a = R() * Math.PI * 2, x = bx + Math.cos(a) * br * 0.6, y = by + Math.abs(Math.sin(a)) * br * 0.5;
    ellipse(g, x, y, 3.2 * s, 3.2 * s, berry, shade(berry, -0.45), 1);
    ellipse(g, x - 1, y - 1.2, 1, 1, '#ffffff');
  }
}

function palmArt(g, o, th) {
  groundShadow(g, -0.1, -0.1, 1.2, 1.2, 0.24);
  const c = iso(0.5, 0.5);
  g.strokeStyle = shade(th.trunk, -0.35); g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(c.x, c.y); g.quadraticCurveTo(c.x + 8, c.y - 30, c.x + 4, c.y - 56); g.stroke();
  g.strokeStyle = th.trunk; g.lineWidth = 5; g.stroke();
  const top = { x: c.x + 4, y: c.y - 56 };
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2 + o.seed * 3;
    const ex = top.x + Math.cos(a) * 28, ey = top.y + Math.sin(a) * 12 + 8;
    g.beginPath(); g.moveTo(top.x, top.y);
    g.quadraticCurveTo(top.x + Math.cos(a) * 16, top.y + Math.sin(a) * 7 - 10, ex, ey);
    g.quadraticCurveTo(top.x + Math.cos(a) * 12, top.y + Math.sin(a) * 5 - 2, top.x, top.y);
    g.fillStyle = th.leaf[i % th.leaf.length]; g.fill(); g.strokeStyle = shade(th.leaf[0], -0.4); g.lineWidth = 1; g.stroke();
  }
  ellipse(g, top.x - 3, top.y + 3, 3.5, 3.5, '#8a5d36'); ellipse(g, top.x + 3, top.y + 4, 3.5, 3.5, '#7a4d2a');
}

function bushArt(g, o, th) {
  const R = rand(Math.floor(o.seed * 1e6));
  groundShadow(g, 0, 0, 1, 1, 0.22);
  const c = iso(0.5, 0.5);
  const leaf = shade(th.leaf[Math.floor(o.seed * th.leaf.length)], 0.05);
  const blobs = [[-8, -6, 9], [8, -6, 9], [0, -12, 10], [0, -3, 9]].map(([x, y, r]) => [c.x + x, c.y + y, r]);
  puff(g, blobs, leaf);
  if (th.snow) ellipse(g, c.x, c.y - 19, 9, 4, '#ffffff');
  else if (o.seed > 0.5) {
    const col = th.flowers[Math.floor(R() * th.flowers.length)];
    for (let i = 0; i < 4; i++) { const x = c.x - 10 + R() * 20, y = c.y - 16 + R() * 12; ellipse(g, x, y, 2.2, 2.2, col, shade(col, -0.35), 0.8); }
  }
}

function rockArt(g, o) {
  groundShadow(g, 0.05, 0.05, 0.9, 0.9, 0.2);
  const c = iso(0.5, 0.5);
  const grd = g.createRadialGradient(c.x - 5, c.y - 12, 2, c.x, c.y - 6, 18);
  grd.addColorStop(0, '#e6e1d8'); grd.addColorStop(1, '#9a948a');
  g.beginPath();
  g.moveTo(c.x - 14, c.y); g.quadraticCurveTo(c.x - 16, c.y - 12, c.x - 6, c.y - 16);
  g.quadraticCurveTo(c.x + 4, c.y - 20, c.x + 12, c.y - 11); g.quadraticCurveTo(c.x + 17, c.y - 3, c.x + 12, c.y + 2);
  g.quadraticCurveTo(c.x, c.y + 5, c.x - 14, c.y); g.closePath();
  g.fillStyle = grd; g.fill(); g.strokeStyle = '#6a655d'; g.lineWidth = 1.4; g.stroke();
  if (o.seed > 0.4) ellipse(g, c.x + 9, c.y - 2, 5, 3, '#8fae6a');
}

// 뭔가 숨어 있을 것 같은 풀숲
function tallGrassArt(g, o, th) {
  const R = rand(Math.floor(o.seed * 1e6));
  const c = iso(0.5, 0.5);
  const base = th.snow ? '#7fb8a0' : th.key === 'mesa' ? '#9cc44a' : '#56b84a';
  const blades = [];
  for (let i = 0; i < 14; i++) blades.push({ x: c.x + (R() - 0.5) * 30, y: c.y + (R() - 0.5) * 12, h: 14 + R() * 10, lean: (R() - 0.5) * 8, light: R() < 0.5 });
  blades.sort((a, b) => a.y - b.y);
  for (const b of blades) {
    const col = b.light ? shade(base, 0.2) : base;
    g.beginPath();
    g.moveTo(b.x - 4, b.y);
    g.quadraticCurveTo(b.x - 2 + b.lean * 0.3, b.y - b.h * 0.6, b.x + b.lean, b.y - b.h);
    g.quadraticCurveTo(b.x + 2 + b.lean * 0.3, b.y - b.h * 0.6, b.x + 4, b.y);
    g.closePath();
    const grd = g.createLinearGradient(0, b.y - b.h, 0, b.y);
    grd.addColorStop(0, shade(col, 0.25)); grd.addColorStop(1, shade(col, -0.2));
    g.fillStyle = grd; g.fill(); g.strokeStyle = shade(base, -0.45); g.lineWidth = 0.9; g.stroke();
  }
}

function flowerArt(g, o, th) {
  const R = rand(Math.floor(o.seed * 1e6));
  const c = iso(0.5, 0.5);
  const col = th.flowers[Math.floor(R() * th.flowers.length)];
  const leaf = shade(th.leaf[1], -0.1);
  for (let i = 0; i < 5; i++) ellipse(g, c.x + (R() - 0.5) * 26, c.y + (R() - 0.5) * 10, 6, 3, leaf, shade(leaf, -0.35), 0.8);
  const fl = [];
  for (let i = 0; i < 6; i++) fl.push([c.x + (R() - 0.5) * 26, c.y - 3 + (R() - 0.5) * 10]);
  fl.sort((a, b) => a[1] - b[1]);
  for (const [x, y] of fl) {
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; ellipse(g, x + Math.cos(a) * 2.6, y - 2 + Math.sin(a) * 1.6, 2.2, 1.6, col, shade(col, -0.3), 0.6); }
    ellipse(g, x, y - 2, 1.3, 1, '#ffd34d');
  }
}

function farmArt(g, o, th) {
  box(g, 0.02, 0.02, 0, o.w - 0.04, o.d - 0.04, 6, '#8a5a36', { top: '#7a4a2a' });
  g.strokeStyle = '#5e3a20'; g.lineWidth = 1.2;
  for (let i = 1; i < o.d * 2; i++) { const a = iso(0.1, i / 2, 6), b = iso(o.w - 0.1, i / 2, 6); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  const R = rand(5);
  const plants = [];
  for (let i = 0; i < o.w * 2; i++) for (let j = 0; j < o.d * 2; j++) plants.push([0.25 + i * 0.5, 0.25 + j * 0.5]);
  plants.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  for (const [u, v] of plants) {
    const p = iso(u, v, 6);
    puff(g, [[p.x - 3, p.y - 5, 4.5], [p.x + 3, p.y - 5, 4.5], [p.x, p.y - 9, 4.5]], th.snow ? '#6fae96' : '#4fae45', { lw: 1 });
    for (let k = 0; k < 2; k++) ellipse(g, p.x - 3 + R() * 6, p.y - 6 + R() * 4, 2, 2, '#ff4d3d', '#a8231a', 0.8);
  }
  // 앞쪽 나무 울타리
  const post = (x, y) => box(g, x, y, 0, 0.08, 0.08, 18, '#c9935a', { bevel: false });
  for (let i = 0; i <= o.d; i++) post(o.w - 0.04, Math.min(i, o.d - 0.08));
  for (let i = 0; i < o.w; i++) post(i, o.d - 0.04);
  box(g, o.w - 0.03, 0, 12, 0.04, o.d, 3, '#e0aa6c', { bevel: false });
  box(g, 0, o.d - 0.03, 12, o.w, 0.04, 3, '#e0aa6c', { bevel: false });
}

function lampArt(g) {
  const p = iso(0.5, 0.5, 0);
  ellipse(g, p.x, p.y, 6, 3, 'rgba(40,50,20,.2)');
  g.fillStyle = '#6b4a30'; g.fillRect(p.x - 1.6, p.y - 44, 3.2, 44);
  g.strokeStyle = '#4a3020'; g.lineWidth = 0.8; g.strokeRect(p.x - 1.6, p.y - 44, 3.2, 44);
  const q = { x: p.x, y: p.y - 50 };
  const grd = g.createRadialGradient(q.x, q.y, 1, q.x, q.y, 16);
  grd.addColorStop(0, 'rgba(255,240,170,.55)'); grd.addColorStop(1, 'rgba(255,240,170,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(q.x, q.y, 16, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff4b8'; g.strokeStyle = '#6b4a30'; g.lineWidth = 1.2;
  g.beginPath(); g.roundRect(q.x - 5, q.y - 6, 10, 12, 3); g.fill(); g.stroke();
  g.fillStyle = '#6b4a30'; g.beginPath(); g.moveTo(q.x - 7, q.y - 6); g.lineTo(q.x, q.y - 11); g.lineTo(q.x + 7, q.y - 6); g.closePath(); g.fill();
}

function signArt(g) {
  const p = iso(0.5, 0.5, 0);
  ellipse(g, p.x, p.y + 1, 14, 4, 'rgba(40,50,20,.18)');
  for (const dx of [-9, 9]) { g.fillStyle = '#8a5d36'; g.fillRect(p.x + dx - 1.5, p.y - 26, 3, 26); }
}

// 글자는 웹 글꼴이 늦게 와도 반영되도록 매번 그린다
function signLive(g, o) {
  const p = iso(0.5, 0.5, 0);
  g.font = 'bold 11px "Jua", "Gowun Dodum", sans-serif';
  const w = Math.max(40, g.measureText(o.label).width + 16);
  g.fillStyle = '#7a5530'; g.beginPath(); g.roundRect(p.x - w / 2, p.y - 36, w, 18, 5); g.fill();
  g.fillStyle = '#d9a660'; g.strokeStyle = '#7a5530'; g.lineWidth = 1.6;
  g.beginPath(); g.roundRect(p.x - w / 2, p.y - 38, w, 18, 5); g.fill(); g.stroke();
  g.fillStyle = '#fffaf0'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(o.label, p.x, p.y - 28.5);
  g.textBaseline = 'alphabetic';
}

function rugArt(g, o) {
  const pts = [iso(0, 0, 0.5), iso(o.w, 0, 0.5), iso(o.w, o.d, 0.5), iso(0, o.d, 0.5)];
  face(g, pts, '#9bd4e8', '#6fb5cf', 1.4);
  const inner = [iso(0.25, 0.25, 0.6), iso(o.w - 0.25, 0.25, 0.6), iso(o.w - 0.25, o.d - 0.25, 0.6), iso(0.25, o.d - 0.25, 0.6)];
  g.setLineDash([4, 3]); face(g, inner, 'rgba(255,255,255,.18)', 'rgba(255,255,255,.85)', 1.2); g.setLineDash([]);
  const c = iso(o.w / 2, o.d / 2, 0.6);
  ellipse(g, c.x, c.y, 26, 13, 'rgba(255,255,255,.25)');
}

// 정적 소품의 스프라이트 여백 [왼, 오, 위, 아래]
function padFor(o, height) {
  const w = o.w || 1, d = o.d || 1;
  return [d * 32 + 34, w * 32 + 34, height + 30, (w + d) * 16 + 16];
}

const variant = (o, n) => Math.floor(o.seed * n);
const withSeed = (o, n) => ({ ...o, seed: (variant(o, n) + 0.5) / n });

const STATIC = {
  shelf: { h: 70, key: o => o.face + variant(o, 6), draw: (g, o) => shelfArt(g, withSeed(o, 6)) },
  table: { h: 30, key: o => o.w + 'x' + o.d + o.color, draw: tableArt },
  desk: { h: 50, key: o => (o.w || 1) + (o.owner || '') + (o.lamp ? 'l' : '') + (o.phone ? 'p' : ''), draw: deskArt },
  rack: { h: 70, key: () => '', draw: rackArt },
  board: { h: 70, key: o => o.w, draw: boardArt },
  kiosk: { h: 40, key: () => '', draw: kioskArt },
  antenna: { h: 80, key: () => '', draw: antennaArt },
  cafeTable: { h: 60, key: o => (o.seed > 0.5 ? 'r' : 'b'), draw: cafeArt },
  sofa: { h: 30, key: o => o.w, draw: sofaArt },
  elevator: { h: 180, key: o => o.w + 'x' + o.d, draw: elevatorArt },
  plant: { h: 40, key: () => '', draw: plantArt },
  tree: { h: 110, key: o => variant(o, 8) + ':' + (o.size || 1).toFixed(1), draw: (g, o, th) => treeArt(g, withSeed(o, 8), th) },
  palm: { h: 90, key: o => variant(o, 6), draw: (g, o, th) => palmArt(g, withSeed(o, 6), th) },
  bush: { h: 40, key: o => variant(o, 6), draw: (g, o, th) => bushArt(g, withSeed(o, 6), th) },
  rock: { h: 30, key: o => (o.seed > 0.4 ? 'm' : ''), draw: rockArt },
  tallgrass: { h: 36, key: o => variant(o, 6), draw: (g, o, th) => tallGrassArt(g, withSeed(o, 6), th) },
  flowers: { h: 20, key: o => variant(o, 8), draw: (g, o, th) => flowerArt(g, withSeed(o, 8), th) },
  farm: { h: 40, key: o => o.w + 'x' + o.d, draw: farmArt },
  lamp: { h: 70, key: () => '', draw: lampArt },
  sign: { h: 40, key: () => '', draw: signArt },
  rug: { h: 4, key: o => o.w + 'x' + o.d, draw: rugArt },
};

function drawObject(ctx, o, world, t, live) {
  const th = world.theme;
  const z0 = world.zAt(o.x + 0.5, o.y + 0.5);
  const p = iso(o.x, o.y, z0);
  ctx.save();
  ctx.translate(p.x, p.y);
  const st = STATIC[o.type];
  if (st) sprite(ctx, `${th.key}:${o.type}:${st.key(o)}`, padFor(o, st.h), g => st.draw(g, o, th));
  switch (o.type) {
    case 'desk': deskLive(ctx, o, t, live.desks.get(world.key(o.x, o.y)) || (o.owner && live.owners[o.owner]), live.owners.phone); break;
    case 'rack': rackLive(ctx, o, t, live.serverBusy); break;
    case 'board': boardLive(ctx, o, world); break;
    case 'kiosk': kioskLive(ctx, t, live.infoBusy); break;
    case 'globe': globeLive(ctx, t, live.infoBusy); break;
    case 'antenna': antennaLive(ctx, t, live.infoBusy); break;
    case 'elevator': elevatorLive(ctx, o, world, live); break;
    case 'sign': signLive(ctx, o); break;
  }
  ctx.restore();
}

function depthOf(o) {
  if (o.type === 'rug') return -1;
  if (o.type === 'flowers') return o.x + o.y + 0.3;
  return o.x + (o.w || 1) / 2 + o.y + (o.d || 1) / 2 + (o.type === 'sign' ? 0.4 : 0);
}

// ---------------------------------------------------------------- 물 반짝임

function drawWater(ctx, world, t) {
  for (let x = 0; x < GW; x++) for (let y = 0; y < GH; y++) {
    if (world.ground[x][y].kind !== 'water') continue;
    const v = world.ground[x][y].v;
    for (let i = 0; i < 2; i++) {
      const ph = (t * 0.25 + v * 3 + i * 0.5) % 1;
      const p = iso(x + 0.2 + ((v * 7 + i * 0.37) % 0.6), y + 0.2 + ((v * 13 + i * 0.53) % 0.6), WATER_Z);
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - ph)})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 3 + ph * 9, (3 + ph * 9) * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (Math.sin(t * 3 + v * 20) > 0.85) {
      const p = iso(x + v, y + 0.5, WATER_Z);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x + 1, p.y); ctx.lineTo(p.x, p.y + 3); ctx.lineTo(p.x - 1, p.y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(p.x - 3, p.y); ctx.lineTo(p.x, p.y + 0.6); ctx.lineTo(p.x + 3, p.y); ctx.lineTo(p.x, p.y - 0.6); ctx.closePath(); ctx.fill();
    }
  }
}

// ---------------------------------------------------------------- 나비

function drawButterflies(ctx, world, t) {
  for (const b of world.butterflies) {
    const x = b.x + Math.sin(t * 0.37 + b.seed * 9) * 1.4 + Math.sin(t * 0.91 + b.seed) * 0.4;
    const y = b.y + Math.sin(t * 0.29 + b.seed * 5) * 1.1;
    const gz = world.zAt(x, y);
    const z = gz + 22 + Math.sin(t * 1.3 + b.seed * 3) * 7;
    const s = iso(x, y, gz), p = iso(x, y, z);
    ellipse(ctx, s.x, s.y, 3, 1.2, 'rgba(40,50,20,.14)');
    const flap = Math.abs(Math.sin(t * 13 + b.seed * 10));
    ctx.save(); ctx.translate(p.x, p.y);
    for (const side of [-1, 1]) {
      ctx.save(); ctx.scale(side * (0.2 + flap * 0.8), 1);
      ellipse(ctx, 3.4, -2.2, 3.6, 3, b.color, shade(b.color, -0.45), 0.9);
      ellipse(ctx, 2.6, 1.8, 2.5, 2.1, shade(b.color, -0.08), shade(b.color, -0.45), 0.9);
      ellipse(ctx, 3.6, -2.6, 1.1, 0.9, 'rgba(255,255,255,.7)');
      ctx.restore();
    }
    ctx.fillStyle = '#4a3a2a'; ctx.beginPath(); ctx.roundRect(-0.8, -3.5, 1.6, 7, 0.8); ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- 말풍선과 이름표

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
  say: { bg: '#ffffff', line: '#d9c8a8', text: '#4a3b2c' },
  think: { bg: '#f6f1ff', line: '#c2b0ec', text: '#4b3a7a' },
  report: { bg: '#eafbe5', line: '#6ab865', text: '#2f6b2b' },
  call: { bg: '#ffece4', line: '#e58a6a', text: '#8a3a20' },
  // 눈에 띄어야 하는 말풍선: 진한 바탕, 굵은 글씨, 왼쪽 표지, 빛나는 테두리
  err: { bg: ['#ff6a6a', '#e0353f'], line: '#8f1820', text: '#ffffff', bold: true, badge: '!', badgeBg: '#ffffff', badgeFg: '#d42a35', glow: '#ff3b47', shake: true },
  ask: { bg: ['#ffd84d', '#ffb21a'], line: '#9a5a00', text: '#3d2600', bold: true, badge: '?', badgeBg: '#3d2600', badgeFg: '#ffd84d', glow: '#ffb21a', pulse: true },
  wait: { bg: ['#fff1b8', '#ffd96a'], line: '#b07400', text: '#4a3200', bold: true, badge: '⏳', badgeBg: '#ffffff', badgeFg: '#b07400', glow: '#ffc53d', pulse: true, dash: [5, 3] },
};

function drawBubble(ctx, x, y, b, placed) {
  const st = BUBBLE[b.type] || BUBBLE.say;
  const now = Date.now();
  const age = now - (b.born || 0);
  ctx.save();
  ctx.font = `${st.bold ? 'bold ' : ''}12px "Gowun Dodum", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  const pad = st.badge ? 30 : 10;
  const lines = wrap(ctx, b.text || '…', 168, b.type === 'think' ? 2 : 3);
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad + 10;
  const lh = 15;
  const h = Math.max(lines.length * lh + 12, st.badge ? 28 : 0);
  // 오류 말풍선은 처음 0.6초 동안 좌우로 흔들린다
  const shake = st.shake && age < 600 ? Math.sin(age / 22) * 3 * (1 - age / 600) : 0;
  const bx = Math.round(x - w / 2 + shake);
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
  let fill = st.bg;
  if (Array.isArray(st.bg)) { fill = ctx.createLinearGradient(0, by, 0, by + h); fill.addColorStop(0, st.bg[0]); fill.addColorStop(1, st.bg[1]); }
  if (st.glow) {
    const k = st.pulse ? 0.5 + 0.5 * Math.sin(now / 260) : 1;
    ctx.shadowColor = st.glow; ctx.shadowBlur = 8 + 10 * k; ctx.shadowOffsetY = 0;
  } else { ctx.shadowColor = 'rgba(80,60,30,.18)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2; }
  ctx.fillStyle = fill; ctx.strokeStyle = st.line; ctx.lineWidth = st.glow ? 2.6 : 2;
  if (st.dash) ctx.setLineDash(st.dash);
  if (b.type === 'think') {
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, h / 2); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.stroke();
    for (const [dx, dy, r] of [[-4, 6, 4], [-9, 13, 2.5]]) { ctx.beginPath(); ctx.arc(x + dx, by + h + dy - 2, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  } else {
    const tx = x + shake;
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, 11); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = Array.isArray(st.bg) ? st.bg[1] : fill;
    ctx.beginPath(); ctx.moveTo(tx - 6, by + h - 1); ctx.lineTo(tx, tailY); ctx.lineTo(tx + 6, by + h - 1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx - 6, by + h); ctx.lineTo(tx, tailY); ctx.lineTo(tx + 6, by + h); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (st.badge) {
    // 왼쪽 동그란 표지: 오류 !, 질문 ?, 승인 대기 ⏳
    const cx = bx + 15, cy = by + h / 2;
    ctx.fillStyle = st.badgeBg; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = st.line; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = st.badgeFg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px "Jua", sans-serif';
    ctx.fillText(st.badge, cx, cy + 0.5);
    ctx.font = `${st.bold ? 'bold ' : ''}12px "Gowun Dodum", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  }
  ctx.fillStyle = st.text; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  if (st.text === '#ffffff') { ctx.shadowColor = 'rgba(120,0,10,.45)'; ctx.shadowBlur = 2; ctx.shadowOffsetY = 1; }
  const ty = by + (h - lines.length * lh) / 2 + 1;
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, ty + i * lh));
  ctx.restore();
}

function drawTag(ctx, x, y, ch) {
  ctx.save();
  ctx.font = 'bold 10px "Jua", "Gowun Dodum", sans-serif';
  const label = ch.label;
  const w = ctx.measureText(label).width + 16;
  ctx.globalAlpha = ch.alpha == null ? 1 : ch.alpha;
  ctx.shadowColor = 'rgba(80,60,30,.2)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
  ctx.fillStyle = 'rgba(255,255,255,.95)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y + 4, w, 16, 8); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = ch.color || '#999'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = ch.color || '#444';
  ctx.beginPath(); ctx.arc(x - w / 2 + 8, y + 12, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a3b2c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 3, y + 12.5);
  ctx.restore();
}

// ---------------------------------------------------------------- 하늘

function drawSky(ctx, world, cam, t) {
  const { width, height } = ctx.canvas;
  const dpr = cam.dpr;
  const th = world.theme;
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  // 바닥이 평평한 뭉게구름
  ctx.save(); ctx.scale(dpr, dpr);
  const W = width / dpr;
  for (let i = 0; i < 6; i++) {
    const s = 0.7 + (i % 3) * 0.25;
    const cx = ((t * 6 * (0.5 + i * 0.12) + i * 280) % (W + 320)) - 160;
    const cy = 40 + (i * 53) % 150;
    ctx.fillStyle = 'rgba(205,228,245,.9)';
    ctx.beginPath(); ctx.roundRect(cx - 40 * s, cy + 2, 110 * s, 14 * s, 7 * s); ctx.fill();
    ctx.fillStyle = '#ffffff';
    for (const [dx, dy, r] of [[0, 0, 18], [22, -10, 22], [46, -4, 18], [66, 2, 13], [-20, 4, 12]]) {
      ctx.beginPath(); ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillRect(cx - 32 * s, cy, 110 * s, 12 * s);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 한 프레임 그리기

export function render(ctx, world, cam, chars, live, t) {
  const dpr = cam.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawSky(ctx, world, cam, t);

  const s = cam.scale * dpr;
  ctx.setTransform(s, 0, 0, s, cam.x * dpr, cam.y * dpr);
  ctx.drawImage(world.groundCanvas, BOUNDS.minX, BOUNDS.minY, BOUNDS.w, BOUNDS.h);
  drawWater(ctx, world, t);

  const drawables = [];
  for (const o of world.objects) drawables.push({ d: depthOf(o), o });
  for (const ch of chars) { if (!ch.hidden) drawables.push({ d: ch.x + ch.y, ch }); }
  drawables.sort((a, b) => a.d - b.d);
  const tops = new Map();
  for (const it of drawables) {
    if (it.o) drawObject(ctx, it.o, world, t, live);
    else {
      const p = iso(it.ch.x, it.ch.y, world.zAt(it.ch.x, it.ch.y));
      it.ch.sx = p.x; it.ch.sy = p.y;
      tops.set(it.ch, drawCharacter(ctx, it.ch, t));
    }
  }
  drawButterflies(ctx, world, t);

  // 이름표와 말풍선은 확대 배율과 상관없이 같은 크기로, 화면 좌표에서 그린다
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toScreen = (x, y) => ({ x: cam.x + x * cam.scale, y: cam.y + y * cam.scale });
  for (const ch of chars) {
    if (ch.hidden || ch.kind === 'npc') continue;
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

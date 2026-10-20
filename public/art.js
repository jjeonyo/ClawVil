// 공통 그리기 도구: 색 계산, 등각 좌표, 부드럽게 음영 진 블록, 스프라이트 캐시.

export const TW = 64, TH = 32;
export const iso = (x, y, z = 0) => ({ x: (x - y) * TW / 2, y: (x + y) * TH / 2 - z });

// ---------------------------------------------------------------- 색

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);

// amt > 0 이면 흰색 쪽으로, < 0 이면 검은색 쪽으로
export function shade(hex, amt) {
  const f = c => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  const [r, g, b] = rgb(hex);
  return toHex(f(r), f(g), f(b));
}

export function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return toHex(...A.map((v, i) => Math.round(v + (B[i] - v) * t)));
}

export function rgba(hex, a) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function rand(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------------------------------------------------------------- 도형

export function path(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

export function face(ctx, pts, fill, stroke, lw = 1) {
  path(ctx, pts);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
}

function vGrad(ctx, pts, top, bottom) {
  const ys = pts.map(p => p.y);
  const g = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  return g;
}

export function ellipse(ctx, x, y, rx, ry, fill, stroke, lw = 1.2) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

// 바닥에 드리우는 부드러운 그림자 (마름모 모양 위를 흐릿한 타원으로)
export function groundShadow(ctx, x, y, w, d, a = 0.18) {
  const c = iso(x + w / 2, y + d / 2);
  const rx = (w + d) * TW / 4 * 0.95, ry = (w + d) * TH / 4 * 0.95;
  const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rx);
  g.addColorStop(0, `rgba(40,50,20,${a})`); g.addColorStop(1, 'rgba(40,50,20,0)');
  ctx.save(); ctx.translate(c.x, c.y); ctx.scale(1, ry / rx); ctx.translate(-c.x, -c.y);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, rx, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// 격자 (x,y)에서 w×d, 높이 z부터 h만큼 솟은 상자. 옆면은 위가 밝은 그라데이션, 윗면 뒤쪽 모서리에 빛.
export function box(ctx, x, y, z, w, d, h, color, o = {}) {
  const T = [iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)];
  const L = [iso(x, y + d, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x, y + d, z)];
  const R = [iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x + w, y, z)];
  const line = o.line === false ? null : (o.line || shade(color, -0.42));
  const lc = o.left || shade(color, -0.1), rc = o.right || shade(color, -0.24);
  if (h > 0.5) {
    face(ctx, L, vGrad(ctx, L, shade(lc, 0.08), shade(lc, -0.12)), line);
    face(ctx, R, vGrad(ctx, R, shade(rc, 0.06), shade(rc, -0.14)), line);
  }
  face(ctx, T, o.top || shade(color, 0.14), line);
  if (o.bevel !== false && w * d > 0.04) {
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    const a = iso(x + 0.06 * w, y + d - 0.08 * d, z + h), b = iso(x + 0.06 * w, y + 0.06 * d, z + h), c = iso(x + w - 0.08 * w, y + 0.06 * d, z + h);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
  }
}

// 둥근 덩어리(나무 수관, 덤불)를 원 여러 개로. 바깥 윤곽선을 먼저 그리고 안을 채운다.
export function puff(ctx, blobs, base, o = {}) {
  const line = o.line || shade(base, -0.45);
  ctx.fillStyle = line;
  for (const [x, y, r] of blobs) { ctx.beginPath(); ctx.arc(x, y, r + (o.lw || 1.6), 0, Math.PI * 2); ctx.fill(); }
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.1, x, y, r * 1.05);
    g.addColorStop(0, shade(base, 0.3)); g.addColorStop(0.55, base); g.addColorStop(1, shade(base, -0.22));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // 위쪽에 잎 결 하이라이트
  ctx.strokeStyle = rgba(shade(base, 0.55), 0.55); ctx.lineWidth = 1.3; ctx.lineCap = 'round';
  for (const [x, y, r] of blobs) {
    if (r < 6) continue;
    ctx.beginPath(); ctx.arc(x - r * 0.15, y - r * 0.1, r * 0.55, Math.PI * 1.15, Math.PI * 1.55); ctx.stroke();
  }
}

// ---------------------------------------------------------------- 스프라이트 캐시

const SPRITES = new Map();
const SPRITE_SCALE = 2.5;

// draw(g)는 원점 (0,0)을 기준으로 그린다. pad는 원점에서 왼/오/위/아래로 필요한 여백.
export function sprite(ctx, key, pad, draw) {
  let s = SPRITES.get(key);
  if (!s) {
    const [l, r, t, b] = pad;
    const c = document.createElement('canvas');
    c.width = Math.ceil((l + r) * SPRITE_SCALE); c.height = Math.ceil((t + b) * SPRITE_SCALE);
    const g = c.getContext('2d');
    g.scale(SPRITE_SCALE, SPRITE_SCALE); g.translate(l, t);
    draw(g);
    s = { c, l, t, w: l + r, h: t + b };
    SPRITES.set(key, s);
  }
  ctx.drawImage(s.c, -s.l, -s.t, s.w, s.h);
}

export function clearSprites() { SPRITES.clear(); }

// 캐릭터 그리기. 공식 이미지 없이 캔버스 도형으로 직접 그린 팬아트다.
// 모든 함수는 발밑을 (0,0)으로 두고 위쪽(-y)으로 그린다. 크기는 대략 높이 40px.

function ell(ctx, x, y, rx, ry, fill, stroke, lw = 1.6) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}

function poly(ctx, pts, fill, stroke, lw = 1.6) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.stroke(); }
}

function dotEyes(ctx, y, gap, blink, r = 1.9, color = '#2a1d33') {
  if (blink) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-gap - 2, y); ctx.lineTo(-gap + 2, y); ctx.moveTo(gap - 2, y); ctx.lineTo(gap + 2, y); ctx.stroke();
    return;
  }
  ell(ctx, -gap, y, r, r * 1.15, color);
  ell(ctx, gap, y, r, r * 1.15, color);
}

function shinyEyes(ctx, y, gap, blink, iris, r = 3.2) {
  if (blink) return dotEyes(ctx, y, gap, true);
  for (const s of [-1, 1]) {
    ell(ctx, s * gap, y, r, r * 1.2, '#fff', '#2a1d33', 1);
    ell(ctx, s * gap + s * 0.4, y + 0.4, r * 0.62, r * 0.8, iris);
    ell(ctx, s * gap + s * 0.4, y + 0.6, r * 0.3, r * 0.42, '#1b1020');
    ell(ctx, s * gap - 0.8, y - 1.2, 0.9, 0.9, '#fff');
  }
}

function mouth(ctx, kind, y, w = 4) {
  ctx.strokeStyle = '#3a2340'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  ctx.beginPath();
  if (kind === 'o') { ell(ctx, 0, y + 1, 1.8, 2.2, '#7b2f45', '#3a2340', 1); return; }
  if (kind === 'worried') { ctx.moveTo(-w, y + 2); ctx.quadraticCurveTo(0, y - 1.5, w, y + 2); }
  else if (kind === 'flat') { ctx.moveTo(-w * 0.6, y + 1); ctx.lineTo(w * 0.6, y + 1); }
  else { ctx.moveTo(-w, y); ctx.quadraticCurveTo(0, y + 3.5, w, y); }
  ctx.stroke();
}

// 메타몽 — Claude 본인
function ditto(ctx, o) {
  const body = o.tint || '#bf98da';
  const line = '#8d64ad';
  ctx.beginPath();
  ctx.moveTo(-17, 0);
  ctx.bezierCurveTo(-22, -1, -22, -9, -16, -11);
  ctx.bezierCurveTo(-23, -14, -21, -22, -14, -20);
  ctx.bezierCurveTo(-12, -28, -3, -29, 0, -25);
  ctx.bezierCurveTo(4, -30, 13, -28, 13, -21);
  ctx.bezierCurveTo(20, -23, 23, -15, 16, -11);
  ctx.bezierCurveTo(22, -8, 21, -1, 17, 0);
  ctx.quadraticCurveTo(0, 3, -17, 0);
  ctx.closePath();
  ctx.fillStyle = body; ctx.fill();
  ctx.lineWidth = 1.8; ctx.strokeStyle = line; ctx.lineJoin = 'round'; ctx.stroke();
  ell(ctx, -6, -20, 5, 2.6, 'rgba(255,255,255,.45)');
  dotEyes(ctx, -13, 5, o.blink, 1.7);
  if (o.mouth === 'worried' || o.mouth === 'o') mouth(ctx, o.mouth, -8, 5);
  else {
    ctx.strokeStyle = '#3a2340'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(-7, -8); ctx.quadraticCurveTo(0, -5.5, 7, -8); ctx.stroke();
  }
  return { eyeY: -13, eyeGap: 5, top: -28 };
}

// 이상해씨 — Explore
function bulbasaur(ctx, o) {
  const skin = '#7fcfb4', dark = '#4f9c86', bulb = '#68b65c', bulbDark = '#3f8a3e';
  ell(ctx, -9, -2, 5, 3, skin, dark);
  ell(ctx, 9, -2, 5, 3, skin, dark);
  // 등의 씨앗
  ell(ctx, 3, -27, 11, 10, bulb, bulbDark, 1.8);
  ctx.strokeStyle = bulbDark; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(3, -36); ctx.quadraticCurveTo(-1, -28, 2, -19); ctx.moveTo(9, -34); ctx.quadraticCurveTo(7, -27, 10, -21); ctx.stroke();
  ell(ctx, 0, -9, 14, 8, skin, dark);
  // 머리와 귀
  poly(ctx, [-13, -22, -11, -30, -6, -25], skin, dark, 1.4);
  poly(ctx, [13, -22, 11, -30, 6, -25], skin, dark, 1.4);
  ell(ctx, 0, -17, 15, 10.5, skin, dark, 1.8);
  poly(ctx, [-3, -25, 0, -23, -1, -21], '#4e9a83');
  poly(ctx, [4, -24, 7, -23, 5, -21], '#4e9a83');
  shinyEyes(ctx, -16, 7, o.blink, '#d9364f', 3.1);
  mouth(ctx, o.mouth || 'smile', -11, 4);
  return { eyeY: -16, eyeGap: 7, top: -37 };
}

// 팬텀 — Plan
function gengar(ctx, o) {
  const skin = '#7d5bb0', dark = '#4d3478';
  ell(ctx, -8, -2, 5.5, 3, skin, dark);
  ell(ctx, 8, -2, 5.5, 3, skin, dark);
  // 등 가시
  poly(ctx, [-12, -24, -14, -33, -6, -27], skin, dark, 1.4);
  poly(ctx, [-4, -28, -2, -37, 4, -28], skin, dark, 1.4);
  poly(ctx, [6, -27, 11, -35, 12, -24], skin, dark, 1.4);
  // 귀
  poly(ctx, [-15, -18, -21, -33, -8, -26], skin, dark, 1.6);
  poly(ctx, [15, -18, 21, -33, 8, -26], skin, dark, 1.6);
  ell(ctx, 0, -15, 16, 14, skin, dark, 1.8);
  ell(ctx, -16, -12, 3.5, 2.5, skin, dark, 1.2);
  ell(ctx, 16, -12, 3.5, 2.5, skin, dark, 1.2);
  if (o.blink) dotEyes(ctx, -19, 6, true);
  else {
    poly(ctx, [-10, -22, -3, -19, -9, -16], '#ff4d5e', '#3a1430', 1);
    poly(ctx, [10, -22, 3, -19, 9, -16], '#ff4d5e', '#3a1430', 1);
    ell(ctx, -6.5, -18.6, 1, 1, '#3a1430');
    ell(ctx, 6.5, -18.6, 1, 1, '#3a1430');
  }
  // 씨익 웃는 입
  ctx.beginPath();
  if (o.mouth === 'worried') { ctx.moveTo(-6, -8); ctx.quadraticCurveTo(0, -12, 6, -8); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
  else {
    ctx.moveTo(-10, -12); ctx.quadraticCurveTo(0, -4, 10, -12); ctx.quadraticCurveTo(0, -8, -10, -12);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = dark; ctx.lineWidth = 1; ctx.stroke();
  }
  return { eyeY: -19, eyeGap: 6.5, top: -37 };
}

// 피카츄 — 범용 서브에이전트
function pikachu(ctx, o) {
  const skin = '#f7d54a', dark = '#b8901c';
  // 꼬리
  poly(ctx, [10, -8, 16, -14, 13, -16, 21, -24, 18, -27, 26, -34, 16, -30, 18, -26, 11, -20, 13, -17], skin, dark, 1.3);
  ell(ctx, -6, -1.5, 4, 2.5, skin, dark);
  ell(ctx, 6, -1.5, 4, 2.5, skin, dark);
  ell(ctx, 0, -8, 10, 8, skin, dark);
  // 귀
  poly(ctx, [-10, -24, -18, -42, -4, -27], skin, dark, 1.4);
  poly(ctx, [-15.3, -36, -18, -42, -12.6, -34], '#2b2320');
  poly(ctx, [10, -24, 18, -42, 4, -27], skin, dark, 1.4);
  poly(ctx, [15.3, -36, 18, -42, 12.6, -34], '#2b2320');
  ell(ctx, 0, -19, 14, 11, skin, dark, 1.8);
  ell(ctx, -10, -15, 3.2, 2.6, '#ef5a4b');
  ell(ctx, 10, -15, 3.2, 2.6, '#ef5a4b');
  if (o.blink) dotEyes(ctx, -20, 5.5, true);
  else for (const s of [-1, 1]) { ell(ctx, s * 5.5, -20, 2.3, 2.6, '#22181a'); ell(ctx, s * 5.5 - 0.7, -21, 0.9, 0.9, '#fff'); }
  ell(ctx, 0, -17, 0.8, 0.6, '#22181a');
  if (o.mouth === 'worried' || o.mouth === 'o') mouth(ctx, o.mouth, -15, 3);
  else {
    ctx.strokeStyle = '#3a2330'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-3, -15.5); ctx.quadraticCurveTo(-1.5, -13.5, 0, -15.5); ctx.quadraticCurveTo(1.5, -13.5, 3, -15.5); ctx.stroke();
  }
  return { eyeY: -20, eyeGap: 5.5, top: -42 };
}

// 이브이 — 그 밖의 에이전트
function eevee(ctx, o) {
  const fur = '#c68a55', dark = '#7d5230', cream = '#f6e5c6';
  ell(ctx, 12, -12, 6, 8, fur, dark);
  ell(ctx, 13, -18, 4, 4, cream);
  ell(ctx, -6, -1.5, 4, 2.5, fur, dark);
  ell(ctx, 6, -1.5, 4, 2.5, fur, dark);
  ell(ctx, 0, -8, 10, 7, fur, dark);
  poly(ctx, [-8, -24, -19, -40, -2, -28], fur, dark, 1.4);
  poly(ctx, [8, -24, 19, -40, 2, -28], fur, dark, 1.4);
  poly(ctx, [-8, -26, -15, -36, -4, -28], '#5a3a24');
  poly(ctx, [8, -26, 15, -36, 4, -28], '#5a3a24');
  // 목도리 털
  for (let i = -3; i <= 3; i++) ell(ctx, i * 3.4, -9 + Math.abs(i) * 0.8, 3.6, 3.2, cream);
  ell(ctx, 0, -19, 12.5, 10, fur, dark, 1.8);
  shinyEyes(ctx, -19, 5.5, o.blink, '#5a3220', 2.8);
  mouth(ctx, o.mouth || 'smile', -14, 2.5);
  return { eyeY: -19, eyeGap: 5.5, top: -40 };
}

// 트레이너 — 나
function trainer(ctx, o) {
  const skin = '#ffe0c2', line = '#6b4a3a';
  ell(ctx, -4.5, -2, 3.5, 2.4, '#3e4a6b');
  ell(ctx, 4.5, -2, 3.5, 2.4, '#3e4a6b');
  poly(ctx, [-9, -3, 9, -3, 7, -15, -7, -15], '#4a8fe0', '#2e5f9e', 1.4);
  ell(ctx, -9, -10, 2.6, 2.6, skin, line, 1);
  ell(ctx, 9, -10, 2.6, 2.6, skin, line, 1);
  ell(ctx, 0, -23, 11, 10, skin, line, 1.6);
  // 모자
  ctx.beginPath(); ctx.arc(0, -25, 11.5, Math.PI, 0); ctx.closePath();
  ctx.fillStyle = '#e8483f'; ctx.fill(); ctx.strokeStyle = '#9e2b26'; ctx.lineWidth = 1.4; ctx.stroke();
  ell(ctx, 0, -31, 4, 2.4, '#fff');
  poly(ctx, [-11.5, -25, 14, -25, 16, -23, -11.5, -23], '#c93a33', '#9e2b26', 1);
  ell(ctx, -9.5, -21, 2.2, 3.5, '#4b3427');
  dotEyes(ctx, -21, 4, o.blink, 1.5);
  mouth(ctx, o.mouth || 'smile', -17, 2.5);
  ell(ctx, -6.5, -18.5, 1.6, 1, 'rgba(255,120,120,.5)');
  ell(ctx, 6.5, -18.5, 1.6, 1, 'rgba(255,120,120,.5)');
  return { eyeY: -21, eyeGap: 4, top: -36 };
}

export const SPECIES = {
  ditto: { name: '메타몽', draw: ditto, color: '#bf98da' },
  bulbasaur: { name: '이상해씨', draw: bulbasaur, color: '#68b65c' },
  gengar: { name: '팬텀', draw: gengar, color: '#7d5bb0' },
  pikachu: { name: '피카츄', draw: pikachu, color: '#f2c531' },
  eevee: { name: '이브이', draw: eevee, color: '#c68a55' },
  trainer: { name: '트레이너', draw: trainer, color: '#e8483f' },
};

export function speciesForAgent(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('explore')) return 'bulbasaur';
  if (t.includes('plan')) return 'gengar';
  if (!t || t.includes('general')) return 'pikachu';
  return 'eevee';
}

function glasses(ctx, info) {
  ctx.strokeStyle = '#2b2033'; ctx.lineWidth = 1.4;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * (info.eyeGap + 0.5), info.eyeY, 4.6, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-info.eyeGap + 4, info.eyeY); ctx.lineTo(info.eyeGap - 4, info.eyeY); ctx.stroke();
  ctx.fillStyle = 'rgba(200,230,255,.25)';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * (info.eyeGap + 0.5), info.eyeY, 4, 0, Math.PI * 2); ctx.fill(); }
}

function explorerHat(ctx, info) {
  const y = info.top + 6;
  ell(ctx, 0, y + 3, 15, 4, '#d9b46a', '#8e6a2c', 1.3);
  ctx.beginPath(); ctx.moveTo(-9, y + 2); ctx.quadraticCurveTo(-8, y - 9, 0, y - 9); ctx.quadraticCurveTo(8, y - 9, 9, y + 2); ctx.closePath();
  ctx.fillStyle = '#e8c57b'; ctx.fill(); ctx.strokeStyle = '#8e6a2c'; ctx.stroke();
  ctx.fillStyle = '#3f8a3e'; ctx.fillRect(-9, y - 1, 18, 2.6);
}

function sweat(ctx, x, y, t) {
  const dy = (t * 30) % 10;
  ctx.save(); ctx.translate(x, y + dy); ctx.globalAlpha = 1 - dy / 12;
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.quadraticCurveTo(5, 1, 0, 3); ctx.quadraticCurveTo(-5, 1, 0, -6);
  ctx.fillStyle = '#7cc8ff'; ctx.fill(); ctx.strokeStyle = '#3b8fd0'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

function book(ctx, x, y, t) {
  const flap = Math.sin(t * 4) * 1.5;
  ctx.save(); ctx.translate(x, y);
  poly(ctx, [-9, 0, 0, 2, 0, -8, -9, -10 + flap], '#fff8e6', '#8a5a2b', 1.2);
  poly(ctx, [9, 0, 0, 2, 0, -8, 9, -10 - flap], '#fff8e6', '#8a5a2b', 1.2);
  ctx.strokeStyle = '#c9b48f'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-2, -3); ctx.moveTo(-6, -6); ctx.lineTo(-2, -5); ctx.moveTo(2, -3); ctx.lineTo(6, -4); ctx.stroke();
  ctx.restore();
}

function phone(ctx, x, y, t) {
  const shake = Math.sin(t * 30) * 1.2;
  ctx.save(); ctx.translate(x + shake, y); ctx.rotate(-0.3);
  ctx.fillStyle = '#e8483f'; ctx.strokeStyle = '#8f2620'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.roundRect(-3, -9, 6, 14, 3); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(232,72,63,.7)'; ctx.lineWidth = 1.2;
  for (let i = 1; i <= 2; i++) { ctx.beginPath(); ctx.arc(x + 4, y - 6, 4 * i + (t * 8 % 3), -1.2, 0.2); ctx.stroke(); }
}

function zzz(ctx, x, y, t) {
  ctx.save(); ctx.fillStyle = '#6c7fb8'; ctx.font = 'bold 11px sans-serif';
  for (let i = 0; i < 3; i++) {
    const p = ((t * 0.6 + i / 3) % 1);
    ctx.globalAlpha = 1 - p;
    ctx.fillText('z', x + p * 12, y - p * 18);
  }
  ctx.restore();
}

function ponder(ctx, x, y, t) {
  ctx.save(); ctx.fillStyle = '#8a6bd1'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText('?', x + Math.sin(t * 3) * 2, y);
  ctx.restore();
}

function wave(ctx, x, y, t) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 10) * 0.4);
  ell(ctx, 0, 0, 3.6, 3.6, '#ffd9b0', '#8a5a2b', 1);
  ctx.restore();
}

// 캐릭터 하나를 그린다. (x,y)는 화면상의 발 위치.
const CHAR_SCALE = 1.4;

export function drawCharacter(ctx, ch, t) {
  ctx.save();
  ctx.translate(ch.sx, ch.sy);
  ctx.scale(CHAR_SCALE, CHAR_SCALE);
  const top = drawCharacterAt(ctx, { ...ch, sx: 0, sy: 0, moving: ch.moving, sweat: ch.sweat }, t);
  ctx.restore();
  return ch.sy + top * CHAR_SCALE;
}

function drawCharacterAt(ctx, ch, t) {
  const sp = SPECIES[ch.species] || SPECIES.ditto;
  const walking = ch.moving;
  const phase = t * 9 + (ch.seed || 0);
  const hop = walking ? Math.abs(Math.sin(phase)) * 4 : 0;
  const breathe = walking ? 0 : Math.sin(t * 2.2 + (ch.seed || 0)) * 0.025;
  const squash = walking ? 1 - Math.abs(Math.cos(phase)) * 0.06 : 1 + breathe;
  const blink = ((t + (ch.seed || 0)) % 3.7) < 0.12;

  ctx.save();
  ctx.translate(ch.sx, ch.sy);
  ctx.globalAlpha = ch.alpha == null ? 1 : ch.alpha;
  ell(ctx, 0, 0, 14 - hop * 0.6, 5, 'rgba(40,60,30,.22)');
  ctx.translate(0, -hop);
  ctx.scale((ch.facing || 1) * (2 - squash), squash);
  const info = sp.draw(ctx, { blink, mouth: ch.mouth, tint: ch.tint }) || { eyeY: -14, eyeGap: 5, top: -30 };
  if (ch.glasses) glasses(ctx, info);
  if (ch.hat) explorerHat(ctx, info);
  ctx.restore();

  const top = ch.sy - hop + info.top * squash;
  ctx.save();
  ctx.globalAlpha = ch.alpha == null ? 1 : ch.alpha;
  if (ch.emote === 'read') book(ctx, ch.sx + 10 * (ch.facing || 1), ch.sy - 8, t);
  if (ch.emote === 'phone') phone(ctx, ch.sx + 16, ch.sy - 20, t);
  if (ch.emote === 'sleep') zzz(ctx, ch.sx + 10, top - 2, t);
  if (ch.emote === 'ponder') ponder(ctx, ch.sx + 12, top + 2, t);
  if (ch.emote === 'wave') wave(ctx, ch.sx + 18, ch.sy - 22, t);
  if (ch.sweat) sweat(ctx, ch.sx + 13, top + 8, t);
  ctx.restore();
  return top;
}

// 마을 캐릭터 그리기. 모두 이 프로젝트를 위해 새로 디자인한 오리지널 캐릭터다.
// 각 함수는 발밑을 (0,0)으로 두고 위쪽(-y)으로 그리며, 오른쪽을 바라보는 3/4 정면 모습이다.
import { shade, rgba } from './art.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 기본 도구

function ell(ctx, x, y, rx, ry, fill, stroke, lw = 1.4, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}

// 왼쪽 위에서 빛이 드는 둥근 그라데이션
function soft(ctx, x, y, r, base, hi = 0.4, lo = -0.22) {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.05, x, y, r * 1.15);
  g.addColorStop(0, shade(base, hi)); g.addColorStop(0.5, base); g.addColorStop(1, shade(base, lo));
  return g;
}

function paint(ctx, base, line, x, y, r, lw = 1.6) {
  ctx.fillStyle = soft(ctx, x, y, r, base); ctx.fill();
  ctx.lineWidth = lw; ctx.strokeStyle = line; ctx.lineJoin = 'round'; ctx.stroke();
}

// 아래가 살짝 평평한 찹쌀떡 모양 몸통
function bodyPath(ctx, cx, cy, rx, ry, flat = 0.55) {
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy);
  ctx.bezierCurveTo(cx - rx, cy - ry * 1.33, cx + rx, cy - ry * 1.33, cx + rx, cy);
  ctx.bezierCurveTo(cx + rx, cy + ry * flat, cx + rx * 0.55, cy + ry, cx, cy + ry);
  ctx.bezierCurveTo(cx - rx * 0.55, cy + ry, cx - rx, cy + ry * flat, cx - rx, cy);
  ctx.closePath();
}

function sheen(ctx, x, y, rx, ry, a = 0.45) {
  ell(ctx, x, y, rx, ry, rgba('#ffffff', a), null, 0, -0.5);
}

// 반짝이는 눈. o.eyes: 'closed'(잠), 'happy'(^^), 그 밖엔 보통. o.blink 면 깜빡임.
function eye(ctx, x, y, rx, ry, o, iris = '#4a2c2a') {
  ctx.lineCap = 'round';
  if (o.eyes === 'closed') {
    ctx.strokeStyle = '#3a2420'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - rx * 1.1, y); ctx.quadraticCurveTo(x, y + ry * 0.9, x + rx * 1.1, y); ctx.stroke();
    return;
  }
  if (o.eyes === 'happy') {
    ctx.strokeStyle = '#3a2420'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - rx * 1.1, y + ry * 0.3); ctx.quadraticCurveTo(x, y - ry * 1.1, x + rx * 1.1, y + ry * 0.3); ctx.stroke();
    return;
  }
  if (o.blink) {
    ctx.strokeStyle = '#3a2420'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - rx, y + 0.5); ctx.lineTo(x + rx, y + 0.5); ctx.stroke();
    return;
  }
  const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
  g.addColorStop(0, '#1a1018'); g.addColorStop(0.65, '#2a1a22'); g.addColorStop(1, iris);
  ell(ctx, x, y, rx, ry, g);
  ell(ctx, x - rx * 0.32, y - ry * 0.38, rx * 0.46, ry * 0.36, '#ffffff');
  ell(ctx, x + rx * 0.34, y + ry * 0.42, rx * 0.2, ry * 0.16, 'rgba(255,255,255,.85)');
  if (o.mouth === 'worried') {
    // 눈썹 안쪽 끝이 올라간 걱정 눈썹
    ctx.strokeStyle = '#3a2420'; ctx.lineWidth = 1.1;
    const inner = x < 1 ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(x - inner * rx * 1.2, y - ry * 1.45); ctx.lineTo(x + inner * rx * 0.9, y - ry * 2); ctx.stroke();
  }
}

function cheeks(ctx, xl, xr, y, r = 2.6) {
  ell(ctx, xl, y, r, r * 0.62, 'rgba(255,120,130,.45)');
  ell(ctx, xr, y, r, r * 0.62, 'rgba(255,120,130,.45)');
}

function mouth(ctx, x, y, kind, w = 2.4) {
  ctx.strokeStyle = '#4a2a26'; ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'open' || kind === 'o') {
    ell(ctx, x, y + 0.6, w * 0.7, w * 0.85, '#8a3540', '#4a2a26', 1);
    ell(ctx, x, y + 1.2, w * 0.45, w * 0.35, '#ff8a95');
    return;
  }
  if (kind === 'worried') { ctx.moveTo(x - w, y + 1); ctx.quadraticCurveTo(x - w / 2, y - 0.6, x, y + 0.6); ctx.quadraticCurveTo(x + w / 2, y + 1.6, x + w, y); }
  else if (kind === 'flat') { ctx.moveTo(x - w * 0.7, y + 0.5); ctx.lineTo(x + w * 0.7, y + 0.5); }
  else { ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w / 2, y + 1.8, x, y + 0.3); ctx.quadraticCurveTo(x + w / 2, y + 1.8, x + w, y); }
  ctx.stroke();
}

// 걸을 때 번갈아 들리는 두 발
function feet(ctx, color, line, step, spread = 6, rx = 4.2, ry = 2.6) {
  const l = Math.max(0, step) * 2.4, r = Math.max(0, -step) * 2.4;
  ell(ctx, -spread, -1.4 - l, rx, ry, soft(ctx, -spread, -1.4 - l, rx, color, 0.3), line, 1.2);
  ell(ctx, spread, -1.4 - r, rx, ry, soft(ctx, spread, -1.4 - r, rx, color, 0.3), line, 1.2);
}

function leaf(ctx, x, y, ang, len, wid, color, line) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wid, -len * 0.5, 0, -len);
  ctx.quadraticCurveTo(-wid, -len * 0.5, 0, 0);
  ctx.closePath();
  ctx.fillStyle = soft(ctx, 0, -len / 2, len / 2, color, 0.35); ctx.fill();
  ctx.strokeStyle = line; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.strokeStyle = rgba(shade(color, -0.3), 0.7); ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(0, -len * 0.8); ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- 모찌 (Claude)

// 코랄색 찹쌀떡. 머리 위에 여섯 갈래 별꽃 새싹이 났다.
function mochi(ctx, o) {
  const base = '#ef8b60', line = '#a14a2b';
  const swing = o.step * 1.5;
  feet(ctx, shade(base, -0.12), line, o.step, 6.5);
  ell(ctx, -14.5, -11 + swing, 3.6, 3, soft(ctx, -14.5, -11, 4, base), line, 1.2, -0.5);
  ell(ctx, 14.5, -11 - swing, 3.6, 3, soft(ctx, 14.5, -11, 4, base), line, 1.2, 0.5);
  bodyPath(ctx, 0, -14.5, 15.5, 13.5);
  paint(ctx, base, line, 0, -15, 16);
  ell(ctx, 1, -8.5, 9.5, 5.2, 'rgba(255,243,230,.75)');
  sheen(ctx, -7.5, -23, 4.2, 2.2);
  // 별꽃 새싹
  ctx.strokeStyle = '#6aa84f'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0.5, -27.5); ctx.quadraticCurveTo(0, -30, 1.5, -32.5); ctx.stroke();
  const cx = 1.8, cy = -35.5;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + (o.t ? Math.sin(o.t * 2) * 0.08 : 0);
    ell(ctx, cx + Math.cos(a) * 3.2, cy + Math.sin(a) * 3.2, 1.7, 3.3, soft(ctx, cx, cy, 5, '#f7a47c', 0.35), line, 1, a + Math.PI / 2);
  }
  ell(ctx, cx, cy, 1.9, 1.9, '#ffd36e', '#c9862a', 0.9);
  const fx = 1.2;
  eye(ctx, -4.4 + fx, -16.5, 2.4, 3, o);
  eye(ctx, 5.4 + fx, -16.5, 2.4, 3, o);
  cheeks(ctx, -8.8 + fx, 9.8 + fx, -11.8);
  mouth(ctx, 0.5 + fx, -12.2, o.mouth || 'smile', 2.2);
  return { top: -40, eyes: [[-4.4 + fx, -16.5], [5.4 + fx, -16.5]], head: { x: 0.5, y: -28, w: 14 } };
}

// ---------------------------------------------------------------- 새싹이 (Explore)

// 잎사귀 귀가 달린 초록 콩. 탐험 모자를 쓰고 돋보기를 든다.
function sprout(ctx, o) {
  const base = '#8ad066', line = '#3d7a2c';
  feet(ctx, shade(base, -0.15), line, o.step, 5.5, 3.8, 2.4);
  leaf(ctx, -9, -24, -1.05, 11, 4.2, '#6cc04e', line);
  leaf(ctx, 9, -24, 1.05, 11, 4.2, '#6cc04e', line);
  bodyPath(ctx, 0, -13.5, 13, 12.5);
  paint(ctx, base, line, 0, -14, 14);
  ell(ctx, 1, -8, 7.5, 4.6, 'rgba(236,252,214,.8)');
  sheen(ctx, -6.5, -21, 3.4, 1.8);
  // 탐험 모자
  ell(ctx, 0, -25.5, 15, 4.6, soft(ctx, 0, -25.5, 14, '#e8cb86', 0.3), '#8a6a2e', 1.3);
  ctx.beginPath(); ctx.moveTo(-9, -26); ctx.bezierCurveTo(-9, -37, 9, -37, 9, -26); ctx.closePath();
  paint(ctx, '#efd593', '#8a6a2e', 0, -31, 9, 1.3);
  ctx.fillStyle = '#7a5530'; ctx.beginPath(); ctx.moveTo(-9, -27.6); ctx.quadraticCurveTo(0, -29.6, 9, -27.6); ctx.lineTo(9, -26); ctx.quadraticCurveTo(0, -28, -9, -26); ctx.closePath(); ctx.fill();
  sheen(ctx, -4, -33, 2.6, 1.2, 0.5);
  const fx = 1;
  eye(ctx, -4 + fx, -15, 2.2, 2.8, o);
  eye(ctx, 5 + fx, -15, 2.2, 2.8, o);
  cheeks(ctx, -8 + fx, 9 + fx, -10.6, 2.3);
  mouth(ctx, 0.5 + fx, -11, o.mouth || 'smile', 2);
  // 돋보기
  ctx.strokeStyle = '#8a5d36'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(11, -6); ctx.lineTo(15, -1); ctx.stroke();
  ell(ctx, 10, -9, 4.4, 4.4, 'rgba(200,240,255,.55)', '#c9932f', 1.6);
  ell(ctx, 8.8, -10.4, 1.4, 0.9, 'rgba(255,255,255,.9)', null, 0, -0.6);
  return { top: -38, eyes: [[-4 + fx, -15], [5 + fx, -15]], head: { x: 0, y: -26, w: 12 } };
}

// ---------------------------------------------------------------- 부엉이 (Plan)

// 둥근 안경을 쓴 보라색 부엉이. 설계도 두루마리를 끼고 다닌다.
function owl(ctx, o) {
  const base = '#8b6fd0', line = '#46337f';
  feet(ctx, '#f2a03d', '#a8601a', o.step, 5, 3.4, 2);
  // 귀깃
  ctx.beginPath(); ctx.moveTo(-12, -24); ctx.quadraticCurveTo(-15, -33, -11, -36); ctx.quadraticCurveTo(-7, -30, -4, -28.5); ctx.closePath();
  paint(ctx, shade(base, -0.05), line, -10, -30, 6, 1.3);
  ctx.beginPath(); ctx.moveTo(12, -24); ctx.quadraticCurveTo(15, -33, 11, -36); ctx.quadraticCurveTo(7, -30, 4, -28.5); ctx.closePath();
  paint(ctx, shade(base, -0.05), line, 10, -30, 6, 1.3);
  bodyPath(ctx, 0, -15, 14, 14.5, 0.7);
  paint(ctx, base, line, 0, -16, 15);
  // 배의 깃털 무늬
  ell(ctx, 0, -7.5, 8, 6, 'rgba(236,226,255,.7)');
  ctx.strokeStyle = rgba(shade(base, -0.25), 0.8); ctx.lineWidth = 0.9;
  for (const [x, y] of [[-3.5, -9], [0.5, -9], [4.5, -9], [-1.5, -5.5], [2.5, -5.5]]) { ctx.beginPath(); ctx.moveTo(x - 1.4, y); ctx.lineTo(x, y + 1.4); ctx.lineTo(x + 1.4, y); ctx.stroke(); }
  // 날개
  const flap = o.step * 1.5;
  ell(ctx, -13.5, -13 + flap, 4, 7.5, soft(ctx, -13.5, -13, 7, shade(base, -0.12)), line, 1.2, 0.25);
  ell(ctx, 13.5, -13 - flap, 4, 7.5, soft(ctx, 13.5, -13, 7, shade(base, -0.12)), line, 1.2, -0.25);
  sheen(ctx, -7, -25, 3.6, 1.8);
  // 얼굴 원반
  const fx = 0.8;
  ell(ctx, -4.4 + fx, -19, 6, 5.6, '#f4ecff', rgba(line, 0.5), 1);
  ell(ctx, 4.8 + fx, -19, 6, 5.6, '#f4ecff', rgba(line, 0.5), 1);
  eye(ctx, -4.4 + fx, -19, 2.3, 2.6, o, '#3b2a6a');
  eye(ctx, 4.8 + fx, -19, 2.3, 2.6, o, '#3b2a6a');
  // 안경
  ctx.strokeStyle = '#d19a2a'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(-4.4 + fx, -19, 5.2, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(4.8 + fx, -19, 5.2, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0.8 + fx - 1, -19.5); ctx.lineTo(0.8 + fx - 0.2, -19.5); ctx.stroke();
  // 부리
  ctx.beginPath(); ctx.moveTo(-1.6 + fx, -15); ctx.lineTo(1.6 + fx, -15); ctx.lineTo(fx, -12); ctx.closePath();
  ctx.fillStyle = '#f2a03d'; ctx.fill(); ctx.strokeStyle = '#a8601a'; ctx.lineWidth = 0.9; ctx.stroke();
  // 설계도 두루마리
  ctx.save(); ctx.translate(-14, -6); ctx.rotate(-0.4);
  ctx.fillStyle = '#5aa9e6'; ctx.strokeStyle = '#2c6a9c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(-2.2, -8, 4.4, 12, 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-1, -5); ctx.lineTo(1, -5); ctx.moveTo(-1, -2); ctx.lineTo(1, -2); ctx.stroke();
  ctx.restore();
  return { top: -37, eyes: [[-4.4 + fx, -19], [4.8 + fx, -19]], head: { x: 0, y: -29, w: 13 } };
}

// ---------------------------------------------------------------- 토끼 (범용 에이전트)

// 파란 목도리를 두른 크림색 토끼. 한쪽 귀가 살짝 접혔다.
function bunny(ctx, o) {
  const base = '#f7ecda', line = '#9a7c60';
  feet(ctx, shade(base, -0.06), line, o.step, 5.5, 4.4, 2.5);
  ell(ctx, -13, -6, 3.6, 3.4, '#ffffff', line, 1.1);
  // 귀
  const wob = Math.sin((o.t || 0) * 3) * 0.05;
  ell(ctx, -5, -34, 3.6, 10.5, soft(ctx, -5, -34, 9, base), line, 1.3, -0.18 + wob);
  ell(ctx, -5.3, -33, 1.7, 7.5, '#ffc1cf', null, 0, -0.18 + wob);
  ctx.save(); ctx.translate(5.5, -26); ctx.rotate(0.28 - wob);
  ell(ctx, 0, -6, 3.6, 7, soft(ctx, 0, -6, 7, base), line, 1.3);
  ell(ctx, 0, -5.5, 1.7, 4.8, '#ffc1cf');
  ctx.translate(0, -12); ctx.rotate(0.9);
  ell(ctx, 0, -3, 3.2, 4.2, soft(ctx, 0, -3, 4, base), line, 1.3);
  ctx.restore();
  bodyPath(ctx, 0, -13.5, 13, 13);
  paint(ctx, base, line, 0, -14, 14);
  sheen(ctx, -6.5, -22, 3.6, 1.8, 0.7);
  // 목도리
  ctx.beginPath(); ctx.moveTo(-11.5, -9); ctx.quadraticCurveTo(0, -4.5, 11.5, -9); ctx.lineTo(11, -6); ctx.quadraticCurveTo(0, -1.5, -11, -6); ctx.closePath();
  ctx.fillStyle = soft(ctx, 0, -7, 12, '#5aa9e6', 0.3); ctx.fill(); ctx.strokeStyle = '#2c6a9c'; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-7, -6); ctx.lineTo(-9.5, 1); ctx.lineTo(-5, 0); ctx.closePath();
  ctx.fillStyle = '#4f9bd8'; ctx.fill(); ctx.stroke();
  const fx = 1;
  eye(ctx, -4 + fx, -16, 2.2, 2.8, o, '#6a3a3a');
  eye(ctx, 5 + fx, -16, 2.2, 2.8, o, '#6a3a3a');
  cheeks(ctx, -8.2 + fx, 9.2 + fx, -12, 2.4);
  ctx.beginPath(); ctx.moveTo(-1 + fx, -13.2); ctx.lineTo(2 + fx, -13.2); ctx.lineTo(0.5 + fx, -11.8); ctx.closePath(); ctx.fillStyle = '#ff8fa8'; ctx.fill();
  mouth(ctx, 0.5 + fx, -11.2, o.mouth || 'smile', 1.8);
  return { top: -45, eyes: [[-4 + fx, -16], [5 + fx, -16]], head: { x: 0, y: -26, w: 12 } };
}

// ---------------------------------------------------------------- 병아리 (그 밖의 에이전트)

function chick(ctx, o) {
  const base = '#ffd95a', line = '#b88a18';
  feet(ctx, '#f59a3a', '#b0601a', o.step, 5, 3.6, 2);
  bodyPath(ctx, 0, -12.5, 12.5, 12);
  paint(ctx, base, line, 0, -13, 13);
  sheen(ctx, -6, -20, 3.4, 1.8, 0.55);
  // 머리 깃털
  for (const [x, a] of [[-2, -0.5], [0.5, 0], [3, 0.5]]) {
    ctx.save(); ctx.translate(x, -24); ctx.rotate(a);
    ell(ctx, 0, -3, 1.6, 3.4, base, line, 1);
    ctx.restore();
  }
  const flap = o.step * 2;
  ell(ctx, -12, -11 + flap, 3.2, 5.4, soft(ctx, -12, -11, 5, shade(base, -0.06)), line, 1.1, 0.5);
  ell(ctx, 12, -11 - flap, 3.2, 5.4, soft(ctx, 12, -11, 5, shade(base, -0.06)), line, 1.1, -0.5);
  const fx = 1;
  eye(ctx, -4 + fx, -15, 2.1, 2.6, o);
  eye(ctx, 5 + fx, -15, 2.1, 2.6, o);
  cheeks(ctx, -8 + fx, 9 + fx, -10.8, 2.2);
  ctx.beginPath(); ctx.moveTo(-2 + fx, -12); ctx.lineTo(0.5 + fx, -13.5); ctx.lineTo(3 + fx, -12); ctx.lineTo(0.5 + fx, -10); ctx.closePath();
  ctx.fillStyle = '#f59a3a'; ctx.fill(); ctx.strokeStyle = '#b0601a'; ctx.lineWidth = 0.9; ctx.stroke();
  // 옆구리에 멘 작은 가방
  ctx.strokeStyle = '#a0522d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-6, -6.5); ctx.quadraticCurveTo(2, -3, 7, -6); ctx.stroke();
  ctx.fillStyle = '#e07a4a'; ctx.beginPath(); ctx.roundRect(6, -8, 6, 5, 1.5); ctx.fill(); ctx.strokeStyle = '#8a3a1a'; ctx.stroke();
  ctx.fillStyle = '#ffd36e'; ctx.fillRect(8.4, -6.6, 1.2, 1.2);
  return { top: -31, eyes: [[-4 + fx, -15], [5 + fx, -15]], head: { x: 0, y: -24, w: 11 } };
}

// ---------------------------------------------------------------- 나 (사람)

function human(ctx, o) {
  const skin = '#ffe0c6', hair = '#6b4632', hoodie = '#f2b84b', hl = '#b07a1e';
  const l = Math.max(0, o.step) * 2.2, r = Math.max(0, -o.step) * 2.2;
  ctx.fillStyle = '#4a5578';
  ctx.fillRect(-5.5, -7 - l, 4, 5); ctx.fillRect(1.5, -7 - r, 4, 5);
  ell(ctx, -3.6, -1.6 - l, 3.6, 2, '#ffffff', '#8a8a9a', 1);
  ell(ctx, 3.6, -1.6 - r, 3.6, 2, '#ffffff', '#8a8a9a', 1);
  // 후드티
  ctx.beginPath(); ctx.moveTo(-8.5, -6); ctx.quadraticCurveTo(-9.5, -16, -6, -17); ctx.lineTo(6, -17); ctx.quadraticCurveTo(9.5, -16, 8.5, -6); ctx.closePath();
  paint(ctx, hoodie, hl, 0, -12, 10, 1.3);
  ctx.strokeStyle = rgba(hl, 0.7); ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(-4.5, -9.5); ctx.quadraticCurveTo(0, -8, 4.5, -9.5); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-1.5, -16); ctx.lineTo(-1.8, -12.5); ctx.moveTo(1.5, -16); ctx.lineTo(1.8, -12.5); ctx.stroke();
  const swing = o.step * 1.5;
  ell(ctx, -9.5, -11 + swing, 2.6, 4.2, soft(ctx, -9.5, -11, 4, hoodie), hl, 1.1, 0.2);
  ell(ctx, 9.5, -11 - swing, 2.6, 4.2, soft(ctx, 9.5, -11, 4, hoodie), hl, 1.1, -0.2);
  ell(ctx, -10, -7.5 + swing, 2, 2, skin, '#c9967a', 0.9);
  ell(ctx, 10, -7.5 - swing, 2, 2, skin, '#c9967a', 0.9);
  ell(ctx, 0, -17, 7.5, 2.8, shade(hoodie, -0.15), hl, 1);
  // 머리
  ell(ctx, 0, -25.5, 10.5, 10, soft(ctx, 0, -25.5, 10, skin, 0.25), '#c9967a', 1.3);
  ctx.beginPath();
  ctx.moveTo(-11, -24); ctx.bezierCurveTo(-12, -38, 12, -38, 11, -24);
  ctx.quadraticCurveTo(9, -29, 6, -28.5); ctx.quadraticCurveTo(3.5, -27, 1.5, -29); ctx.quadraticCurveTo(-1, -27, -3.5, -29); ctx.quadraticCurveTo(-7, -27.5, -9, -27); ctx.closePath();
  paint(ctx, hair, shade(hair, -0.45), -2, -31, 10, 1.2);
  sheen(ctx, -5, -33, 3, 1.2, 0.3);
  const fx = 1;
  eye(ctx, -3.6 + fx, -23.5, 1.8, 2.3, o);
  eye(ctx, 4 + fx, -23.5, 1.8, 2.3, o);
  cheeks(ctx, -7 + fx, 7.5 + fx, -20, 2);
  mouth(ctx, 0.3 + fx, -19.8, o.mouth || 'smile', 1.6);
  return { top: -37, eyes: [[-3.6 + fx, -23.5], [4 + fx, -23.5]], head: { x: 0, y: -35, w: 11 } };
}

// ---------------------------------------------------------------- 마을 주민

// 쉼터에서 낮잠 자는 구름 양
function sheep(ctx, o) {
  ell(ctx, -8, -2, 2.4, 2, '#5a504a'); ell(ctx, 6, -2, 2.4, 2, '#5a504a');
  const wool = [[-10, -9, 7.5], [-3, -13, 8.5], [5, -12, 8], [-7, -4, 7], [2, -5, 8], [9, -6, 6]];
  ctx.fillStyle = '#b7b0a2';
  for (const [x, y, r] of wool) { ctx.beginPath(); ctx.arc(x, y, r + 1.4, 0, TAU); ctx.fill(); }
  for (const [x, y, r] of wool) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = soft(ctx, x, y, r, '#fbf8f1', 0.4, -0.1); ctx.fill(); }
  // 얼굴 (엎드려서 오른쪽을 본다)
  ell(ctx, 13, -7, 2.4, 3.8, '#6e625a', null, 0, 0.6);
  ell(ctx, 15, -6, 6, 5, soft(ctx, 15, -6, 6, '#7a6c62', 0.3), '#4a3e36', 1.2);
  ell(ctx, 12.5, -11, 4, 2.6, '#fbf8f1');
  eye(ctx, 13.5, -6.5, 1.5, 1.4, { eyes: 'closed' });
  eye(ctx, 17.5, -6.5, 1.5, 1.4, { eyes: 'closed' });
  ell(ctx, 15.5, -3.5, 1.4, 0.9, '#f2a0a8');
  return { top: -23, eyes: [], head: { x: 14, y: -11, w: 6 } };
}

function frog(ctx, o) {
  const base = '#7fcf6a', line = '#3d7a2c';
  ell(ctx, -8, -3, 5, 3.4, soft(ctx, -8, -3, 5, shade(base, -0.1)), line, 1.1);
  ell(ctx, 8, -3, 5, 3.4, soft(ctx, 8, -3, 5, shade(base, -0.1)), line, 1.1);
  ell(ctx, 0, -7, 10.5, 7.5, soft(ctx, 0, -7, 10, base), line, 1.4);
  ell(ctx, 1, -4.5, 6.5, 3.6, 'rgba(240,255,220,.75)');
  for (const x of [-5, 5]) {
    ell(ctx, x, -13, 4, 4, soft(ctx, x, -13, 4, base), line, 1.2);
    eye(ctx, x + 0.5, -13, 2, 2.3, o);
  }
  cheeks(ctx, -7, 8, -7.5, 2);
  ctx.strokeStyle = '#2d5a20'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-4, -8); ctx.quadraticCurveTo(0.5, -5.5, 5, -8); ctx.stroke();
  return { top: -18, eyes: [], head: { x: 0, y: -16, w: 9 } };
}

function duck(ctx, o) {
  ell(ctx, 0, 0.5, 13, 3.6, null, 'rgba(255,255,255,.7)', 1.2);
  ell(ctx, -1, -4, 10, 6, soft(ctx, -1, -4, 10, '#ffe066'), '#b88a18', 1.3);
  ell(ctx, -10, -7, 3, 2.2, '#ffe066', '#b88a18', 1.1, -0.6);
  ell(ctx, -3, -5, 5.5, 3, rgba('#f0c040', 0.8), null, 0, 0.2);
  ell(ctx, 5.5, -12, 5.4, 5.2, soft(ctx, 5.5, -12, 5, '#ffe066'), '#b88a18', 1.3);
  ctx.beginPath(); ctx.moveTo(9.5, -12.5); ctx.quadraticCurveTo(14, -12.5, 13.5, -10.5); ctx.quadraticCurveTo(11, -9.5, 9.5, -10.5); ctx.closePath();
  ctx.fillStyle = '#f59a3a'; ctx.fill(); ctx.strokeStyle = '#b0601a'; ctx.lineWidth = 0.9; ctx.stroke();
  eye(ctx, 7, -13.5, 1.3, 1.6, o);
  ell(ctx, 4, -10.6, 1.6, 1, 'rgba(255,120,130,.45)');
  return { top: -18, eyes: [], head: { x: 5, y: -17, w: 5 } };
}

export const SPECIES = {
  mochi: { name: '모찌', draw: mochi, color: '#ef8b60', w: 1.1 },
  sprout: { name: '새싹이', draw: sprout, color: '#6cc04e' },
  owl: { name: '부엉이', draw: owl, color: '#8b6fd0' },
  bunny: { name: '토끼', draw: bunny, color: '#5aa9e6' },
  chick: { name: '병아리', draw: chick, color: '#f2b51e', w: 0.9 },
  human: { name: '사람', draw: human, color: '#e2963a', w: 0.8 },
  sheep: { name: '양', draw: sheep, color: '#b7b0a2', w: 1.5 },
  frog: { name: '개구리', draw: frog, color: '#7fcf6a', w: 0.9 },
  duck: { name: '오리', draw: duck, color: '#ffe066', w: 0 },
};

export function speciesForAgent(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('explore')) return 'sprout';
  if (t.includes('plan')) return 'owl';
  if (!t || t.includes('general')) return 'bunny';
  return 'chick';
}

// ---------------------------------------------------------------- 방마다 쓰는 작업 소품 (Claude)

function prop(ctx, kind, info, t) {
  const h = info.head;
  if (kind === 'glasses') {
    ctx.strokeStyle = '#4a3020'; ctx.lineWidth = 1.3;
    for (const [x, y] of info.eyes) { ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.stroke(); ell(ctx, x, y, 3.6, 3.6, 'rgba(210,240,255,.25)'); }
    const [a, b] = info.eyes;
    ctx.beginPath(); ctx.moveTo(a[0] + 4, a[1]); ctx.lineTo(b[0] - 4, b[1]); ctx.stroke();
  } else if (kind === 'hardhat') {
    ctx.beginPath(); ctx.moveTo(h.x - h.w * 0.85, h.y + 3); ctx.bezierCurveTo(h.x - h.w * 0.85, h.y - 9, h.x + h.w * 0.85, h.y - 9, h.x + h.w * 0.85, h.y + 3); ctx.closePath();
    paint(ctx, '#ffcf3a', '#b88a10', h.x, h.y - 2, h.w, 1.3);
    ell(ctx, h.x + 1, h.y + 3, h.w + 2, 2.2, soft(ctx, h.x, h.y + 3, h.w, '#ffd84d'), '#b88a10', 1.2);
    ctx.fillStyle = '#ffe680'; ctx.fillRect(h.x - 1.5, h.y - 6, 3, 8);
  } else if (kind === 'headset') {
    ctx.strokeStyle = '#3b4252'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(h.x, h.y + 6, h.w * 0.95, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    ell(ctx, h.x - h.w * 0.95, h.y + 9, 2.6, 3.6, '#4f5d73', '#2b3444', 1);
    ell(ctx, h.x + h.w * 0.95, h.y + 9, 2.6, 3.6, '#4f5d73', '#2b3444', 1);
    ctx.strokeStyle = '#3b4252'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(h.x + h.w * 0.95, h.y + 11); ctx.quadraticCurveTo(h.x + h.w * 0.9, h.y + 18, h.x + 5, h.y + 18); ctx.stroke();
    ell(ctx, h.x + 4.5, h.y + 18, 1.6, 1.3, '#ff6b6b');
  } else if (kind === 'antenna') {
    ctx.strokeStyle = '#5b4aa8'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(h.x, h.y + 6, h.w * 0.9, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(h.x + 5, h.y - 2); ctx.lineTo(h.x + 8, h.y - 11); ctx.stroke();
    ell(ctx, h.x + 8, h.y - 12, 2.2, 2.2, Math.sin(t * 8) > 0 ? '#ff5a5a' : '#ff9a9a', '#8a1f1f', 1);
    ctx.strokeStyle = 'rgba(255,90,90,.6)'; ctx.lineWidth = 1;
    const r = 3 + (t * 12) % 6;
    ctx.beginPath(); ctx.arc(h.x + 8, h.y - 12, r, -2.4, -0.7); ctx.stroke();
  } else if (kind === 'beret') {
    ell(ctx, h.x - 1, h.y + 1, h.w * 0.8, 4.2, soft(ctx, h.x - 1, h.y, h.w, '#e8574d'), '#9a2c26', 1.2, -0.2);
    ell(ctx, h.x - 1, h.y - 3.5, 1.4, 1.6, '#9a2c26');
    // 귀에 꽂은 연필
    ctx.save(); ctx.translate(h.x + h.w * 0.9, h.y + 7); ctx.rotate(-0.9);
    ctx.fillStyle = '#ffcf3a'; ctx.fillRect(-1, -7, 2.2, 9);
    ctx.fillStyle = '#ffd9b0'; ctx.beginPath(); ctx.moveTo(-1, 2); ctx.lineTo(1.2, 2); ctx.lineTo(0.1, 4.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- 감정 표현

function sweat(ctx, x, y, t) {
  const dy = (t * 26) % 9;
  ctx.save(); ctx.translate(x, y + dy); ctx.globalAlpha *= 1 - dy / 11;
  ctx.beginPath(); ctx.moveTo(0, -5); ctx.quadraticCurveTo(4.5, 1, 0, 3); ctx.quadraticCurveTo(-4.5, 1, 0, -5);
  ctx.fillStyle = soft(ctx, 0, -1, 4, '#8fd4ff', 0.5); ctx.fill(); ctx.strokeStyle = '#3b8fd0'; ctx.lineWidth = 1; ctx.stroke();
  ell(ctx, -1, -0.5, 0.8, 1.3, '#ffffff');
  ctx.restore();
}

function book(ctx, x, y, t) {
  const flap = Math.sin(t * 4) * 1.2;
  ctx.save(); ctx.translate(x, y);
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(s * 8, 0); ctx.lineTo(s * 8, -9 + (s < 0 ? flap : -flap)); ctx.lineTo(0, -7); ctx.closePath();
    ctx.fillStyle = '#fffaf0'; ctx.fill(); ctx.strokeStyle = '#4fa3e0'; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.strokeStyle = '#c9b48f'; ctx.lineWidth = 0.7;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(s * 1.8, -4.8 + i * 2); ctx.lineTo(s * 6.2, -6 + i * 2); ctx.stroke(); }
  }
  ctx.restore();
}

function phone(ctx, x, y, t) {
  const shake = Math.sin(t * 30) * 1;
  ctx.save(); ctx.translate(x + shake, y); ctx.rotate(-0.5);
  ctx.beginPath(); ctx.moveTo(-3, -8); ctx.quadraticCurveTo(-5, 0, -3, 8); ctx.lineTo(1, 8); ctx.lineTo(1, 4); ctx.quadraticCurveTo(-1, 0, 1, -4); ctx.lineTo(1, -8); ctx.closePath();
  ctx.fillStyle = '#e8574d'; ctx.fill(); ctx.strokeStyle = '#8f2620'; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(232,87,77,.75)'; ctx.lineWidth = 1.2;
  for (let i = 1; i <= 2; i++) { ctx.beginPath(); ctx.arc(x + 4, y - 6, 3.5 * i + (t * 8 % 3), -1.3, 0.1); ctx.stroke(); }
}

function zzz(ctx, x, y, t) {
  ctx.save(); ctx.font = 'bold 9px sans-serif';
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.5 + i / 3) % 1;
    ctx.globalAlpha = (1 - p) * 0.9;
    ctx.fillStyle = '#7f8fc8';
    ctx.font = `bold ${7 + p * 5}px sans-serif`;
    ctx.fillText('z', x + p * 10 + Math.sin(p * 6) * 2, y - p * 16);
  }
  ctx.restore();
}

function ponder(ctx, x, y, t) {
  ctx.save();
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#8a6bd1'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
  const dx = Math.sin(t * 3) * 1.5;
  ctx.strokeText('?', x + dx, y); ctx.fillText('?', x + dx, y);
  ctx.restore();
}

function hand(ctx, x, y, t, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 10) * 0.45);
  ell(ctx, 0, -3, 3.2, 3.4, color || '#ffd9b0', shade(color || '#ffd9b0', -0.4), 1);
  ctx.restore();
}

function sparkles(ctx, x, y, t) {
  for (let i = 0; i < 3; i++) {
    const a = t * 2 + i * 2.1, r = 13 + Math.sin(t * 3 + i) * 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.5;
    const s = 1.6 + Math.sin(t * 6 + i) * 0.8;
    ctx.fillStyle = '#ffd84d';
    ctx.beginPath(); ctx.moveTo(px, py - s * 2); ctx.lineTo(px + s * 0.5, py); ctx.lineTo(px, py + s * 2); ctx.lineTo(px - s * 0.5, py); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(px - s * 2, py); ctx.lineTo(px, py + s * 0.5); ctx.lineTo(px + s * 2, py); ctx.lineTo(px, py - s * 0.5); ctx.closePath(); ctx.fill();
  }
}

// 엘리베이터에서 나타나고 사라질 때 피어오르는 연기
function poof(ctx, p) {
  ctx.save();
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU;
    const r = 6 + p * 16;
    ctx.globalAlpha = Math.max(0, 1 - p) * 0.9;
    ell(ctx, Math.cos(a) * r, -12 + Math.sin(a) * r * 0.6, 5 * (1 - p * 0.5), 5 * (1 - p * 0.5), '#ffffff', '#d9d2c4', 1);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 캐릭터 하나 그리기

const CHAR_SCALE = 1.4;

// (ch.sx, ch.sy)는 발 위치. 말풍선을 붙일 머리 꼭대기 y를 돌려준다.
export function drawCharacter(ctx, ch, t) {
  const sp = SPECIES[ch.species] || SPECIES.mochi;
  const seed = ch.seed || 0;
  const walking = ch.moving;
  const phase = t * 10 + seed;
  const step = walking ? Math.sin(phase) : 0;
  const hop = walking ? Math.abs(Math.sin(phase)) * 2 : 0;
  const breathe = walking ? 0 : Math.sin(t * 2.4 + seed) * (ch.emote === 'sleep' || ch.species === 'sheep' ? 0.05 : 0.025);
  const sy = 1 + breathe - (walking ? Math.abs(Math.cos(phase)) * 0.04 : 0);
  const sx = 2 - sy;
  const blink = ((t + seed) % 3.9) < 0.12;
  const facing = ch.facing || 1;
  const alpha = ch.alpha == null ? 1 : ch.alpha;
  const eyes = ch.emote === 'sleep' || ch.species === 'sheep' ? 'closed' : ch.eyes;

  ctx.save();
  ctx.translate(ch.sx, ch.sy);
  ctx.scale(CHAR_SCALE, CHAR_SCALE);
  ctx.globalAlpha = alpha;
  if (sp.w !== 0) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 14 * (sp.w || 1));
    g.addColorStop(0, 'rgba(40,50,20,.28)'); g.addColorStop(1, 'rgba(40,50,20,0)');
    ctx.save(); ctx.scale(1, 0.36); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 14 * (sp.w || 1) - hop, 0, TAU); ctx.fill(); ctx.restore();
  }
  ctx.save();
  ctx.translate(0, -hop);
  ctx.scale(facing * sx, sy);
  const info = sp.draw(ctx, { blink, mouth: ch.mouth, eyes, step, t: t + seed });
  if (ch.prop) prop(ctx, ch.prop, info, t);
  ctx.restore();

  const top = info.top * sy - hop;
  const headY = (info.head ? info.head.y : info.top + 8) * sy - hop;
  if (ch.emote === 'read') book(ctx, 12 * facing, -7, t);
  if (ch.emote === 'phone') phone(ctx, 15 * facing, headY + 10, t);
  if (ch.emote === 'sleep') zzz(ctx, 8 * facing, top + 2, t);
  if (ch.emote === 'ponder') ponder(ctx, 11 * facing, top + 4, t);
  if (ch.emote === 'wave') hand(ctx, 17 * facing, headY + 12, t, sp.color);
  if (ch.eyes === 'happy') sparkles(ctx, 0, headY + 6, t);
  if (ch.sweat) sweat(ctx, -10 * facing, headY + 8, t);
  if (ch.poofT != null) {
    const p = (t - ch.poofT) / 0.7;
    if (p >= 0 && p < 1) poof(ctx, p);
  }
  ctx.restore();
  return ch.sy + top * CHAR_SCALE;
}

// 화면 패널용 작은 얼굴 그림
export function portrait(species, size = 34) {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = c.height = size * dpr;
  c.style.width = c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const sp = SPECIES[species] || SPECIES.mochi;
  const k = size / 46;
  ctx.translate(size / 2, size * 0.94);
  ctx.scale(k, k);
  sp.draw(ctx, { blink: false, step: 0, t: 0 });
  return c;
}

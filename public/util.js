// 여러 파일이 함께 쓰는 작은 도우미 (문자열, 시간·토큰 표기). 화면(DOM)을 건드리지 않는다.

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const baseName = p => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() : '');
export const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + '초 전';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}
export function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? s + '초' : s < 3600 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : Math.floor(s / 3600) + '시간 ' + Math.floor(s / 60 % 60) + '분';
}
// 토큰 수를 545k, 1.2M처럼 줄여 쓴다
export function tokens(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
}
export function clock(t) {
  const d = new Date(t || Date.now());
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

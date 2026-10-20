#!/usr/bin/env node
// 클로드봇 마을 — Claude Code 세션 기록(jsonl)을 따라 읽어 블록 마을로 보여주는 로컬 서버.
// 외부 패키지 없음. 훅/설정을 건드리지 않고 ~/.claude/projects 아래 파일을 읽기만 한다.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || process.env.PORT || 4848);
const HOST = args.host || '127.0.0.1';
// Host 헤더에서는 IPv6 주소가 [::1] 처럼 대괄호로 싸여 온다
const HOST_HEADER = HOST.includes(':') && !HOST.startsWith('[') ? `[${HOST}]` : HOST;
const PUBLIC_DIR = path.join(__dirname, 'public');

let ROOT = args.dir || process.env.CLAUDE_PROJECTS_DIR ||
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
if (args.demo) ROOT = require('./demo').start();

const ACTIVE_MS = 2 * 60 * 1000;       // 마지막 기록 후 이 시간 안이면 "불 켜진" 세션
const INITIAL_TAIL = 2 * 1024 * 1024;      // 처음 열 때 메인 세션 끝부분만 읽는다
const SUB_INITIAL_TAIL = 128 * 1024;
const SUB_RECENT_MS = 30 * 60 * 1000;  // 처음 열 때 이 시간 안에 쓰인 서브에이전트 기록만 읽는다
const MAX_CHUNK = 4 * 1024 * 1024;     // 한 번의 폴링에서 읽는 최대 바이트
const HEAD_BYTES = 64 * 1024;
const NAME_RE = /^[A-Za-z0-9._-]+$/;

function userName() {
  try { return os.userInfo().username; } catch { return process.env.USER || process.env.USERNAME || 'me'; }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }   // --port=5000
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

// ---------------------------------------------------------------- 파일 읽기 도우미

function readRange(file, start, end) {
  const len = Math.max(0, end - start);
  const buf = Buffer.alloc(len);
  if (!len) return buf;
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  return buf;
}

function parseLines(buf) {
  const out = [];
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 잘린 줄은 무시 */ }
  }
  return out;
}

function headRecords(file, size) {
  const buf = readRange(file, 0, Math.min(size, HEAD_BYTES));
  const nl = buf.lastIndexOf(0x0a);
  return parseLines(nl >= 0 ? buf.subarray(0, nl) : buf);
}

function tailRecords(file, size, bytes) {
  const start = Math.max(0, size - bytes);
  let buf = readRange(file, start, size);
  if (start > 0) { const nl = buf.indexOf(0x0a); buf = nl >= 0 ? buf.subarray(nl + 1) : Buffer.alloc(0); }
  return parseLines(buf);
}

// ---------------------------------------------------------------- 텍스트 정리

function clip(s, n) {
  if (typeof s !== 'string') return '';
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// 사용자 메시지에서 실제 프롬프트만 골라낸다. 명령(/clear 등)과 시스템 주입문은 걸러낸다.
function cleanPrompt(text) {
  if (typeof text !== 'string') return {};
  const t = text.trim();
  const cmd = t.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/);
  if (cmd) return { cmd: cmd[1] };
  if (t.startsWith('[Request interrupted')) return { interrupt: true };
  if (/^<(local-command|system-reminder|bash-|task-notification|user-prompt-submit-hook)/.test(t)) return {};
  if (t.startsWith('Caveat:')) return {};
  const stripped = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  return stripped ? { text: stripped } : {};
}

function userText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  if (content.some(b => b && b.type === 'tool_result')) return '';
  return content.map(b => (b && b.type === 'text' ? b.text : b && b.type === 'image' ? '[이미지]' : '')).join(' ');
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(b => (b && b.type === 'text' ? b.text : '')).join(' ');
  return '';
}

const INPUT_KEYS = ['description', 'command', 'file_path', 'notebook_path', 'path', 'pattern', 'glob',
  'url', 'query', 'subagent_type', 'skill', 'prompt', 'message', 'to'];

function compactInput(name, input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of INPUT_KEYS) if (typeof input[k] === 'string') out[k] = clip(input[k], k === 'prompt' ? 300 : 160);
  if (Array.isArray(input.todos)) {
    out.todos = input.todos.slice(0, 10).map(t => ({ c: clip(t.content || t.subject || '', 60), s: t.status || 'pending' }));
  }
  if (Array.isArray(input.questions) && input.questions[0]) out.question = clip(input.questions[0].question, 160);
  if (typeof input.subject === 'string') out.subject = clip(input.subject, 80);
  if (!Object.keys(out).length) {
    for (const v of Object.values(input)) if (typeof v === 'string') { out.arg = clip(v, 120); break; }
  }
  return out;
}

// jsonl 한 줄 → 화면에 필요한 작은 이벤트들
function compact(rec, src) {
  const out = [];
  if (!rec || typeof rec !== 'object') return out;
  const base = { src, t: rec.timestamp ? Date.parse(rec.timestamp) : null };
  if (rec.isSidechain) base.side = true;
  if (rec.agentId) base.agentId = rec.agentId;

  switch (rec.type) {
    case 'custom-title':
      if (rec.customTitle) out.push({ ...base, k: 'title', text: clip(rec.customTitle, 80) });
      break;
    case 'user': {
      if (rec.isMeta || rec.isCompactSummary) break;
      const c = rec.message && rec.message.content;
      if (Array.isArray(c)) {
        const tur = rec.toolUseResult && typeof rec.toolUseResult === 'object' ? rec.toolUseResult : null;
        for (const b of c) {
          if (!b || b.type !== 'tool_result') continue;
          out.push({ ...base, k: 'result', id: b.tool_use_id, err: !!b.is_error,
            text: clip(resultText(b.content), 240), agent: tur && tur.agentId ? String(tur.agentId) : undefined,
            async: !!(tur && (tur.isAsync || tur.status === 'async_launched')) });
        }
      }
      const p = cleanPrompt(userText(c));
      if (p.cmd) out.push({ ...base, k: 'command', text: p.cmd });
      else if (p.interrupt) out.push({ ...base, k: 'interrupt' });
      else if (p.text) out.push({ ...base, k: 'prompt', text: clip(p.text, 300) });
      break;
    }
    case 'assistant': {
      const m = rec.message || {};
      if (rec.isApiErrorMessage) { out.push({ ...base, k: 'apierr', text: clip(resultText(m.content), 160) }); break; }
      if (!Array.isArray(m.content)) break;
      for (const b of m.content) {
        if (!b) continue;
        if (b.type === 'thinking') out.push({ ...base, k: 'think', text: clip(b.thinking || '', 280) });
        else if (b.type === 'redacted_thinking') out.push({ ...base, k: 'think', text: '' });
        else if (b.type === 'text' && b.text && b.text.trim()) out.push({ ...base, k: 'text', text: clip(b.text, 400), stop: m.stop_reason || null });
        else if (b.type === 'tool_use') out.push({ ...base, k: 'tool', id: b.id, name: b.name, input: compactInput(b.name, b.input) });
      }
      break;
    }
    case 'system':
      if (rec.subtype === 'stop_hook_summary' || rec.subtype === 'turn_duration') out.push({ ...base, k: 'stop' });
      else if (rec.subtype === 'api_error') out.push({ ...base, k: 'apierr', text: clip(rec.content || 'API 오류', 160) });
      else if (rec.subtype === 'compact_boundary') out.push({ ...base, k: 'compact' });
      break;
  }
  return out;
}

// ---------------------------------------------------------------- 세션 목록

const infoCache = new Map();

function sessionInfo(file, st) {
  const hit = infoCache.get(file);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit.info;
  const info = { title: '', cwd: '', birth: st.birthtimeMs || st.mtimeMs, hasMessages: false, customTitle: '' };
  try {
    const recs = headRecords(file, st.size);
    if (st.size > HEAD_BYTES) recs.push(...tailRecords(file, st.size, HEAD_BYTES));
    let firstTs = null;
    for (const r of recs) {
      if (r.type === 'user' || r.type === 'assistant') info.hasMessages = true;
      if (!info.cwd && r.cwd) info.cwd = r.cwd;
      if (!firstTs && r.timestamp) firstTs = Date.parse(r.timestamp);
      if (r.type === 'custom-title' && r.customTitle) info.customTitle = r.customTitle;
      if (!info.title && r.type === 'user' && !r.isMeta && !r.isSidechain) {
        const p = cleanPrompt(userText(r.message && r.message.content));
        if (p.text) info.title = clip(p.text, 60);
      }
    }
    if (firstTs) info.birth = firstTs;
    if (info.customTitle) info.title = clip(info.customTitle, 60);
  } catch { /* 읽는 도중 지워진 파일 */ }
  infoCache.set(file, { size: st.size, mtime: st.mtimeMs, info });
  return info;
}

// 세션의 서브에이전트 기록 가운데 가장 최근에 바뀐 시각. 서브에이전트만 일하는 동안에도 불이 켜져 있게 한다.
function newestSubagentWrite(floorDir, sessionId, oldFormat) {
  let newest = 0;
  try {
    const dir = path.join(floorDir, sessionId, 'subagents');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      try { newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs); } catch { /* 지워짐 */ }
    }
  } catch { /* 하위 폴더 없음 */ }
  return Math.max(newest, oldFormat.get(sessionId) || 0);
}

// 디렉터리 이름(-Users-me-work-app)에서 경로를 대충 복원한다. 실제 cwd가 기록에 있으면 그걸 쓴다.
function guessCwd(dirName) { return dirName.replace(/-/g, '/'); }

function listFloors() {
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory() && NAME_RE.test(d.name)); }
  catch { return []; }
  const now = Date.now();
  const floors = [];
  for (const d of dirs) {
    const dir = path.join(ROOT, d.name);
    let files;
    try { files = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    const sessions = [];
    // 예전 형식(agent-*.jsonl)의 서브에이전트 기록: 최근 것만 어느 세션 것인지 확인한다
    const oldFormat = new Map();
    for (const f of files) {
      if (!f.isFile() || !f.name.startsWith('agent-') || !f.name.endsWith('.jsonl')) continue;
      let st;
      try { st = fs.statSync(path.join(dir, f.name)); } catch { continue; }
      if (now - st.mtimeMs > ACTIVE_MS) continue;
      const sid = subagentHead(path.join(dir, f.name), st).sessionId;
      if (sid) oldFormat.set(sid, Math.max(oldFormat.get(sid) || 0, st.mtimeMs));
    }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl') || f.name.startsWith('agent-')) continue;
      const id = f.name.slice(0, -6);
      if (!NAME_RE.test(id)) continue;
      const file = path.join(dir, f.name);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      const info = sessionInfo(file, st);
      if (!info.hasMessages) continue;
      // 하루 넘게 조용한 세션은 서브에이전트 폴더까지 뒤지지 않는다
      const mtime = now - st.mtimeMs < 86400e3 ? Math.max(st.mtimeMs, newestSubagentWrite(dir, id, oldFormat)) : st.mtimeMs;
      sessions.push({ id, title: info.title || '제목 없는 세션', cwd: info.cwd, birth: info.birth,
        mtime, active: now - mtime < ACTIVE_MS });
    }
    if (!sessions.length) continue;
    sessions.sort((a, b) => b.mtime - a.mtime);
    const cwd = (sessions.find(s => s.cwd) || {}).cwd || guessCwd(d.name);
    floors.push({
      id: d.name, cwd, name: path.basename(cwd) || d.name,
      firstSeen: Math.min(...sessions.map(s => s.birth)),
      lastActive: sessions[0].mtime,
      active: sessions.some(s => s.active),
      sessionCount: sessions.length,
      sessions: sessions.slice(0, 30).map(({ cwd: _c, ...s }) => s),
    });
  }
  floors.sort((a, b) => a.firstSeen - b.firstSeen || a.id.localeCompare(b.id));
  floors.forEach((f, i) => { f.floor = i + 1; });
  return floors;
}

// ---------------------------------------------------------------- 서브에이전트 기록 찾기

const sideHeadCache = new Map();

function subagentHead(file, st) {
  const hit = sideHeadCache.get(file);
  if (hit && hit.size === st.size) return hit.head;
  const head = { sessionId: '', prompt: '', agentId: '' };
  try {
    for (const r of headRecords(file, st.size)) {
      if (!head.sessionId && r.sessionId) head.sessionId = r.sessionId;
      if (!head.agentId && r.agentId) head.agentId = String(r.agentId);
      if (!head.prompt && r.type === 'user') {
        const p = cleanPrompt(userText(r.message && r.message.content));
        if (p.text) head.prompt = clip(p.text, 300);
      }
      if (head.sessionId && head.prompt && head.agentId) break;
    }
  } catch { /* 무시 */ }
  // 첫 프롬프트가 아직 안 써졌으면 다음에 다시 읽는다
  if (head.prompt) sideHeadCache.set(file, { size: st.size, head });
  return head;
}

function readMeta(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function findSubagents(floorDir, sessionId) {
  const subs = [];
  const nested = path.join(floorDir, sessionId, 'subagents');
  try {
    for (const f of fs.readdirSync(nested)) {
      if (!f.endsWith('.jsonl') || !NAME_RE.test(f)) continue;
      const file = path.join(nested, f);
      const meta = readMeta(file.replace(/\.jsonl$/, '.meta.json'));
      subs.push({ key: f.slice(0, -6), file, agentType: meta && (meta.agentType || meta.subagent_type) });
    }
  } catch { /* 하위 폴더 없음 */ }
  // 예전 버전: 프로젝트 폴더에 agent-*.jsonl 로 섞여 있다
  try {
    for (const f of fs.readdirSync(floorDir)) {
      if (!f.startsWith('agent-') || !f.endsWith('.jsonl') || !NAME_RE.test(f)) continue;
      const file = path.join(floorDir, f);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (subagentHead(file, st).sessionId === sessionId) subs.push({ key: f.slice(0, -6), file });
    }
  } catch { /* 무시 */ }
  return subs;
}

// ---------------------------------------------------------------- 증분 읽기

// offset부터 새로 추가된 완성된 줄만 읽는다. 아주 긴 한 줄(이미지 등)은 건너뛴다.
function readNew(file, offset, initialTail) {
  const st = fs.statSync(file);
  let start = offset;
  let reset = false;
  if (start == null) {
    start = initialTail == null ? 0 : Math.max(0, st.size - initialTail);
    if (start > 0) {
      const probe = readRange(file, start, Math.min(st.size, start + MAX_CHUNK));
      const nl = probe.indexOf(0x0a);
      start = nl >= 0 ? start + nl + 1 : st.size;
    }
  } else if (start > st.size) { start = 0; reset = true; }
  const end = Math.min(st.size, start + MAX_CHUNK);
  if (end <= start) return { offset: start, records: [], reset, size: st.size, mtime: st.mtimeMs };
  const buf = readRange(file, start, end);
  const nl = buf.lastIndexOf(0x0a);
  if (nl < 0) {
    // 줄 하나가 MAX_CHUNK보다 크면 그 줄은 버리고 다음 줄부터 읽는다
    const skip = buf.length === MAX_CHUNK ? end : start;
    return { offset: skip, records: [], reset, size: st.size, mtime: st.mtimeMs };
  }
  return { offset: start + nl + 1, records: parseLines(buf.subarray(0, nl)), reset, size: st.size, mtime: st.mtimeMs };
}

function sessionDelta(floorId, sessionId, cursor) {
  const floorDir = path.join(ROOT, floorId);
  const mainFile = path.join(floorDir, sessionId + '.jsonl');
  const initial = !cursor || typeof cursor.m !== 'number';
  const main = readNew(mainFile, initial ? null : cursor.m, INITIAL_TAIL);
  const events = [];
  for (const r of main.records) events.push(...compact(r, 'main'));

  const nextSubs = {};
  const subsMeta = {};
  const prevSubs = (cursor && cursor.s) || {};
  const now = Date.now();
  let lastWrite = main.mtime;
  for (const sub of findSubagents(floorDir, sessionId)) {
    let st;
    try { st = fs.statSync(sub.file); } catch { continue; }
    lastWrite = Math.max(lastWrite, st.mtimeMs);
    const head = subagentHead(sub.file, st);
    subsMeta[sub.key] = { prompt: head.prompt, agentId: head.agentId, agentType: sub.agentType || '', mtime: st.mtimeMs };
    let off = prevSubs[sub.key];
    let tail = null;
    if (typeof off !== 'number') {
      if (initial) {
        // 처음 열 때: 끝난 지 오래된 서브에이전트는 건너뛰고, 최근 것만 끝부분을 읽는다.
        // 긴 명령을 기다리는 동안에는 기록이 멈추므로 넉넉하게 30분까지 본다.
        if (now - st.mtimeMs > SUB_RECENT_MS) off = st.size; else { off = null; tail = SUB_INITIAL_TAIL; }
      } else off = 0; // 새로 생긴 서브에이전트
    }
    const r = readNew(sub.file, off, tail);
    nextSubs[sub.key] = r.offset;
    for (const rec of r.records) events.push(...compact(rec, 'sub:' + sub.key));
  }
  events.sort((a, b) => (a.t || 0) - (b.t || 0));
  return {
    events,
    initial,
    reset: main.reset,
    cursor: { m: main.offset, s: nextSubs },
    subs: subsMeta,
    session: { id: sessionId, mtime: lastWrite, active: now - lastWrite < ACTIVE_MS, more: main.offset < main.size },
  };
}

// ---------------------------------------------------------------- HTTP

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // 다른 사이트가 이 서버를 읽어 가지 못하도록 Host 헤더를 확인한다 (DNS 리바인딩 방지)
  const rawHost = req.headers.host || '';
  const host = rawHost.startsWith('[') ? rawHost.slice(0, rawHost.indexOf(']') + 1) : rawHost.split(':')[0];
  if (!['localhost', '127.0.0.1', '[::1]', HOST_HEADER].includes(host)) { res.writeHead(403); return res.end(); }
  try {
    if (url.pathname === '/api/floors') {
      return sendJson(res, 200, { root: ROOT, user: userName(), demo: !!args.demo, now: Date.now(), floors: listFloors() });
    }
    if (url.pathname === '/api/session') {
      const floor = url.searchParams.get('floor') || '';
      const session = url.searchParams.get('session') || '';
      if (!NAME_RE.test(floor) || !NAME_RE.test(session)) return sendJson(res, 400, { error: 'bad name' });
      let cursor = null;
      const c = url.searchParams.get('c');
      if (c) { try { cursor = JSON.parse(c); } catch { return sendJson(res, 400, { error: 'bad cursor' }); } }
      if (!fs.existsSync(path.join(ROOT, floor, session + '.jsonl'))) return sendJson(res, 404, { error: 'no session' });
      return sendJson(res, 200, sessionDelta(floor, session, cursor));
    }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    return sendJson(res, 500, { error: String(e && e.message || e) });
  }
});

server.on('error', e => {
  const why = { EADDRINUSE: `포트 ${PORT}을 이미 다른 프로그램이 쓰고 있어요. --port 로 다른 포트를 주세요.`,
    EADDRNOTAVAIL: `이 PC에 ${HOST} 주소가 없어요. --host 값을 확인하세요.`,
    EAFNOSUPPORT: `이 PC에서 ${HOST} 주소 형식을 쓸 수 없어요 (IPv6가 꺼져 있을 수 있어요).`,
    EACCES: `포트 ${PORT}을 열 권한이 없어요. 1024 이상의 포트를 쓰세요.` }[e.code];
  console.error(`\n  서버를 열지 못했어요: ${why || e.message}\n`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🏝️  클로드봇 마을이 열렸어요 → http://localhost:${PORT}`);
  console.log(`      읽는 위치: ${ROOT}${args.demo ? ' (데모)' : ''}\n`);
});

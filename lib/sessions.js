// 세션 기록 파일 다루기: 층(프로젝트)과 세션 목록, 서브에이전트 기록 찾기, 지난번 읽은 곳부터 이어 읽기.
// 기록 폴더(root)는 인자로 받는다. 파일을 읽기만 한다.
'use strict';

const fs = require('fs');
const path = require('path');
const { clip, cleanPrompt, userText, compact } = require('./events');

const ACTIVE_MS = 2 * 60 * 1000;       // 마지막 기록 후 이 시간 안이면 "불 켜진" 세션
const INITIAL_TAIL = 2 * 1024 * 1024;      // 처음 열 때 메인 세션 끝부분만 읽는다
const SUB_INITIAL_TAIL = 128 * 1024;
const SUB_RECENT_MS = 30 * 60 * 1000;  // 처음 열 때 이 시간 안에 쓰인 서브에이전트 기록만 읽는다
const MAX_CHUNK = 4 * 1024 * 1024;     // 한 번의 폴링에서 읽는 최대 바이트
const HEAD_BYTES = 64 * 1024;
const CACHE_MAX = 20000;               // 캐시가 이보다 커지면 비운다
const NAME_RE = /^[A-Za-z0-9._-]+$/;

// 폴더·세션 이름으로 받아도 되는 값인가 ('.'·'..'는 상위 폴더를 가리키므로 안 된다)
const validName = s => NAME_RE.test(s) && s !== '.' && s !== '..';

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

// ---------------------------------------------------------------- 세션 목록

const infoCache = new Map();

// 제목은 사용자가 붙인 이름 → 가장 최근 요청 → 첫 요청 순으로 고른다
function sessionInfo(file, st) {
  const hit = infoCache.get(file);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit.info;
  // 앞부분(HEAD_BYTES)이 이미 다 찬 파일이 커지기만 했으면 앞부분은 그대로다. 끝부분만 다시 읽는다
  const grown = hit && st.size > hit.size && hit.size >= HEAD_BYTES;
  const info = grown ? { ...hit.info } : { first: '', last: '', title: '', cwd: '', birth: st.birthtimeMs || st.mtimeMs, hasMessages: false, customTitle: '' };
  try {
    const recs = grown ? [] : headRecords(file, st.size);
    if (st.size > HEAD_BYTES) recs.push(...tailRecords(file, st.size, HEAD_BYTES));
    let firstTs = null;
    for (const r of recs) {
      if (r.type === 'user' || r.type === 'assistant') info.hasMessages = true;
      if (!info.cwd && r.cwd) info.cwd = r.cwd;
      if (!firstTs && r.timestamp) firstTs = Date.parse(r.timestamp);
      if (r.type === 'custom-title' && r.customTitle) info.customTitle = r.customTitle;
      if (r.type === 'last-prompt' && typeof r.lastPrompt === 'string') {
        const p = cleanPrompt(r.lastPrompt);
        if (p.text) info.last = clip(p.text, 60);
      }
      if (!info.first && r.type === 'user' && !r.isMeta && !r.isSidechain) {
        const p = cleanPrompt(userText(r.message && r.message.content));
        if (p.text) info.first = clip(p.text, 60);
      }
    }
    if (firstTs && !grown) info.birth = firstTs;
    info.title = info.customTitle ? clip(info.customTitle, 60) : (info.last || info.first);
  } catch { /* 읽는 도중 지워진 파일 */ }
  infoCache.set(file, { size: st.size, mtime: st.mtimeMs, info });
  return info;
}

// 세션 폴더의 서브에이전트 기록 파일들. 워크플로가 띄운 에이전트는 subagents/workflows/<실행 ID>/agent-*.jsonl 에 있다
function subagentFiles(floorDir, sessionId) {
  const out = [];
  const dir = path.join(floorDir, sessionId, 'subagents');
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.jsonl') && NAME_RE.test(f)) out.push({ name: f, file: path.join(dir, f), wf: null });
    }
  } catch { /* 하위 폴더 없음 */ }
  try {
    for (const wf of fs.readdirSync(path.join(dir, 'workflows'))) {
      if (!NAME_RE.test(wf)) continue;
      try {
        for (const f of fs.readdirSync(path.join(dir, 'workflows', wf))) {
          if (f.startsWith('agent-') && f.endsWith('.jsonl') && NAME_RE.test(f)) out.push({ name: f, file: path.join(dir, 'workflows', wf, f), wf });
        }
      } catch { /* 폴더가 아님 */ }
    }
  } catch { /* 워크플로 없음 */ }
  return out;
}

// 세션의 서브에이전트 기록 가운데 가장 최근에 바뀐 시각. 서브에이전트만 일하는 동안에도 불이 켜져 있게 한다.
function newestSubagentWrite(floorDir, sessionId, oldFormat) {
  let newest = 0;
  for (const s of subagentFiles(floorDir, sessionId)) {
    try { newest = Math.max(newest, fs.statSync(s.file).mtimeMs); } catch { /* 지워짐 */ }
  }
  return Math.max(newest, oldFormat.get(sessionId) || 0);
}

// 디렉터리 이름(-Users-me-work-app)에서 경로를 대충 복원한다. 실제 cwd가 기록에 있으면 그걸 쓴다.
function guessCwd(dirName) { return dirName.replace(/-/g, '/'); }

function listFloors(root) {
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && NAME_RE.test(d.name)); }
  catch { return []; }
  const now = Date.now();
  const floors = [];
  const seen = new Set();
  for (const d of dirs) {
    const dir = path.join(root, d.name);
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
      seen.add(file);
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
  // 이번 훑기에서 안 보인 세션 파일은 캐시에서 뺀다 (지워진 파일이 쌓이지 않게)
  for (const k of infoCache.keys()) if (!seen.has(k)) infoCache.delete(k);
  floors.sort((a, b) => a.firstSeen - b.firstSeen || a.id.localeCompare(b.id));
  floors.forEach((f, i) => { f.floor = i + 1; });
  return floors;
}

// ---------------------------------------------------------------- 서브에이전트 기록 찾기

const sideHeadCache = new Map();

function subagentHead(file, st) {
  const hit = sideHeadCache.get(file);
  // 기록은 뒤에만 덧붙으므로 파일이 줄지 않았다면 머리말은 그대로다
  if (hit && st.size >= hit.size) return hit.head;
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
  if (head.prompt) {
    sideHeadCache.set(file, { size: st.size, head });
    if (sideHeadCache.size > CACHE_MAX) sideHeadCache.clear();
  }
  return head;
}

function readMeta(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// 예전 형식 파일이 어느 세션 것인지. 파일의 세션 번호는 바뀌지 않으므로 한 번 알면 다시 확인하지 않는다.
const legacySessionOf = new Map();

function findSubagents(floorDir, sessionId) {
  const subs = [];
  for (const s of subagentFiles(floorDir, sessionId)) subs.push({ key: s.name.slice(0, -6), file: s.file, wf: s.wf });
  // 예전 버전: 프로젝트 폴더에 agent-*.jsonl 로 섞여 있다
  try {
    for (const f of fs.readdirSync(floorDir)) {
      if (!f.startsWith('agent-') || !f.endsWith('.jsonl') || !NAME_RE.test(f)) continue;
      const file = path.join(floorDir, f);
      const known = legacySessionOf.get(file);
      if (known && known !== sessionId) continue;
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      const sid = subagentHead(file, st).sessionId;
      if (sid) {
        if (legacySessionOf.size > CACHE_MAX) legacySessionOf.clear();
        legacySessionOf.set(file, sid);
      }
      if (sid === sessionId) subs.push({ key: f.slice(0, -6), file, wf: null, legacy: true });
    }
  } catch { /* 무시 */ }
  return subs;
}

// 서브에이전트 하나의 표시 정보. 메타 파일은 이 항목을 보낼 때만 읽는다 (예전 형식은 메타를 보지 않는다)
function subEntry(sub, st) {
  const head = subagentHead(sub.file, st);
  const meta = sub.legacy ? null : readMeta(sub.file.replace(/\.jsonl$/, '.meta.json'));
  const desc = meta && meta.description;
  const e = { prompt: head.prompt, agentId: head.agentId, agentType: (meta && (meta.agentType || meta.subagent_type)) || '', mtime: st.mtimeMs,
    desc: typeof desc === 'string' ? clip(desc, 40) : '', toolUseId: (meta && typeof meta.toolUseId === 'string' && meta.toolUseId) || undefined };
  if (sub.wf) e.wf = sub.wf;
  return e;
}

// ---------------------------------------------------------------- 증분 읽기

// offset부터 새로 추가된 완성된 줄만 읽는다. 아주 긴 한 줄(이미지 등)은 건너뛴다.
function readNew(file, offset, initialTail) {
  const st = fs.statSync(file);
  let start = offset;
  let reset = false;
  let pre = null;  // 첫 줄을 찾으려고 읽은 구간. 같은 바이트를 두 번 읽지 않으려고 남겨 둔다
  if (start == null) {
    start = initialTail == null ? 0 : Math.max(0, st.size - initialTail);
    if (start > 0) {
      const at = start;
      const buf = readRange(file, at, Math.min(st.size, at + MAX_CHUNK));
      pre = { at, buf };
      const nl = buf.indexOf(0x0a);
      start = nl >= 0 ? start + nl + 1 : st.size;
    }
  } else if (start > st.size) { start = 0; reset = true; }
  const end = Math.min(st.size, start + MAX_CHUNK);
  // more: MAX_CHUNK에서 끊어 읽어 뒤에 더 읽을 줄이 남았다. 마지막 줄이 아직 덜 쓰였을 뿐이면 false다
  const more = end < st.size;
  if (end <= start) return { offset: start, records: [], reset, more: false, size: st.size, mtime: st.mtimeMs };
  let buf;
  if (pre) {
    // 앞부분은 이미 읽은 것을 쓰고, 모자란 뒤쪽만 더 읽는다
    const have = pre.buf.subarray(start - pre.at);
    const preEnd = pre.at + pre.buf.length;
    buf = end <= preEnd ? have.subarray(0, end - start) : Buffer.concat([have, readRange(file, preEnd, end)]);
  } else buf = readRange(file, start, end);
  const nl = buf.lastIndexOf(0x0a);
  if (nl < 0) {
    // 줄 하나가 MAX_CHUNK보다 크면 그 줄은 버리고 다음 줄부터 읽는다
    const skip = buf.length === MAX_CHUNK ? end : start;
    return { offset: skip, records: [], reset, more, size: st.size, mtime: st.mtimeMs };
  }
  return { offset: start + nl + 1, records: parseLines(buf.subarray(0, nl)), reset, more, size: st.size, mtime: st.mtimeMs };
}

function sessionDelta(root, floorId, sessionId, cursor) {
  const floorDir = path.join(root, floorId);
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
    // 파일 하나를 못 읽어도(권한, 도중에 지워짐 등) 세션 전체가 멈추지 않게 그 파일만 건너뛴다
    try {
      const st = fs.statSync(sub.file);
      if (!st.isFile()) continue;
      lastWrite = Math.max(lastWrite, st.mtimeMs);
      let off = prevSubs[sub.key];
      const known = typeof off === 'number';
      // 클라이언트가 이미 끝까지 읽은 파일은 머리말·메타·읽기 없이 위치만 넘긴다
      if (known && off === st.size) { nextSubs[sub.key] = off; continue; }
      // 클라이언트가 처음 보는 서브에이전트는 표시 정보를 함께 보낸다
      if (!known) subsMeta[sub.key] = subEntry(sub, st);
      let tail = null;
      if (!known) {
        if (initial) {
          // 처음 열 때: 끝난 지 오래된 서브에이전트는 건너뛰고, 최근 것만 끝부분을 읽는다.
          // 긴 명령을 기다리는 동안에는 기록이 멈추므로 넉넉하게 30분까지 본다.
          if (now - st.mtimeMs > SUB_RECENT_MS) off = st.size; else { off = null; tail = SUB_INITIAL_TAIL; }
        } else off = 0; // 새로 생긴 서브에이전트
      }
      const r = readNew(sub.file, off, tail);
      nextSubs[sub.key] = r.offset;
      if (known && r.records.length) subsMeta[sub.key] = subEntry(sub, st);
      for (const rec of r.records) events.push(...compact(rec, 'sub:' + sub.key));
    } catch {
      // 이 서브에이전트만 건너뛰되, 읽던 위치는 지켜 다음에 처음부터 다시 읽지 않게 한다
      if (typeof prevSubs[sub.key] === 'number') nextSubs[sub.key] = prevSubs[sub.key];
    }
  }
  events.sort((a, b) => (a.t || 0) - (b.t || 0));
  // 모델·컨텍스트 정보는 가장 최근 것 하나만 있으면 된다
  const lastUsage = events.map(e => e.k).lastIndexOf('usage');
  const sent = events.filter((e, i) => e.k !== 'usage' || i === lastUsage);
  return {
    events: sent,
    initial,
    reset: main.reset,
    cursor: { m: main.offset, s: nextSubs },
    subs: subsMeta,
    session: { id: sessionId, mtime: lastWrite, active: now - lastWrite < ACTIVE_MS, more: main.more },
  };
}

module.exports = { validName, listFloors, sessionDelta, sessionInfo, readNew, MAX_CHUNK };

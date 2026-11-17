#!/usr/bin/env node
// 클로드봇 마을 — Claude Code 세션 기록(jsonl)을 따라 읽어 블록 마을로 보여주는 로컬 서버.
// 외부 패키지 없음. 훅/설정을 건드리지 않고 ~/.claude/projects 아래 파일을 읽기만 한다.
// 이 파일은 실행 옵션과 HTTP만 맡는다. 기록을 읽는 일은 lib/sessions.js, 기록을 이벤트로 바꾸는 일은 lib/events.js에 있다.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { validName, listFloors, sessionDelta } = require('./lib/sessions');

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || process.env.PORT || 4848);
const HOST = args.host || '127.0.0.1';
// Host 헤더에서는 IPv6 주소가 [::1] 처럼 대괄호로 싸여 온다
const HOST_HEADER = HOST.includes(':') && !HOST.startsWith('[') ? `[${HOST}]` : HOST;
const ANY_HOST = ['0.0.0.0', '::', '[::]'].includes(HOST);   // 모든 주소로 열었다
const PUBLIC_DIR = path.join(__dirname, 'public');

let ROOT = args.dir || process.env.CLAUDE_PROJECTS_DIR ||
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
if (args.demo) ROOT = require('./demo').start();

const BODY_MAX = 1024 * 1024;          // POST 본문 한도
const FLOORS_TTL = 1500;               // 탭들이 층 목록을 이 시간 동안 함께 쓴다

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

let floorsCache = { at: 0, floors: null };

// GET(쿼리)과 POST(본문)가 같이 쓰는 세션 응답
function answerSession(res, floor, session, cursor) {
  if (!validName(floor) || !validName(session)) return sendJson(res, 400, { error: 'bad name' });
  if (!fs.existsSync(path.join(ROOT, floor, session + '.jsonl'))) return sendJson(res, 404, { error: 'no session' });
  return sendJson(res, 200, sessionDelta(ROOT, floor, session, cursor));
}

// 요청 본문을 JSON으로 읽어 넘긴다. 1 MiB를 넘으면 413, JSON이 아니면 400, 처리 중 오류는 500
function readJsonBody(req, res, handle) {
  const chunks = [];
  let size = 0;
  let done = false;
  req.on('error', () => { done = true; });
  req.on('data', c => {
    if (done) return;
    size += c.length;
    if (size <= BODY_MAX) { chunks.push(c); return; }
    done = true;
    res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
    res.end('{"error":"too large"}');
  });
  req.on('end', () => {
    if (done) return;
    done = true;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendJson(res, 400, { error: 'bad json' }); }
    try { handle(body); } catch (e) {
      if (!res.headersSent) sendJson(res, 500, { error: String(e && e.message || e) });
    }
  });
}

const server = http.createServer((req, res) => {
  // 다른 사이트가 이 서버를 읽어 가지 못하도록 Host 헤더를 확인한다 (DNS 리바인딩 방지).
  // localhost 같은 이름은 이 PC 안에서 온 연결에만 허용한다. 다른 기기는 Host를 마음대로 적을 수 있으므로
  // --host에 준 주소로 들어온 경우만 받는다 (0.0.0.0 같은 '모든 주소'로 열었으면 다른 기기는 받지 않는다)
  const rawHost = req.headers.host || '';
  const host = rawHost.startsWith('[') ? rawHost.slice(0, rawHost.indexOf(']') + 1) : rawHost.split(':')[0];
  const remote = req.socket.remoteAddress || '';
  const fromThisPc = remote === '::1' || remote.startsWith('127.') || remote.startsWith('::ffff:127.');
  const allowed = fromThisPc ? ['localhost', '127.0.0.1', '[::1]', HOST_HEADER].includes(host) : (!ANY_HOST && host === HOST_HEADER);
  if (!allowed) { res.writeHead(403); return res.end(); }
  try {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return sendJson(res, 400, { error: 'bad url' }); }
    if (url.pathname === '/api/floors') {
      // 탭마다 따로 훑지 않도록 목록을 잠깐 함께 쓴다
      const t = Date.now();
      if (!floorsCache.floors || t - floorsCache.at >= FLOORS_TTL) floorsCache = { at: t, floors: listFloors(ROOT) };
      return sendJson(res, 200, { root: ROOT, user: userName(), demo: !!args.demo, now: Date.now(), floors: floorsCache.floors });
    }
    if (url.pathname === '/api/session' && req.method === 'POST') {
      // 커서를 주소에 실으면 서브에이전트가 많을 때 431이 나므로 본문으로 받는다
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return sendJson(res, 415, { error: 'json only' });
      return readJsonBody(req, res, b => {
        const o = b && typeof b === 'object' ? b : {};
        return answerSession(res, typeof o.floor === 'string' ? o.floor : '', typeof o.session === 'string' ? o.session : '', o.c || null);
      });
    }
    if (url.pathname === '/api/session') {
      const floor = url.searchParams.get('floor') || '';
      const session = url.searchParams.get('session') || '';
      let cursor = null;
      const c = url.searchParams.get('c');
      if (c) { try { cursor = JSON.parse(c); } catch { return sendJson(res, 400, { error: 'bad cursor' }); } }
      return answerSession(res, floor, session, cursor);
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

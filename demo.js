// 데모 모드: 임시 폴더에 가짜 Claude Code 세션 기록을 계속 써 넣는다.
// `node server.js --demo` 로 실행하면 Claude Code 없이도 마을이 움직이는 걸 볼 수 있다.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let toolSeq = 0;
const toolId = () => 'toolu_demo' + (++toolSeq).toString().padStart(4, '0');

class Writer {
  constructor(file, base) { this.file = file; this.base = base; this.parent = null; }
  write(rec) {
    const full = { parentUuid: this.parent, uuid: uuid(), timestamp: new Date().toISOString(), ...this.base, ...rec };
    this.parent = full.uuid;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(full) + '\n');
  }
  prompt(text) { this.write({ type: 'user', message: { role: 'user', content: text } }); }
  command(name) { this.write({ type: 'user', message: { role: 'user', content: `<command-name>${name}</command-name>\n<command-message>${name.slice(1)}</command-message>` } }); }
  think(text) { this.write({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: text, signature: 'demo' }] } }); }
  text(text, stop = 'end_turn') { this.write({ type: 'assistant', message: { role: 'assistant', stop_reason: stop, content: [{ type: 'text', text }] } }); }
  tool(name, input) {
    const id = toolId();
    this.write({ type: 'assistant', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
    return id;
  }
  result(id, content, isError = false, extra = {}) {
    this.write({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] }, ...extra });
  }
  async run(name, input, content, ms = 1500, isError = false) {
    const id = this.tool(name, input);
    await sleep(ms);
    this.result(id, content, isError);
  }
}

function projectDir(root, cwd) { return path.join(root, cwd.replace(/[^A-Za-z0-9]/g, '-')); }

// 오래된 층: 불 꺼진 지 오래된 프로젝트들
function seedOldFloors(root) {
  const old = [
    ['/Users/demo/work/ai-playground', '프롬프트 실험 정리해줘', 40],
    ['/Users/demo/work/2d_boxing', '타격 판정 버그 좀 봐줘', 20],
  ];
  for (const [cwd, prompt, daysAgo] of old) {
    const dir = projectDir(root, cwd);
    const sid = uuid();
    const file = path.join(dir, sid + '.jsonl');
    const w = new Writer(file, { sessionId: sid, cwd, isSidechain: false, type: 'user', version: 'demo' });
    w.prompt(prompt);
    w.text('완료했습니다.');
    const t = (Date.now() - daysAgo * 86400e3) / 1000;
    fs.utimesSync(file, t, t);
  }
}

async function subagent(dir, sessionId, cwd, key, prompt, steps) {
  const file = path.join(dir, sessionId, 'subagents', key + '.jsonl');
  const agentId = key.replace('agent-', '');
  const w = new Writer(file, { sessionId, cwd, isSidechain: true, agentId, version: 'demo' });
  w.prompt(prompt);
  for (const s of steps) {
    if (s.think) { w.think(s.think); await sleep(s.ms || 1200); continue; }
    await w.run(s.tool, s.input, s.out || 'ok', s.ms || 1600, !!s.err);
  }
  w.text(steps.report || '조사 끝났습니다.');
  return agentId;
}

async function mainScenario(root) {
  const cwd = '/Users/demo/work/cozy-town';
  const dir = projectDir(root, cwd);
  for (;;) {
    const sid = uuid();
    const w = new Writer(path.join(dir, sid + '.jsonl'), { sessionId: sid, cwd, isSidechain: false, version: 'demo' });
    w.command('/clear');
    await sleep(800);
    w.prompt('로그인하면 가끔 튕기는 버그 고쳐줘. 테스트도 돌려보고.');
    await sleep(1200);
    w.think('로그인 흐름부터 확인해야겠다. 토큰 갱신 쪽이 수상하다.');
    await sleep(2200);
    await w.run('Grep', { pattern: 'refreshToken', path: 'src' }, 'src/auth/session.ts\nsrc/api/client.ts', 1800);
    await w.run('Read', { file_path: '/Users/demo/work/cozy-town/src/auth/session.ts' }, '...', 2000);

    // 서브에이전트 두 명에게 나눠 맡긴다
    const exPrompt = '인증 관련 파일과 토큰 갱신 호출 위치를 전부 찾아서 정리해줘';
    const plPrompt = '토큰 갱신 경쟁 상태를 고칠 수정 계획을 세워줘';
    const exId = w.tool('Agent', { description: '인증 코드 조사', subagent_type: 'Explore', prompt: exPrompt });
    await sleep(600);
    const plId = w.tool('Agent', { description: '수정 계획 수립', subagent_type: 'Plan', prompt: plPrompt });
    await sleep(1500);
    const exDone = subagent(dir, sid, cwd, 'agent-ex' + toolSeq, exPrompt, Object.assign([
      { tool: 'Glob', input: { pattern: 'src/**/*auth*' }, ms: 1800 },
      { tool: 'Read', input: { file_path: 'src/api/client.ts' }, ms: 2200 },
      { think: '갱신 요청이 동시에 두 번 나갈 수 있다.' , ms: 1800 },
      { tool: 'Grep', input: { pattern: 'setInterval\\(refresh' }, ms: 2000 },
      { tool: 'Read', input: { file_path: 'src/auth/interceptor.ts' }, ms: 2000 },
    ], { report: '갱신 호출이 client.ts와 interceptor.ts 두 곳에서 동시에 나갑니다.' }));
    await sleep(1400);
    const plDone = subagent(dir, sid, cwd, 'agent-pl' + toolSeq, plPrompt, Object.assign([
      { tool: 'Read', input: { file_path: 'src/auth/session.ts' }, ms: 2400 },
      { think: '갱신을 단일 Promise로 묶으면 되겠다.', ms: 2000 },
      { tool: 'WebSearch', input: { query: 'single flight token refresh pattern' }, ms: 2600 },
      { tool: 'Read', input: { file_path: 'docs/auth.md' }, ms: 1800 },
    ], { report: '갱신을 single-flight 로 묶고 인터셉터는 그 Promise를 기다리게 하면 됩니다.' }));
    const exAgent = await exDone;
    await sleep(800);
    w.result(exId, '갱신 호출이 두 곳에서 동시에 나갑니다.', false, { toolUseResult: { agentId: exAgent, status: 'completed' } });
    const plAgent = await plDone;
    await sleep(800);
    w.result(plId, 'single-flight 로 묶는 계획', false, { toolUseResult: { agentId: plAgent, status: 'completed' } });
    await sleep(1500);

    await w.run('TodoWrite', { todos: [
      { content: '토큰 갱신 single-flight 적용', status: 'in_progress' },
      { content: '인터셉터 대기 처리', status: 'pending' },
      { content: '테스트 실행', status: 'pending' },
      { content: '커밋', status: 'pending' },
    ] }, 'ok', 2200);
    await w.run('Edit', { file_path: '/Users/demo/work/cozy-town/src/auth/session.ts' }, 'ok', 3000);
    await w.run('Edit', { file_path: '/Users/demo/work/cozy-town/src/auth/interceptor.ts' }, 'ok', 2600);
    await w.run('Bash', { command: 'npm test -- auth', description: '인증 테스트 실행' },
      'FAIL src/auth/session.test.ts\n  ✕ refresh twice (12 ms)\n  Expected 1 call, received 2', 4200, true);
    w.think('테스트가 실패했다. 인터셉터가 아직 예전 함수를 부른다.');
    await sleep(2600);
    await w.run('Read', { file_path: '/Users/demo/work/cozy-town/src/auth/interceptor.ts' }, '...', 1600);
    await w.run('Edit', { file_path: '/Users/demo/work/cozy-town/src/auth/interceptor.ts' }, 'ok', 2400);
    await w.run('Bash', { command: 'npm test -- auth', description: '인증 테스트 다시 실행' }, 'PASS 12 tests', 4200);
    await w.run('TodoWrite', { todos: [
      { content: '토큰 갱신 single-flight 적용', status: 'completed' },
      { content: '인터셉터 대기 처리', status: 'completed' },
      { content: '테스트 실행', status: 'completed' },
      { content: '커밋', status: 'in_progress' },
    ] }, 'ok', 1600);
    await w.run('Bash', { command: 'git commit -am "fix: 토큰 갱신을 한 번만 하도록"', description: '변경 사항 커밋' }, '[main 3f2a1c9] fix', 2600);
    await w.run('AskUserQuestion', { questions: [{ question: '원격 브랜치에 바로 푸시할까요?' }] }, '네', 4000);
    await w.run('Bash', { command: 'git push', description: '푸시' }, 'ok', 2200);
    w.text('로그인 튕김은 토큰 갱신이 동시에 두 번 나가서 생긴 문제였습니다. 한 번만 나가도록 고치고 테스트 12개 통과, 푸시까지 했습니다.');
    await sleep(14000);
  }
}

async function sideScenario(root) {
  const cwd = '/Users/demo/work/mcp-hub';
  const dir = projectDir(root, cwd);
  const sid = uuid();
  const w = new Writer(path.join(dir, sid + '.jsonl'), { sessionId: sid, cwd, isSidechain: false, version: 'demo' });
  w.prompt('MCP 서버 목록 API 문서 업데이트해줘');
  for (;;) {
    await w.run('WebFetch', { url: 'https://modelcontextprotocol.io/docs' }, '...', 3500);
    await w.run('Read', { file_path: 'docs/servers.md' }, '...', 3000);
    await w.run('Write', { file_path: 'docs/servers.md' }, 'ok', 4000);
    await w.run('Bash', { command: 'npm run lint:docs' }, 'ok', 3500);
    w.text('문서 갱신했습니다.', 'end_turn');
    await sleep(20000);
    w.prompt('예제 코드도 추가해줘');
  }
}

function start() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-village-demo-'));
  seedOldFloors(root);
  mainScenario(root).catch(e => console.error('demo:', e));
  setTimeout(() => sideScenario(root).catch(e => console.error('demo:', e)), 300);
  return root;
}

module.exports = { start };

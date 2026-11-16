// 세션 기록 파일 읽기 (lib/sessions.js). 임시 폴더에 기록을 만들어 가며 확인한다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validName, listFloors, sessionDelta } = require('../lib/sessions');

const SID = '11111111-2222-3333-4444-555555555555';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-test-'));
  const floor = '-Users-me-app';
  const dir = path.join(root, floor);
  fs.mkdirSync(dir, { recursive: true });
  const main = path.join(dir, SID + '.jsonl');
  const line = o => JSON.stringify({ timestamp: new Date().toISOString(), sessionId: SID, cwd: '/Users/me/app', ...o }) + '\n';
  const prompt = text => line({ type: 'user', message: { content: text } });
  const tool = (id, name) => line({ type: 'assistant', message: { id: 'msg_' + id, content: [{ type: 'tool_use', id, name, input: {} }] } });
  fs.writeFileSync(main, prompt('첫 요청'));
  return { root, floor, dir, main, line, prompt, tool, sub: (...p) => path.join(dir, SID, 'subagents', ...p) };
}
const kinds = d => d.events.map(e => e.k);

test('validName: 상위 폴더를 가리키는 이름은 거절', () => {
  assert.ok(validName('-Users-me-app')); assert.ok(validName(SID));
  for (const bad of ['..', '.', 'a/b', '', 'a b']) assert.equal(validName(bad), false, bad);
});

test('listFloors: 층과 세션, 제목은 붙인 이름 → 최근 요청 → 첫 요청', () => {
  const f = fixture();
  let [floor] = listFloors(f.root);
  assert.deepEqual({ id: floor.id, name: floor.name, cwd: floor.cwd, floor: floor.floor, n: floor.sessionCount }, { id: f.floor, name: 'app', cwd: '/Users/me/app', floor: 1, n: 1 });
  assert.equal(floor.sessions[0].title, '첫 요청');
  fs.appendFileSync(f.main, f.line({ type: 'last-prompt', lastPrompt: '최근 요청' }));
  assert.equal(listFloors(f.root)[0].sessions[0].title, '최근 요청');
  fs.appendFileSync(f.main, f.line({ type: 'custom-title', customTitle: '붙인 이름' }));
  assert.equal(listFloors(f.root)[0].sessions[0].title, '붙인 이름');
  // 메시지가 없는 파일과 이름이 이상한 폴더는 목록에 없다
  fs.writeFileSync(path.join(f.dir, 'empty-session.jsonl'), f.line({ type: 'mode' }));
  fs.mkdirSync(path.join(f.root, 'bad name'));
  assert.equal(listFloors(f.root).length, 1);
  assert.equal(listFloors(f.root)[0].sessionCount, 1);
});

test('sessionDelta: 읽은 곳부터 이어 읽고, 덜 쓰인 줄은 기다린다', () => {
  const f = fixture();
  const first = sessionDelta(f.root, f.floor, SID, null);
  assert.equal(first.initial, true); assert.deepEqual(kinds(first), ['prompt']);
  const idle = sessionDelta(f.root, f.floor, SID, first.cursor);
  assert.deepEqual(idle.events, []); assert.equal(idle.session.more, false); assert.deepEqual(idle.cursor, first.cursor);
  const full = f.tool('t1', 'Read');
  fs.appendFileSync(f.main, full.slice(0, 40));               // 줄이 아직 덜 쓰였다
  const partial = sessionDelta(f.root, f.floor, SID, first.cursor);
  assert.deepEqual(partial.events, []); assert.equal(partial.session.more, false); assert.equal(partial.cursor.m, first.cursor.m);
  fs.appendFileSync(f.main, full.slice(40));
  const done = sessionDelta(f.root, f.floor, SID, partial.cursor);
  assert.deepEqual(kinds(done), ['tool']); assert.equal(done.events[0].mid, 'msg_t1');
  // 파일이 줄어들면(다시 쓰임) 처음부터 다시 읽으라고 알린다
  fs.writeFileSync(f.main, f.prompt('새로'));
  assert.equal(sessionDelta(f.root, f.floor, SID, done.cursor).reset, true);
});

test('서브에이전트: 처음에는 모두 알리고, 그 뒤로는 바뀐 파일만', () => {
  const f = fixture();
  fs.mkdirSync(f.sub('workflows', 'wf_1'), { recursive: true });
  const a = f.sub('agent-aaa.jsonl'), w = f.sub('workflows', 'wf_1', 'agent-www.jsonl');
  const subLine = (id, o) => f.line({ isSidechain: true, agentId: id, ...o });
  fs.writeFileSync(a, subLine('aaa', { type: 'user', message: { content: '조사해줘' } }));
  fs.writeFileSync(a.replace('.jsonl', '.meta.json'), JSON.stringify({ agentType: 'Explore', description: '코드 조사', toolUseId: 'toolu_A' }));
  fs.writeFileSync(w, subLine('www', { type: 'user', message: { content: '[Workflow] 검토' } }));
  fs.writeFileSync(w.replace('.jsonl', '.meta.json'), JSON.stringify({ agentType: 'workflow-subagent', description: 'review:logic' }));
  fs.mkdirSync(f.sub('agent-dir.jsonl'));                      // 파일이 아닌 항목이 섞여도 멈추지 않는다

  const first = sessionDelta(f.root, f.floor, SID, null);
  assert.deepEqual(Object.keys(first.subs).sort(), ['agent-aaa', 'agent-www']);
  assert.deepEqual({ ...first.subs['agent-aaa'], mtime: 0 }, { prompt: '조사해줘', agentId: 'aaa', agentType: 'Explore', mtime: 0, desc: '코드 조사', toolUseId: 'toolu_A' });
  assert.equal(first.subs['agent-www'].wf, 'wf_1'); assert.equal(first.subs['agent-www'].desc, 'review:logic');
  assert.deepEqual(first.events.map(e => e.src).sort(), ['main', 'sub:agent-aaa', 'sub:agent-www']);

  const idle = sessionDelta(f.root, f.floor, SID, first.cursor);
  assert.deepEqual(idle.subs, {}); assert.deepEqual(idle.events, []);

  fs.appendFileSync(a, subLine('aaa', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 's1', name: 'Grep', input: { pattern: 'x' } }] } }));
  const changed = sessionDelta(f.root, f.floor, SID, idle.cursor);
  assert.deepEqual(Object.keys(changed.subs), ['agent-aaa']);
  assert.deepEqual(changed.events.map(e => [e.src, e.k, e.name]), [['sub:agent-aaa', 'tool', 'Grep']]);
});

test('usage 이벤트는 응답마다 가장 최근 것 하나만 보낸다', () => {
  const f = fixture();
  const asst = ctx => f.line({ type: 'assistant', message: { id: 'm' + ctx, model: 'claude-x', usage: { input_tokens: ctx }, content: [{ type: 'text', text: '답' }] } });
  fs.appendFileSync(f.main, asst(100) + asst(200) + asst(300));
  const d = sessionDelta(f.root, f.floor, SID, null);
  assert.deepEqual(d.events.filter(e => e.k === 'usage').map(e => e.ctx), [300]);
  assert.equal(d.events.filter(e => e.k === 'text').length, 3);
});

// 이벤트 → 캐릭터 상태 (public/town.js). 브라우저 없이 Town만 불러서 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from '../public/world.js';
import { Town } from '../public/town.js';

const ev = (k, o = {}) => ({ src: 'main', t: Date.now(), k, ...o });
const tool = (id, name, input = {}, mid = 'm1') => ev('tool', { id, name, input, mid });
// 빈 마을. past에 지난 기록을 주면 처음 열 때처럼 재생한 뒤의 상태가 된다
function town(past = []) {
  const notes = [];
  const t = new Town(buildWorld(0), { userName: 'me', onNotify: (kind, text) => notes.push([kind, text]) });
  t.replay(past, true);
  return { t, notes, c: t.claude, logs: () => t.logs.map(l => l.text) };
}

test('도구를 쓰면 일하는 중이 되고, 결과가 오면 끝난다', () => {
  const { t, c } = town();
  t.handle(ev('prompt', { text: '고쳐줘' }));
  t.handle(tool('a', 'Read', { file_path: '/x/a.md' }));
  assert.equal(c.state, 'working'); assert.equal(c.activity, '📖 a.md 읽는 중'); assert.equal(c.room, 'library'); assert.equal(t.pending.size, 1);
  t.handle(ev('result', { id: 'a' }));
  assert.equal(t.pending.size, 0); assert.equal(c.alert, null);
});

test('도구가 실패하면 오류 상태가 되고 로그에 남는다', () => {
  const { t, c } = town();
  t.handle(tool('b', 'Bash', { command: 'npm test' }));
  t.handle(ev('result', { id: 'b', err: true, text: 'FAIL' }));
  assert.equal(c.alert, 'error'); assert.equal(c.bubble.type, 'err'); assert.equal(t.logs[0].err, true);
});

test('질문은 확인 필요 상태다. 진땀 중이어도 확인 필요가 먼저이고, 답하면 풀린다', () => {
  const { t, c, notes } = town();
  t.handle(tool('b', 'Bash'));
  t.handle(ev('result', { id: 'b', err: true }));
  t.handle(tool('q', 'AskUserQuestion', { question: '푸시할까요?' }, 'm2'));
  assert.equal(c.sweat, true); assert.equal(c.alert, 'attention'); assert.equal(c.bubble.type, 'ask');
  assert.deepEqual(notes, [['ask', '푸시할까요?']]);
  t.handle(ev('result', { id: 'q', text: '네' }));
  assert.notEqual(c.alert, 'attention'); assert.equal(c.bubble, null);
});

test('최종 API 오류는 답변을 끝내고, 사용량 한도는 Claude가 다시 응답할 때까지 남는다', () => {
  const { t, c, notes } = town();
  t.handle(ev('prompt', { text: '해줘' }));
  t.handle(ev('apierr', { text: '재시도 중' }));
  assert.equal(c.state, 'working'); assert.equal(t.limit, null);
  const until = Date.now() + 3600e3;
  t.handle(ev('apierr', { final: true, until, text: '한도' }));
  assert.equal(c.state, 'idle'); assert.equal(t.turnActive, false); assert.equal(t.limit.until, until);
  assert.deepEqual(notes.at(-1), ['limit', '한도']);
  t.handle(ev('prompt', { text: '다시' }));
  assert.equal(t.limit.until, until);
  t.handle(ev('think', { text: '음', mid: 'm9' }));
  assert.equal(t.limit, null);
});

test('결과 줄이 빠진 도구는 Claude가 다음 응답을 시작하면 끝난 것으로 본다', () => {
  const { t } = town();
  t.handle(tool('a', 'Read', {}, 'm1'));
  t.handle(ev('think', { text: '다음', mid: 'm2' }));
  assert.equal(t.pending.size, 0);
  // 같은 응답 안에서는 결과가 먼저 기록돼도 실행 중인 도구를 지우지 않는다
  t.handle(tool('x', 'Edit', {}, 'm3')); t.handle(tool('y', 'Read', {}, 'm3'));
  t.handle(ev('result', { id: 'y' })); t.handle(tool('z', 'Grep', {}, 'm3'));
  assert.deepEqual([...t.pending.keys()], ['x', 'z']);
  // 서브에이전트 호출과 응답 ID가 없는 기록은 이렇게 정리하지 않는다
  t.handle(tool('ag', 'Agent', { subagent_type: 'Explore', description: '조사' }, 'm3'));
  t.handle(ev('tool', { id: 'n', name: 'Read', input: {} }));
  t.handle(ev('think', { text: '다음', mid: 'm4' }));
  assert.deepEqual([...t.pending.keys()], ['ag', 'n']);
});

test('일하는 도중 보낸 메시지가 일반 기록으로 또 와도 한 번만 보인다', () => {
  const { t, logs } = town();
  t.handle(ev('prompt', { text: '이것도', queued: true }));
  t.handle(ev('prompt', { text: '이것도' }));
  assert.equal(logs().filter(l => l === '💬 이것도').length, 1);
});

test('모델·컨텍스트 정보', () => {
  const { t } = town();
  t.handle(ev('usage', { ctx: 545000, model: 'claude-x', br: 'main' }));
  t.handle(ev('usage', { ctx: 16000, model: 'claude-x' }));
  assert.deepEqual(t.stats, { model: 'claude-x', ctx: 16000, branch: 'main' });
});

// 백그라운드 서브에이전트가 일하는 중인 세션을 연 상태
function withBackgroundSub() {
  const x = town([ev('prompt', { text: '조사해줘' }),
    tool('tA', 'Agent', { subagent_type: 'general-purpose', description: '조사', prompt: 'p' }),
    ev('result', { id: 'tA', async: true, agent: 'bg1' })]);
  x.t.subsMeta['agent-bg1'] = { agentId: 'bg1', toolUseId: 'tA', prompt: 'p' };
  x.sub = x.t.subs.get('tA');
  return x;
}

test('백그라운드 서브에이전트는 완료 알림이 와야 보고하러 간다', () => {
  const { t, sub, logs } = withBackgroundSub();
  assert.deepEqual([sub.state, sub.resumed, sub.agentId, sub.type], ['working', true, 'bg1', 'general-purpose']);
  const note = ev('tasknote', { id: 'tA', status: 'completed', text: 'Agent "조사" finished', tools: 3, ms: 61000, tok: 1500 });
  t.handle(note);
  assert.equal(sub.state, 'reporting'); assert.equal(sub.resumed, false);
  assert.ok(logs().includes('📊 작업 통계 · 도구 3회 · 1분 1초 · 2k 토큰'));
  const n = t.logs.length;
  t.handle(note);                                   // 같은 알림이 또 기록돼도 한 번만 처리한다
  assert.equal(t.logs.length, n);
});

test('서브에이전트 기록은 호출 ID로 이어지고, 넘긴 보고 내용을 기억한다', () => {
  const { t, sub } = withBackgroundSub();
  t.handle({ src: 'sub:agent-bg1', t: Date.now(), k: 'tool', id: 's1', name: 'SubagentHandback', input: { message: '원인을 찾았어요' } });
  assert.equal(t.subByFile.get('agent-bg1'), sub); assert.equal(t.subs.size, 1);
  assert.equal(sub.reportText, '원인을 찾았어요');
  t.handle({ src: 'sub:agent-bg1', t: Date.now(), k: 'result', id: 's1' });
  assert.equal(sub.state, 'reporting');
});

test('실패한 백그라운드 작업 알림은 오류로 남는다', () => {
  const { t } = town();
  t.handle(ev('tasknote', { id: 'bash1', status: 'failed', text: 'Background command "빌드" failed' }));
  assert.deepEqual([t.logs[0].text, t.logs[0].err], ['💦 Background command "빌드" failed', true]);
});

test('처음 열 때: 지난 실패의 표시는 남기지 않고, 답을 기다리는 질문은 다시 띄운다', () => {
  const failed = town([ev('prompt', { text: '해줘' }), tool('b', 'Bash'), ev('result', { id: 'b', err: true })]);
  assert.equal(failed.c.sweat, false); assert.equal(failed.c.alert, null);
  assert.ok(failed.t.logs.some(l => l.err));
  const asking = town([ev('prompt', { text: '해줘' }), tool('q', 'AskUserQuestion', { question: '할까요?' })]);
  assert.equal(asking.c.alert, 'attention'); assert.equal(asking.c.bubble.text, '할까요?');
  assert.deepEqual(asking.notes, []);               // 지난 기록을 재생하는 동안에는 알리지 않는다
});

test('답변 완료 알림은 내 요청에 30초 넘게 걸린 답변에만 보낸다', () => {
  const quick = town();
  quick.t.handle(ev('prompt', { text: '짧게' }));
  quick.t.handle(ev('text', { text: '끝', stop: 'end_turn', mid: 'm1' }));
  assert.deepEqual(quick.notes, []);
  const slow = town();
  slow.t.handle(ev('prompt', { text: '길게', t: Date.now() - 45000 }));
  slow.t.handle(ev('text', { text: '다 했습니다', stop: 'end_turn', mid: 'm1' }));
  assert.deepEqual(slow.notes, [['done', '다 했습니다']]);
});

test('승인 대기 추정: 금방 끝나야 할 도구가 7초 넘게 안 끝나면 확인 필요, 오래 걸리는 도구는 아니다', () => {
  const stuck = (name) => {
    const x = town();
    x.t.handle(ev('prompt', { text: '해줘' }));
    x.t.handle(tool('e', name));
    x.t.pending.get('e').at -= 8000;                // 8초 전에 시작한 것으로
    x.c.path = [];                                  // 방에 도착해 서 있다
    x.t.update(0, true);
    return x;
  };
  const edit = stuck('Edit');
  assert.equal(edit.c.bubble.type, 'wait'); assert.equal(edit.c.alert, 'attention'); assert.equal(edit.notes[0][0], 'wait');
  edit.t.handle(ev('result', { id: 'e' }));
  assert.equal(edit.c.alert, null);
  const bash = stuck('Bash');
  assert.notEqual(bash.c.bubble && bash.c.bubble.type, 'wait'); assert.deepEqual(bash.notes, []);
});

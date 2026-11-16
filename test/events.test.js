// 기록 한 줄 → 이벤트 (lib/events.js). 기록 모양은 Claude Code 2.1.3xx에서 확인한 것이다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compact, cleanPrompt } = require('../lib/events');

const T = '2026-10-20T08:00:00.000Z';
const kinds = evs => evs.map(e => e.k);

test('cleanPrompt: 진짜 요청만 남긴다', () => {
  assert.deepEqual(cleanPrompt('버그 고쳐줘'), { text: '버그 고쳐줘' });
  assert.deepEqual(cleanPrompt('<command-name>/clear</command-name>'), { cmd: '/clear' });
  assert.deepEqual(cleanPrompt('[Request interrupted by user]'), { interrupt: true });
  assert.deepEqual(cleanPrompt('<task-notification>…</task-notification>'), {});
  assert.deepEqual(cleanPrompt('질문 <system-reminder>숨김</system-reminder>'), { text: '질문' });
});

test('내 메시지와 도구 결과', () => {
  assert.deepEqual(compact({ type: 'user', timestamp: T, message: { content: '안녕' } }, 'main'),
    [{ src: 'main', t: Date.parse(T), k: 'prompt', text: '안녕' }]);
  assert.deepEqual(compact({ type: 'user', isMeta: true, message: { content: '숨김' } }, 'main'), []);
  const [r] = compact({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: true }] },
    toolUseResult: { status: 'async_launched', agentId: 'a1' } }, 'main');
  assert.equal(r.k, 'result'); assert.equal(r.id, 't1'); assert.equal(r.err, true); assert.equal(r.async, true); assert.equal(r.agent, 'a1');
});

test('Claude의 응답: 생각·답변·도구에 응답 ID(mid)가 붙고, 메인 세션만 usage를 낸다', () => {
  const rec = { type: 'assistant', timestamp: T, gitBranch: 'main', message: { id: 'msg_1', model: 'claude-x', stop_reason: 'tool_use',
    usage: { input_tokens: 2, cache_read_input_tokens: 500, cache_creation_input_tokens: 98 },
    content: [{ type: 'thinking', thinking: '음' }, { type: 'text', text: '볼게요' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a/b.md' } }] } };
  const evs = compact(rec, 'main');
  assert.deepEqual(kinds(evs), ['usage', 'think', 'text', 'tool']);
  assert.deepEqual({ ctx: evs[0].ctx, model: evs[0].model, br: evs[0].br }, { ctx: 600, model: 'claude-x', br: 'main' });
  assert.ok(evs.slice(1).every(e => e.mid === 'msg_1'));
  assert.deepEqual(evs[3].input, { file_path: '/a/b.md' });
  assert.deepEqual(kinds(compact(rec, 'sub:agent-1')), ['think', 'text', 'tool']);
  assert.equal(compact({ ...rec, gitBranch: 'HEAD' }, 'main')[0].br, undefined);
});

test('최종 API 오류에는 한도가 풀리는 시각이 붙는다', () => {
  const [e] = compact({ type: 'assistant', isApiErrorMessage: true, quotaLimits: { resetsAt: 1792499400 },
    message: { content: [{ type: 'text', text: 'limit' }] } }, 'main');
  assert.deepEqual({ k: e.k, final: e.final, until: e.until, text: e.text }, { k: 'apierr', final: true, until: 1792499400000, text: 'limit' });
  const [retry] = compact({ type: 'system', subtype: 'api_error', content: '재시도' }, 'main');
  assert.equal(retry.k, 'apierr'); assert.equal(retry.final, undefined);
});

test('백그라운드 작업 완료 알림', () => {
  const content = '<task-notification>\n<task-id>x</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>completed</status>\n' +
    '<summary>Agent "조사" finished</summary>\n<usage><subagent_tokens>202727</subagent_tokens><tool_uses>49</tool_uses><duration_ms>726759</duration_ms></usage>\n</task-notification>';
  const [e] = compact({ type: 'queue-operation', operation: 'enqueue', content }, 'main');
  assert.deepEqual({ k: e.k, id: e.id, status: e.status, text: e.text, tok: e.tok, tools: e.tools, ms: e.ms },
    { k: 'tasknote', id: 'toolu_1', status: 'completed', text: 'Agent "조사" finished', tok: 202727, tools: 49, ms: 726759 });
  assert.deepEqual(compact({ type: 'queue-operation', operation: 'enqueue', content: '그냥 글' }, 'main'), []);
  assert.deepEqual(compact({ type: 'queue-operation', operation: 'dequeue', content }, 'main'), []);
});

test('일하는 도중 보낸 메시지는 첨부로만 남는다', () => {
  const att = (o) => ({ type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt', prompt: '이것도', origin: { kind: 'human' }, ...o } });
  assert.deepEqual(compact(att({}), 'main').map(e => [e.k, e.text, e.queued]), [['prompt', '이것도', true]]);
  assert.deepEqual(compact(att({ origin: { kind: 'task-notification' } }), 'main'), []);
  assert.deepEqual(compact(att({ prompt: '<task-notification>…' }), 'main'), []);
});

test('압축·턴 종료·세션 이름', () => {
  assert.deepEqual(compact({ type: 'system', subtype: 'compact_boundary', compactMetadata: { preTokens: 787271, postTokens: 16199 } }, 'main')
    .map(e => [e.k, e.pre, e.post]), [['compact', 787271, 16199]]);
  assert.deepEqual(kinds(compact({ type: 'system', subtype: 'stop_hook_summary' }, 'main')), ['stop']);
  assert.deepEqual(compact({ type: 'custom-title', customTitle: '내 세션' }, 'main').map(e => [e.k, e.text]), [['title', '내 세션']]);
  assert.deepEqual(compact(null, 'main'), []);
  assert.deepEqual(compact({ type: 'mode' }, 'main'), []);
});

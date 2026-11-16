// 기록 한 줄(jsonl) → 화면에 보낼 작은 이벤트.
// 서버와 화면 사이의 약속(이벤트 종류와 필드)은 이 파일의 compact()가 정하고, 화면에서는 public/town.js의 Town.handle()이 받는다.
//
// 모든 이벤트의 공통 필드: src('main' 또는 'sub:<서브에이전트 파일 키>'), t(기록 시각 ms, 없으면 null),
//                        side(메인 파일에 섞인 서브에이전트 기록이면 true), agentId
//   prompt    내 메시지              text, queued(Claude가 일하는 도중 보낸 메시지면 true)
//   command   /clear 같은 명령       text
//   interrupt 내가 중단함
//   think     생각                   text, mid
//   text      답변                   text, stop(stop_reason), mid
//   tool      도구 호출              id, name, input(줄인 입력), mid
//   result    도구 결과              id, err, text, agent(서브에이전트 ID), async(백그라운드로 시작만 했으면 true)
//   stop      답변 한 번이 끝남
//   apierr    API 오류               text, final(재시도까지 실패), until(사용량 한도가 풀리는 시각 ms)
//   tasknote  백그라운드 작업 완료   id(호출 ID), status, text, tok·tools·ms(통계)
//   usage     모델과 컨텍스트 크기   ctx, model, br(브랜치)  — 메인 세션만
//   compact   대화 압축              pre, post(전후 토큰 수)
//   title     세션에 붙인 이름       text
// mid는 한 번의 API 응답에서 나온 기록끼리 같은 값이다.
'use strict';

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
    case 'queue-operation': {
      // 백그라운드 작업(서브에이전트·워크플로·명령)이 끝났다는 알림. 호출 결과는 시작할 때 이미 왔으므로 진짜 끝은 이것으로 안다
      const c = rec.operation === 'enqueue' && typeof rec.content === 'string' ? rec.content.trim() : '';
      if (!c.startsWith('<task-notification')) break;
      const tag = name => { const m = c.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? m[1].trim() : ''; };
      const id = tag('tool-use-id');
      if (!id) break;
      const ev = { ...base, k: 'tasknote', id, status: tag('status'), text: clip(tag('summary'), 160) };
      // 서브에이전트·워크플로 알림에는 쓴 토큰, 도구 횟수, 걸린 시간이 붙어 온다
      const num = name => { const n = Number(tag(name)); return Number.isFinite(n) && n > 0 ? n : undefined; };
      if (c.includes('<usage>')) { ev.tok = num('subagent_tokens'); ev.tools = num('tool_uses'); ev.ms = num('duration_ms'); }
      out.push(ev);
      break;
    }
    case 'attachment': {
      // Claude가 일하는 도중 내가 보낸 메시지는 사용자 기록이 아니라 이 첨부로만 남는다
      const a = rec.attachment;
      if (!a || a.type !== 'queued_command' || a.commandMode !== 'prompt' || rec.isMeta) break;
      if (!(a.origin ? a.origin.kind === 'human' : a.humanTurn)) break;
      const p = cleanPrompt(typeof a.prompt === 'string' ? a.prompt : '');
      if (p.text) out.push({ ...base, k: 'prompt', text: clip(p.text, 300), queued: true });
      break;
    }
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
      // 재시도까지 실패해 답변 대신 남은 오류(사용량 한도 등). 이걸로 그 답변은 끝난다
      if (rec.isApiErrorMessage) {
        const ev = { ...base, k: 'apierr', final: true, text: clip(resultText(m.content), 160) };
        // 사용량 한도면 한도가 풀리는 시각(초 단위)이 함께 남는다
        const reset = Number(rec.quotaLimits && rec.quotaLimits.resetsAt);
        if (Number.isFinite(reset) && reset > 0) ev.until = reset * 1000;
        out.push(ev);
        break;
      }
      if (!Array.isArray(m.content)) break;
      // mid: 한 번의 API 응답에서 나온 기록끼리 같은 값. 화면에서 Claude의 단계 경계를 가르는 데 쓴다
      const ab = m.id ? { ...base, mid: m.id } : base;
      // 메인 세션의 모델과 지금 컨텍스트 크기(이 응답에 들어간 입력 토큰). 브랜치는 이름을 모를 때 HEAD로 남는다
      const u = m.usage;
      if (src === 'main' && !rec.isSidechain && u && typeof u.input_tokens === 'number') {
        const ctx = u.input_tokens + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        const br = typeof rec.gitBranch === 'string' && rec.gitBranch !== 'HEAD' ? clip(rec.gitBranch, 40) : undefined;
        if (ctx > 0) out.push({ ...base, k: 'usage', ctx, model: typeof m.model === 'string' ? clip(m.model, 40) : '', br });
      }
      for (const b of m.content) {
        if (!b) continue;
        if (b.type === 'thinking') out.push({ ...ab, k: 'think', text: clip(b.thinking || '', 280) });
        else if (b.type === 'redacted_thinking') out.push({ ...ab, k: 'think', text: '' });
        else if (b.type === 'text' && b.text && b.text.trim()) out.push({ ...ab, k: 'text', text: clip(b.text, 400), stop: m.stop_reason || null });
        else if (b.type === 'tool_use') out.push({ ...ab, k: 'tool', id: b.id, name: b.name, input: compactInput(b.name, b.input) });
      }
      break;
    }
    case 'system':
      if (rec.subtype === 'stop_hook_summary' || rec.subtype === 'turn_duration') out.push({ ...base, k: 'stop' });
      else if (rec.subtype === 'api_error') out.push({ ...base, k: 'apierr', text: clip(rec.content || 'API 오류', 160) });
      else if (rec.subtype === 'compact_boundary') {
        const cm = rec.compactMetadata || {};
        out.push({ ...base, k: 'compact', pre: Number(cm.preTokens) || undefined, post: Number(cm.postTokens) || undefined });
      }
      break;
  }
  return out;
}

module.exports = { clip, cleanPrompt, userText, compact };

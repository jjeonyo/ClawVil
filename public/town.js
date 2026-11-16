// 마을 한 곳(세션 하나)의 상태: 서버가 보낸 이벤트를 캐릭터의 행동으로 바꾼다.
// 이벤트의 종류와 필드는 lib/events.js 머리말에 적혀 있다. 이 파일은 화면(DOM)을 건드리지 않는다. 그리기는 world.js, 패널은 app.js가 한다.
import { findPath, GW, GH } from './world.js';
import { SPECIES, speciesForAgent } from './critters.js';
import { short, dur, tokens } from './util.js';
import { roomForTool, describeTool, FINAL_TOOLS, LONG_TOOLS } from './tools.js';

const CLAUDE_COLOR = '#d97757';
const NOTIFY_TURN_MS = 30000;   // 이보다 오래 걸린 답변이 끝나면 알림을 보낸다 (금방 끝난 답변은 알리지 않는다)
// 끝을 알리는 호출 결과가 없는 서브에이전트(백그라운드·워크플로·다시 일하러 간)가 이만큼 조용하면 끝난 것으로 본다.
// 서브에이전트는 도구 없이 1~2분씩 생각하기도 하니 넉넉히 잡는다. 보통은 완료 알림이나 마지막 보고로 먼저 끝난다
const RESUMED_QUIET_MS = 5 * 60e3;
// Claude Code는 명령이 도는 동안 기록을 쓰지 않는다. 끝나지 않은 도구가 있으면 이 시간까지는 일하는 중으로 본다.
const WAIT_MS = 30 * 60e3;

const CLAUDE_PROPS = { library: 'glasses', dev: 'hardhat', server: 'headset', info: 'antenna', meeting: 'beret' };

const ALERT_BUBBLES = new Set(['err', 'ask', 'wait']);
const ERR_HOLD_MS = 2500;   // 오류 말풍선이 다른 말풍선에 가리지 않고 버티는 최소 시간

// 완료 알림에 붙어 온 통계: " · 도구 49회 · 12분 6초 · 203k 토큰"
function usageText(ev) {
  return (ev.tools ? ` · 도구 ${ev.tools}회` : '') + (ev.ms ? ` · ${dur(ev.ms)}` : '') + (ev.tok ? ` · ${tokens(ev.tok)} 토큰` : '');
}

// ---------------------------------------------------------------- 캐릭터

export class Agent {
  constructor(o) {
    Object.assign(this, {
      x: 0, y: 0, path: [], speed: 3.4, facing: 1, bubble: null, queued: null, emote: null, sweatUntil: 0,
      state: 'idle', activity: '대기 중', tools: 0, since: Date.now(), lastAt: Date.now(),
      seed: Math.random() * 10, alpha: 1, hidden: false, token: 0, spot: null, mouth: null,
    }, o);
  }
  get moving() { return this.path.length > 0; }
  get sweat() { return Date.now() < this.sweatUntil; }
  // 눈에 띄게 표시할 상태: 'attention'(질문·승인 대기) · 'error'(실패·오류) · null
  // 진땀이 남아 있어도 질문·승인 대기 말풍선이 떠 있으면 내가 할 일이 있으니 확인 필요로 본다
  get alert() {
    const t = this.bubble && this.bubble.type;
    if (t === 'ask' || t === 'wait') return 'attention';
    return this.sweat || t === 'err' ? 'error' : null;
  }
  // tool: 이 말풍선을 띄운 도구 호출 ID. 그 도구가 끝날 때 지운다
  say(type, text, ms = 3500, tool = null) {
    const now = Date.now();
    const b = { type, text, tool, born: now, until: ms ? now + ms : Infinity };
    // 막 뜬 오류 말풍선은 평범한 말풍선에 바로 가리지 않는다. 그 말풍선은 update()에서 뒤이어 띄운다
    const cur = this.bubble;
    if (cur && cur.type === 'err' && !ALERT_BUBBLES.has(type) && now - cur.born < ERR_HOLD_MS) { this.queued = b; return; }
    this.queued = null;
    this.bubble = b;
  }
  // 조건에 맞는 말풍선을 지운다 (뒤이어 띄우려고 미뤄 둔 것도)
  unsay(test = () => true) {
    if (this.bubble && test(this.bubble)) this.bubble = null;
    if (this.queued && test(this.queued)) this.queued = null;
  }
}

// ---------------------------------------------------------------- 마을(한 세션)

export class Town {
  constructor(world, opts) {
    this.world = world;
    this.opts = opts;
    this.chars = [];
    this.subs = new Map();        // Task tool_use id → Agent
    this.subByFile = new Map();   // 서브에이전트 기록 파일 → Agent
    this.subsMeta = {};
    this.taskNotes = new Set();   // 이미 처리한 완료 알림 (같은 알림이 여러 번 기록된다)
    this.stats = {};              // 메인 세션의 모델, 컨텍스트 토큰, 브랜치
    this.limit = null;            // 사용량 한도에 걸려 있으면 { until, text }
    this.turnStartedAt = 0;       // 내가 보낸 요청으로 시작한 답변의 시작 시각 (알림용)
    this.pending = new Map();     // tool_use id → { agent, ev, at }
    this.reserved = new Map();    // spot → Agent
    this.timers = [];
    this.logs = [];
    this.replaying = false;
    this.turnActive = false;
    this.lastEventAt = 0;
    this.elevatorUntil = 0;
    this.phoneUntil = 0;
    this.userTypingUntil = 0;
    this.dirty = true;

    this.user = this.add(new Agent({ id: 'user', kind: 'user', species: 'human', label: opts.userName + ' (나)', color: SPECIES.human.color, speed: 2.5 }));
    this.place(this.user, world.userSeat);
    this.claude = this.add(new Agent({ id: 'claude', kind: 'claude', species: 'clawd', label: 'Claude', color: CLAUDE_COLOR }));
    this.place(this.claude, world.claudeSeat);

    // 마을 주민: 쉼터에서 자는 양, 연못가를 뛰어다니는 개구리, 헤엄치는 오리
    const sheep = this.add(new Agent({ id: 'sheep', kind: 'npc', species: 'sheep', label: '' }));
    this.place(sheep, world.napSpot);
    sheep.emote = 'sleep';
    if (world.frogSpots.length) {
      this.frog = this.add(new Agent({ id: 'frog', kind: 'npc', species: 'frog', label: '', speed: 1.6 }));
      this.place(this.frog, world.frogSpots[0]);
      this.frog.nextHop = performance.now() + 4000;
    }
    this.duck = this.add(new Agent({ id: 'duck', kind: 'npc', species: 'duck', label: '', speed: 0.45 }));
    this.duck.loopIndex = 0;
    this.place(this.duck, world.duckLoop[0]);
  }

  add(a) { this.chars.push(a); return a; }

  // -------- 위치

  place(a, spot) { a.x = spot.x; a.y = spot.y; a.path = []; a.facing = spot.face || a.facing; a.arrived = true; }

  release(a) { if (a.spot && this.reserved.get(a.spot) === a) this.reserved.delete(a.spot); a.spot = null; }

  reserve(a, list) {
    if (a.spot && list.includes(a.spot)) return a.spot;
    const free = list.filter(s => !this.reserved.has(s));
    const pick = free.length ? free[Math.floor(Math.random() * free.length)] : list[Math.floor(Math.random() * list.length)];
    this.release(a);
    a.spot = pick;
    if (!this.reserved.has(pick)) this.reserved.set(pick, a);
    return pick;
  }

  walk(a, spot, onArrive) {
    a.token++;
    const token = a.token;
    a.arrived = false;
    a.onArrive = () => { if (a.token === token) { a.arrived = true; a.facing = spot.face || a.facing; onArrive && onArrive(); } };
    if (this.replaying) { this.place(a, spot); a.onArrive(); return; }
    a.path = findPath(this.world, a, spot);
    a.target = spot;
  }

  // 화면을 그리지 않는 동안에는 걷는 모습을 건너뛰고 바로 도착시킨다
  settle() {
    for (const a of [...this.chars]) {
      if (!a.path.length) continue;
      const end = a.path[a.path.length - 1];
      a.x = end.x; a.y = end.y; a.path = [];
      if (a.onArrive) a.onArrive();
    }
  }

  goRoom(a, room, onArrive) {
    let spot;
    if (room === 'desk') { this.release(a); spot = a === this.claude ? this.world.claudeSeat : this.reserve(a, this.world.spots.report); }
    else if (room === 'ask') spot = this.reserve(a, this.world.spots.ask);
    else spot = this.reserve(a, this.world.spots[room] || this.world.spots.dev);
    a.room = room;
    if (a.target === spot && (a.moving || a.arrived)) { if (a.arrived && onArrive) onArrive(); return; }
    this.walk(a, spot, onArrive);
  }

  // Claude가 지금 있는(또는 가고 있는) 자리 바로 옆 빈칸
  spotNearClaude(a) {
    const c = this.claude;
    const base = c.target && !c.arrived ? c.target : c;
    const cx = Math.floor(base.x), cy = Math.floor(base.y);
    const taken = [...this.reserved.entries()].filter(([, who]) => who !== a).map(([s]) => Math.floor(s.x) + ',' + Math.floor(s.y));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [0, -1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [2, 1]]) {
      const x = cx + dx, y = cy + dy;
      if (x < 1 || y < 1 || x >= GW - 1 || y >= GH - 1) continue;
      if (this.world.blocked.has(this.world.key(x, y)) || taken.includes(x + ',' + y)) continue;
      return { x: x + 0.5, y: y + 0.5, face: dx > 0 ? -1 : 1, room: c.room };
    }
    return this.world.spots.report[0];
  }

  later(ms, a, fn) {
    if (this.replaying) { fn(); return; }
    const token = a ? a.token : null;
    this.timers.push({ at: performance.now() + ms, fn, a, token });
  }

  // -------- 로그

  log(who, text, opts = {}) {
    this.logs.unshift({ t: opts.t || Date.now(), who: who.label || who, color: who.color || '#888', text, err: !!opts.err, warn: !!opts.warn });
    if (this.logs.length > 120) this.logs.length = 120;
    this.dirty = true;
  }

  // -------- 이벤트 처리

  actorFor(ev) {
    if (ev.src === 'main') {
      if (ev.side) {
        // 예전 버전: 서브에이전트 기록이 메인 파일에 섞여 있다
        const busy = [...this.subs.values()].filter(s => !s.gone);
        return busy[busy.length - 1] || this.claude;
      }
      return this.claude;
    }
    const key = ev.src.slice(4);
    return this.subByFile.get(key) || this.linkSub(key, ev);
  }

  linkSub(key, ev) {
    const meta = this.subsMeta[key] || {};
    if (meta.wf) {
      // 워크플로가 띄운 에이전트: 따로 부른 호출이 없으니 기록만 보고 데려온다. 끝은 마지막 보고(FINAL_TOOLS)나
      // 마지막 답변, 또는 한동안 조용한 것으로 판단한다 (updateSubs)
      const w = this.spawnSub({ id: 'file:' + key, t: ev && ev.t, input: { subagent_type: '워크플로', description: meta.desc || short(meta.prompt, 20), prompt: meta.prompt } }, this.replaying);
      w.resumed = true;
      if (meta.agentId) w.agentId = meta.agentId;
      w.fileKey = key;
      this.subByFile.set(key, w);
      return w;
    }
    const norm = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const cands = [...this.subs.values()].filter(s => !s.fileKey && !s.gone);
    // meta.json의 toolUseId는 이 서브에이전트를 부른 호출 ID다. 있으면 그것으로 정확히 잇는다
    const byCall = meta.toolUseId ? this.subs.get(meta.toolUseId) : null;
    let a = (byCall && !byCall.fileKey && !byCall.gone ? byCall : null)
      || cands.find(s => meta.agentId && s.agentId === meta.agentId)
      || cands.find(s => meta.prompt && norm(s.prompt) === norm(meta.prompt))
      || cands[0];
    if (!a) {
      // Task 호출이 읽은 범위 밖에 있었던 경우: 기록만 보고 데려온다. 호출 결과는 agentId로 찾아 잇고,
      // 그마저 없으면 다시 일하러 간 서브에이전트처럼 한동안 조용할 때 보고하러 간다 (updateSubs)
      a = this.spawnSub({ id: 'file:' + key, t: ev && ev.t, input: { subagent_type: meta.agentType || '', description: meta.desc || short(meta.prompt, 20), prompt: meta.prompt } }, true);
      a.resumed = true;
    }
    if (meta.agentId) a.agentId = meta.agentId;
    a.fileKey = key;
    this.subByFile.set(key, a);
    return a;
  }

  handle(ev) {
    const now = Date.now();
    if (ev.t) this.lastEventAt = Math.max(this.lastEventAt, ev.t);
    if (ev.k === 'title') { this.opts.onTitle && this.opts.onTitle(ev.text); return; }
    if (ev.k === 'usage') {
      this.stats = { model: ev.model || this.stats.model, ctx: ev.ctx, branch: ev.br || this.stats.branch };
      return;
    }
    const a = this.actorFor(ev);
    if (!a || a.gone) return;
    a.lastAt = now;
    // Claude가 다시 응답하기 시작했으면 사용량 한도는 풀린 것이다
    if (this.limit && a === this.claude && (ev.k === 'think' || ev.k === 'text' || ev.k === 'tool')) this.limit = null;
    if (a === this.claude && ev.mid && !ev.side && (ev.k === 'think' || ev.k === 'text' || ev.k === 'tool')) {
      // Claude는 도구 결과를 모두 받아야 다음 응답을 시작한다. 그런데도 남아 있는 이전 응답(다른 mid)의 도구는
      // 결과 줄이 빠진 것(4MB 넘는 줄 등)이니 끝난 것으로 정리한다. 서브에이전트 호출은 따로 끝을 판단한다.
      // 같은 응답 안에서는 도구 실행이 겹쳐 결과가 먼저 기록되기도 하므로 응답 ID가 있을 때만 정리한다
      for (const [id, p] of this.pending) {
        if (p.agent !== a || !p.ev.mid || p.ev.mid === ev.mid || p.ev.name === 'Task' || p.ev.name === 'Agent') continue;
        this.pending.delete(id);
        a.unsay(b => b.tool === id);
      }
    }
    if (a.kind === 'sub' && (a.state === 'reporting' || a.state === 'leaving') && (ev.k === 'tool' || ev.k === 'think')) {
      // 보고하러 가다가 일을 하나 더 받으면 다시 일하러 돌아간다. 이때는 끝났다는 신호(Task 결과)가 다시 오지 않으므로
      // 기록이 한동안 멈추면 알아서 다시 보고하러 간다 (updateSubs)
      a.state = 'working'; a.alpha = 1; a.emote = null; a.eyes = null; a.mouth = null; a.resumed = true;
      this.log(a, '↩️ 일이 더 생겨서 돌아가요', { t: ev.t });
    }

    switch (ev.k) {
      case 'prompt': {
        if (a.kind === 'sub') { a.activity = '맡은 일 확인 중'; break; }
        // 일하는 도중 보낸 메시지(queued)가 나중에 일반 기록으로 한 번 더 남는 경우를 걸러 낸다
        const lp = this.lastPrompt;
        if (lp && lp.text === ev.text && (lp.queued || ev.queued) && Math.abs((ev.t || now) - lp.t) < 120000) break;
        this.lastPrompt = { text: ev.text, t: ev.t || now, queued: !!ev.queued };
        if (!this.turnActive) this.turnStartedAt = ev.t || now;
        this.turnActive = true;
        this.user.say('say', ev.text, 5000);
        this.userTypingUntil = now + 2500;
        this.claude.state = 'working'; this.claude.activity = '요청 확인 중'; this.claude.emote = null; this.claude.mouth = null;
        this.log(this.user, '💬 ' + ev.text, { t: ev.t });
        break;
      }
      case 'command': {
        this.log(this.user, '⌨️ ' + ev.text, { t: ev.t });
        if (ev.text === '/clear' || ev.text === '/compact') this.claude.say('say', ev.text === '/clear' ? '새 세션 시작!' : '기억 정리 중…', 2500);
        break;
      }
      case 'interrupt': this.endTurn('⛔ 중단됨', ev.t); break;
      case 'think': {
        if (a.state !== 'arriving') a.state = 'working';
        a.thinkingSince = now; a.emote = null;
        a.say('think', ev.text || '생각 중…', 7000);
        if (ev.text) this.log(a, '💭 ' + ev.text, { t: ev.t });
        break;
      }
      case 'tool': this.onTool(a, ev); break;
      case 'result': this.onResult(ev); break;
      case 'text': {
        if (a.kind === 'sub') {
          a.say('say', ev.text, 3000);
          // 끝을 알리는 호출 결과가 없는 서브에이전트는 마지막 답변으로 끝난 것을 안다
          if (a.resumed && ev.stop === 'end_turn') { a.resumed = false; this.finishSub(a, { text: ev.text, err: false }); }
          break;
        }
        a.say('say', ev.text, 6000);
        this.log(a, '💬 ' + ev.text, { t: ev.t });
        this.lastAnswer = ev.text;
        if (ev.stop === 'end_turn') this.endTurn(null, ev.t);
        break;
      }
      case 'stop': if (a === this.claude && this.turnActive) this.endTurn(null, ev.t); break;
      case 'apierr': {
        a.say('err', 'API 오류: ' + (ev.text || ''), 4000); a.sweatUntil = now + 4000; this.log(a, '⚠️ ' + (ev.text || 'API 오류'), { t: ev.t, err: true });
        if (!ev.final) break;
        if (ev.until) this.limit = { until: ev.until, text: ev.text };
        // 재시도까지 실패한 오류(사용량 한도 등)는 그 답변을 끝낸다
        if (a === this.claude) {
          this.notify('limit', ev.text);
          if (this.turnActive || a.state !== 'idle') this.endTurn(null, ev.t, true);
        }
        else if (a.kind === 'sub') { a.resumed = false; this.finishSub(a, { text: ev.text, err: true }); }
        break;
      }
      case 'tasknote': this.onTaskNote(ev); break;
      case 'compact': this.log(a, '🧹 대화 압축' + (ev.pre && ev.post ? ` · ${tokens(ev.pre)} → ${tokens(ev.post)} 토큰` : ''), { t: ev.t }); break;
    }
  }

  onTool(a, ev) {
    const now = Date.now();
    const name = ev.name;
    const room = roomForTool(name);
    const what = describeTool(name, ev.input);
    const arriving = a.state === 'arriving';
    a.tools++; a.state = arriving ? 'arriving' : 'working'; a.activity = what; a.thinkingSince = null; a.emote = null; a.mouth = null;
    if (a === this.claude) this.turnActive = true;
    this.pending.set(ev.id, { agent: a, ev, at: now });
    this.log(a, what, { t: ev.t, warn: name === 'AskUserQuestion' });
    if (arriving) {
      // 아직 엘리베이터에서 내리기 전이면 내린 뒤 이 방으로 간다
      a.nextRoom = room;
      a.say('say', what, 0, ev.id);
      return;
    }
    if (a.kind === 'sub' && FINAL_TOOLS.has(name)) {
      // SubagentHandback에는 서브에이전트가 넘기는 보고 내용이 들어 있다. 보고 말풍선에 그대로 쓴다
      if (name === 'SubagentHandback' && ev.input.message) a.reportText = ev.input.message;
      a.say('say', what, 0, ev.id);
      return;
    }
    if (name === 'Workflow' && a === this.claude) {
      // 워크플로도 자리에서 전화를 건다. 일할 에이전트들은 각자 기록이 생기면 엘리베이터로 출근한다
      this.goRoom(a, 'desk', () => { a.emote = 'phone'; this.phoneUntil = Date.now() + 2600; });
      a.say('call', '📞 워크플로 팀, 부탁해요', 3200);
      return;
    }

    if ((name === 'Task' || name === 'Agent') && a === this.claude) {
      // 자기 자리에서 전화를 걸고, 새 에이전트가 엘리베이터로 출근한다
      this.goRoom(a, 'desk', () => { a.emote = 'phone'; this.phoneUntil = Date.now() + 2600; });
      a.say('call', `📞 ${ev.input.subagent_type || '도우미'}님, ${ev.input.description || '부탁해요'}`, 3200);
      this.spawnSub(ev, this.replaying);
      return;
    }
    if (room === 'ask') {
      this.goRoom(a, 'ask', () => { a.facing = -1; });
      a.say('ask', ev.input.question || '확인할 게 있어요', 0, ev.id);
      this.notify('ask', ev.input.question || '확인할 게 있어요');
      return;
    }
    if (todosOf(ev)) { this.world.todos = todosOf(ev); }
    a.say('say', what, 0, ev.id);
    this.goRoom(a, room, () => { if (room === 'library') a.emote = 'read'; });
  }

  onResult(ev) {
    const p = this.pending.get(ev.id);
    const sub = this.subs.get(ev.id)
      || (ev.agent ? [...this.subs.values()].find(s => s.agentId === ev.agent && !s.gone && s.state !== 'reporting' && s.state !== 'leaving') : null);
    if (sub && !sub.gone) {
      if (ev.async) {
        // 백그라운드 서브에이전트: 호출 결과는 시작할 때 바로 온다. 끝은 완료 알림(tasknote)이나 마지막 보고로 안다
        sub.resumed = true;
        if (ev.agent) sub.agentId = ev.agent;
        this.log(sub, '🌙 백그라운드에서 일하는 중');
      } else { sub.resumed = false; this.finishSub(sub, ev); }
    }
    if (!p) return;
    this.pending.delete(ev.id);
    const a = p.agent;
    a.unsay(b => b.until === Infinity && b.tool === ev.id);
    if (a.emote === 'read' || a.emote === 'phone') a.emote = null;
    if (ev.err) {
      a.sweatUntil = Date.now() + 4500;
      a.mouth = 'worried';
      a.say('err', '앗… ' + (ev.text || p.ev.name + ' 실패'), 4500);
      this.log(a, `💦 ${p.ev.name} 실패: ${ev.text || ''}`, { t: ev.t, err: true });
      this.later(4500, a, () => { a.mouth = null; });
    } else if (p.ev.name === 'AskUserQuestion') {
      this.user.say('say', ev.text || '응!', 3000);
      this.log(this.user, '🙋 ' + (ev.text || '답변'), { t: ev.t });
    } else if (a.kind === 'sub' && a.resumed && FINAL_TOOLS.has(p.ev.name)) {
      a.resumed = false;
      this.finishSub(a, { text: '', err: false });
    }
  }

  spawnSub(ev, instant) {
    const i = ev.input || {};
    const type = i.subagent_type || 'general-purpose';
    const species = speciesForAgent(type);
    const a = this.add(new Agent({
      id: ev.id, kind: 'sub', type, species, color: SPECIES[species].color,
      label: short(type, 16), desc: i.description || '', prompt: i.prompt || '',
      activity: '출근 중', state: 'arriving', speed: 3.2, since: ev.t || Date.now(),
    }));
    this.subs.set(ev.id, a);
    const room = /explore/i.test(type) ? 'library' : /plan/i.test(type) ? 'meeting' : 'dev';
    if (instant || this.replaying) {
      a.state = 'working'; a.activity = '일하는 중';
      this.place(a, this.reserve(a, this.world.spots[room]));
      a.room = room;
      return a;
    }
    a.hidden = true;
    this.later(1300, null, () => {
      this.elevatorUntil = Date.now() + 1800;
      this.place(a, this.world.elevatorDoor);
      a.hidden = false; a.alpha = 0;
      a.poofT = performance.now() / 1000; a.eyes = 'happy';
      a.say('say', '안녕하세요! 출근했어요', 2200);
      this.log(a, `🛗 출근 · ${a.desc}`);
      this.later(450, null, () => {
        a.alpha = 1;
        this.later(1400, null, () => { if (a.eyes === 'happy') a.eyes = null; });
        if (a.state === 'arriving' && a.pendingFinish) {
          const f = a.pendingFinish;
          a.pendingFinish = null; a.state = 'working';
          this.finishSub(a, f);
        } else if (a.state === 'arriving') {
          const to = a.nextRoom || room;
          a.state = 'working';
          if (!a.nextRoom) a.activity = '일하러 가는 중';
          this.goRoom(a, to, () => { if (to === 'library') a.emote = 'read'; });
        }
      });
    });
    return a;
  }

  // 백그라운드 작업이 끝났다는 알림. 서브에이전트면 보고하러 오고, 명령·워크플로면 로그만 남긴다
  onTaskNote(ev) {
    const key = ev.id + ':' + ev.status;
    if (this.taskNotes.has(key)) return;
    this.taskNotes.add(key);
    const failed = ev.status !== 'completed';
    const stats = usageText(ev);
    const sub = this.subs.get(ev.id);
    if (sub && !sub.gone) {
      // 마지막 보고(SubagentHandback)가 먼저 와서 이미 보고하러 간 뒤면 통계만 로그에 남긴다
      if (stats) this.log(sub, '📊 작업 통계' + stats, { t: ev.t });
      if (sub.state === 'reporting' || sub.state === 'leaving') return;
      sub.resumed = false;
      this.finishSub(sub, { text: failed ? ev.text : '', err: failed });
      return;
    }
    if (ev.text) this.log(this.claude, (failed ? '💦 ' : '✅ ') + ev.text + stats, { t: ev.t, err: failed });
  }

  finishSub(a, ev) {
    for (const [id, p] of this.pending) if (p.agent === a) this.pending.delete(id);
    if (this.replaying) { this.removeSub(a); return; }
    // 엘리베이터에서 내리기도 전에 끝났으면 내린 뒤에 보고하러 간다 (첫 기록부터 실패한 경우 등)
    if (a.state === 'arriving') { a.pendingFinish = ev; return; }
    a.state = 'reporting'; a.activity = '보고하러 가는 중'; a.emote = null;
    a.unsay(b => !(b.type === 'err' && Date.now() - b.born < ERR_HOLD_MS));   // 막 뜬 오류 말풍선은 남긴다
    const spot = this.spotNearClaude(a);
    this.release(a);
    a.spot = spot; this.reserved.set(spot, a); a.room = 'report';
    this.walk(a, spot, () => {
      if (a.state !== 'reporting') return;
      a.facing = a.x < this.claude.x ? 1 : -1;
      const said = ev.text || (ev.err ? '' : a.reportText) || '';
      a.say(ev.err ? 'err' : 'report', (ev.err ? '죄송해요… ' : '보고: ') + (said || '다 했어요!'), 3200);
      if (!ev.err) { a.eyes = 'happy'; this.cheer(); } else a.mouth = 'worried';
      this.log(a, (ev.err ? '😓 ' : '📋 ') + 'Claude에게 보고' + (said ? ': ' + short(said, 90) : ''), { err: ev.err });
      this.later(3200, a, () => {
        if (a.state !== 'reporting') return;
        a.say('say', '👋 퇴근합니다!', 2000); a.emote = 'wave';
        this.later(1600, a, () => {
          if (a.state !== 'reporting') return;
          a.state = 'leaving'; a.activity = '퇴근 중'; a.emote = null; a.eyes = null; a.mouth = null;
          this.release(a);
          this.walk(a, this.world.elevatorDoor, () => {
            if (a.state !== 'leaving') return;
            this.elevatorUntil = Date.now() + 1500;
            this.log(a, '🛗 퇴근');
            a.poofT = performance.now() / 1000;
            this.later(350, a, () => { a.alpha = 0.4; });
            this.later(700, a, () => this.removeSub(a));
          });
        });
      });
    });
  }

  removeSub(a) {
    a.gone = true;
    this.release(a);
    this.chars = this.chars.filter(c => c !== a);
    for (const [k, v] of this.subs) if (v === a) this.subs.delete(k);
    if (a.fileKey) this.subByFile.delete(a.fileKey);
    this.dirty = true;
  }

  // 화면 밖에서 알아야 할 일(질문, 승인 대기, 답변 완료, 사용량 한도). 지난 기록을 재생하는 동안에는 알리지 않는다
  notify(kind, text) {
    if (!this.replaying && this.opts.onNotify) this.opts.onNotify(kind, text);
  }

  endTurn(msg, t, quiet = false) {
    // 내가 보낸 요청에 NOTIFY_TURN_MS 넘게 걸린 답변이 끝나면 알린다
    if (!quiet && !msg && this.turnStartedAt && Date.now() - this.turnStartedAt >= NOTIFY_TURN_MS) this.notify('done', this.lastAnswer);
    this.turnStartedAt = 0;
    this.turnActive = false;
    for (const [id, p] of this.pending) if (p.agent === this.claude) this.pending.delete(id);
    const c = this.claude;
    c.state = 'idle'; c.activity = '대기 중'; c.emote = null; c.mouth = null; c.since = Date.now();
    if (msg) { c.say('say', msg, 2500); this.log(c, msg, { t }); }
    else if (!quiet) this.cheer();
    c.unsay(b => b.until === Infinity);
    this.goRoom(c, 'desk');
  }

  // Claude가 잠깐 > < 눈으로 웃는다 (서브에이전트 보고를 받을 때, 답변을 마칠 때)
  cheer(ms = 2600) {
    const c = this.claude;
    if (this.replaying) return;
    c.eyes = 'happy';
    this.later(ms, null, () => { if (c.eyes === 'happy') c.eyes = null; });
  }

  // 처음 열 때 지나간 기록을 순식간에 재생해 현재 상태를 맞춘다
  replay(events, sessionActive) {
    this.replaying = true;
    for (const ev of events) this.handle(ev);
    this.replaying = false;
    // 지난 실패의 진땀·오류 표시는 재생한 시각 기준이라 남기지 않는다
    for (const ch of this.chars) { ch.unsay(); ch.sweatUntil = 0; }
    const quietFor = Date.now() - (this.lastEventAt || 0);
    if (!((sessionActive && quietFor <= 10 * 60e3) || this.waiting())) {
      for (const a of [...this.subs.values()]) this.removeSub(a);
      this.pending.clear();
      if (this.turnActive || this.claude.state !== 'idle') this.endTurn(null, undefined, true);
      this.place(this.claude, this.world.claudeSeat);
    } else {
      // 진행 중인 도구가 있으면 그 말풍선을 다시 띄운다
      for (const [id, p] of this.pending) {
        if (p.ev.name === 'AskUserQuestion') p.agent.say('ask', p.ev.input.question || '확인할 게 있어요', 0, id);
        else if (!['Task', 'Agent'].includes(p.ev.name)) p.agent.say('say', describeTool(p.ev.name, p.ev.input), 0, id);
      }
    }
    this.claude.since = this.lastEventAt || Date.now();
    this.dirty = true;
  }

  // 기록은 멈췄지만 끝나지 않은 도구(긴 명령, 서브에이전트 호출 등)를 기다리는 중인가
  waiting() {
    return this.turnActive && this.pending.size > 0 && Date.now() - (this.lastEventAt || 0) < WAIT_MS;
  }

  // -------- 매 프레임

  update(dt, live) {
    const now = Date.now();
    const pnow = performance.now();
    if (this.timers.length) {
      const due = this.timers.filter(tm => tm.at <= pnow);
      this.timers = this.timers.filter(tm => tm.at > pnow);
      for (const tm of due) if (!tm.a || tm.a.token === tm.token || tm.token === null) tm.fn();
    }
    for (const a of this.chars) {
      if (a.path.length) {
        const p = a.path[0];
        const dx = p.x - a.x, dy = p.y - a.y;
        const dist = Math.hypot(dx, dy);
        const step = a.speed * dt;
        if (dx - dy !== 0) a.facing = dx - dy > 0 ? 1 : -1;
        if (dist <= step) { a.x = p.x; a.y = p.y; a.path.shift(); if (!a.path.length && a.onArrive) a.onArrive(); }
        else { a.x += dx / dist * step; a.y += dy / dist * step; }
      }
      if (a.queued && (!a.bubble || now - a.bubble.born >= ERR_HOLD_MS)) {
        const q = a.queued;
        a.queued = null;
        if (q.until !== Infinity) q.until += now - q.born;
        q.born = now;
        a.bubble = q;
      }
      if (a.bubble && now > a.bubble.until) a.bubble = null;
    }
    const c = this.claude;
    // 오래 조용하면 고민하거나 졸기
    if (c.state === 'working' && !c.moving) {
      const quiet = now - c.lastAt;
      const hasPending = [...this.pending.values()].some(p => p.agent === c);
      if (!hasPending && quiet > 20000 && live) {
        c.emote = 'ponder';
        if (!c.bubble) c.say('think', `고민 중… ${Math.round(quiet / 1000)}초째`, 1200);
      }
      // 승인을 기다리는 것으로 보이는 도구가 남아 있는 동안 ⏳ 말풍선을 띄운다 (로그는 도구마다 한 번)
      let waitFor = null;
      for (const [id, p] of this.pending) {
        if (p.agent !== c || LONG_TOOLS.has(p.ev.name) || /^mcp__/.test(p.ev.name) || !live || now - p.at <= 7000) continue;
        waitFor = id;
        if (!p.asked) {
          p.asked = true;
          this.log(c, `⏳ 승인 대기 중인 것 같아요: ${p.ev.name}`, { warn: true });
          this.notify('wait', describeTool(p.ev.name, p.ev.input));
        }
      }
      if (waitFor && !(c.bubble && ALERT_BUBBLES.has(c.bubble.type))) c.say('wait', '승인 기다리는 중일까요?', 0, waitFor);
    }
    // 답을 기다리는 질문이 있으면, 함께 호출한 도구의 말풍선에 덮였더라도 ? 말풍선을 다시 띄운다
    for (const [id, p] of this.pending) {
      const a = p.agent;
      if (p.ev.name === 'AskUserQuestion' && !(a.bubble && ALERT_BUBBLES.has(a.bubble.type))) a.say('ask', p.ev.input.question || '확인할 게 있어요', 0, id);
    }
    if (c.state === 'idle' && !c.moving) c.emote = now - c.since > 3 * 60e3 ? 'sleep' : (c.emote === 'sleep' ? null : c.emote);
    if (c.emote === 'phone' && now > this.phoneUntil) c.emote = null;
    // 방마다 쓰는 작업 소품
    c.prop = c.arrived && c.state === 'working' ? (CLAUDE_PROPS[c.room] || null) : null;
    this.updateNpcs(pnow);
    this.updateSubs(now, live);
    this.world.elevatorOpen += ((now < this.elevatorUntil ? 1 : 0) - this.world.elevatorOpen) * Math.min(1, dt * 6);
  }

  updateSubs(now, live) {
    for (const a of this.subs.values()) {
      if (!a.resumed || a.gone || a.state !== 'working' || a.moving) continue;
      const busy = [...this.pending.values()].some(p => p.agent === a);
      const quiet = now - a.lastAt;
      // 끝나지 않은 도구가 있어도 결과가 끝내 안 오면(4MB 넘는 줄, 도중에 끈 경우) WAIT_MS 뒤에는 끝난 것으로 본다
      if (busy ? quiet > WAIT_MS : (quiet > RESUMED_QUIET_MS || !live)) { a.resumed = false; this.finishSub(a, { text: '', err: false }); }
    }
  }

  updateNpcs(pnow) {
    const f = this.frog;
    if (f && !f.moving && pnow > f.nextHop) {
      const spots = this.world.frogSpots;
      const near = spots.filter(s => Math.hypot(s.x - f.x, s.y - f.y) < 3.5 && (s.x !== f.x || s.y !== f.y));
      const to = (near.length ? near : spots)[Math.floor(Math.random() * (near.length || spots.length))];
      f.path = [to];
      f.onArrive = () => { f.facing = Math.random() < 0.5 ? 1 : -1; };
      f.nextHop = pnow + 5000 + Math.random() * 7000;
    }
    const d = this.duck;
    if (d && !d.moving) {
      d.loopIndex = (d.loopIndex + 1) % this.world.duckLoop.length;
      d.path = [this.world.duckLoop[d.loopIndex]];
      d.onArrive = null;
    }
  }

  liveFlags(floorLabel, userName) {
    const desks = new Map();
    let serverBusy = false, infoBusy = false;
    for (const a of this.chars) {
      if (!a.arrived || a.state !== 'working' || a.moving) continue;
      if (a.room === 'dev' && a.spot && a.spot.desk) desks.set(a.spot.desk, true);
      if (a.room === 'server') serverBusy = true;
      if (a.room === 'info') infoBusy = true;
    }
    const c = this.claude;
    return {
      desks, serverBusy, infoBusy, floorLabel, userName,
      owners: {
        user: Date.now() < this.userTypingUntil,
        claude: c.arrived && c.room === 'desk' && c.state === 'working',
        phone: Date.now() < this.phoneUntil,
      },
    };
  }
}

function todosOf(ev) {
  if (ev.input && Array.isArray(ev.input.todos)) return ev.input.todos;
  return null;
}

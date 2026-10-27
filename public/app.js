// 세션 기록을 받아 캐릭터를 움직이고, 층 안내·사람 목록·활동 로그를 그린다.
import { buildWorld, findPath, render, iso, GW, GH, ROOMS, THEMES, themeForFloor } from './world.js';
import { SPECIES, speciesForAgent, portrait } from './critters.js';

const POLL_MS = 250;
const FLOORS_MS = 2000;
const OLD_FLOOR_MS = 3 * 86400e3;
const CLAUDE_COLOR = '#d97757';

const $ = sel => document.querySelector(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baseName = p => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() : '');
const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + '초 전';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}
function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? s + '초' : s < 3600 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : Math.floor(s / 3600) + '시간 ' + Math.floor(s / 60 % 60) + '분';
}
function clock(t) {
  const d = new Date(t || Date.now());
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---------------------------------------------------------------- 도구 → 방

function roomForTool(name) {
  if (/^mcp__/.test(name)) return 'info';
  switch (name) {
    case 'Read': case 'Grep': case 'Glob': case 'LS': case 'NotebookRead': return 'library';
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return 'dev';
    case 'Bash': case 'BashOutput': case 'KillShell': case 'KillBash': case 'Monitor': case 'PowerShell': return 'server';
    case 'WebSearch': case 'WebFetch': case 'ToolSearch': case 'ListMcpResourcesTool': case 'ReadMcpResourceTool': return 'info';
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList': case 'TaskGet': case 'TaskOutput':
    case 'EnterPlanMode': case 'ExitPlanMode': case 'Skill': return 'meeting';
    case 'AskUserQuestion': return 'ask';
    case 'Task': case 'Agent': case 'SendMessage': case 'Workflow': return 'desk';
    default: return 'dev';
  }
}

function hostOf(u) { try { return new URL(u).host; } catch { return u || ''; } }

function describeTool(name, i = {}) {
  switch (name) {
    case 'Read': return `📖 ${baseName(i.file_path) || '파일'} 읽는 중`;
    case 'NotebookRead': return `📖 ${baseName(i.notebook_path)} 읽는 중`;
    case 'Grep': return `🔎 "${short(i.pattern, 24)}" 찾는 중`;
    case 'Glob': return `🗂️ ${short(i.pattern, 24)} 훑는 중`;
    case 'LS': return `🗂️ ${baseName(i.path)} 살펴보는 중`;
    case 'Edit': case 'MultiEdit': return `✏️ ${baseName(i.file_path)} 고치는 중`;
    case 'Write': return `📝 ${baseName(i.file_path)} 쓰는 중`;
    case 'NotebookEdit': return `✏️ ${baseName(i.notebook_path)} 고치는 중`;
    case 'Bash': return `⚙️ ${short(i.description || i.command, 40)}`;
    case 'BashOutput': case 'Monitor': return '⚙️ 실행 결과 지켜보는 중';
    case 'WebSearch': return `🌐 "${short(i.query, 28)}" 검색`;
    case 'WebFetch': return `🌐 ${hostOf(i.url)} 읽는 중`;
    case 'ToolSearch': return '🧰 도구 찾는 중';
    case 'TodoWrite': return '📝 할 일 정리 중';
    case 'TaskCreate': case 'TaskUpdate': return `📝 ${short(i.subject || i.description || '할 일', 28)}`;
    case 'EnterPlanMode': case 'ExitPlanMode': return '🗺️ 계획 세우는 중';
    case 'Skill': return `📘 ${i.skill || '스킬'} 펼쳐 보는 중`;
    case 'AskUserQuestion': return `❓ ${short(i.question || '확인할 게 있어요', 60)}`;
    case 'Task': case 'Agent': return `📞 ${i.subagent_type || '도우미'} 호출 · ${short(i.description, 24)}`;
    case 'SendMessage': return `📞 ${i.to || '동료'}에게 연락`;
    case 'Workflow': return '📞 워크플로 팀 호출';
    case 'StructuredOutput': case 'SubagentHandback': return '📋 결과 정리 중';
    default:
      if (/^mcp__/.test(name)) return `🔌 ${name.split('__').slice(1).join(' · ')}`;
      return `🔧 ${name}`;
  }
}

// 서브에이전트가 결과를 넘기는 마지막 도구. 끝을 알리는 호출 결과가 따로 없는 서브에이전트(백그라운드·워크플로)는 이걸로 끝을 안다
const FINAL_TOOLS = new Set(['StructuredOutput', 'SubagentHandback']);
const RESUMED_QUIET_MS = 30000;   // 다시 일하러 간 서브에이전트가 이만큼 조용하면 끝난 것으로 본다
const WF_QUIET_MS = 5 * 60e3;     // 워크플로 에이전트는 이만큼 조용해야 끝난 것으로 본다
// Claude Code는 명령이 도는 동안 기록을 쓰지 않는다. 끝나지 않은 도구가 있으면 이 시간까지는 일하는 중으로 본다.
const WAIT_MS = 30 * 60e3;

const CLAUDE_PROPS = { library: 'glasses', dev: 'hardhat', server: 'headset', info: 'antenna', meeting: 'beret' };

const ALERT_BUBBLES = new Set(['err', 'ask', 'wait']);
const ERR_HOLD_MS = 2500;   // 오류 말풍선이 다른 말풍선에 가리지 않고 버티는 최소 시간
const LONG_TOOLS = new Set(['Bash', 'BashOutput', 'Monitor', 'PowerShell', 'TaskOutput', 'Task', 'Agent', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'SendMessage']);

// ---------------------------------------------------------------- 캐릭터

class Agent {
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

class Town {
  constructor(world, opts) {
    this.world = world;
    this.opts = opts;
    this.chars = [];
    this.subs = new Map();        // Task tool_use id → Agent
    this.subByFile = new Map();   // 서브에이전트 기록 파일 → Agent
    this.subsMeta = {};
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
      w.resumed = true; w.wf = true;
      if (meta.agentId) w.agentId = meta.agentId;
      w.fileKey = key;
      this.subByFile.set(key, w);
      return w;
    }
    const norm = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const cands = [...this.subs.values()].filter(s => !s.fileKey && !s.gone);
    let a = cands.find(s => meta.agentId && s.agentId === meta.agentId)
      || cands.find(s => meta.prompt && norm(s.prompt) === norm(meta.prompt))
      || cands[0];
    if (!a) {
      // Task 호출이 읽은 범위 밖에 있었던 경우: 기록만 보고 데려온다. 호출 결과는 agentId로 찾아 잇고,
      // 그마저 없으면 다시 일하러 간 서브에이전트처럼 한동안 조용할 때 보고하러 간다 (updateSubs)
      a = this.spawnSub({ id: 'file:' + key, t: ev && ev.t, input: { subagent_type: meta.agentType || '', description: short(meta.prompt, 20), prompt: meta.prompt } }, true);
      if (!meta.agentId) a.resumed = true;
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
    const a = this.actorFor(ev);
    if (!a || a.gone) return;
    a.lastAt = now;
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
        if (ev.stop === 'end_turn') this.endTurn(null, ev.t);
        break;
      }
      case 'stop': if (a === this.claude && this.turnActive) this.endTurn(null, ev.t); break;
      case 'apierr': a.say('err', 'API 오류: ' + (ev.text || ''), 4000); a.sweatUntil = now + 4000; this.log(a, '⚠️ ' + (ev.text || 'API 오류'), { t: ev.t, err: true }); break;
      case 'compact': this.log(a, '🧹 대화 압축', { t: ev.t }); break;
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
    if (a.kind === 'sub' && FINAL_TOOLS.has(name)) { a.say('say', what, 0, ev.id); return; }
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
        // 백그라운드 서브에이전트: 호출 결과는 시작할 때 바로 온다. 끝은 기록이 멈추는 것으로 판단한다.
        sub.resumed = true;
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
        if (a.state === 'arriving') {
          const to = a.nextRoom || room;
          a.state = 'working';
          if (!a.nextRoom) a.activity = '일하러 가는 중';
          this.goRoom(a, to, () => { if (to === 'library') a.emote = 'read'; });
        }
      });
    });
    return a;
  }

  finishSub(a, ev) {
    for (const [id, p] of this.pending) if (p.agent === a) this.pending.delete(id);
    // 재생 중이거나, 엘리베이터에서 내리기도 전에 끝났으면 그냥 보낸다
    if (this.replaying || a.state === 'arriving') { this.removeSub(a); return; }
    a.state = 'reporting'; a.activity = '보고하러 가는 중'; a.emote = null;
    a.unsay(b => !(b.type === 'err' && Date.now() - b.born < ERR_HOLD_MS));   // 막 뜬 오류 말풍선은 남긴다
    const spot = this.spotNearClaude(a);
    this.release(a);
    a.spot = spot; this.reserved.set(spot, a); a.room = 'report';
    this.walk(a, spot, () => {
      if (a.state !== 'reporting') return;
      a.facing = a.x < this.claude.x ? 1 : -1;
      a.say(ev.err ? 'err' : 'report', (ev.err ? '죄송해요… ' : '보고: ') + (ev.text || '다 했어요!'), 3200);
      if (!ev.err) { a.eyes = 'happy'; this.cheer(); } else a.mouth = 'worried';
      this.log(a, (ev.err ? '😓 ' : '📋 ') + 'Claude에게 보고', { err: ev.err });
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

  endTurn(msg, t, quiet = false) {
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
        if (!p.asked) { p.asked = true; this.log(c, `⏳ 승인 대기 중인 것 같아요: ${p.ev.name}`, { warn: true }); }
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
      // 워크플로 에이전트는 끝을 알리는 마지막 보고가 있으니 생각이 길어져 조용한 것을 끝으로 오해하지 않게 더 기다린다
      const quietMs = a.wf ? WF_QUIET_MS : RESUMED_QUIET_MS;
      if (busy ? quiet > WAIT_MS : (quiet > quietMs || !live)) { a.resumed = false; this.finishSub(a, { text: '', err: false }); }
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

// ---------------------------------------------------------------- 앱

const app = {
  floors: [], user: 'me', floor: null, session: null, autoFollow: true,
  town: null, world: null, cursor: null, sessionToken: 0, sessionActive: false,
  cam: { x: 0, y: 0, scale: 1, dpr: 1, fitted: false }, showOld: false, showAllSessions: false,
  title: '',
};

const canvas = $('#town');
const ctx = canvas.getContext('2d');

function resize() {
  // 무대 테두리 안쪽 크기 (getBoundingClientRect는 테두리까지 재서 오른쪽·아래가 몇 px 가려진다)
  const st = canvas.parentElement;
  const r = { width: st.clientWidth, height: st.clientHeight };
  app.cam.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * app.cam.dpr);
  canvas.height = Math.round(r.height * app.cam.dpr);
  canvas.style.width = r.width + 'px';
  canvas.style.height = r.height + 'px';
  if (!app.cam.touched) fit();
}

// 가장자리 숲은 조금 잘라도 되니, 방들이 있는 부분이 화면에 꽉 차게 맞춘다
function fit() {
  const w = canvas.width / app.cam.dpr, h = canvas.height / app.cam.dpr;
  const minX = iso(1, GH - 1).x - 20, maxX = iso(GW - 1, 1).x + 20;
  const minY = iso(1, 1).y - 110, maxY = iso(GW - 1, GH - 1).y + 40;
  const s = Math.min(w / (maxX - minX), (h - 70) / (maxY - minY));
  app.cam.scale = s;
  app.cam.x = (w - (maxX - minX) * s) / 2 - minX * s;
  app.cam.y = (h + 50 - (maxY - minY) * s) / 2 - minY * s;
}

function zoom(f, cx, cy) {
  const cam = app.cam;
  const w = canvas.width / cam.dpr, h = canvas.height / cam.dpr;
  cx = cx == null ? w / 2 : cx; cy = cy == null ? h / 2 : cy;
  const ns = Math.max(0.35, Math.min(3, cam.scale * f));
  cam.x = cx - (cx - cam.x) * ns / cam.scale;
  cam.y = cy - (cy - cam.y) * ns / cam.scale;
  cam.scale = ns;
  cam.touched = true;
}

(function setupCamera() {
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: app.cam.x, cy: app.cam.y }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    app.cam.x = drag.cx + e.clientX - drag.x; app.cam.y = drag.cy + e.clientY - drag.y; app.cam.touched = true;
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $('#zoomIn').onclick = () => zoom(1.2);
  $('#zoomOut').onclick = () => zoom(1 / 1.2);
  $('#zoomFit').onclick = () => { app.cam.touched = false; fit(); };
  window.addEventListener('resize', resize);
  // 층별 안내를 접고 펴면 지도 크기가 바뀐다
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(canvas.parentElement);
})();

// -------- 층별 안내 접기 (접은 상태는 이 브라우저에 기억한다)

const FOLD_KEY = 'clawd-village:left-folded';
function setLeftFolded(folded) {
  $('#app').classList.toggle('left-folded', folded);
  const btn = $('#leftToggle');
  const label = folded ? '층별 안내 펼치기' : '층별 안내 접기';
  btn.title = label; btn.setAttribute('aria-label', label); btn.setAttribute('aria-expanded', String(!folded));
  try { localStorage.setItem(FOLD_KEY, folded ? '1' : '0'); } catch { /* 저장소를 못 쓰는 브라우저 */ }
  resize();
}
$('#leftToggle').addEventListener('click', e => { e.stopPropagation(); setLeftFolded(!$('#app').classList.contains('left-folded')); });
// 접힌 띠는 어디를 눌러도 펼친다
$('#leftSign').addEventListener('click', () => { if ($('#app').classList.contains('left-folded')) setLeftFolded(false); });
try { if (localStorage.getItem(FOLD_KEY) === '1') setLeftFolded(true); } catch { /* 저장소를 못 쓰는 브라우저 */ }

// -------- 데이터

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
}

async function refreshFloors() {
  try {
    const data = await getJson('/api/floors');
    app.floors = data.floors;
    app.user = data.user || 'me';
    $('#rootPath').textContent = data.root + (data.demo ? ' (데모)' : '');
    if (!app.floor && app.floors.length) {
      const fromHash = new URLSearchParams(location.hash.slice(1));
      const hf = app.floors.find(f => f.id === fromHash.get('floor'));
      const latest = [...app.floors].sort((a, b) => b.lastActive - a.lastActive)[0];
      const f = hf || latest;
      const sid = hf && fromHash.get('session') && f.sessions.some(s => s.id === fromHash.get('session')) ? fromHash.get('session') : null;
      if (sid) app.autoFollow = false;
      await enterFloor(f, sid, false);
    } else if (app.floor) {
      const f = app.floors.find(x => x.id === app.floor.id);
      if (f) {
        app.floor = f;
        // /clear 하면 같은 층의 새 세션으로 따라간다
        const newest = [...f.sessions].sort((a, b) => b.birth - a.birth)[0];
        const cur = f.sessions.find(s => s.id === app.session);
        if (app.autoFollow && !app.riding && newest && cur && newest.id !== app.session && newest.birth > cur.birth) {
          toast(`🆕 ${f.floor}F 새 세션으로 따라갑니다`);
          openSession(f, newest.id);
        }
      }
    }
    renderFloors();
    renderHeader();
    $('#empty').hidden = app.floors.length > 0;
    $('#emptyRoot').textContent = data.root;
  } catch (e) {
    console.warn(e);
  }
}

function newestStarted(f) {
  const newest = [...f.sessions].sort((a, b) => b.birth - a.birth)[0];
  return newest && newest.id;
}

async function enterFloor(f, sessionId, animate = true) {
  const prev = app.floor ? app.floor.floor : 1;
  if (sessionId === undefined || sessionId === null) app.autoFollow = true;
  // 따로 고르지 않았으면 자동 따라가기와 같은 기준(가장 나중에 시작한 세션)으로 연다
  const sid = sessionId || newestStarted(f);
  // 엘리베이터가 도는 동안에는 이전 층에 머문다. 층과 세션은 도착할 때 함께 바꾼다.
  if (animate && prev !== f.floor) {
    app.riding = true;
    try { await elevatorRide(prev, f.floor); } finally { app.riding = false; }
  }
  app.floor = f;
  openSession(f, sid);
  renderFloors();
}

function elevatorRide(from, to) {
  const el = $('#elevator');
  const num = $('#elevatorNum');
  const arrow = $('#elevatorArrow');
  arrow.textContent = to > from ? '▲' : '▼';
  el.hidden = false;
  el.classList.add('show');
  const steps = Math.abs(to - from);
  const each = Math.max(45, Math.min(160, 900 / Math.max(1, steps)));
  return new Promise(resolve => {
    let cur = from;
    num.textContent = cur + 'F';
    const tick = () => {
      if (cur === to) {
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 250); resolve(); }, 380);
        return;
      }
      cur += to > from ? 1 : -1;
      num.textContent = cur + 'F';
      setTimeout(tick, each);
    };
    setTimeout(tick, each);
  });
}

function openSession(f, sid) {
  if (!sid) return;
  app.session = sid;
  app.cursor = null;
  app.title = '';
  const token = ++app.sessionToken;
  const themeIndex = themeForFloor(f.floor);
  if (!app.world || app.world.themeIndex !== themeIndex) app.world = buildWorld(themeIndex);
  app.world.todos = [];
  app.town = new Town(app.world, { userName: app.user, onTitle: t => { app.title = t; renderHeader(); } });
  history.replaceState(null, '', `#floor=${encodeURIComponent(f.id)}${app.autoFollow ? '' : '&session=' + encodeURIComponent(sid)}`);
  renderHeader();
  poll(token, f.id, sid);
}

async function poll(token, floorId, sid) {
  let first = true;
  while (token === app.sessionToken) {
    let data = null;
    try {
      const c = app.cursor ? '&c=' + encodeURIComponent(JSON.stringify(app.cursor)) : '';
      data = await getJson(`/api/session?floor=${encodeURIComponent(floorId)}&session=${encodeURIComponent(sid)}${c}`);
    } catch (e) {
      await sleep(1000);
      continue;
    }
    if (token !== app.sessionToken) return;
    const town = app.town;
    Object.assign(town.subsMeta, data.subs || {});
    if (data.reset) { openSession(app.floor, sid); return; }
    if (first || data.initial) { town.replay(data.events, data.session.active); first = false; }
    else for (const ev of data.events) town.handle(ev);
    // 기록 파일이 2분 넘게 조용해도 끝나지 않은 도구를 기다리는 중이면 LIVE로 본다
    app.sessionActive = data.session.active || town.waiting();
    app.cursor = data.cursor;
    renderHeader();
    if (!data.session.more) await sleep(POLL_MS);
  }
}

// -------- 화면 패널

function renderHeader() {
  const f = app.floor;
  if (!f) return;
  $('#floorBadge').textContent = f.floor + 'F';
  $('#floorName').textContent = f.name;
  const s = f.sessions.find(x => x.id === app.session);
  $('#sessionTitle').textContent = app.title || (s ? s.title : '');
  $('#themeLabel').textContent = THEMES[themeForFloor(f.floor)].label + ' 마을';
  const live = $('#live');
  live.classList.toggle('on', app.sessionActive);
  live.lastChild.textContent = app.sessionActive ? 'LIVE' : '쉬는 중';
  $('#cwd').textContent = f.cwd;
  $('#sid').textContent = app.session ? app.session.slice(0, 8) : '';
}

function renderFloors() {
  const box = $('#floors');
  const now = Date.now();
  const sorted = [...app.floors].sort((a, b) => b.floor - a.floor);
  const recent = sorted.filter(f => f.active || now - f.lastActive < OLD_FLOOR_MS || (app.floor && f.id === app.floor.id));
  const old = sorted.filter(f => !recent.includes(f));
  const item = f => {
    const cur = app.floor && f.id === app.floor.id;
    const lit = f.active || (cur && app.sessionActive);
    let html = `<li class="floor ${cur ? 'current' : ''} ${lit ? 'lit' : ''}" data-floor="${esc(f.id)}">
      <div class="frow"><span class="fnum">${f.floor}F</span><span class="fname">${esc(f.name)}</span><span class="light" title="${lit ? '지금 일하는 중' : '불 꺼짐'}"></span></div>
      <div class="fmeta">세션 ${f.sessionCount}개 · ${ago(now - f.lastActive)}</div>`;
    if (cur) {
      const list = app.showAllSessions ? f.sessions : f.sessions.slice(0, 8);
      html += `<ul class="sessions">
        <li class="follow ${app.autoFollow ? 'on' : ''}" data-follow="1">${app.autoFollow ? '✅' : '⬜'} 최근 세션 자동으로 따라가기</li>
        ${list.map(s => `<li class="sess ${s.id === app.session ? 'sel' : ''} ${s.active ? 'act' : ''}" data-session="${esc(s.id)}">
          <span class="stitle">${esc(s.title)}</span><span class="sago">${ago(now - s.mtime)}</span></li>`).join('')}
        ${f.sessions.length > 8 ? `<li class="more" data-more="1">${app.showAllSessions ? '접기' : `세션 ${f.sessions.length - 8}개 더 보기`}</li>` : ''}
      </ul>`;
    }
    return html + '</li>';
  };
  box.innerHTML = recent.map(item).join('') +
    (old.length ? `<li class="oldtoggle" data-old="1">${app.showOld ? '▾' : '▸'} 불 꺼진 지 오래된 층 ${old.length}개</li>` + (app.showOld ? old.map(item).join('') : '') : '');
}

// 이미 열린 탭에서 북마크를 누르거나 주소창의 #floor=… 를 고치면 그 층·세션으로 옮긴다
window.addEventListener('hashchange', () => {
  const h = new URLSearchParams(location.hash.slice(1));
  const f = app.floors.find(x => x.id === h.get('floor'));
  if (!f) return;
  const want = h.get('session');
  const sid = want && f.sessions.some(s => s.id === want) ? want : null;
  if (app.floor && f.id === app.floor.id) {
    if (sid ? sid === app.session && !app.autoFollow : app.autoFollow) return;
    app.autoFollow = !sid;
    openSession(f, sid || newestStarted(f));
    renderFloors();
    return;
  }
  app.autoFollow = !sid;
  enterFloor(f, sid, true);
});

$('#floors').addEventListener('click', e => {
  const t = e.target.closest('[data-session],[data-follow],[data-more],[data-old],[data-floor]');
  if (!t) return;
  e.stopPropagation();
  if (t.dataset.old) { app.showOld = !app.showOld; return renderFloors(); }
  if (t.dataset.more) { app.showAllSessions = !app.showAllSessions; return renderFloors(); }
  if (t.dataset.follow) {
    app.autoFollow = !app.autoFollow;
    const newest = newestStarted(app.floor);
    if (app.autoFollow && newest && newest !== app.session) openSession(app.floor, newest);
    else history.replaceState(null, '', `#floor=${encodeURIComponent(app.floor.id)}${app.autoFollow ? '' : '&session=' + encodeURIComponent(app.session)}`);
    return renderFloors();
  }
  if (t.dataset.session) {
    if (t.dataset.session === app.session) return;
    app.autoFollow = false;
    openSession(app.floor, t.dataset.session);
    return renderFloors();
  }
  const f = app.floors.find(x => x.id === t.dataset.floor);
  if (f && (!app.floor || f.id !== app.floor.id)) { app.showAllSessions = false; enterFloor(f, null, true); }
});

const STATE_LABEL = { working: '작업 중', idle: '대기', arriving: '출근 중', reporting: '보고 중', leaving: '퇴근 중' };

// 패널에 쓰는 캐릭터 얼굴 그림 (한 번 그려 두고 재사용)
const portraits = new Map();
function portraitUrl(species) {
  if (!portraits.has(species)) portraits.set(species, portrait(species, 40).toDataURL());
  return portraits.get(species);
}

function renderPeople() {
  const town = app.town;
  if (!town) return;
  const now = Date.now();
  const people = town.chars.filter(c => c.kind === 'claude' || c.kind === 'sub');
  $('#peopleCount').textContent = `${people.length}명 근무 중`;
  $('#people').innerHTML = people.map(a => {
    let st = STATE_LABEL[a.state] || a.state;
    if (a.emote === 'ponder') st = '고민 중';
    if (a.emote === 'sleep') st = '졸음';
    const al = a.alert;
    if (al === 'error') st = '⚠ 오류';
    else if (al === 'attention') st = a.bubble.type === 'wait' ? '⏳ 승인 대기?' : '❓ 답변 기다림';
    const sp = SPECIES[a.species];
    return `<li class="person ${al ? 'alert-' + al : ''}">
      <span class="avatar" style="border-color:${a.color}"><img src="${portraitUrl(a.species)}" alt=""></span>
      <div class="pbody">
        <div class="prow"><b>${esc(a.kind === 'claude' ? 'Claude' : a.type)}</b><span class="species">${esc(sp ? sp.name : '')}</span><span class="pill s-${esc(a.state)} ${al ? 'a-' + al : ''}">${esc(st)}</span></div>
        ${a.desc ? `<div class="pdesc">${esc(a.desc)}</div>` : ''}
        <div class="pact">${esc(a.activity)}</div>
        <div class="pmeta">도구 ${a.tools}회 · ${dur(now - a.since)}</div>
      </div></li>`;
  }).join('');
}

function renderLogs() {
  const town = app.town;
  if (!town || !town.dirty) return;
  town.dirty = false;
  $('#logs').innerHTML = town.logs.slice(0, 80).map(l => `<li class="${l.err ? 'err' : l.warn ? 'warn' : ''}">
    <span class="ltime">${clock(l.t)}</span><span class="lwho" style="color:${l.color}">● ${esc(l.who)}</span>
    <span class="ltext">${esc(l.text)}</span></li>`).join('');
}

// 오류나 확인할 일이 있으면 상단 표지, 무대 테두리, 브라우저 탭 제목으로도 알린다
const BASE_TITLE = document.title;
function renderAlerts() {
  const people = app.town ? app.town.chars.filter(c => c.kind === 'claude' || c.kind === 'sub') : [];
  const err = people.filter(c => c.alert === 'error').length;
  const att = people.filter(c => c.alert === 'attention').length;
  const box = $('#alerts');
  const key = err + '/' + att;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = (err ? `<span class="chip err">⚠ 오류 ${err}</span>` : '') + (att ? `<span class="chip warn">❓ 확인 필요 ${att}</span>` : '');
  }
  const stage = $('#stage');
  stage.classList.toggle('alert-error', err > 0);
  stage.classList.toggle('alert-attention', !err && att > 0);
  const title = (err ? '⚠ ' : att ? '❓ ' : '') + BASE_TITLE;
  if (document.title !== title) document.title = title;
}

function renderLegend() {
  const rooms = ['library', 'dev', 'server', 'info', 'meeting', 'lobby', 'elevator'];
  const cast = [['clawd', 'Claude', '방마다 작업 모자'], ['sprout', 'Explore', '탐험 모자 · 돋보기'], ['owl', 'Plan', '안경 · 설계도'],
    ['bunny', '범용', '파란 목도리'], ['chick', '그 밖의 에이전트', ''], ['human', '나', '']];
  $('#legend').innerHTML = rooms.map(k => `<li><span>${ROOMS[k].icon}</span><b>${ROOMS[k].name}</b><em>${ROOMS[k].desc}</em></li>`).join('') +
    cast.map(([sp, who, note]) => `<li class="cast"><img src="${portraitUrl(sp)}" alt=""><b>${SPECIES[sp].name}</b><em>${who}${note ? ' · ' + note : ''}</em></li>`).join('');
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// -------- 루프

let last = performance.now();
let panelAt = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.town && app.world) {
    app.town.update(dt, app.sessionActive);
    const live = app.town.liveFlags(app.floor ? app.floor.floor + 'F' : '', app.user);
    render(ctx, app.world, app.cam, app.town.chars, live, now / 1000);
    if (now - panelAt > 500) { panelAt = now; renderPeople(); renderLogs(); renderAlerts(); }
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#d9f1ff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(frame);
}

resize();
renderLegend();
refreshFloors();
setInterval(refreshFloors, FLOORS_MS);
setInterval(() => renderFloors(), 15000);
// 다른 탭을 보는 동안에는 화면을 그리지 않으니(requestAnimationFrame 멈춤) 상태와 탭 제목만 따로 갱신한다
setInterval(() => {
  if (!document.hidden || !app.town) return;
  app.town.settle();
  app.town.update(0, app.sessionActive);
  renderAlerts();
}, 1000);
requestAnimationFrame(frame);

// 도구 이름에 대해 아는 것을 한곳에 모은다: 어느 방으로 가는지, 말풍선·로그에 뭐라고 쓰는지, 오래 걸리는 도구인지.
import { baseName, short } from './util.js';

export function roomForTool(name) {
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

export function describeTool(name, i = {}) {
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
export const FINAL_TOOLS = new Set(['StructuredOutput', 'SubagentHandback']);
// 원래 오래 걸릴 수 있는 도구. 이런 도구가 끝나지 않아도 승인을 기다리는 것으로 보지 않는다
export const LONG_TOOLS = new Set(['Bash', 'BashOutput', 'Monitor', 'PowerShell', 'TaskOutput', 'Task', 'Agent', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'SendMessage']);

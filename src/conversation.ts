export type Message = { id: string; text: string; role: 'assistant' | 'user'; revision?: number; mode?: 'mock' | 'live' };
export type Turn = { sessionId: string; requestId: string; expectedVersion: number; message: Message | null; edit: boolean };
export type Snapshot = { sessionId: string; scenarioId: string; version: number; messages: Message[]; lastRequestId: string | null; pending: { turn: Turn; expiresAt: number } | null };
export type ConversationUi = { revealed: string[]; suggestions: Record<string, { keywords: string[]; sentence: string; expanded: boolean }>; lockedUserId: string | null };
export type LocalConversation = { schemaVersion: 1; active: Snapshot | null; pending: Turn | null; ui: ConversationUi;
  ending?: string; starting?: { sessionId: string; scenarioId: string; expectedSessionId: string | null } };
export const ACTIVE_KEY = 'sayscene:v1:activeConversation';
export const emptyUi = (): ConversationUi => ({ revealed: [], suggestions: {}, lockedUserId: null });
export const emptyConversation = (): LocalConversation => ({ schemaVersion: 1, active: null, pending: null, ui: emptyUi() });
export function readConversation(): LocalConversation {
  const raw = localStorage.getItem(ACTIVE_KEY);
  if (!raw) return emptyConversation();
  const data = JSON.parse(raw);
  if (data?.schemaVersion !== 1 || !data.ui || !Array.isArray(data.ui.revealed) || !data.ui.revealed.every((id: unknown) => typeof id === 'string')
      || !data.ui.suggestions || Array.isArray(data.ui.suggestions) || typeof data.ui.suggestions !== 'object'
      || !Object.values(data.ui.suggestions).every((hint: any) => typeof hint?.sentence === 'string' && typeof hint.expanded === 'boolean'
        && Array.isArray(hint.keywords) && hint.keywords.every((word: unknown) => typeof word === 'string'))
      || (data.active && (!Array.isArray(data.active.messages) || typeof data.active.sessionId !== 'string' || !Number.isInteger(data.active.version)
      || !data.active.messages.every((m: Message) => typeof m?.id === 'string' && typeof m.text === 'string' && ['assistant', 'user'].includes(m.role))))
      || (data.pending && (typeof data.pending.requestId !== 'string' || !Number.isInteger(data.pending.expectedVersion)))) throw new Error('저장된 대화 형식을 읽지 못했어요. 기존 데이터는 유지됩니다.');
  return data;
}
export function writeConversation(data: LocalConversation) {
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(data)); }
  catch { throw new Error('진행 중 대화를 저장하지 못했어요. 브라우저 저장 공간과 설정을 확인해주세요.'); }
  window.dispatchEvent(new Event('sayscene-conversation'));
}
export function displayedMessages(local: LocalConversation): Message[] {
  const messages = [...(local.active?.messages ?? [])];
  const pending = local.pending?.message;
  if (pending) { if (local.pending?.edit) messages.splice(-2); messages.push(pending); }
  return messages;
}
export class ConversationError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function conversationApi(path = '', body?: unknown, signal?: AbortSignal): Promise<{ active: Snapshot | null; closed: string[] }> {
  const response = await fetch(`/api/v1/conversation${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new ConversationError(response.status, response.status === 503 ? '대화 저장 서버에 연결하지 못했어요. 기록을 보존했으니 연결 후 다시 시도해주세요.' : '대화 상태를 확인하지 못했어요. 다시 연결해주세요.');
  const data = await response.json();
  if (!data || !Array.isArray(data.closed) || (data.active && !Array.isArray(data.active.messages))) throw new Error('대화 서버 응답을 확인하지 못했어요.');
  return data;
}
export function mergeServer(local: LocalConversation, state: { active: Snapshot | null; closed: string[] }): LocalConversation {
  const active = state.active;
  if (!active) return emptyConversation();
  const same = local.active?.sessionId === active.sessionId;
  const pending = active.pending?.turn ?? (same && local.pending?.expectedVersion === active.version
    && local.pending.requestId !== active.lastRequestId ? local.pending : null);
  return { schemaVersion: 1, active, pending, ui: same ? local.ui : emptyUi() };
}
// Cookie 발급 및 로컬 복원은 브라우저 전체에서 직렬화한다.
export async function reconcile() {
  if (!navigator.locks) throw new Error('대화 동기화를 위해 최신 Chrome 또는 Safari를 사용해주세요.');
  return navigator.locks.request('sayscene:conversation-bootstrap', async () => {
    const local = readConversation();
    let state = await conversationApi();
    // 네트워크를 기다리는 동안 입력 탭이 저장한 최신 기록을 덮어쓰지 않는다.
    if (JSON.stringify(readConversation()) !== JSON.stringify(local)) return readConversation();
    if (local.ending) {
      if (state.active?.sessionId === local.ending) state = await conversationApi('/end', { sessionId: local.ending });
    } else if (local.starting) {
      if (!state.active || state.active.sessionId === local.starting.expectedSessionId)
        state = await conversationApi('/start', { ...local.starting, expectedSessionId: state.active?.sessionId ?? null });
    } else if (!state.active && local.active && !state.closed.includes(local.active.sessionId)) {
      state = await conversationApi('/restore', { ...local.active, pending: null });
    }
    if (JSON.stringify(readConversation()) !== JSON.stringify(local)) return readConversation();
    const next = mergeServer(local, state); writeConversation(next); return next;
  });
}

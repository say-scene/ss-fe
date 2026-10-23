// 테스트용 메모리 서버. 실제 useConversation의 저장·라우팅·잠금 코드를 그대로 실행한다.
import { vi } from 'vitest';
import type { Snapshot, Message } from './conversation';
export function installSessionHarness(fallback: ReturnType<typeof vi.fn>) {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (name: string, options: any, callback?: any) => {
    const action = callback ?? options;
    const before = queues.get(name) ?? Promise.resolve();
    const next = before.catch(() => {}).then(() => { if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError'); return action({ name }); });
    queues.set(name, next); void next.finally(() => { if (queues.get(name) === next) queues.delete(name); }).catch(() => {});
    return next;
  } } });
  const peers = new Set<any>();
  vi.stubGlobal('BroadcastChannel', class {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor() { peers.add(this); }
    postMessage(data: unknown) { for (const peer of peers) if (peer !== this) queueMicrotask(() => peer.onmessage?.({ data })); }
    close() { peers.delete(this); }
  });
  const state: { active: Snapshot | null; closed: string[] } = { active: null, closed: [] };
  const result = () => new Response(JSON.stringify(state));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/v1/conversation')) return fallback(url, init);
    const body = init?.body ? JSON.parse(init.body as string) : null;
    if (url.endsWith('/start')) state.active = { sessionId: body.sessionId, scenarioId: body.scenarioId, version: 0, messages: [], lastRequestId: null, pending: null };
    if (url.endsWith('/restore')) state.active = body;
    if (url.endsWith('/end')) { state.closed.push(body.sessionId); state.active = null; }
    if (url.endsWith('/turn')) {
      const active = state.active!;
      if (active.lastRequestId === body.requestId) return result();
      const messages = [...active.messages];
      if (body.edit) messages.splice(-2);
      if (body.message) messages.push(body.message);
      const response = await fallback(messages.length ? '/api/v1/demo/cafe/reply' : `/api/v1/demo/cafe?scenarioId=${active.scenarioId}`, {
        ...init, body: JSON.stringify({ scenarioId: active.scenarioId, messages: messages.map((m: Message) => ({ role: m.role, content: m.text })) }) });
      if (!response.ok) return response;
      const value = await response.json();
      messages.push({ id: crypto.randomUUID(), text: value.text, role: 'assistant', revision: 1, mode: value.mode });
      if (state.active?.sessionId === active.sessionId) state.active = { ...active, messages, version: active.version + 1, lastRequestId: body.requestId, pending: null };
    }
    return result();
  }));
  return state;
}

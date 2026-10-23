// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ACTIVE_KEY, emptyConversation, emptyUi, readConversation, writeConversation, mergeServer, reconcile } from './conversation';
import { useConversation } from './useConversation';
import { installSessionHarness } from './sessionTestHarness';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const snapshot = () => ({ sessionId: crypto.randomUUID(), scenarioId: 'cafe-order', version: 1,
  messages: [{ id: crypto.randomUUID(), text: 'Hello!', role: 'assistant' as const, revision: 1 }], lastRequestId: crypto.randomUUID(), pending: null });
it('Redis 완료 이력을 우선하고 같은 버전의 전송 요청 ID만 유지한다', () => {
  const active = snapshot();
  const pending = { sessionId: active.sessionId, requestId: crypto.randomUUID(), expectedVersion: 1, message: null, edit: false };
  const local = { schemaVersion: 1 as const, active, pending, ui: emptyUi() };
  expect(mergeServer(local, { active, closed: [] }).pending).toEqual(pending);
  expect(mergeServer(local, { active: { ...active, version: 2, lastRequestId: pending.requestId }, closed: [] }).pending).toBeNull();
});
it('Redis 이력이 없으면 로컬 복원하고 종료 표식이 있으면 부활시키지 않는다', async () => {
  const server = installSessionHarness(vi.fn()); const active = snapshot();
  writeConversation({ ...emptyConversation(), active });
  await reconcile(); expect(server.active?.sessionId).toBe(active.sessionId);
  server.active = null; server.closed.push(active.sessionId);
  await reconcile(); expect(readConversation().active).toBeNull();
});
it('손상된 로컬 기록은 임의로 덮어쓰지 않는다', async () => {
  installSessionHarness(vi.fn()); localStorage.setItem(ACTIVE_KEY, 'broken');
  await expect(reconcile()).rejects.toThrow(); expect(localStorage.getItem(ACTIVE_KEY)).toBe('broken');
});
it('사용권 이전 시 이전 탭의 입력을 해제한 뒤 하나의 탭만 활성화한다', async () => {
  installSessionHarness(vi.fn());
  const a = renderHook(() => useConversation()); const b = renderHook(() => useConversation());
  await waitFor(() => expect(a.result.current.ready && b.result.current.ready).toBe(true));
  await act(async () => { await a.result.current.start('cafe-order'); });
  const stopped = vi.fn(); a.result.current.cleanupChat.current = stopped;
  expect(a.result.current.owner).toBe(true);
  await act(async () => { await b.result.current.resume(); });
  expect(stopped).toHaveBeenCalled(); expect(a.result.current.owner).toBe(false); expect(b.result.current.owner).toBe(true);
});
it('전송 실패 시 같은 요청 ID를 저장해 재시도한다', async () => {
  const inference = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ text: 'Hi', mode: 'mock' })));
  installSessionHarness(inference);
  const hook = renderHook(() => useConversation()); await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => { await hook.result.current.start('cafe-order'); });
  await act(async () => { await expect(hook.result.current.generate([])).rejects.toThrow(); });
  const id = readConversation().pending!.requestId;
  await act(async () => { await hook.result.current.generate([]); });
  expect(readConversation().active?.lastRequestId).toBe(id); expect(readConversation().pending).toBeNull();
});

it('복원 응답을 기다리는 중 새로 저장된 기록을 덮어쓰지 않는다', async () => {
  installSessionHarness(vi.fn());
  const first = snapshot(); writeConversation({ ...emptyConversation(), active: first });
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = reconcile();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  const next = { ...first, version: 2 };
  writeConversation({ ...emptyConversation(), active: next });
  finish(new Response(JSON.stringify({ active: first, closed: [] })));
  await pending;
  expect(readConversation().active?.version).toBe(2);
});
it('로컬 저장 실패 시 새 대화를 서버에 시작하지 않는다', async () => {
  installSessionHarness(vi.fn());
  const hook = renderHook(() => useConversation()); await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('quota'); };
  await act(async () => { expect(await hook.result.current.start('cafe-order')).toBe(false); });
  expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(call => call[0].endsWith('/start'))).toBe(false);
  localStorage.setItem = original;
});

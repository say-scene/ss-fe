// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRecorder } from './useRecorder';
import ChatRoom from './ChatRoom';
import Translation from './Translation';
import { useConversation } from './useConversation';
import { emptyConversation, readConversation, reconcile, writeConversation } from './conversation';
import { installSessionHarness } from './sessionTestHarness';
import { tracedFetch, type TraceAction } from './telemetry';

const telemetry = vi.hoisted(() => ({ actions: [] as Array<{ name: string; context: object; setError: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }> }));
vi.mock('./telemetry', () => {
  const startAction = (name: string) => {
    const action = { name, context: {}, setError: vi.fn(), end: vi.fn() };
    telemetry.actions.push(action); return action;
  };
  return {
    startAction,
    tracedFetch: vi.fn((url: string, init: RequestInit, _action?: unknown) => fetch(url, init)),
    runAction: async (name: string, work: (action: unknown) => Promise<unknown>, parent?: unknown) => {
      const action = parent ?? startAction(name);
      try { return await work(action); }
      catch (error) { (action as ReturnType<typeof startAction>).setError(); throw error; }
      finally { if (!parent) (action as ReturnType<typeof startAction>).end(); }
    },
  };
});
const speech = vi.hoisted(() => ({ speak: vi.fn(), stop: vi.fn() }));
vi.mock('./useSpeech', () => ({ useSpeech: () => ({ playback: 'ended', speechError: '', speak: speech.speak, stop: speech.stop }) }));
let recorder: FakeRecorder;
let releaseMicrophone: ReturnType<typeof vi.fn>;
class FakeRecorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor() { recorder = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['private audio']) }); this.onstop?.(); }
}
function media() {
  releaseMicrophone = vi.fn();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: releaseMicrophone }] }),
  } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const reply = (text: string) => new Response(JSON.stringify({ text, mode: 'live' }));
beforeEach(() => { telemetry.actions.length = 0; vi.mocked(tracedFetch).mockClear(); media(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); speech.speak.mockClear(); speech.stop.mockClear(); });

it('releases recorder UI and microphone before downstream generation settles, but keeps its action open', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn((_name, _options, work) => work({})) } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"text":"private transcript"}')));
  const generation = deferred<void>();
  const callback = vi.fn(() => generation.promise);
  const hook = renderHook(() => useRecorder(callback));
  let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  act(() => hook.result.current.start());
  await waitFor(() => expect(hook.result.current.state).toBe('recording'));
  now = 3000; act(() => hook.result.current.stopRecording());
  await waitFor(() => expect(callback).toHaveBeenCalled());
  const action = telemetry.actions.find(item => item.name === 'speech.turn')!;
  expect(vi.mocked(tracedFetch).mock.calls[0][2]).toBe(action);
  expect(callback).toHaveBeenCalledWith('private transcript', action);
  expect(hook.result.current.state).toBe('idle'); expect(releaseMicrophone).toHaveBeenCalled();
  expect(action.end).not.toHaveBeenCalled();
  await act(async () => generation.resolve());
  expect(action.end).toHaveBeenCalledTimes(1);
});

it('cancels a pending speech action on reset without a late callback overwriting the next recording', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn((_name, _options, work) => work({})) } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"text":"transcript"}')));
  const generation = deferred<void>();
  const hook = renderHook(() => useRecorder(() => generation.promise));
  let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  act(() => hook.result.current.start()); await waitFor(() => expect(hook.result.current.state).toBe('recording'));
  now = 3000; act(() => hook.result.current.stopRecording());
  await waitFor(() => expect(hook.result.current.state).toBe('idle'));
  const action = telemetry.actions[0];
  act(() => { hook.result.current.reset(); hook.result.current.start(); });
  await waitFor(() => expect(hook.result.current.state).toBe('recording'));
  expect(action.setError).toHaveBeenCalledWith('aborted'); expect(action.end).toHaveBeenCalled();
  await act(async () => generation.resolve());
  expect(hook.result.current.state).toBe('recording');
});

it('passes one speech action from STT through the legacy reply and gives translation a separate action', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn((_name, _options, work) => work({})) } });
  const downstream = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/api/v1/stt') return Promise.resolve(new Response('{"text":"A latte."}'));
    if (url === '/api/v1/demo/cafe/reply') return downstream.promise;
    return Promise.resolve(reply('Welcome!'));
  }));
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(speech.speak).toHaveBeenCalledWith('Welcome!'));
  let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  fireEvent.click(screen.getByRole('button', { name: '마이크로 답하기' }));
  await waitFor(() => expect(recorder.state).toBe('recording'));
  now = 3000; fireEvent.click(screen.getByRole('button', { name: '녹음 종료' }));
  await waitFor(() => expect(vi.mocked(tracedFetch).mock.calls.some(call => call[0] === '/api/v1/demo/cafe/reply')).toBe(true));
  const stt = vi.mocked(tracedFetch).mock.calls.find(call => call[0] === '/api/v1/stt')!;
  const turn = vi.mocked(tracedFetch).mock.calls.find(call => call[0] === '/api/v1/demo/cafe/reply')!;
  expect(turn[2]).toBe(stt[2]);
  const action = telemetry.actions.find(item => item.name === 'speech.turn')!;
  expect(action.end).not.toHaveBeenCalled();
  await act(async () => downstream.resolve(reply('Hot or iced?')));
  await waitFor(() => expect(action.end).toHaveBeenCalledTimes(1));
  cleanup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '안녕', sessionId: 'business-session', messageId: 'message', revision: 1 }))));
  render(<Translation sessionId="business-session" messageId="message" revision={1} text="private text" />);
  fireEvent.click(screen.getByRole('button', { name: '한글 번역' }));
  await screen.findByText('안녕');
  const translation = vi.mocked(tracedFetch).mock.calls.find(call => call[0] === '/api/v1/translate')!;
  expect(translation[2]).not.toBe(action); expect(telemetry.actions.at(-1)?.name).toBe('translation');
});

it('passes the STT action to the managed generation callback and waits until it settles', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn((_name, _options, work) => work({})) } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"text":"A latte."}')));
  const downstream = deferred<Array<{ id: string; text: string; role: 'assistant' | 'user'; revision: number }>>();
  const generate = vi.fn(() => downstream.promise);
  const first = { id: 'assistant', text: 'Welcome!', role: 'assistant' as const, revision: 1 as const };
  const local = { ...emptyConversation(), active: { sessionId: 'application-session', scenarioId: 'cafe-order', version: 1,
    messages: [first], lastRequestId: null, pending: null } };
  render(<ChatRoom managed={{ local, generate, saveUi: vi.fn(), registerCleanup: vi.fn(), restart: vi.fn() }} />);
  let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  fireEvent.click(screen.getByRole('button', { name: '마이크로 답하기' }));
  await waitFor(() => expect(recorder.state).toBe('recording'));
  now = 3000; fireEvent.click(screen.getByRole('button', { name: '녹음 종료' }));
  await waitFor(() => expect(generate).toHaveBeenCalled());
  const action = telemetry.actions.find(item => item.name === 'speech.turn')!;
  expect(vi.mocked(tracedFetch).mock.calls[0][2]).toBe(action);
  expect(generate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ text: 'A latte.' })]), action);
  expect(action.end).not.toHaveBeenCalled();
  await act(async () => downstream.resolve([first, { id: 'response', text: 'Hot or iced?', role: 'assistant', revision: 1 }]));
  await waitFor(() => expect(action.end).toHaveBeenCalledTimes(1));
});

it('reuses a supplied speech action for managed turn conflict checks and automatic retries without changing requestId', async () => {
  const server = installSessionHarness(vi.fn().mockResolvedValue(reply('Hello!')));
  const hook = renderHook(() => useConversation()); await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => { await hook.result.current.start('cafe-order'); });
  const native = vi.mocked(fetch).getMockImplementation()!;
  let attempts = 0;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/turn') && attempts++ === 0) return Promise.resolve(new Response('{}', { status: 409 }));
    return native(url, init);
  }));
  const parent = { context: {}, setError: vi.fn(), end: vi.fn() } as unknown as TraceAction;
  const first = vi.mocked(tracedFetch).mock.calls.length;
  await act(async () => { await hook.result.current.generate([], parent); });
  const calls = vi.mocked(tracedFetch).mock.calls.slice(first);
  expect(calls.map(call => call[0])).toEqual(['/api/v1/conversation/turn', '/api/v1/conversation', '/api/v1/conversation/turn']);
  expect(calls.every(call => call[2] === parent)).toBe(true);
  expect(JSON.parse(calls[0][1]!.body as string).requestId).toBe(JSON.parse(calls[2][1]!.body as string).requestId);
  expect(server.active?.lastRequestId).toBe(JSON.parse(calls[0][1]!.body as string).requestId);
  expect(parent.end).not.toHaveBeenCalled();
});

it('keeps reconciliation GET and restore in one action while manual retry creates a fresh action', async () => {
  const server = installSessionHarness(vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(reply('Hello!')));
  const active = { sessionId: crypto.randomUUID(), scenarioId: 'cafe-order', version: 0, messages: [], lastRequestId: null, pending: null };
  writeConversation({ ...emptyConversation(), active });
  await reconcile();
  const syncCalls = vi.mocked(tracedFetch).mock.calls.slice(-2);
  expect(syncCalls.map(call => call[0])).toEqual(['/api/v1/conversation', '/api/v1/conversation/restore']);
  expect(syncCalls[0][2]).toBe(syncCalls[1][2]);
  const hook = renderHook(() => useConversation()); await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => { await hook.result.current.resume(); });
  await act(async () => { await expect(hook.result.current.generate([])).rejects.toThrow(); });
  const original = vi.mocked(tracedFetch).mock.calls.filter(call => call[0].endsWith('/turn')).at(-1)!;
  const requestId = readConversation().pending!.requestId;
  await act(async () => { await hook.result.current.generate([]); });
  const retry = vi.mocked(tracedFetch).mock.calls.filter(call => call[0].endsWith('/turn')).at(-1)!;
  expect(retry[2]).not.toBe(original[2]);
  expect(JSON.parse(retry[1]!.body as string).requestId).toBe(requestId);
  expect(server.active?.lastRequestId).toBe(requestId);
});

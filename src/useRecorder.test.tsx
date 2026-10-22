// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRecorder } from './useRecorder';
let recorder: FakeRecorder; let stopTrack: ReturnType<typeof vi.fn>;
class FakeRecorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor() { recorder = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }
}
beforeEach(() => {
  stopTrack = vi.fn();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
    locks: { request: vi.fn((_name, _options, callback) => callback({})) },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'A latte, please.' }))));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('녹음 종료 후 전사 결과를 전달하고 마이크를 해제한다', async () => {
  const done = vi.fn(); const { result } = renderHook(() => useRecorder(done));
  let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.state).toBe('recording'));
  now = 3000; act(() => result.current.stopRecording());
  await waitFor(() => expect(done).toHaveBeenCalledWith('A latte, please.'));
  expect(stopTrack).toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith('/api/v1/stt', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }));
});
it('권한 거부를 안내하고 재시도를 허용한다', async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new DOMException('Denied','NotAllowedError'));
  const { result } = renderHook(() => useRecorder(vi.fn()));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.error).toContain('마이크 권한'));
  expect(result.current.state).toBe('idle'); expect(fetch).not.toHaveBeenCalled();
});
it('다른 탭이 마이크를 사용하면 녹음하지 않는다', async () => {
  vi.mocked(navigator.locks.request).mockImplementation(((_n: unknown, _o: unknown, callback: (v: null) => Promise<void>) => callback(null)) as typeof navigator.locks.request);
  const { result } = renderHook(() => useRecorder(vi.fn()));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.error).toContain('다른 탭'));
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});
it('화면 이탈 후 권한이 승인되어도 마이크를 닫는다', async () => {
  let resolve!: (stream: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(() => new Promise(r => { resolve = r; }));
  const { result, unmount } = renderHook(() => useRecorder(vi.fn()));
  act(() => result.current.start()); unmount();
  await act(async () => resolve({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream));
  expect(stopTrack).toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('무음 인식 결과는 사용자 말풍선으로 전달하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"code":"NO_SPEECH"}', {status:422})));
  const done=vi.fn();const {result}=renderHook(()=>useRecorder(done));
  let now=1000;vi.spyOn(Date,'now').mockImplementation(()=>now);
  act(()=>result.current.start());await waitFor(()=>expect(result.current.state).toBe('recording'));
  now=3000;act(()=>result.current.stopRecording());
  await waitFor(()=>expect(result.current.error).toContain('목소리'));
  expect(done).not.toHaveBeenCalled();
});

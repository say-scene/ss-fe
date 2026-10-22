// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ChatRoom from './ChatRoom';
class Utterance {
  text: string; lang = ''; rate = 1; voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) { this.text = text; }
}
let spoken: Utterance[];
let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices: ReturnType<typeof vi.fn> };
beforeEach(() => {
  spoken = [];
  synth = { speak: vi.fn((u: Utterance) => spoken.push(u)), cancel: vi.fn(), getVoices: vi.fn(() => [{ lang: 'en-US', name: 'English' }]) };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'Welcome! What would you like?', mode: 'mock' }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('완성된 응답을 자동으로 읽고 원문은 클릭 후 공개한다', async () => {
  render(<ChatRoom />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1));
  expect(spoken[0].text).toBe('Welcome! What would you like?');
  expect(spoken[0].lang).toBe('en-US');
  expect(screen.queryByText('Welcome! What would you like?')).not.toBeInTheDocument();
  act(() => spoken[0].onstart?.());
  expect(screen.getByText('바리스타가 말하고 있어요')).toBeInTheDocument();
  act(() => spoken[0].onend?.());
  fireEvent.click(screen.getByRole('button', { name: '영어 원문 보기' }));
  expect(screen.getByText('Welcome! What would you like?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 듣기' }));
  expect(synth.speak).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('재생 실패 시 문장을 유지하고 재생을 재시도할 수 있다', async () => {
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(spoken).toHaveLength(1));
  act(() => spoken[0].onerror?.());
  expect(screen.getByRole('alert')).toHaveTextContent('다시 듣기');
  fireEvent.click(screen.getByRole('button', { name: '다시 듣기' }));
  expect(spoken).toHaveLength(2);
});
it('LLM 실패는 재시도하고 음성은 재생하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('연결');
  expect(synth.speak).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '다시 시도하기' })).toBeEnabled();
});
it('화면을 떠난 뒤 도착한 응답은 읽지 않는다', async () => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  const { unmount } = render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  unmount();
  await act(async () => resolve(new Response(JSON.stringify({ text: 'Late reply', mode: 'live' }))));
  expect(synth.speak).not.toHaveBeenCalled();
});
it('TTS 미지원 브라우저에서도 원문을 확인할 수 있다', async () => {
  vi.stubGlobal('speechSynthesis', undefined);
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('음성 재생을 지원하지');
  fireEvent.click(screen.getByRole('button', { name: '영어 원문 보기' }));
  expect(screen.getByText('Welcome! What would you like?')).toBeInTheDocument();
});

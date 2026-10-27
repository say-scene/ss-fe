// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ChatRoom from './ChatRoom';
const mocks = vi.hoisted(() => ({ state: 'idle', transcript: (_text: string) => {}, speak: vi.fn(), stop: vi.fn() }));
vi.mock('./useRecorder', () => ({ useRecorder: (callback: (text: string) => void) => {
  mocks.transcript = callback;
  return { state: mocks.state, seconds: 0, error: '', start: vi.fn(), stopRecording: vi.fn(), reset: vi.fn() };
} }));
vi.mock('./useSpeech', () => ({ useSpeech: () => ({ playback: 'ended', speechError: '', speak: mocks.speak, stop: mocks.stop }) }));
const reply = (text: string) => new Response(JSON.stringify({ text, mode: 'live' }));
afterEach(() => { mocks.state = 'idle'; cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('STT 입력 후 전체 이력으로 답변을 받고 다음 녹음까지 이어간다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockResolvedValueOnce(reply('Hot or iced?')).mockResolvedValueOnce(reply('What size?'));
  vi.stubGlobal('fetch', fetcher);
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledWith('Welcome!'));
  act(() => mocks.transcript('A latte, please.'));
  expect(screen.getByText('A latte, please.')).toBeInTheDocument();
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledWith('Hot or iced?'));
  expect(screen.getByRole('button', { name: '마이크로 답하기' })).toBeEnabled();
  act(() => mocks.transcript('Hot, please.'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledWith('What size?'));
  const body = JSON.parse(fetcher.mock.calls[2][1].body);
  expect(body.scenarioId).toBe('cafe-order');
  expect(body.messages).toEqual([
    { role: 'assistant', content: 'Welcome!' }, { role: 'user', content: 'A latte, please.' },
    { role: 'assistant', content: 'Hot or iced?' }, { role: 'user', content: 'Hot, please.' },
  ]);
  expect(screen.getAllByRole('button', { name: '영어 원문 보기' })).toHaveLength(3);
});
it('실패한 답변은 사용자 발화를 중복 추가하지 않고 같은 이력으로 재시도한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockResolvedValueOnce(new Response('{}', { status: 504 })).mockResolvedValueOnce(reply('What size?'));
  vi.stubGlobal('fetch', fetcher);
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: '새 인사 듣기' })).toBeInTheDocument();
  act(() => mocks.transcript('A latte, please.'));
  expect(screen.queryByRole('button', { name: '새 인사 듣기' })).not.toBeInTheDocument();
  const retry = await screen.findByRole('button', { name: '답변 다시 받기' });
  expect(screen.getByRole('button', { name: '마이크로 답하기' })).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1][1].body).toEqual(fetcher.mock.calls[2][1].body);
  expect(screen.getAllByText('A latte, please.')).toHaveLength(1);
});
it('화면 이탈 뒤 늦게 완료된 다음 답변을 재생하지 않는다', async () => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; })));
  const { unmount } = render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  act(() => mocks.transcript('A latte.'));
  expect(screen.getByRole('button', { name: '마이크로 답하기' })).toBeDisabled();
  unmount();
  await act(async () => resolve(reply('Late reply')));
  expect(mocks.speak).toHaveBeenCalledTimes(1);
});

it('수정하면 이전 AI 답변을 제거하고 수정 문장으로 재생성한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockResolvedValueOnce(reply('A latte?')).mockResolvedValueOnce(reply('An iced tea?'));
  vi.stubGlobal('fetch', fetcher);
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  act(() => mocks.transcript('A latte.'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getAllByRole('button', { name: '영어 원문 보기' })[1]);
  fireEvent.click(screen.getByRole('button', { name: '수정하기' }));
  expect(mocks.stop).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '마이크로 답하기' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '발화 수정' }), { target: { value: 'An iced tea.' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledWith('An iced tea?'));
  expect(screen.queryByText('A latte?')).not.toBeInTheDocument();
  expect(screen.queryByText('A latte.')).not.toBeInTheDocument();
  expect(screen.getByText('수정한 발화')).toBeInTheDocument();
  expect(JSON.parse(fetcher.mock.calls[2][1].body).messages).toEqual([
    { role: 'assistant', content: 'Welcome!' }, { role: 'user', content: 'An iced tea.' },
  ]);
});
it('빈 수정은 저장하지 않고 취소하면 원문과 기존 답변을 유지한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockResolvedValueOnce(reply('What size?'));
  vi.stubGlobal('fetch', fetcher);
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  act(() => mocks.transcript('A latte.'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '수정하기' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
  expect(screen.getByRole('button', { name: '수정 완료' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(screen.getByText('A latte.')).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('수정 응답 실패 후 재시도에도 수정한 문맥을 유지한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockResolvedValueOnce(reply('What size?'))
    .mockResolvedValueOnce(new Response('{}', { status: 504 })).mockResolvedValueOnce(reply('An iced tea?'));
  vi.stubGlobal('fetch', fetcher);
  render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  act(() => mocks.transcript('A latte.'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '수정하기' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'An iced tea.' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
  fireEvent.click(await screen.findByRole('button', { name: '답변 다시 받기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(3));
  expect(fetcher.mock.calls[2][1].body).toEqual(fetcher.mock.calls[3][1].body);
  expect(screen.getAllByText('An iced tea.')).toHaveLength(1);
});
it('후속 녹음이 시작되면 이전 발화의 수정을 잠근다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockResolvedValueOnce(reply('What size?')).mockResolvedValueOnce(reply('Anything else?')));
  const { rerender } = render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  act(() => mocks.transcript('A latte.'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button', { name: '수정하기' })).toBeEnabled();
  mocks.state = 'recording'; rerender(<ChatRoom />);
  expect(screen.queryByRole('button', { name: '수정하기' })).not.toBeInTheDocument();
  mocks.state = 'idle'; rerender(<ChatRoom />);
  expect(screen.queryByRole('button', { name: '수정하기' })).not.toBeInTheDocument();
  act(() => mocks.transcript('Small.'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(3));
  expect(screen.getAllByRole('button', { name: '수정하기' })).toHaveLength(1);
});

const hint = () => new Response(JSON.stringify({ sentence: 'I would like a latte, please.', keywords: ['would like', 'latte'] }));
it('추천은 키워드부터 공개하고 재추천은 추가 호출 없이 같은 예문을 보여준다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockResolvedValueOnce(hint()).mockResolvedValueOnce(reply('Tea, sure!'));
  vi.stubGlobal('fetch', fetcher); render(<ChatRoom />);
  fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '답변 추천 ✦' }));
  expect(await screen.findByText('would like')).toBeInTheDocument();
  expect(screen.queryByText('I would like a latte, please.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '마이크로 답하기' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '재추천 · 문장 보기' }));
  expect(screen.getByText('I would like a latte, please.')).toBeInTheDocument();
  expect(screen.queryByText('would like')).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(mocks.speak).toHaveBeenCalledTimes(1);
  act(() => mocks.transcript('Tea, please.'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[2][1].body).messages).toEqual([
    { role: 'assistant', content: 'Welcome!' }, { role: 'user', content: 'Tea, please.' },
  ]);
  expect(screen.getByText('I would like a latte, please.')).toBeInTheDocument();
});
it('키워드만 보고 답하면 예문을 나중에 공개하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockResolvedValueOnce(hint()).mockResolvedValueOnce(reply('What size?')));
  render(<ChatRoom />); fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '답변 추천 ✦' }));
  await screen.findByText('would like');
  act(() => mocks.transcript('A latte.'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2));
  expect(screen.getByText('would like')).toBeInTheDocument();
  expect(screen.queryByText('I would like a latte, please.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '재추천 · 문장 보기' })).not.toBeInTheDocument();
});
it('추천 요청 중 녹음하면 늦은 추천을 폐기한다', async () => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; })));
  const { rerender } = render(<ChatRoom />); fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '답변 추천 ✦' }));
  mocks.state = 'recording'; rerender(<ChatRoom />);
  await act(async () => resolve(hint()));
  expect(screen.queryByText('would like')).not.toBeInTheDocument();
});
it('추천 실패 후 재시도 가능하고 마이크도 사용할 수 있다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockResolvedValueOnce(new Response('{}', { status: 502 })).mockResolvedValueOnce(hint()));
  render(<ChatRoom />); fireEvent.click(screen.getByRole('button', { name: '대화 시작하기' }));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '답변 추천 ✦' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('추천을 불러오지');
  expect(screen.getByRole('button', { name: '마이크로 답하기' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '답변 추천 ✦' }));
  expect(await screen.findByText('would like')).toBeInTheDocument();
});

it('사용자 다시 듣기는 현재 표시된 수정 발화를 TTS로 재생한다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply('Welcome!')).mockResolvedValueOnce(reply('A latte?')).mockResolvedValueOnce(reply('Tea?')));
  render(<ChatRoom />);
  fireEvent.click(screen.getByText('대화 시작하기'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  act(() => mocks.transcript('A latte.'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2));
  const userButton = () => screen.getByText(/음성 인식 결과|수정한 발화/).closest('article')!.querySelector<HTMLButtonElement>('.message-actions button')!;
  fireEvent.click(userButton());
  expect(mocks.speak).toHaveBeenLastCalledWith('A latte.');
  fireEvent.click(screen.getByRole('button', { name: '수정하기' }));
  fireEvent.change(screen.getByLabelText('발화 수정'), { target: { value: 'Tea, please.' } });
  fireEvent.click(screen.getByText('수정 완료'));
  await waitFor(() => expect(mocks.speak).toHaveBeenLastCalledWith('Tea?'));
  fireEvent.click(userButton());
  expect(mocks.speak).toHaveBeenLastCalledWith('Tea, please.');
});

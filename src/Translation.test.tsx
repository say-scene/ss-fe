// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Translation from './Translation';
const props = { sessionId: 's', messageId: 'm', revision: 1, text: 'Hi' };
const result = { ...props, text: '안녕하세요' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('필요할 때 번역하고 재열기에는 캐시를 사용한다', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
  vi.stubGlobal('fetch', fetcher);
  render(<Translation {...props} />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '한글 번역' }));
  await screen.findByText('안녕하세요');
  fireEvent.click(screen.getByRole('button', { name: '한글 번역' }));
  expect(screen.queryByText('안녕하세요')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '한글 번역' }));
  expect(screen.getByText('안녕하세요')).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('실패 후 재시도할 수 있다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, json: async () => result }));
  render(<Translation {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '한글 번역' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '한글 번역' }));
  await screen.findByText('안녕하세요');
});
it('수정으로 컴포넌트가 교체되면 이전 요청을 취소하고 늦은 응답을 폐기한다', async () => {
  let resolve!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<Translation key="1" {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '한글 번역' }));
  const signal = fetcher.mock.calls[0][1].signal;
  view.rerender(<Translation key="2" {...props} revision={2} text="Bye" />);
  expect(signal.aborted).toBe(true);
  resolve({ ok: true, json: async () => result });
  await waitFor(() => expect(screen.queryByText('안녕하세요')).toBeNull());
});
it('버튼은 말풍선 밖에 두고 번역 본문만 안에 표시한다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => result }));
  render(<Translation {...props}>{(button, content) => <><div data-testid="bubble">Hi{content}</div><div>{button}</div></>}</Translation>);
  const button = screen.getByRole('button', { name: '한글 번역' });
  expect(screen.getByTestId('bubble').contains(button)).toBe(false);
  fireEvent.click(button);
  const translated = await screen.findByText('안녕하세요');
  expect(screen.getByTestId('bubble').contains(translated)).toBe(true);
  fireEvent.click(button);
  expect(screen.queryByText('안녕하세요')).toBeNull();
});

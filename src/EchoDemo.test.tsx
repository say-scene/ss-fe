// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import EchoDemo from './EchoDemo';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('입력을 전송하고 서버가 반환한 값만 결과에 표시한다', async () => {
  let resolve!: (r: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<EchoDemo />);
  fireEvent.change(screen.getByLabelText('보낼 문장'), { target: { value: '안녕!' } });
  fireEvent.click(screen.getByRole('button', { name: '백엔드로 보내기' }));
  expect(screen.getByRole('button', { name: '응답 기다리는 중…' })).toBeDisabled();
  expect(screen.queryByText('백엔드 응답 도착')).not.toBeInTheDocument();
  expect(fetchMock.mock.calls[0]).toEqual(['/api/v1/demo/echo', expect.objectContaining({ body: '{"message":"안녕!"}' })]);
  resolve(new Response(JSON.stringify({ message: '서버에서 돌려준 문장', source: 'Spring Boot', receivedAt: '2026-10-21T09:00:00Z' })));
  expect(await screen.findByText('서버에서 돌려준 문장')).toBeInTheDocument();
});
it('연결 실패를 표시하고 재전송을 허용한다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<EchoDemo />);
  fireEvent.click(screen.getByRole('button', { name: '백엔드로 보내기' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('백엔드 연결');
  expect(screen.getByRole('button', { name: '백엔드로 보내기' })).toBeEnabled();
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('응답을 기다리는 동안 중복 실행을 막고 모의 응답을 구별한다', async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /카페 대화 시작/ }));
  expect(screen.getByRole('button', { name: /답변을 준비/ })).toBeDisabled();
  resolve(new Response(JSON.stringify({ text: 'Welcome to our cafe!', mode: 'mock' })));
  expect(await screen.findByText('로컬 모의 응답 · 실제 AI 추론이 아닙니다')).toBeInTheDocument();
  expect(screen.queryByText('Welcome to our cafe!')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /영어 문장 보기/ }));
  expect(screen.getByText('Welcome to our cafe!')).toBeInTheDocument();
});
it('연결 실패 후 재시도할 수 있다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(
    new Response(JSON.stringify({ text: 'Hello!', mode: 'live' }))));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /카페 대화 시작/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('연결하지 못했어요');
  fireEvent.click(screen.getByRole('button', { name: /다시 시도/ }));
  expect(await screen.findByRole('button', { name: /영어 문장 보기/ })).toBeInTheDocument();
});

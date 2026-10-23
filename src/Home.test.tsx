// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Home from './Home';
import App from './App';
import { installSessionHarness } from './sessionTestHarness';
import { scenarios } from './scenarios';
afterEach(() => { cleanup(); window.location.hash = ''; vi.unstubAllGlobals(); });
it('10개 장소 중 선택하면 연결된 상황으로 시작한다', () => {
  const start = vi.fn(); render(<Home onStart={start} />);
  for (const scenario of scenarios) expect(screen.getByRole('button', { name: `${scenario.emoji} ${scenario.place}` })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '💻 IT 회사' }));
  expect(screen.getByRole('button', { name: /인프라 엔지니어 면접 보기/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '시작하기 →' }));
  expect(start).toHaveBeenCalledWith(scenarios[9]);
});
it('메인에서 선택한 상황의 첫 인사를 요청하고 종료하면 메인으로 돌아온다', async () => {
  window.location.hash = '#home';
  const inference = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'Welcome to the interview.', mode: 'live' })));
  installSessionHarness(inference);
  vi.stubGlobal('speechSynthesis', undefined);
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '💻 IT 회사' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '시작하기 →' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '시작하기 →' }));
  await waitFor(() => expect(inference).toHaveBeenCalledWith('/api/v1/demo/cafe?scenarioId=infra-interview', expect.anything()));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('인프라 엔지니어 면접 보기');
  fireEvent.click(screen.getByRole('button', { name: '대화 메뉴' }));
  fireEvent.click(screen.getByRole('button', { name: '대화 종료' }));
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('오늘은 어디에서'));
});
it('로고로 메인 이동 후 늦게 도착한 첫 인사를 표시하지 않는다', async () => {
  window.location.hash = '#chat/hotel-checkin';
  let finish!: (response: Response) => void;
  const inference = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  installSessionHarness(inference);
  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: '시작하기 →' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '시작하기 →' }));
  await waitFor(() => expect(inference).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('link', { name: 'Say Scene ●' }));
  await act(async () => finish(new Response(JSON.stringify({ text: 'Late greeting', mode: 'live' }))));
  expect(screen.getByRole('button', { name: '시작하기 →' })).toBeInTheDocument();
  expect(screen.queryByText('Late greeting')).not.toBeInTheDocument();
});

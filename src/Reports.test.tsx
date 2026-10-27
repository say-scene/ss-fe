// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { installSessionHarness } from './sessionTestHarness';
import { REPORT_KEY, readReports, saveReport, renameReport, deleteReport, type Report } from './reports';
import { NewReport, ReportLibrary } from './ReportView';
const mocks = vi.hoisted(() => ({ transcript: (_text: string) => {}, speak: vi.fn() }));
vi.mock('./useRecorder', () => ({ useRecorder: (callback: (text: string) => void) => {
  mocks.transcript = callback;
  return { state: 'idle', seconds: 0, error: '', start: vi.fn(), stopRecording: vi.fn(), reset: vi.fn() };
} }));
vi.mock('./useSpeech', () => ({ useSpeech: () => ({ playback: 'ended', speechError: '', speak: mocks.speak, stop: vi.fn() }) }));
const report: Report = { schemaVersion: 1, id: 'r', title: '카페 · 주문 · 2026-10-22 · 14:00:00', createdAt: '2026-10-22T05:00:00Z',
 snapshot: { sessionId: 's', scenarioId: 'cafe-order', messages: [{ messageId: 'a', revision: 1, role: 'assistant', text: 'Hi' }, { messageId: 'u', revision: 2, role: 'user', text: 'A latte.' }] },
 summary: ['잘했어요.', '자연스러워요.'], turns: [{ messageId: 'u', revision: 2, text: 'A latte.', explanationKo: '좋아요.', betterExpressionEn: 'A latte, please.' }] };
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  window.location.hash = '#chat';
});
afterEach(() => { cleanup(); window.location.hash = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); mocks.speak.mockClear(); });
it('저장을 눌러야 남고 다시보기에서 원문과 교정이 열린다', async () => {
  const view = render(<NewReport report={report} onExit={vi.fn()} />);
  expect(readReports()).toEqual([]);
  fireEvent.click(screen.getByText('리포트 저장'));
  await screen.findByText('저장 완료');
  expect(readReports()).toEqual([report]);
  view.unmount(); render(<ReportLibrary onExit={vi.fn()} />);
  fireEvent.click(await screen.findByText(report.title));
  expect(screen.getByText('좋아요.')).toBeInTheDocument();
  expect(screen.getByText('A latte.')).toBeInTheDocument();
});
it('중복 ID/제목을 막고 제목 수정 뒤에도 생성 시각 정렬을 유지한다', async () => {
  await saveReport(report);
  await expect(saveReport(report)).rejects.toThrow('이미 저장');
  await expect(saveReport({ ...report, id: 'other' })).rejects.toThrow('같은 제목');
  await saveReport({ ...report, id: 'new', title: '새 대화', createdAt: '2026-10-23T05:00:00Z' });
  await renameReport('r', '수정된 제목');
  expect(readReports().map(r => r.id)).toEqual(['new', 'r']);
  expect(readReports()[1].createdAt).toBe(report.createdAt);
  await expect(renameReport('r', '새 대화')).rejects.toThrow('같은 제목');
  await deleteReport('r'); expect(readReports()).toHaveLength(1);
});
it('손상된 저장소와 용량 초과를 성공으로 표시하지 않는다', async () => {
  localStorage.setItem(REPORT_KEY, 'broken');
  await expect(saveReport(report)).rejects.toThrow();
  expect(localStorage.getItem(REPORT_KEY)).toBe('broken');
  localStorage.setItem(REPORT_KEY, '[]');
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  render(<NewReport report={report} onExit={vi.fn()} />);
  fireEvent.click(screen.getByText('리포트 저장'));
  expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했어요');
  expect(screen.queryByText('저장 완료')).toBeNull();
});
async function converse(fetcher: ReturnType<typeof vi.fn>) {
  installSessionHarness(fetcher); render(<App />);
  await waitFor(() => expect(screen.getByText('시작하기 →')).toBeEnabled());
  fireEvent.click(screen.getByText('시작하기 →'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1));
  act(() => mocks.transcript('A latte.'));
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByLabelText('대화 메뉴'));
  fireEvent.click(screen.getByText('대화 종료'));
}
const reply = () => new Response(JSON.stringify({ text: 'Welcome!', mode: 'live' }));
it('대화 종료 스냅샷으로 한 번 생성하고 자동 저장하지 않는다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply()).mockImplementationOnce(async (_url, init) => {
    const snapshot = JSON.parse(init.body); const user = snapshot.messages[1];
    return new Response(JSON.stringify({ sessionId: snapshot.sessionId, summary: report.summary, turns: [{ ...user, explanationKo: '좋아요.', betterExpressionEn: 'A latte, please.' }] }));
  });
  await converse(fetcher);
  await screen.findByText('대화 총평');
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[2][0]).toBe('/api/v1/report');
  const body = JSON.parse(fetcher.mock.calls[2][1].body);
  expect(body.messages.map((m: any) => m.role)).toEqual(['assistant', 'user', 'assistant']);
  expect(readReports()).toEqual([]);
});
it('생성 실패는 안내와 함께 메인으로 이동하고 저장하지 않는다', async () => {
  await converse(vi.fn().mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply()).mockRejectedValueOnce(new Error('offline')));
  await screen.findByText('리포트를 생성하지 못했습니다. 이번 대화는 저장되지 않았습니다.');
  expect(screen.getByText('시작하기 →')).toBeInTheDocument();
  expect(readReports()).toEqual([]);
});
it('생성 중 나가기 후 늦은 응답이 화면을 바꾸지 않는다', async () => {
  let finish!: (r: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply()).mockImplementationOnce(() => new Promise<Response>(r => { finish = r; }));
  await converse(fetcher);
  fireEvent.click(await screen.findByText('나가기'));
  expect(fetcher.mock.calls[2][1].signal.aborted).toBe(true);
  await act(async () => finish(new Response('{}')));
  expect(screen.getByText('시작하기 →')).toBeInTheDocument();
  expect(screen.queryByText('대화 총평')).toBeNull();
});
it('AI 맥락은 항상 보이고 동일한 추천 문장은 Great만 표시한다', () => {
  render(<NewReport report={{ ...report, turns: [{ ...report.turns[0], betterExpressionEn: ' A latte. ' }] }} onExit={vi.fn()} />);
  expect(screen.getByText('Hi')).toBeVisible();
  expect(screen.queryByText('앞선 AI 대화 보기')).not.toBeInTheDocument();
  expect(screen.getByText('Great!')).toBeInTheDocument();
  expect(screen.queryByText('더 자연스러운 표현')).not.toBeInTheDocument();
  expect(screen.queryByText('좋아요.')).not.toBeInTheDocument();
});
it('상단을 유지하며 제목을 수정하고 확인 팝업에서 취소 또는 삭제한다', async () => {
  await saveReport(report);
  render(<ReportLibrary onExit={vi.fn()} />);
  const dialog = screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement;
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => dialog.removeAttribute('open');
  const heading = screen.getByRole('heading', { name: 'Report 다시보기' });
  fireEvent.click(await screen.findByText(report.title));
  expect(screen.getByRole('heading', { name: 'Report 다시보기' })).toBe(heading);
  fireEvent.click(screen.getByRole('button', { name: '제목 수정' }));
  fireEvent.change(screen.getByLabelText('리포트 제목'), { target: { value: '오늘의 카페' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 완료' }));
  await screen.findByRole('heading', { name: '오늘의 카페' });
  fireEvent.click(screen.getByRole('button', { name: '리포트 삭제' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(readReports()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '리포트 삭제' }));
  fireEvent.click(screen.getByRole('button', { name: /^삭제$/ }));
  await screen.findByText('저장한 리포트가 없어요.');
  expect(readReports()).toHaveLength(0);
});
it('Great 비율이 80% 이상일 때만 총평에 도장을 표시한다', () => {
  const turns = Array.from({ length: 5 }, (_, i) => ({ ...report.turns[0], messageId: `u${i}`, betterExpressionEn: i < 4 ? report.turns[0].text : 'Another expression.' }));
  const view = render(<NewReport report={{ ...report, turns }} onExit={vi.fn()} />);
  expect(screen.getByAltText('Great! 전체 발화의 80% 이상이 추천 표현과 같아요.')).toBeInTheDocument();
  view.rerender(<NewReport report={{ ...report, turns: turns.map((turn, i) => i === 3 ? { ...turn, betterExpressionEn: 'Different.' } : turn) }} onExit={vi.fn()} />);
  expect(screen.queryByAltText('Great! 전체 발화의 80% 이상이 추천 표현과 같아요.')).not.toBeInTheDocument();
  view.rerender(<NewReport report={{ ...report, turns: [] }} onExit={vi.fn()} />);
  expect(screen.queryByAltText('Great! 전체 발화의 80% 이상이 추천 표현과 같아요.')).not.toBeInTheDocument();
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ExpressionTools from './ExpressionTools';
import { lookupExpression, readExpressions, saveExpression, deleteExpression, VOCAB_KEY } from './vocabulary';
const source = { sessionId: 'session', messageId: 'message', revision: 1, role: 'assistant', scenarioId: 'cafe-order' };
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not configured')));
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
  });
  if (!Range.prototype.getClientRects) Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([{ left: 100, top: 100, width: 80, bottom: 120 }] as unknown as DOMRectList);
});
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  render(<><p data-expression-id="message" data-role="assistant">I would like a hot latte, please.</p><p data-expression-id="other">Another sentence.</p><p>Outside bubble</p><ExpressionTools sessionId="session" scenarioId="cafe-order" open={false} onClose={() => {}} /></>);
}
async function select(from: Node, start: number, to: Node, end: number) {
  const range = document.createRange(); range.setStart(from, start); range.setEnd(to, end);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
}
it('선택한 여러 단어를 메뉴로 저장하며 원문과 출처를 보존한다', async () => {
  setup(); const node = screen.getByText('I would like a hot latte, please.').firstChild!;
  await select(node, 2, node, node.textContent!.indexOf(','));
  fireEvent.pointerDown(screen.getByRole('button', { name: '＋ 표현 저장' }));
  fireEvent.click(screen.getByRole('button', { name: '＋ 표현 저장' }));
  expect(await screen.findByRole('status')).toHaveTextContent('저장했습니다');
  const saved = readExpressions()[0];
  expect(saved.expression).toBe('would like a hot latte');
  expect(saved.example).toBe('I would like a hot latte, please.');
  expect(saved.source).toEqual(source);
});
it('서로 다른 말풍선 또는 말풍선 밖 선택에는 저장 메뉴가 없다', async () => {
  setup(); const a = screen.getByText('I would like a hot latte, please.').firstChild!;
  const b = screen.getByText('Another sentence.').firstChild!;
  await select(a, 0, b, 5);
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  const outside = screen.getByText('Outside bubble').firstChild!;
  await select(outside, 0, outside, 7);
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
});
it('중복 표현은 대소문자와 공백을 정규화하고 최초 저장 문장을 유지한다', async () => {
  expect(await saveExpression(' Would   like ', 'first example', source)).toBe(true);
  expect(await saveExpression('would like', 'changed example', { ...source, revision: 2 })).toBe(false);
  expect(readExpressions()).toHaveLength(1);
  expect(readExpressions()[0].example).toBe('first example');
});
it('손상된 저장소는 덮어쓰지 않고 오류를 알린다', async () => {
  window.localStorage.setItem(VOCAB_KEY, '{invalid');
  await expect(saveExpression('latte', 'example', source)).rejects.toThrow();
  expect(window.localStorage.getItem(VOCAB_KEY)).toBe('{invalid');
});
it('저장 공간 오류에 성공 메시지를 표시하지 않는다', async () => {
  setup(); const node = screen.getByText('I would like a hot latte, please.').firstChild!;
  await select(node, 0, node, 6);
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
  fireEvent.click(screen.getByRole('button', { name: '＋ 표현 저장' }));
  expect(await screen.findByRole('status')).toHaveTextContent('저장하지 못했어요');
});

it('저장 목록을 다시 읽어도 유지되며 선택 항목만 삭제한다', async () => {
  await saveExpression('latte', 'A latte, please.', source);
  await saveExpression('tea', 'Tea, please.', source);
  const saved = readExpressions();
  expect(readExpressions()).toEqual(saved);
  await deleteExpression(saved[0].id);
  expect(readExpressions().map(item => item.expression)).toEqual(['tea']);
});

const details = { meaningKo: '라테', partOfSpeech: '명사', exampleKo: '라테 한 잔 주세요.' };
it('기존 저장 항목의 뜻을 조회하고 캐시하며 최초 원문과 출처를 유지한다', async () => {
  await saveExpression('latte', 'A latte, please.', source);
  const original = readExpressions()[0];
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...details, expression: 'latte', example: original.example })));
  vi.stubGlobal('fetch', fetcher);
  await lookupExpression(original.id);
  await lookupExpression(original.id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(readExpressions()[0]).toEqual({ ...original, details });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() });
  render(<ExpressionTools sessionId="home" scenarioId="cafe-order" open={true} onClose={vi.fn()} />);
  expect(await screen.findByText('명사')).toBeInTheDocument();
  expect(screen.getByText('라테 한 잔 주세요.')).toBeInTheDocument();
});
it('조회 실패에도 표현을 유지하고 재시도할 수 있다', async () => {
  await saveExpression('latte', 'A latte, please.', source);
  const item = readExpressions()[0];
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ ...details, expression: item.expression, example: item.example })));
  vi.stubGlobal('fetch', fetcher);
  await expect(lookupExpression(item.id)).rejects.toThrow();
  expect(readExpressions()[0]).toEqual(item);
  await lookupExpression(item.id);
  expect(readExpressions()[0].details).toEqual(details);
});
it('조회 중 삭제한 표현을 늦은 응답이 되살리지 않는다', async () => {
  await saveExpression('latte', 'A latte, please.', source);
  const item = readExpressions()[0];
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = lookupExpression(item.id);
  expect(lookupExpression(item.id)).toBe(pending);
  await deleteExpression(item.id);
  finish(new Response(JSON.stringify({ ...details, expression: item.expression, example: item.example })));
  await pending;
  expect(readExpressions()).toEqual([]);
});
it('잘못된 조회 응답은 저장하지 않는다', async () => {
  await saveExpression('latte', 'A latte, please.', source);
  const item = readExpressions()[0];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ meaningKo: '라테', expression: item.expression, example: item.example }))));
  await expect(lookupExpression(item.id)).rejects.toThrow();
  expect(readExpressions()[0].details).toBeUndefined();
});

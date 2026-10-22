export const VOCAB_KEY = 'sayscene:v1:vocabulary';
export type Expression = {
  id: string; schemaVersion: 1; expression: string; example: string; createdAt: string;
  source: { sessionId: string; messageId: string; revision: number; role: string; scenarioId: string };
};
export const expressionKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export function readExpressions(): Expression[] {
  const raw = window.localStorage.getItem(VOCAB_KEY);
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || !data.every(item => item && item.schemaVersion === 1
    && typeof item.id === 'string' && typeof item.expression === 'string' && item.expression.trim()
    && typeof item.example === 'string' && typeof item.createdAt === 'string' && item.source
    && typeof item.source.messageId === 'string' && typeof item.source.sessionId === 'string'
    && typeof item.source.revision === 'number' && typeof item.source.role === 'string'
    && typeof item.source.scenarioId === 'string')) throw new Error('invalid vocabulary');
  return data;
}
// 지원 브라우저에서는 다른 탭의 저장·삭제와 직렬화한다.
async function update<T>(action: () => T): Promise<T> {
  return navigator.locks ? navigator.locks.request(VOCAB_KEY, action) : action();
}
export function saveExpression(expression: string, example: string, source: Expression['source']) {
  return update(() => {
    if (!expression.trim()) throw new Error('empty expression');
    const items = readExpressions();
    if (items.some(item => expressionKey(item.expression) === expressionKey(expression))) return false;
    items.push({ id: crypto.randomUUID(), schemaVersion: 1, expression: expression.trim(), example,
      source, createdAt: new Date().toISOString() });
    window.localStorage.setItem(VOCAB_KEY, JSON.stringify(items));
    return true;
  });
}
export function deleteExpression(id: string) {
  return update(() => window.localStorage.setItem(VOCAB_KEY, JSON.stringify(readExpressions().filter(item => item.id !== id))));
}

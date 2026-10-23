export const VOCAB_KEY = 'sayscene:v1:vocabulary';
export type ExpressionDetails = { meaningKo: string; partOfSpeech: string; exampleKo: string };
export type Expression = {
  details?: ExpressionDetails;
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
    && typeof item.source.scenarioId === 'string'
    && (item.details === undefined || validDetails(item.details)))) throw new Error('invalid vocabulary');
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

export function validDetails(value: unknown): value is ExpressionDetails {
  if (!value || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return ['meaningKo', 'partOfSpeech', 'exampleKo'].every(key => typeof fields[key] === 'string' && !!(fields[key] as string).trim());
}
// 저장한 표현을 먼저 보존한다. 조회 실패는 원문 저장을 취소하지 않는다.
const lookups = new Map<string, Promise<void>>();
export function lookupExpression(id: string): Promise<void> {
  const existing = lookups.get(id);
  if (existing) return existing;
  const pending = loadDetails(id).finally(() => lookups.delete(id));
  lookups.set(id, pending);
  return pending;
}
async function loadDetails(id: string) {
  const item = readExpressions().find(item => item.id === id);
  if (!item || item.details) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 190000);
  try {
    const response = await fetch('/api/v1/lookup', { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expression: item.expression, example: item.example }) });
    const data = await response.json();
    if (!response.ok || data?.expression !== item.expression || data?.example !== item.example || !validDetails(data)) throw new Error('invalid lookup');
    await update(() => {
      const items = readExpressions();
      const target = items.find(current => current.id === id);
      // 조회 중 삭제된 표현은 되살리지 않고, 이미 저장된 뜻도 덮어쓰지 않는다.
      if (!target || target.details) return;
      target.details = { meaningKo: data.meaningKo.trim(), partOfSpeech: data.partOfSpeech.trim(), exampleKo: data.exampleKo.trim() };
      window.localStorage.setItem(VOCAB_KEY, JSON.stringify(items));
    });
  } finally { clearTimeout(timeout); }
}

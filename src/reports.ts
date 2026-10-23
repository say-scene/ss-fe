export type ReportMessage = { messageId: string; revision: number; role: 'assistant' | 'user'; text: string };
export type ReportSnapshot = { sessionId: string; scenarioId: string; messages: ReportMessage[] };
export type ReportTurn = { messageId: string; revision: number; text: string; explanationKo: string; betterExpressionEn: string };
export type Report = { schemaVersion: 1; id: string; title: string; createdAt: string; snapshot: ReportSnapshot; summary: string[]; turns: ReportTurn[] };
export const REPORT_KEY = 'sayscene:v1:reports';
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
export function validReview(data: any, snapshot: ReportSnapshot): boolean {
  const users = snapshot.messages.filter(m => m.role === 'user');
  return data?.sessionId === snapshot.sessionId && Array.isArray(data.summary) && data.summary.length >= 2 && data.summary.length <= 3
    && data.summary.every(nonempty) && Array.isArray(data.turns) && data.turns.length === users.length
    && data.turns.every((turn: any, i: number) => turn?.messageId === users[i].messageId && turn.revision === users[i].revision
      && turn.text === users[i].text && nonempty(turn.explanationKo) && nonempty(turn.betterExpressionEn));
}
export function readReports(): Report[] {
  const raw = window.localStorage.getItem(REPORT_KEY);
  if (!raw) return [];
  const items = JSON.parse(raw);
  if (!Array.isArray(items) || !items.every(item => item?.schemaVersion === 1 && nonempty(item.id) && nonempty(item.title)
    && nonempty(item.createdAt) && Number.isFinite(Date.parse(item.createdAt)) && nonempty(item.snapshot?.sessionId)
    && nonempty(item.snapshot?.scenarioId) && Array.isArray(item.snapshot?.messages)
    && item.snapshot.messages.every((m: any) => nonempty(m?.messageId) && Number.isInteger(m.revision) && m.revision > 0
      && ['user', 'assistant'].includes(m.role) && nonempty(m.text))
    && validReview({ ...item, sessionId: item.snapshot.sessionId }, item.snapshot))) throw new Error('invalid reports');
  return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
async function update(action: () => void) {
  if (navigator.locks) await navigator.locks.request(REPORT_KEY, action); else action();
}
export function saveReport(report: Report) {
  return update(() => {
    const items = readReports();
    if (items.some(item => item.id === report.id)) throw new Error('이미 저장한 리포트입니다.');
    if (items.some(item => item.title === report.title)) throw new Error('같은 제목의 리포트가 있어 저장하지 않았습니다.');
    window.localStorage.setItem(REPORT_KEY, JSON.stringify([...items, report]));
  });
}
export function renameReport(id: string, title: string) {
  return update(() => {
    const items = readReports(); title = title.trim();
    if (!title) throw new Error('제목을 입력해주세요.');
    if (!items.some(item => item.id === id)) throw new Error('리포트를 찾을 수 없습니다.');
    if (items.some(item => item.id !== id && item.title === title)) throw new Error('같은 제목이 이미 있습니다.');
    window.localStorage.setItem(REPORT_KEY, JSON.stringify(items.map(item => item.id === id ? { ...item, title } : item)));
  });
}
export function deleteReport(id: string) {
  return update(() => window.localStorage.setItem(REPORT_KEY, JSON.stringify(readReports().filter(item => item.id !== id))));
}

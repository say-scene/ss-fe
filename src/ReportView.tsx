import { useEffect, useState } from 'react';
import { deleteReport, readReports, renameReport, REPORT_KEY, saveReport, type Report } from './reports';
import './report.css';

function Content({ report }: { report: Report }) {
  return <><h1>{report.title}</h1><p className="report-time">{new Date(report.createdAt).toLocaleString('ko-KR')}</p>
    <section className="report-summary"><h2>대화 총평</h2>{report.summary.map((line, i) => <p key={i}>{line}</p>)}</section>
    <h2>내 발화 돌아보기</h2>{report.turns.map(turn => {
      const index = report.snapshot.messages.findIndex(m => m.messageId === turn.messageId);
      const context = report.snapshot.messages[index - 1];
      return <article className="report-turn" key={turn.messageId}>
        {context?.role === 'assistant' && <p className="report-context"><small>AI · 대화 맥락</small><br/><span lang="en">{context.text}</span></p>}
        <h3>내가 말한 문장</h3><p lang="en">{turn.text}</p><p>{turn.explanationKo}</p>
        <h3>더 자연스러운 표현</h3><p lang="en">{turn.betterExpressionEn}</p>
      </article>;
    })}</>;
}
export function NewReport({ report, onExit }: { report: Report | null; onExit: () => void }) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!report || saving || saved) return;
    setSaving(true); setError('');
    try { await saveReport(report); setSaved(true); }
    catch (e) { setError(e instanceof Error && /이미|같은 제목/.test(e.message) ? e.message : '저장하지 못했어요. 브라우저 저장 공간을 확인해주세요.'); }
    finally { setSaving(false); }
  }
  return <main className="report-shell">
    {report ? <Content report={report} /> : <><h1>대화 리포트</h1><p role="status">리포트를 만들고 있어요. 로컬 모델에서는 시간이 걸릴 수 있어요.</p></>}
    {error && <p role="alert">{error}</p>}
    {report && <p>저장하면 대화 원문과 교정 내용이 이 브라우저에 보관됩니다. 저장 전 나가면 리포트는 남지 않습니다.</p>}
    <footer>{report && <button disabled={saved || saving} onClick={save}>{saved ? '저장 완료' : saving ? '저장 중…' : '리포트 저장'}</button>}<button onClick={onExit}>나가기</button></footer>
  </main>;
}
export function ReportLibrary({ onExit }: { onExit: () => void }) {
  const [items, setItems] = useState<Report[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function reload() { try { setItems(readReports()); setError(''); } catch { setError('저장된 리포트를 읽지 못했어요. 기존 데이터는 변경하지 않았습니다.'); } }
  useEffect(() => { reload(); const sync = (event: StorageEvent) => { if (!event.key || event.key === REPORT_KEY) reload(); };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync); }, []);
  const report = items.find(item => item.id === selected);
  async function change(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await action(); reload(); } catch (e) { setError(e instanceof Error && /제목|찾을 수/.test(e.message) ? e.message : '리포트를 변경하지 못했어요. 저장 공간을 확인해주세요.'); }
    finally { setBusy(false); }
  }
  return <main className="report-shell"><header><button onClick={onExit}>← 메인으로</button>{report && <button onClick={() => setSelected(null)}>목록으로</button>}</header>
    {error && <p role="alert">{error}</p>}
    {report ? <><Content report={report} /><form onSubmit={event => { event.preventDefault(); void change(() => renameReport(report.id, title)); }}>
      <label htmlFor="report-title">리포트 제목</label><input id="report-title" value={title} onChange={event => setTitle(event.target.value)} />
      <button disabled={busy || !title.trim()}>제목 수정</button></form><button disabled={busy} onClick={() => { if (window.confirm('저장된 리포트를 삭제할까요?')) void change(() => deleteReport(report.id)); }}>리포트 삭제</button></>
      : <><h1>Report 다시보기</h1><p>최신순 · 이 브라우저에 저장한 리포트</p>{!items.length && !error && <p>저장한 리포트가 없어요.</p>}
        <ul className="report-list">{items.map(item => <li key={item.id}><button onClick={() => { setSelected(item.id); setTitle(item.title); }}><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString('ko-KR')}</small></button></li>)}</ul></>}
  </main>;
}

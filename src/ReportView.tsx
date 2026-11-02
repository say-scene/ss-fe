import { useEffect, useRef, useState, type ReactNode } from 'react';
import { deleteReport, readReports, renameReport, REPORT_KEY, saveReport, type Report } from './reports';
import IconButton from './IconButton';
import './report.css';

function Content({ report, titleEditor }: { report: Report; titleEditor?: ReactNode }) {
  const greatCount = report.turns.filter(turn => turn.text.trim() === turn.betterExpressionEn.trim()).length;
  const showStamp = report.turns.length > 0 && greatCount / report.turns.length >= 0.8;
  return <>
    <div className="report-heading">
      <span className="report-eyebrow">대화 리포트</span>
      <div className="report-title-row">{titleEditor ?? <h1>{report.title}</h1>}</div>
      <div className="report-meta"><time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleString('ko-KR')}</time><span>내 발화 {report.turns.length}개</span></div>
    </div>
    <section className="report-summary"><div className="report-summary-copy"><h2>대화 총평</h2>{report.summary.map((line, i) => <p key={i}>{line}</p>)}</div>{showStamp && <img className="report-great-stamp" src="/report-great-stamp.png" alt="Great! 전체 발화의 80% 이상이 추천 표현과 같아요." />}</section>
    <div className="report-section-heading"><h2>문장 노트</h2></div>
    {report.turns.map((turn, turnIndex) => {
      const index = report.snapshot.messages.findIndex(m => m.messageId === turn.messageId);
      const context = report.snapshot.messages[index - 1];
      const great = turn.text.trim() === turn.betterExpressionEn.trim();
      return <article className="report-turn" key={turn.messageId}>
        <h3 className="report-turn-heading" aria-label={`문장 ${turnIndex + 1}`}><span>{String(turnIndex + 1).padStart(2, '0')}</span></h3>
        {context?.role === 'assistant' && <div className="report-context"><span className="report-ai-label">AI</span><p lang="en">{context.text}</p></div>}
        <div className="report-comparison">
          <div className="report-original"><p lang="en">{turn.text}</p>{great && <span className="report-great" lang="en">Great!</span>}</div>
          {!great && <div className="report-better"><h4>더 자연스러운 표현</h4><p lang="en">{turn.betterExpressionEn}</p></div>}
        </div>
        {!great && <p className="report-explanation">{turn.explanationKo}</p>}
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
  return <main className="report-shell report-result">
    <div className="report-topline"><span className="report-brand">Say<span>Scene</span></span><span>대화 돌아보기</span></div>
    <div className="report-paper">
    {report ? <Content report={report} /> : <section className="report-loading" aria-busy="true"><span className="report-eyebrow">대화 완료</span><h1>대화를 돌아보고 있어요</h1><p role="status">리포트를 만들고 있어요. 잠시만 기다려주세요.</p><div className="report-skeleton" aria-hidden="true"><span/><span/><span/></div></section>}
    {error && <p role="alert">{error}</p>}
    <footer className="report-actions">
      {report && <p role={saved ? 'status' : undefined}>{saved ? '이 브라우저에 저장했어요. Report 다시보기에서 확인할 수 있어요.' : '저장하면 원문과 교정 내용이 이 브라우저에 남아요. 저장 전 나가면 리포트는 사라져요.'}</p>}
      <div><button onClick={onExit}>나가기</button>{report && <button className="report-save" disabled={saved || saving} onClick={save}>{saved ? '저장 완료' : saving ? '저장 중…' : '리포트 저장'}</button>}</div>
    </footer>
    </div>
  </main>;
}
export function ReportLibrary({ onExit }: { onExit: () => void }) {
  const [items, setItems] = useState<Report[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteDialog = useRef<HTMLDialogElement>(null);
  function reload() { try { setItems(readReports()); setError(''); } catch { setError('저장된 리포트를 읽지 못했어요. 기존 데이터는 변경하지 않았습니다.'); } }
  useEffect(() => { reload(); const sync = (event: StorageEvent) => { if (!event.key || event.key === REPORT_KEY) reload(); };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync); }, []);
  const report = items.find(item => item.id === selected);
  async function change(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await action(); reload(); setEditing(false); } catch (e) { setError(e instanceof Error && /제목|찾을 수/.test(e.message) ? e.message : '리포트를 변경하지 못했어요. 저장 공간을 확인해주세요.'); }
    finally { setBusy(false); }
  }
  return <div className="report-layout">
    <aside className="chat-sidebar report-sidebar" aria-label="리포트 안내">
      <a className="wordmark" href="#home">Say<span>Scene</span><i>●</i></a>
      <div className="sidebar-label">나의 학습 기록</div>
      <div className="current-scene"><span aria-hidden="true">📝</span><div>대화 리포트<small>나눈 대화와 배운 표현</small></div></div>
      <div className="scene-guide"><span className="eyebrow">YOUR NOTES</span><h2>지난 대화 속에서<br/>다음 표현을 찾아요.</h2><p>함께 나눈 대화를 돌아보고<br/>더 자연스러운 표현을 익혀보세요.</p></div>
      <div className="sidebar-bottom"><img src="/sayscene-logo.png" alt="SayScene 말풍선 친구"/><p>완벽하지 않아도 괜찮아요.<br/>한 장면씩, 나만의 속도로.</p></div>
    </aside>
    <main className={`report-shell report-library-page${report ? " is-detail" : ""}`}>
    <header className="report-library-header">
      <IconButton label="메인으로" onClick={onExit}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/></svg></IconButton>
      <h1 id="report-library-title">Report 다시보기</h1>
      {report && <IconButton className="report-list-toggle" label="목록으로" onClick={() => { setSelected(null); setEditing(false); setError(''); }}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h10"/></svg></IconButton>}
    </header>
    <div className="report-library-body">
    {error && <p role="alert">{error}</p>}
    {report ? <div className="report-detail">
      <div className="report-paper"><Content report={report} titleEditor={editing ? <form className="report-title-form" onSubmit={event => { event.preventDefault(); void change(() => renameReport(report.id, title)); }}>
        <label htmlFor="report-title">리포트 제목</label><input autoFocus id="report-title" value={title} onChange={event => setTitle(event.target.value)} />
        <IconButton type="submit" label="수정 완료" disabled={busy || !title.trim()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></IconButton><IconButton type="button" label="취소" disabled={busy} onClick={() => setEditing(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></IconButton>
      </form> : <><h2>{report.title}</h2><IconButton label="제목 수정" onClick={() => { setTitle(report.title); setEditing(true); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15Z"/></svg></IconButton></>} /></div>
      <div className="report-delete-row"><IconButton label="리포트 삭제" disabled={busy} onClick={() => { setDeleteError(''); deleteDialog.current?.showModal(); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></IconButton></div>
    </div>
      : <section className="report-library" aria-labelledby="report-library-title">
        <p className="report-library-description">함께 나눈 대화와 배운 표현을 다시 살펴보세요.</p>
        <div className="report-library-meta"><span>저장한 리포트 {items.length}개</span><span>최신순</span></div>
        {!items.length && !error && <div className="report-empty"><h2>저장한 리포트가 없어요.</h2><p>대화를 마친 뒤 리포트를 저장하면<br/>이곳에서 다시 볼 수 있어요.</p><button onClick={onExit}>대화하러 가기 →</button></div>}
        <ul className="report-list">{items.map(item => <li key={item.id}><button onClick={() => { setSelected(item.id); setTitle(item.title); }}>
          <span className="report-list-content"><strong>{item.title}</strong><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ko-KR')}</time></span><span className="report-list-arrow" aria-hidden="true">↗</span>
        </button></li>)}</ul>
        <p className="report-library-note">이 브라우저에 저장한 리포트예요.</p>
      </section>}

    </div>
    <dialog ref={deleteDialog} className="report-delete-dialog" aria-labelledby="report-delete-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="report-delete-title">정말 삭제하시겠습니까?</h2><p>삭제한 리포트는 되돌릴 수 없어요.</p>
      {deleteError && <p role="alert">{deleteError}</p>}
      <div><button autoFocus disabled={busy} onClick={() => deleteDialog.current?.close()}>취소</button><button className="report-confirm-delete" disabled={busy} onClick={async () => {
        if (!report || busy) return;
        setBusy(true); setDeleteError('');
        try { await deleteReport(report.id); reload(); setSelected(null); setEditing(false); deleteDialog.current?.close(); }
        catch { setDeleteError('삭제하지 못했어요. 다시 시도해주세요.'); }
        finally { setBusy(false); }
      }}>{busy ? '삭제 중…' : '삭제'}</button></div>
    </dialog>
  </main></div>;
}

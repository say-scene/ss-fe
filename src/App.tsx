import { useEffect, useRef, useState } from 'react';
import ChatRoom from './ChatRoom';
import Home from './Home';
import { NewReport, ReportLibrary } from './ReportView';
import { validReview, type Report, type ReportSnapshot } from './reports';
import { useConversation } from './useConversation';
import { scenarios, type Scenario } from './scenarios';

export default function App() {
  const conversation = useConversation();
  const [route, setRoute] = useState(window.location.hash);
  const [report, setReport] = useState<Report | null>(null);
  const [notice, setNotice] = useState('');
  const ending = useRef(false);
  const reportRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { reportRequest.current?.abort(); reportRequest.current = null; }, []);
  useEffect(() => {
    if (route !== '#report') { reportRequest.current?.abort(); reportRequest.current = null; setReport(null); }
  }, [route]);
  useEffect(() => {
    const update = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const previousRoute = useRef(route);
  useEffect(() => {
    if (previousRoute.current.startsWith('#chat') && !route.startsWith('#chat')) conversation.release();
    previousRoute.current = route;
  }, [route]);
  const navigate = (hash: string) => { window.location.hash = hash; setRoute(hash); };
  async function endConversation(snapshot: ReportSnapshot) {
    if (ending.current || reportRequest.current) return;
    ending.current = true;
    if (!await conversation.end()) { ending.current = false; return; }
    setNotice(''); setReport(null);
    if (!snapshot.messages.some(m => m.role === 'user')) { setNotice('아직 사용자 발화가 없어 리포트를 만들지 않았어요.'); navigate('#home'); return; }
    const controller = new AbortController(); reportRequest.current = controller;
    const createdAt = new Date().toISOString();
    navigate('#report');
    const timeout = setTimeout(() => controller.abort(), 190000);
    try {
      const response = await fetch('/api/v1/report', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) });
      const data = await response.json();
      if (!response.ok || !validReview(data, snapshot)) throw new Error('invalid report');
      if (reportRequest.current !== controller || controller.signal.aborted) return;
      const scenario = scenarios.find(item => item.id === snapshot.scenarioId)!;
      const date = new Date(createdAt);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const time = date.toLocaleTimeString('en-GB', { hour12: false });
      setReport({ schemaVersion: 1, id: crypto.randomUUID(), title: `${scenario.place} · ${scenario.situation} · ${day} · ${time}`,
        createdAt, snapshot, summary: data.summary, turns: data.turns });
    } catch {
      if (reportRequest.current === controller) { setNotice('리포트를 생성하지 못했습니다. 이번 대화는 저장되지 않았습니다.'); navigate('#home'); }
    } finally { clearTimeout(timeout); if (reportRequest.current === controller) reportRequest.current = null; }
  }
  const leaveReport = () => { reportRequest.current?.abort(); reportRequest.current = null; setReport(null); navigate('#home'); };
  if (route === '#reports') return <ReportLibrary onExit={leaveReport} />;
  if (route === '#report') return report || reportRequest.current ? <NewReport report={report} onExit={leaveReport} /> : <main className="report-shell"><p>저장하지 않은 리포트는 남아 있지 않습니다.</p><button onClick={leaveReport}>메인으로</button></main>;
  async function start(item: Scenario) {
    if (conversation.local.active && !window.confirm('새 대화를 시작하면 진행 중인 대화가 삭제됩니다. 새로 시작할까요?')) return;
    if (await conversation.start(item.id)) { ending.current = false; setNotice(''); navigate(`#chat/${item.id}`); }
  }
  async function resume() {
    if (await conversation.resume()) {
      const active = conversation.local.active;
      if (active) navigate(`#chat/${active.scenarioId}`);
    }
  }
  const active = conversation.local.active;
  const scenario = scenarios.find(item => item.id === active?.scenarioId);
  const error = conversation.error && <p role="alert" className="report-shell">{conversation.error}<button onClick={() => { conversation.release(); void conversation.refresh().catch(() => {}); }}>연결 다시 확인</button></p>;
  if (route.startsWith('#chat') && active && scenario) return <>{error}{conversation.owner
    ? <ChatRoom key={`${active.sessionId}:active`} scenario={scenario} onEnd={endConversation} onExit={() => navigate('#home')}
        managed={{ local: conversation.local, generate: conversation.generate, saveUi: conversation.saveUi,
          registerCleanup: cleanup => { conversation.cleanupChat.current = cleanup; }, restart: () => { void start(scenario); } }} />
    : <ChatRoom key={`${active.sessionId}:paused`} scenario={scenario} onExit={() => navigate('#home')}
        paused={{ local: conversation.local, onResume: () => { void resume(); }, busy: conversation.acquiring || !conversation.ready }} />}</>;
  return <>{error}{notice && <p role="alert" className="report-shell">{notice}</p>}
    {route.startsWith('#chat') && !active && conversation.ready && <p role="status" className="report-shell">대화가 종료되었거나 다른 탭에서 변경되었습니다.</p>}
    {!conversation.ready && !conversation.error && <p role="status">저장된 대화를 확인하고 있어요…</p>}
    <Home disabled={!conversation.ready || conversation.acquiring} onStart={item => { void start(item); }}
      resume={active && scenario ? { title: scenario.title, onClick: () => { void resume(); } } : undefined} /></>;
}

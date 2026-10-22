import EchoDemo from './EchoDemo';
import { useRef, useState } from 'react';

type Reply = { text: string; mode: 'mock' | 'live' };
export default function DemoApp() {
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const pending = useRef(false);
  async function start() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(''); setReply(null); setRevealed(false);
    try {
      const response = await fetch('/api/v1/demo/cafe', { method: 'POST', signal: AbortSignal.timeout(60000) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body.code === 'INFERENCE_NOT_CONFIGURED') throw new Error('아직 대화를 준비 중이에요. 잠시 후 다시 시도해주세요.');
        if (response.status === 504) throw new Error('답변 준비가 오래 걸리고 있어요. 다시 시도해주세요.');
        throw new Error('대화에 연결하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string' || !data.text.trim()
        || !('mode' in data) || (data.mode !== 'mock' && data.mode !== 'live')) throw new Error('답변을 받지 못했어요. 다시 시도해주세요.');
      setReply({ text: data.text, mode: data.mode });
    } catch (e) {
      setError(e instanceof Error && e.message.endsWith('주세요.') ? e.message : '대화에 연결하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally { pending.current = false; setBusy(false); }
  }
  return <div className="page">
    <header><a className="wordmark" href="/" aria-label="SayScene 홈">Say<span>Scene</span><i>●</i></a><span className="header-note">영어가 경험이 되는 순간</span><span className="preview-tag">미리보기</span></header>
    <EchoDemo />
    <main>
      <section className="intro" aria-labelledby="title">
        <span className="eyebrow">✦ AI와 함께하는 상황극 영어</span>
        <h1 id="title">오늘의 첫 마디,<br/><span>SayScene</span>에서.</h1>
        <p className="lead">익숙한 카페에서 가볍게 시작해요.<br/>완벽한 영어보다, 말하고 싶은 마음이면 충분해요.</p>
        <div className="brand-art"><img src="/sayscene-logo.png" alt="윙크하는 말풍선 친구와 SayScene 로고"/><span className="art-caption">작은 한마디가 새로운 장면으로.</span></div>
        <p className="scope-note">지금은 카페의 첫 인사를 만나보는 미리보기예요.<br/>음성 대화는 다음 단계에서 함께해요.</p>
      </section>
      <section className="scene" aria-label="카페 대화 미리보기">
        <div className="scene-top"><span className="scene-icon" aria-hidden="true">☕</span><div><span className="overline">TODAY’S SCENE</span><h2>카페에서 주문하기</h2></div><span className="scene-number">01</span></div>
        <div className="scene-context"><span>장소 <b>카페</b></span><span>상황 <b>음료 주문</b></span></div>
        <div className="conversation" aria-busy={busy}>
          {!reply && !busy && !error && <div className="empty"><div className="cup" aria-hidden="true">☕</div><h3>문을 열면, 대화가 시작돼요.</h3><p>바리스타가 건네는 첫 인사를 만나보세요.</p></div>}
          {busy && <div className="waiting" role="status"><span className="dots">● ● ●</span><p>바리스타가 인사를 준비하고 있어요.</p></div>}
          {error && <div className="error" role="alert"><span aria-hidden="true">↻</span><p>{error}</p></div>}
          {reply && <div className="reply"><span className="speaker">SayScene · 바리스타</span><div className="bubble">{revealed ? <p lang="en">{reply.text}</p> : <button className="reveal" onClick={() => setRevealed(true)}><span className="blur-lines" aria-hidden="true">Welcome to the cafe.<br/>A little hello, just for you.</span><span>영어 문장 보기 ↗</span></button>}</div><p className="reply-note" role="status">{reply.mode === 'mock' ? '로컬 모의 응답 · 실제 AI 추론이 아닙니다' : '첫 인사가 도착했어요. 문장을 열어 확인해보세요.'}</p></div>}
        </div>
        <div className="scene-bottom"><button className="primary" onClick={start} disabled={busy}>{busy ? '답변을 준비하고 있어요…' : error ? '다시 시도하기 ↻' : reply ? '첫 인사 다시 만나기 ↻' : '카페 대화 시작하기 →'}</button><p>카페 상황 한 장면으로 가볍게 시작해요</p></div>
      </section>
    </main>
    <footer><span>Say it. Scene it.</span><span>나만의 속도로, 하나의 장면씩.</span></footer>
  </div>;
}

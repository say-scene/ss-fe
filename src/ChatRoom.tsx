import { useEffect, useRef, useState } from 'react';
import { useSpeech } from './useSpeech';
import { useRecorder } from './useRecorder';
import './chat.css';

type Message = { id: string; text: string; mode: 'mock' | 'live' };
export default function ChatRoom() {
  const [message, setMessage] = useState<Message | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState('');
  const [userText, setUserText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const microphone = useRecorder(setUserText);
  const recordingBusy = microphone.state !== 'idle';
  const timelineEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { timelineEnd.current?.scrollIntoView?.({ block: 'nearest' }); }, [userText, microphone.state]);
  const request = useRef<AbortController | null>(null);
  const { playback, speechError, speak, stop } = useSpeech();
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  async function start() {
    if (request.current) return;
    microphone.reset(); setUserText('');
    stop(); setMessage(null); setRevealed(false); setError(''); setLoading(true);
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch('/api/v1/demo/cafe', { method: 'POST', signal: controller.signal });
      if (!response.ok) throw new Error('request failed');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string' || !data.text.trim()
        || !('mode' in data) || (data.mode !== 'mock' && data.mode !== 'live')) throw new Error('invalid response');
      if (request.current !== controller || controller.signal.aborted) return;
      setMessage({ id: crypto.randomUUID(), text: data.text.trim(), mode: data.mode });
      speak(data.text.trim());
    } catch {
      if (request.current === controller) setError('대화에 연결하지 못했어요. 서버 연결을 확인하고 다시 시도해주세요.');
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }
  const playing = playback === 'speaking' || playback === 'queued';
  const status = microphone.state === 'recording' ? `녹음 중 · ${microphone.seconds}초 / 30초` : microphone.state === 'requesting' ? '마이크 권한을 확인하고 있어요' : microphone.state === 'transcribing' ? '말씀하신 내용을 글로 옮기고 있어요' : userText ? '답변을 글로 옮겼어요' : loading ? '첫 인사를 준비하고 있어요' : playback === 'speaking' ? '바리스타가 말하고 있어요'
    : playback === 'queued' ? '음성을 준비하고 있어요' : message ? '마이크를 눌러 영어로 답해보세요' : '준비되면 대화를 시작해보세요';
  return <div className="chat-shell">
    <aside className="chat-sidebar">
      <a className="wordmark" href="#chat">Say<span>Scene</span><i>●</i></a>
      <div className="sidebar-label">오늘의 대화</div>
      <div className="current-scene"><span aria-hidden="true">☕</span><div>카페에서 주문하기<small>일상 · 첫 번째 장면</small></div><span className="active-dot" /></div>
      <div className="scene-guide"><span className="eyebrow">YOUR SCENE</span><h2>커피 한 잔으로<br/>시작하는 영어.</h2><p>카페에 막 들어왔어요.<br/>바리스타의 첫 인사를 듣고<br/>영어의 리듬을 느껴보세요.</p><div className="guide-tags"><span>카페</span><span>음료 주문</span></div></div>
      <div className="sidebar-bottom"><img src="/sayscene-logo.png" alt="SayScene 말풍선 친구"/><p>완벽하지 않아도 괜찮아요.<br/>한 장면씩, 나만의 속도로.</p><a href="#demo">연결 확인 화면 ↗</a></div>
    </aside>
    <div className="chat-room">
      <header className="chat-header"><div className="chat-title"><span className="header-cup" aria-hidden="true">☕</span><div><p>카페 · 음료 주문</p><h1>카페에서 주문하기</h1></div></div><a href="#demo" className="mobile-demo">연결 확인 ↗</a><div className="chat-menu"><button className="menu-toggle" aria-label="대화 메뉴" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>•••</button>{menuOpen && <div className="menu-panel"><button disabled title="준비 중">단어장</button><button disabled title="준비 중">대화 종료</button><small>버튼 준비 중</small></div>}</div></header>
      <div className="chat-timeline" role="region" aria-label="대화 내용" aria-busy={loading}>
        <div className="scene-divider"><span>오늘, 새로운 장면의 시작</span></div>
        <div className="scene-banner"><span aria-hidden="true">✦</span><p>편안하게 들어보세요.<br/><strong>영어 원문은 말풍선을 누르면 볼 수 있어요.</strong></p></div>
        {!message && !loading && !error && <div className="chat-welcome"><div className="welcome-cup" aria-hidden="true">☕</div><h2>어서 오세요, SayScene Café.</h2><p>준비되셨나요?<br/>바리스타가 먼저 말을 걸어줄 거예요.</p></div>}
        {loading && <div className="chat-message"><div className="barista-avatar" aria-hidden="true">☕</div><div><span className="chat-speaker">SayScene <small>바리스타</small></span><div className="chat-loading" role="status">첫 인사를 준비하고 있어요 <span>···</span></div></div></div>}
        {message && <article className="chat-message" key={message.id}><div className="barista-avatar" aria-hidden="true">☕</div><div className="message-body"><span className="chat-speaker">SayScene <small>바리스타</small></span><div className="chat-bubble">{revealed ? <p lang="en">{message.text}</p> : <button className="chat-reveal" onClick={() => setRevealed(true)} aria-label="영어 원문 보기"><span className="hidden-sentence" aria-hidden="true">A little hello, just for you.<br/>Your scene begins here.</span><span className="reveal-hint">원문 보기 ↗</span></button>}</div><div className="message-actions"><button disabled={recordingBusy} onClick={() => playing ? stop() : speak(message.text)}>{playing ? '재생 중지' : '다시 듣기'}</button><span>{revealed ? '영어 원문' : '먼저 귀 기울여 들어보세요'}</span>{revealed && <button disabled title="준비 중">한글 번역</button>}<button disabled title="준비 중">표현 저장</button></div>{message.mode === 'mock' && <p className="chat-mock">모의 응답 · 실제 LLM이 생성한 문장이 아닙니다</p>}</div></article>}
        {message && !userText && <div className="user-pending"><button className="suggestion-placeholder" disabled title="준비 중">답변 추천 ✦</button>{recordingBusy && <div className="recording-bubble" role="status">{microphone.state === 'recording' ? '● 입력 중…' : microphone.state === 'transcribing' ? '음성을 글로 옮기는 중…' : '마이크 연결 중…'}</div>}</div>}
        {userText && <article className="chat-message user-message"><div className="message-body"><span className="chat-speaker">나 <small>음성 인식 결과</small></span><div className="chat-bubble"><p lang="en">{userText}</p></div><div className="message-actions"><button disabled title="준비 중">다시 듣기</button><button disabled title="준비 중">한글 번역</button><button disabled title="준비 중">수정하기</button><button disabled title="준비 중">표현 저장</button></div><p className="user-next-note">다음 AI 답변은 아직 연결하지 않았어요.</p></div></article>}
        {microphone.error && <div className="chat-error" role="alert">{microphone.error}</div>}
        <div ref={timelineEnd} />
        {error && <div className="chat-error" role="alert">{error}</div>}
        {speechError && <div className="chat-error" role="alert">{speechError}</div>}
      </div>
      <div className="chat-composer"><div className="playback-status" role="status"><span className={playing ? 'status-dot playing' : 'status-dot'} />{status}</div>{!message ? <button className="primary chat-start" onClick={start} disabled={loading}>{loading ? '인사를 준비하는 중…' : error ? '다시 시도하기' : '대화 시작하기'}</button> : <div className="microphone-composer"><button className={`microphone-button ${microphone.state === 'recording' ? 'is-recording' : ''}`} onClick={() => microphone.state === 'recording' ? microphone.stopRecording() : microphone.start()} disabled={playing || !!userText || microphone.state === 'requesting' || microphone.state === 'transcribing'} aria-label={microphone.state === 'recording' ? '녹음 종료' : '마이크로 답하기'} aria-pressed={microphone.state === 'recording'}>{microphone.state === 'recording' ? <span aria-hidden="true">■</span> : <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>}</button><div><strong>{microphone.state === 'recording' ? '다시 누르면 녹음이 끝나요' : userText ? '답변 인식 완료' : playing ? 'AI의 말을 먼저 들어주세요' : '마이크를 눌러 답해보세요'}</strong><p>{userText ? '새 인사 듣기로 다시 연습할 수 있어요.' : '최대 30초 · 영어로 말해주세요'}</p></div><button className="new-scene" onClick={start} disabled={playing || recordingBusy}>새 인사 듣기</button></div>}<p className="chat-footnote">음성은 저장하지 않아요 · 회색 보조 버튼은 준비 중입니다.</p></div>
    </div>
  </div>;
}

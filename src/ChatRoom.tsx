import { Fragment, useEffect, useRef, useState } from 'react';
import { useSpeech } from './useSpeech';
import { useRecorder } from './useRecorder';
import './chat.css';
import ExpressionTools from './ExpressionTools';
import Translation from './Translation';
import IconButton from './IconButton';
import type { ReportSnapshot } from './reports';
import { displayedMessages, type LocalConversation, type ConversationUi } from './conversation';

import { scenarios, type Scenario } from './scenarios';

type Suggestion = { keywords: string[]; sentence: string; expanded: boolean };

type Message = { id: string; text: string; role: 'assistant' | 'user'; revision?: number; mode?: 'mock' | 'live' | 'preset' };
type Managed = { local: LocalConversation; generate: (history: Message[]) => Promise<Message[]>; saveUi: (ui: ConversationUi) => void;
  registerCleanup: (cleanup: (() => void) | null) => void; restart: () => void };
type Paused = { local: LocalConversation; onResume: () => void; busy: boolean };
export default function ChatRoom({ managed, paused, scenario = scenarios[0], autoStart = false, onEnd, onExit = () => { window.location.hash = '#home'; } }: { scenario?: Scenario; autoStart?: boolean; onExit?: () => void; onEnd?: (snapshot: ReportSnapshot) => void; managed?: Managed; paused?: Paused }) {
  const SCENARIO_ID = scenario.id;
  const initialLocal = managed?.local ?? paused?.local;
  const [sessionId, setSessionId] = useState(() => initialLocal?.active?.sessionId ?? crypto.randomUUID());
  const [vocabularyOpen, setVocabularyOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>(initialLocal?.ui.suggestions ?? {});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const suggestionRequest = useRef<AbortController | null>(null);
  function cancelSuggestion() {
    suggestionRequest.current?.abort(); suggestionRequest.current = null;
    setSuggesting(false); setSuggestionError('');
  }
  const [liveMessages, setMessages] = useState<Message[]>(initialLocal ? displayedMessages(initialLocal) : []);
  const messages = paused ? displayedMessages(paused.local) : liveMessages;
  const message = messages.at(-1);
  const waitingReply = message?.role === 'user';
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<string[]>(initialLocal?.ui.revealed ?? []);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [lockedUserId, setLockedUserId] = useState<string | null>(initialLocal?.ui.lockedUserId ?? null);
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const microphone = useRecorder(text => {
    if (paused || editingId || request.current || messages.at(-1)?.role !== 'assistant') return;
    cancelSuggestion();
    const history: Message[] = [...messages, { id: crypto.randomUUID(), text, role: 'user', revision: 1 }];
    setMessages(history);
    void generate(history);
  });
  const recordingBusy = microphone.state !== 'idle';
  useEffect(() => {
    if (microphone.state === 'recording') {
      cancelSuggestion();
      if (lastUser) setLockedUserId(lastUser.id);
    }
  }, [microphone.state, lastUser]);
  const timelineEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { timelineEnd.current?.scrollIntoView?.({ block: 'nearest' }); }, [messages, microphone.state, loading, suggestions, suggesting]);
  const request = useRef<AbortController | null>(null);
  const { playback, speechError, speak, stop } = useSpeech();
  useEffect(() => () => { request.current?.abort(); request.current = null; suggestionRequest.current?.abort(); suggestionRequest.current = null; }, []);
  useEffect(() => {
    managed?.registerCleanup(() => { request.current?.abort(); request.current = null; cancelSuggestion(); microphone.reset(); stop(); });
    return () => managed?.registerCleanup(null);
  }, []);
  useEffect(() => { managed?.saveUi({ suggestions, revealed, lockedUserId }); }, [suggestions, revealed, lockedUserId]);
  useEffect(() => {
    if (paused) return;
    let active = true;
    if (managed) {
      if (managed.local.pending || !messages.length) queueMicrotask(() => { if (active) void generate(messages); });
    } else if (autoStart) queueMicrotask(() => { if (active) start(); });
    return () => { active = false; };
  }, []);
  function start() {
    if (paused) return;
    if (managed) { if (!messages.length) void generate([]); else managed.restart(); return; }
    if (request.current) return;
    cancelSuggestion(); setSuggestions({}); setSessionId(crypto.randomUUID());
    microphone.reset(); setMessages([]); setRevealed([]); setEditingId(null); setLockedUserId(null);
    void generate([]);
  }
  function edit(message: Message) {
    if (paused) return;
    if (managed?.local.pending || loading || recordingBusy || message.id !== lastUser?.id || message.id === lockedUserId) return;
    cancelSuggestion();
    stop(); setEditingId(message.id); setEditText(message.text);
  }
  function saveEdit() {
    const text = editText.trim();
    if (!text || !editingId || editingId !== lastUser?.id || editingId === lockedUserId || loading || recordingBusy) return;
    if (text === lastUser.text) { setEditingId(null); return; }
    // messageId는 유지하고 revision만 증가한다. 이전 답변을 새 문맥에 포함하지 않는다.
    const index = messages.findIndex(m => m.id === editingId);
    const history = [...messages.slice(0, index), { ...lastUser, text, revision: (lastUser.revision ?? 1) + 1 }];
    cancelSuggestion();
    setSuggestions(current => Object.fromEntries(Object.entries(current).filter(([id]) => history.some(m => m.id === id))));
    setMessages(history); setEditingId(null);
    setRevealed(ids => ids.filter(id => history.some(m => m.id === id)));
    void generate(history);
  }
  async function suggest() {
    if (!message || message.role !== 'assistant' || loading || editingId || recordingBusy || playing || suggestionRequest.current || suggestions[message.id]) return;
    const targetId = message.id;
    const controller = new AbortController(); suggestionRequest.current = controller;
    setSuggesting(true); setSuggestionError('');
    const timeout = setTimeout(() => controller.abort(), 190000);
    try {
      const response = await fetch('/api/v1/demo/cafe/suggestion', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: SCENARIO_ID, messages: messages.map(m => ({ role: m.role, content: m.text })) }) });
      const data = await response.json();
      if (!response.ok || typeof data?.sentence !== 'string' || !data.sentence.trim() || !Array.isArray(data.keywords)
          || !data.keywords.length || !data.keywords.every((k: unknown) => typeof k === 'string' && k.trim())) throw new Error('invalid suggestion');
      if (suggestionRequest.current !== controller || controller.signal.aborted) return;
      setSuggestions(current => ({ ...current, [targetId]: { sentence: data.sentence.trim(), keywords: data.keywords, expanded: false } }));
    } catch {
      if (suggestionRequest.current === controller) setSuggestionError('추천을 불러오지 못했어요. 다시 요청하거나 마이크로 바로 답해주세요.');
    } finally {
      clearTimeout(timeout);
      if (suggestionRequest.current === controller) { suggestionRequest.current = null; setSuggesting(false); }
    }
  }
  async function generate(history: Message[]) {
    if (request.current) return;
    stop(); setError(''); setLoading(true);
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), managed ? 245000 : 190000);
    try {
      if (managed) {
        const next = await managed.generate(history);
        if (request.current !== controller || controller.signal.aborted) return;
        setMessages(next);
        const last = next.at(-1)!; setSpeakingId(last.id); speak(last.text);
        return;
      }
      const response = await fetch(history.length ? '/api/v1/demo/cafe/reply' : `/api/v1/demo/cafe?scenarioId=${SCENARIO_ID}`, { method: 'POST', signal: controller.signal, ...(history.length ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioId: SCENARIO_ID, messages: history.map(m => ({ role: m.role, content: m.text })) }) } : {}) });
      if (!response.ok) throw new Error('request failed');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string' || !data.text.trim()
        || !('mode' in data) || (data.mode !== 'mock' && data.mode !== 'live')) throw new Error('invalid response');
      if (request.current !== controller || controller.signal.aborted) return;
      const id = crypto.randomUUID();
      setMessages([...history, { id, text: data.text.trim(), role: 'assistant', mode: data.mode }]);
      setSpeakingId(id);
      speak(data.text.trim());
    } catch (e) {
      if (request.current === controller) setError(managed && e instanceof Error && /[가-힣]/.test(e.message) ? e.message : '대화에 연결하지 못했어요. 서버 연결을 확인하고 다시 시도해주세요.');
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }
  const playing = playback === 'speaking' || playback === 'queued';
  function replay(message: Message) {
    if (playing && speakingId === message.id) { stop(); return; }
    setSpeakingId(message.id); speak(message.text);
  }
  const status = editingId ? '말씀하려던 영어 문장으로 수정해주세요' : microphone.state === 'recording' ? `녹음 중 · ${microphone.seconds}초 / 30초` : microphone.state === 'requesting' ? '마이크 권한을 확인하고 있어요' : microphone.state === 'transcribing' ? '말씀하신 내용을 글로 옮기고 있어요' : loading ? (messages.length ? '다음 답변을 준비하고 있어요' : '첫 인사를 준비하고 있어요') : waitingReply ? '답변 생성을 다시 시도해주세요' : playback === 'speaking' ? (messages.find(m => m.id === speakingId)?.role === 'user' ? '내 문장을 다시 듣고 있어요' : `${scenario.partner}가 말하고 있어요`)
    : playback === 'queued' ? '음성을 준비하고 있어요' : message ? '마이크를 눌러 영어로 답해보세요' : '준비되면 대화를 시작해보세요';
  return <div className="chat-shell">
    <ExpressionTools sessionId={sessionId} scenarioId={SCENARIO_ID} open={vocabularyOpen} onClose={() => setVocabularyOpen(false)} />
    <aside className="chat-sidebar">
      <a className="wordmark" href="#home" onClick={event => { event.preventDefault(); onExit(); }}>Say<span>Scene</span><i>●</i></a>
      <div className="sidebar-label">오늘의 대화</div>
      <div className="current-scene"><span aria-hidden="true">{scenario.emoji}</span><div>{scenario.title}<small>{scenario.place} · 영어 연습</small></div><span className={paused ? 'active-dot is-paused' : 'active-dot'} /></div>
      <div className="scene-guide"><span className="eyebrow">YOUR SCENE</span><h2>{scenario.title}</h2><p>상황에 맞춰 대화해 보세요.<br/>상대방의 첫 인사를 듣고<br/>영어로 답해보세요.</p><div className="guide-tags"><span>{scenario.place}</span><span>{scenario.situation}</span></div></div>
      <div className="sidebar-bottom"><img src="/sayscene-logo.png" alt="SayScene 말풍선 친구"/><p>완벽하지 않아도 괜찮아요.<br/>한 장면씩, 나만의 속도로.</p></div>
    </aside>
    <div className="chat-room">
      <header className="chat-header"><div className="chat-title"><span className="header-cup" aria-hidden="true">{scenario.emoji}</span><div><p>{scenario.place} · {scenario.situation}</p><h1>{scenario.title}</h1></div></div>{paused && <span className="chat-paused-status">대화 일시정지</span>}<div className="chat-menu"><button className="menu-toggle" aria-label="대화 메뉴" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>•••</button>{menuOpen && <div className="menu-panel"><button onClick={() => { setMenuOpen(false); setVocabularyOpen(true); }}>단어장</button><button disabled={recordingBusy || !!editingId} onClick={() => {
        if (paused) { onExit(); return; }
        stop(); request.current?.abort(); request.current = null; cancelSuggestion();
        if (onEnd) onEnd({ sessionId, scenarioId: SCENARIO_ID, messages: messages.map(m => ({ messageId: m.id, revision: m.revision ?? 1, role: m.role, text: m.text })) });
        else onExit();
      }}>{paused ? '메인으로' : '대화 종료'}</button></div>}</div></header>
      <div className="chat-timeline" role="region" aria-label="대화 내용" aria-busy={loading}>
        <div className="scene-divider"><span>오늘, 새로운 장면의 시작</span></div>
        <div className="scene-banner"><span aria-hidden="true">✦</span><p>편안하게 들어보세요.<br/><strong>원문을 열고 표현을 드래그하면 저장할 수 있어요.</strong></p></div>
        {!paused && !message && !loading && !error && <div className="chat-welcome"><div className="welcome-cup" aria-hidden="true">{scenario.emoji}</div><h2>{scenario.title}</h2><p>준비되셨나요?<br/>상대방이 먼저 말을 걸어줄 거예요.</p></div>}

        {messages.map(message => message.role === 'assistant' ? (<Fragment key={message.id}><article className="chat-message"><div className="barista-avatar" aria-hidden="true">{scenario.emoji}</div><div className="message-body"><span className="chat-speaker">SayScene <small>{scenario.partner}</small></span><Translation key={`${message.id}:${message.revision ?? 1}`} sessionId={sessionId} messageId={message.id} revision={message.revision ?? 1} text={message.text} disabled={!!editingId}>{(translationButton, translationContent) => <><div className="bubble-row"><div className="chat-bubble">{revealed.includes(message.id) ? <p lang="en" data-expression-id={message.id} data-revision={message.revision ?? 1} data-role={message.role}>{message.text}</p> : <button className="chat-reveal" onClick={() => setRevealed(ids => [...ids, message.id])} aria-label="영어 원문 보기"><span className="hidden-sentence" lang="en" aria-hidden="true">{message.text}</span></button>}{revealed.includes(message.id) && translationContent}</div>{!paused && !lastUser && message.id === messages[0]?.id && <IconButton className="replay-button" onClick={start} disabled={!!editingId || playing || loading || recordingBusy} label="새 인사 듣기"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></svg></IconButton>}</div><div className="message-actions"><IconButton className="replay-button" disabled={recordingBusy || loading || !!editingId} onClick={() => replay(message)} label={playing && speakingId === message.id ? '재생 중지' : '다시 듣기'}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>{playing && speakingId === message.id ? <path d="M16 8v8M20 8v8"/> : <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>}</svg></IconButton>{revealed.includes(message.id) && translationButton}{!revealed.includes(message.id) && <span>먼저 귀 기울여 들어보세요</span>}</div></>}</Translation>{message.mode === 'mock' && <p className="chat-mock">모의 응답 · 실제 LLM이 생성한 문장이 아닙니다</p>}</div></article>{suggestions[message.id] && <aside className="suggestion-card" aria-label="답변 연습 힌트">
          <div className="suggestion-heading"><strong>✦ {suggestions[message.id].expanded ? '추천 예문' : '추천 키워드'}</strong><small>연습용 힌트 · 직접 마이크로 말해야 대화가 이어져요.</small></div>
          {suggestions[message.id].expanded ? <p lang="en">{suggestions[message.id].sentence}</p> : <div className="suggestion-row">
            <div className="suggestion-keywords">{suggestions[message.id].keywords.map((word, i) => <span lang="en" key={i}>{word}</span>)}</div>
            {!paused && message.id === messages.at(-1)?.id && <button disabled={recordingBusy || !!editingId} onClick={() => setSuggestions(current => ({ ...current, [message.id]: { ...current[message.id], expanded: true } }))}>재추천 · 문장 보기</button>}
          </div>}
        </aside>}</Fragment>) : (<article key={message.id} className="chat-message user-message"><div className="message-body"><span className="chat-speaker">나 <small>{(message.revision ?? 1) > 1 ? '수정한 발화' : '음성 인식 결과'}</small></span><Translation key={`${message.id}:${message.revision ?? 1}`} sessionId={sessionId} messageId={message.id} revision={message.revision ?? 1} text={message.text} disabled={!!editingId}>{(translationButton, translationContent) => <>{editingId === message.id ? <form className="message-edit" onSubmit={event => { event.preventDefault(); saveEdit(); }}>
          <label htmlFor="edit-utterance">발화 수정</label>
          <textarea id="edit-utterance" lang="en" autoFocus rows={3} value={editText} onChange={event => setEditText(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setEditingId(null); }} />
          <p>저장하면 이 발화에 대한 AI 답변을 다시 생성해요.</p>
          <div><button type="submit" disabled={!editText.trim()}>수정 완료</button><button type="button" onClick={() => setEditingId(null)}>취소</button></div>
        </form> : <div className="chat-bubble"><p lang="en" data-expression-id={message.id} data-revision={message.revision ?? 1} data-role={message.role}>{message.text}</p>{translationContent}</div>}<div className="message-actions"><IconButton className="replay-button" disabled={recordingBusy || loading || !!editingId} onClick={() => replay(message)} label={playing && speakingId === message.id ? '재생 중지' : '다시 듣기'}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>{playing && speakingId === message.id ? <path d="M16 8v8M20 8v8"/> : <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>}</svg></IconButton>{!editingId && translationButton}{!paused && message.id === lastUser?.id && message.id !== lockedUserId && !editingId && <IconButton className="edit-message-button" label="수정하기" disabled={loading || recordingBusy || !!managed?.local.pending} onClick={() => edit(message)}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/></svg></IconButton>}</div></>}</Translation></div></article>))}
        {loading && <div className="chat-message"><div className="barista-avatar" aria-hidden="true">{scenario.emoji}</div><div><span className="chat-speaker">SayScene <small>{scenario.partner}</small></span><div className="chat-loading" role="status">{messages.length ? '다음 답변을 준비하고 있어요' : '첫 인사를 준비하고 있어요'} <span>···</span></div></div></div>}
        {!paused && message && !waitingReply && !loading && <div className="user-pending">{!suggestions[message.id] && <button className="suggestion-placeholder" disabled={suggesting || playing || recordingBusy || !!editingId} onClick={suggest}>{suggesting ? '추천을 준비하고 있어요…' : '답변 추천 ✦'}</button>}{suggestionError && <p role="alert">{suggestionError}</p>}{recordingBusy && <div className="recording-bubble" role="status">{microphone.state === 'recording' ? '● 입력 중…' : microphone.state === 'transcribing' ? '음성을 글로 옮기는 중…' : '마이크 연결 중…'}</div>}</div>}

        {microphone.error && <div className="chat-error" role="alert">{microphone.error}</div>}
        <div ref={timelineEnd} />
        {error && <div className="chat-error" role="alert">{error}{waitingReply && <button onClick={() => generate(messages)} disabled={loading || !!editingId}>답변 다시 받기</button>}</div>}
        {speechError && <div className="chat-error" role="alert">{speechError}</div>}
      </div>
      <div className="chat-composer">{paused ? <div className="chat-resume"><button className="primary" disabled={paused.busy} onClick={paused.onResume}>{paused.busy ? '대화를 연결하고 있어요…' : '이어서 대화하기'}</button><p>다른 탭에서 대화 중이면 이 탭에서 이어집니다.</p></div> : <><div className="playback-status" role="status"><span className={playing ? 'status-dot playing' : 'status-dot'} />{status}</div>{!message ? <button className="primary chat-start" onClick={start} disabled={loading}>{loading ? '인사를 준비하는 중…' : error ? '다시 시도하기' : '대화 시작하기'}</button> : <div className="microphone-composer"><button className={`microphone-button ${microphone.state === 'recording' ? 'is-recording' : ''}`} onClick={() => microphone.state === 'recording' ? microphone.stopRecording() : microphone.start()} disabled={!!editingId || playing || loading || waitingReply || microphone.state === 'requesting' || microphone.state === 'transcribing'} aria-label={microphone.state === 'recording' ? '녹음 종료' : '마이크로 답하기'} aria-pressed={microphone.state === 'recording'}>{microphone.state === 'recording' ? <span aria-hidden="true">■</span> : <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>}</button><div><strong>{microphone.state === 'recording' ? '다시 누르면 녹음이 끝나요' : loading ? 'AI 답변을 기다리고 있어요' : waitingReply ? '답변을 다시 받아주세요' : playing ? 'AI의 말을 먼저 들어주세요' : '마이크를 눌러 답해보세요'}</strong><p>{loading ? '로컬 모델에서는 시간이 걸릴 수 있어요.' : '최대 30초 · 영어로 말해주세요'}</p></div></div>}<p className="chat-footnote">음성은 저장하지 않아요 · 다시 듣기는 표시된 문장을 읽어드려요.</p></>}</div>
    </div>
  </div>;
}

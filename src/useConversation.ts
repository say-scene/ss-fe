import { useEffect, useRef, useState } from 'react';
import { conversationApi, ConversationError, displayedMessages, emptyConversation, emptyUi, mergeServer, readConversation, reconcile, writeConversation,
  ACTIVE_KEY, type ConversationUi, type LocalConversation, type Message } from './conversation';

export function useConversation() {
  const [local, setLocal] = useState<LocalConversation>(emptyConversation);
  const [ready, setReady] = useState(false);
  const [owner, setOwner] = useState(false);
  const [error, setError] = useState('');
  const [acquiring, setAcquiring] = useState(false);
  const ownerRef = useRef(false);
  const cleanupChat = useRef<(() => void) | null>(null);
  const releaseLock = useRef<(() => void) | null>(null);
  const acquireAbort = useRef<AbortController | null>(null);
  const request = useRef<AbortController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const alive = useRef(true);
  function release() {
    cleanupChat.current?.(); request.current?.abort(); request.current = null;
    ownerRef.current = false; setOwner(false); releaseLock.current?.(); releaseLock.current = null;
  }
  function read() { try { setLocal(readConversation()); } catch (e) { setError((e as Error).message); } }
  async function refresh() {
    setError('');
    try { await reconcile(); if (alive.current) { read(); setReady(true); } }
    catch (e) { if (alive.current) { read(); setError((e as Error).message); } throw e; }
  }
  useEffect(() => {
    alive.current = true;
    const sync = () => {
      try {
        const next = readConversation();
        if (ownerRef.current && (!next.active || next.ending || next.starting)) release();
        setLocal(next);
      } catch (e) { setError((e as Error).message); release(); }
    };
    const storage = (event: StorageEvent) => { if (!event.key || event.key === ACTIVE_KEY) sync(); };
    const bus = new BroadcastChannel('sayscene:conversation-control'); channel.current = bus;
    bus.onmessage = event => { if (event.data === 'takeover' && ownerRef.current) release(); };
    window.addEventListener('storage', storage); window.addEventListener('sayscene-conversation', read);
    void refresh().catch(() => {});
    return () => { alive.current = false; acquireAbort.current?.abort(); release(); bus.close(); channel.current = null;
      window.removeEventListener('storage', storage); window.removeEventListener('sayscene-conversation', read); };
  }, []);
  async function acquire() {
    if (ownerRef.current) return;
    if (!navigator.locks) throw new Error('이 브라우저는 대화 사용권 동기화를 지원하지 않아요.');
    acquireAbort.current?.abort();
    const controller = new AbortController(); acquireAbort.current = controller;
    setAcquiring(true);
    const takeover = () => channel.current?.postMessage('takeover');
    takeover();
    const interval = setInterval(takeover, 1000);
    try {
      await new Promise<void>((resolve, reject) => {
        navigator.locks.request('sayscene:conversation-owner', { signal: controller.signal }, async () => {
          clearInterval(interval);
          ownerRef.current = true; resolve();
          await new Promise<void>(done => { releaseLock.current = done; });
        }).catch(reject);
      });
      try { await refresh(); } catch (e) { release(); throw e; }
      if (!ownerRef.current) throw new Error('다른 탭으로 대화 사용권이 이동했어요.');
      setOwner(true);
    } finally { clearInterval(interval); setAcquiring(false); }
  }
  async function resume() {
    setError('');
    try { await acquire(); return true; } catch (e) { setError((e as Error).message); release(); return false; }
  }
  async function start(scenarioId: string) {
    setError('');
    try {
      await acquire();
      const current = readConversation();
      const starting = { sessionId: crypto.randomUUID(), scenarioId, expectedSessionId: current.active?.sessionId ?? null };
      // 쓰기 실패하면 서버의 기존 대화를 삭제하지 않는다.
      writeConversation({ ...current, starting });
      const state = await conversationApi('/start', starting);
      writeConversation(mergeServer(emptyConversation(), state));
      return true;
    } catch (e) { setError((e as Error).message); release(); return false; }
  }
  async function generate(history: Message[]) {
    if (!ownerRef.current) throw new Error('다른 탭에서 대화 중입니다.');
    let current = readConversation(); const active = current.active;
    if (!active) throw new Error('진행 중인 대화가 없습니다.');
    const last = history.at(-1);
    const edit = !!last && active.messages.some(m => m.id === last.id);
    const turn = current.pending ?? { sessionId: active.sessionId, requestId: crypto.randomUUID(), expectedVersion: active.version,
      message: last?.role === 'user' ? { ...last, revision: last.revision ?? 1 } : null, edit };
    current = { ...current, pending: turn }; writeConversation(current);
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 240000);
    try {
      for (;;) {
        try {
          const state = await conversationApi('/turn', turn, controller.signal);
          if (!ownerRef.current || controller.signal.aborted) throw new Error('사용권이 이동했습니다.');
          const next = mergeServer(readConversation(), state); writeConversation(next);
          return next.active!.messages;
        } catch (e) {
          if (!(e instanceof ConversationError) || e.status !== 409 || controller.signal.aborted) throw e;
          const state = await conversationApi('', undefined, controller.signal);
          if (state.active?.sessionId !== turn.sessionId) throw new Error('대화가 다른 탭에서 종료되거나 변경됐어요.');
          if (state.active.lastRequestId === turn.requestId) {
            writeConversation(mergeServer(readConversation(), state)); return state.active.messages;
          }
          if (state.active.version !== turn.expectedVersion) { writeConversation(mergeServer(readConversation(), state)); throw new Error('다른 탭의 최신 대화를 다시 열어주세요.'); }
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new Error('요청이 취소됐어요.')); };
            const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, 1000);
            controller.signal.addEventListener('abort', abort, { once: true });
          });
        }
      }
    } finally { clearTimeout(timeout); if (request.current === controller) request.current = null; }
  }
  function saveUi(ui: ConversationUi) {
    if (!ownerRef.current) return;
    try { const current = readConversation(); if (current.active) writeConversation({ ...current, ui }); }
    catch { setError('대화를 브라우저에 저장하지 못했어요. 저장 공간을 확인해주세요.'); release(); }
  }
  async function end() {
    if (!ownerRef.current) return false;
    setError('');
    try {
      const current = readConversation(); if (!current.active) return false;
      writeConversation({ ...current, ending: current.active.sessionId });
      await conversationApi('/end', { sessionId: current.active.sessionId });
      writeConversation(emptyConversation()); release(); return true;
    } catch (e) { setError((e as Error).message); release(); return false; }
  }
  return { local, messages: displayedMessages(local), ready, owner, error, acquiring, cleanupChat, release, resume, start, generate, saveUi, end, refresh };
}

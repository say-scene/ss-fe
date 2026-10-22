import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { deleteExpression, readExpressions, saveExpression, VOCAB_KEY, type Expression } from './vocabulary';

type Pick = { text: string; example: string; element: HTMLElement; source: Expression['source']; x: number; y: number };
export default function ExpressionTools({ sessionId, scenarioId, open, onClose }: {
  sessionId: string; scenarioId: string; open: boolean; onClose: () => void;
}) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<Expression[]>([]);
  const [listError, setListError] = useState('');
  const [sort, setSort] = useState('alphabet');
  const menu = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  function refresh() {
    try { setItems(readExpressions()); setListError(''); }
    catch { setListError('단어장을 읽지 못했어요. 기존 저장 내용은 변경하지 않았습니다.'); }
  }
  useEffect(() => {
    if (open) { setPick(null); refresh(); dialog.current?.showModal(); }
    else if (dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === VOCAB_KEY || event.key === null) refresh(); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (open || menu.current?.contains(document.activeElement)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) { setPick(null); return; }
      const range = selection.getRangeAt(0);
      const parent = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>('[data-expression-id]');
      const element = parent(range.startContainer);
      const text = selection.toString().trim();
      if (!text || !element || !element.isConnected || element !== parent(range.endContainer)) { setPick(null); return; }
      const rects = range.getClientRects();
      const rect = rects[rects.length - 1];
      const timeline = element.closest('.chat-timeline')?.getBoundingClientRect();
      if (!rect || (timeline && (rect.bottom < timeline.top || rect.top > timeline.bottom))) { setPick(null); return; }
      setPick({ text, element, example: element.textContent ?? '',
        source: { sessionId, scenarioId, messageId: element.dataset.expressionId!, revision: Number(element.dataset.revision ?? 1), role: element.dataset.role ?? '' },
        x: Math.max(8, Math.min(rect.left + rect.width / 2 - 64, window.innerWidth - 136)),
        y: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 56)) });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setPick(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPick(null); };
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerup', schedule);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', schedule); document.removeEventListener('pointerup', schedule);
      document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
    };
  }, [sessionId, scenarioId, open]);
  async function save() {
    if (!pick || busy.current) return;
    if (!pick.element.isConnected || pick.element.textContent !== pick.example
      || Number(pick.element.dataset.revision ?? 1) !== pick.source.revision) {
      setPick(null); setNotice('발화가 변경됐어요. 표현을 다시 선택해주세요.'); return;
    }
    busy.current = true; setSaving(true);
    try {
      const added = await saveExpression(pick.text, pick.example, pick.source);
      setNotice(added ? '저장했습니다' : '이미 저장된 표현입니다'); setPick(null); window.getSelection()?.removeAllRanges();
    } catch { setNotice('저장하지 못했어요. 브라우저 저장 공간과 설정을 확인해주세요.'); }
    finally { busy.current = false; setSaving(false); }
  }
  async function remove(id: string) {
    try { await deleteExpression(id); refresh(); }
    catch { setListError('삭제하지 못했어요. 기존 저장 내용은 유지됩니다.'); }
  }
  const sorted = [...items].sort((a, b) => sort === 'latest' ? b.createdAt.localeCompare(a.createdAt) : a.expression.localeCompare(b.expression, 'en', { sensitivity: 'base' }));
  return <>
    {pick && !open && createPortal(<div ref={menu} className="expression-popover" style={{ left: pick.x, top: pick.y }} role="toolbar" aria-label="선택한 표현 메뉴" onPointerDown={event => event.preventDefault()}>
      <button onClick={save} disabled={saving}>{saving ? '저장 중…' : '＋ 표현 저장'}</button>
    </div>, document.body)}
    {notice && createPortal(<div className="expression-notice" role="status">{notice}</div>, document.body)}
    <dialog ref={dialog} className="vocabulary-dialog" aria-labelledby="vocabulary-title" onCancel={onClose}>
      <header><h2 id="vocabulary-title">내 단어장</h2><button onClick={onClose} aria-label="단어장 닫기">닫기</button></header>
      <p>이 브라우저에 저장한 표현과 저장 당시 문장이에요.</p>
      <label>정렬 <select value={sort} onChange={event => setSort(event.target.value)}><option value="alphabet">알파벳순</option><option value="latest">최신순</option></select></label>
      {listError ? <p role="alert">{listError}</p> : sorted.length ? <ul>{sorted.map(item => <li key={item.id}><strong lang="en">{item.expression}</strong><p lang="en">{item.example}</p><button onClick={() => remove(item.id)} aria-label={`${item.expression} 삭제`}>삭제</button></li>)}</ul> : <p>아직 저장한 표현이 없어요. 말풍선의 영어를 드래그해 보세요.</p>}
    </dialog>
  </>;
}

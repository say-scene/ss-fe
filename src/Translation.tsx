import { useEffect, useRef, useState, type ReactNode } from 'react';

import IconButton from './IconButton';

type Props = { sessionId: string; messageId: string; revision: number; text: string; disabled?: boolean; children?: (button: ReactNode, content: ReactNode) => ReactNode };

export default function Translation({ sessionId, messageId, revision, text, disabled, children }: Props) {
  const [translation, setTranslation] = useState('');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  async function toggle() {
    if (request.current || disabled) return;
    if (translation) { setVisible(value => !value); return; }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError('');
    const timeout = setTimeout(() => controller.abort(), 190000);
    try {
      const response = await fetch('/api/v1/translate', {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messageId, revision, text }),
      });
      const data = await response.json();
      if (!response.ok || typeof data?.text !== 'string' || !data.text.trim()
          || data.sessionId !== sessionId || data.messageId !== messageId || data.revision !== revision) throw new Error('invalid translation');
      if (request.current !== controller || controller.signal.aborted) return;
      setTranslation(data.text.trim()); setVisible(true);
    } catch {
      if (request.current === controller) setError('번역하지 못했어요. 다시 눌러주세요.');
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }
  const button = <IconButton className="translation-button" label={loading ? '번역 중…' : '한글 번역'} disabled={disabled || loading} onClick={toggle} aria-expanded={visible}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 5h12M9 2v3M5 5c1 5 4 8 8 10M13 5c-1 5-4 8-9 11M14 21l4-10 4 10M15.5 17h5"/></svg>
    </IconButton>;
  const content = <>
    {visible && <p lang="ko" className="translation-text">{translation}</p>}
    {error && <p role="alert">{error}</p>}
  </>;
  return children ? children(button, content) : <div className="message-translation">{button}{content}</div>;
}

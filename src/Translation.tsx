import { useEffect, useRef, useState } from 'react';

type Props = { sessionId: string; messageId: string; revision: number; text: string; disabled?: boolean };

export default function Translation({ sessionId, messageId, revision, text, disabled }: Props) {
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
  return <div className="message-translation">
    <button disabled={disabled || loading} onClick={toggle} aria-expanded={visible}>
      {loading ? '번역 중…' : visible ? '번역 숨기기' : '한글 번역'}
    </button>
    {visible && <p lang="ko" className="translation-text">{translation}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

import { useRef, useState, type FormEvent } from 'react';

type Echo = { message: string; source: string; receivedAt: string };
export default function EchoDemo() {
  const [message, setMessage] = useState('안녕, SayScene!');
  const [result, setResult] = useState<Echo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !message.trim()) return;
    pending.current = true;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/v1/demo/echo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('HTTP error');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object'
        || !('message' in data) || typeof data.message !== 'string'
        || !('source' in data) || typeof data.source !== 'string'
        || !('receivedAt' in data) || typeof data.receivedAt !== 'string') throw new Error('Invalid response');
      setResult({ message: data.message, source: data.source, receivedAt: data.receivedAt });
    } catch {
      setError('백엔드 연결을 확인해주세요. 서버를 실행한 뒤 다시 보낼 수 있어요.');
    } finally { pending.current = false; setBusy(false); }
  }
  return <section className="echo-demo" aria-labelledby="echo-title">
    <div><span className="eyebrow">LOCAL DEMO</span><h2 id="echo-title">프론트 → 백엔드 → 프론트</h2><p>보낸 문장을 Spring Boot가 그대로 돌려줍니다. AI 서버 없이 확인할 수 있어요.</p></div>
    <form onSubmit={send}>
      <label htmlFor="echo-message">보낼 문장</label>
      <div className="echo-input"><input id="echo-message" value={message} maxLength={200} disabled={busy} onChange={e => setMessage(e.target.value)} /><button className="primary" disabled={busy || !message.trim()}>{busy ? '응답 기다리는 중…' : '백엔드로 보내기'}</button></div>
    </form>
    <div aria-live="polite" aria-busy={busy}>{result && <div className="echo-result"><h3>백엔드 응답 도착</h3><p>{result.message}</p><small>응답 서버: {result.source} · 수신 시각: {result.receivedAt}</small></div>}</div>
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}

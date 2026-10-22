import { useCallback, useEffect, useRef, useState } from 'react';

type RecordingState = 'idle' | 'requesting' | 'recording' | 'transcribing';
export function useRecorder(onTranscript: (text: string) => void) {
  const [state, setState] = useState<RecordingState>('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const current = useRef(0);
  const busy = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const upload = useRef<AbortController | null>(null);
  const releaseLock = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const callback = useRef(onTranscript); callback.current = onTranscript;
  const releaseMedia = useCallback(() => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
  }, []);
  const dispose = useCallback(() => {
    current.current++; busy.current = false;
    const rec = recorder.current;
    if (rec) {
      rec.onstop = null; rec.ondataavailable = null; rec.onerror = null;
      if (rec.state !== 'inactive') rec.stop();
    }
    recorder.current = null; releaseMedia();
    upload.current?.abort(); upload.current = null;
    releaseLock.current?.(); releaseLock.current = null;
  }, [releaseMedia]);
  useEffect(() => dispose, [dispose]);
  const reset = useCallback(() => { dispose(); setState('idle'); setError(''); setSeconds(0); }, [dispose]);
  function stopRecording() {
    if (recorder.current?.state === 'recording') {
      setState('transcribing'); recorder.current.stop();
    }
  }
  function start() {
    if (busy.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || !navigator.locks) {
      setError('이 브라우저에서는 녹음할 수 없어요. 최신 Chrome 또는 Safari에서 열어주세요.'); return;
    }
    busy.current = true; const version = ++current.current;
    setError(''); setSeconds(0); setState('requesting');
    const finish = (message = '') => {
      if (version !== current.current) return;
      releaseMedia(); releaseLock.current?.(); releaseLock.current = null;
      busy.current = false; recorder.current = null; upload.current = null;
      setState('idle'); setError(message);
    };
    void navigator.locks.request('sayscene:microphone', { ifAvailable: true }, async lock => {
      if (version !== current.current) return;
      if (!lock) { finish('다른 탭에서 마이크를 사용 중이에요. 녹음을 마친 뒤 다시 눌러주세요.'); return; }
      const held = new Promise<void>(resolve => { releaseLock.current = resolve; });
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        if (version !== current.current) { media.getTracks().forEach(t => t.stop()); return; }
        stream.current = media;
        const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
        if (!mime) { finish('지원되는 녹음 형식이 없어요. 다른 브라우저에서 시도해주세요.'); return; }
        const rec = new MediaRecorder(media, { mimeType: mime, audioBitsPerSecond: 64000 });
        recorder.current = rec;
        const chunks: Blob[] = []; const startedAt = Date.now();
        rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        rec.onerror = () => { dispose(); setState('idle'); setError('녹음에 실패했어요. 마이크를 확인하고 다시 시도해주세요.'); };
        rec.onstop = async () => {
          releaseMedia();
          if (version !== current.current) return;
          const audio = new Blob(chunks, { type: rec.mimeType || mime }); chunks.length = 0;
          if (Date.now() - startedAt < 500 || !audio.size) { finish('조금 더 길게 말해주세요. 다시 녹음할 수 있어요.'); return; }
          if (audio.size > 2097152) { finish('녹음 용량이 너무 커요. 짧게 다시 말해주세요.'); return; }
          setState('transcribing');
          const controller = new AbortController(); upload.current = controller;
          const timeout = setTimeout(() => controller.abort(), 125000);
          try {
            const form = new FormData();
            const extension = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';
            form.append('audio', audio, `speech.${extension}`);
            const response = await fetch('/api/v1/stt', { method: 'POST', body: form, signal: controller.signal });
            const data = await response.json().catch(() => null);
            if (version !== current.current) return;
            if (!response.ok) {
              finish(data?.code === 'NO_SPEECH' ? '목소리가 들리지 않았어요. 다시 말해주세요.'
                : response.status === 422 ? '음성을 인식하지 못했어요. 또렷하게 다시 말해주세요.'
                : '음성 인식 서버에 연결하지 못했어요. 잠시 후 다시 녹음해주세요.'); return;
            }
            if (typeof data?.text !== 'string' || !data.text.trim()) { finish('목소리가 들리지 않았어요. 다시 말해주세요.'); return; }
            callback.current(data.text.trim()); finish();
          } catch {
            finish('음성 인식이 완료되지 않았어요. 연결을 확인하고 다시 녹음해주세요.');
          } finally { clearTimeout(timeout); }
        };
        rec.start(); setState('recording');
        timer.current = setInterval(() => {
          if (version !== current.current) return;
          const elapsed = Math.floor((Date.now() - startedAt) / 1000); setSeconds(Math.min(elapsed, 30));
          if (elapsed >= 30 && rec.state === 'recording') { setState('transcribing'); rec.stop(); }
        }, 250);
      } catch (e) {
        finish(e instanceof DOMException && e.name === 'NotAllowedError'
          ? '마이크 권한이 필요해요. 브라우저의 사이트 설정에서 허용한 뒤 다시 눌러주세요.'
          : '마이크를 사용할 수 없어요. 연결 상태나 다른 앱의 사용 여부를 확인해주세요.');
      }
      await held;
    }).catch(() => finish('마이크를 사용할 수 없어요. 다시 시도해주세요.'));
  }
  return { state, seconds, error, start, stopRecording, reset };
}

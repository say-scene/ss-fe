import { useCallback, useEffect, useRef, useState } from 'react';

type Playback = 'idle' | 'queued' | 'speaking' | 'ended' | 'error';
export function useSpeech() {
  const [playback, setPlayback] = useState<Playback>('idle');
  const [speechError, setSpeechError] = useState('');
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    if (utterance.current) {
      utterance.current.onstart = null;
      utterance.current.onend = null;
      utterance.current.onerror = null;
      utterance.current = null;
      window.speechSynthesis?.cancel();
    }
  }, []);
  useEffect(() => cancel, [cancel]);
  const stop = useCallback(() => {
    cancel(); setPlayback('idle'); setSpeechError('');
  }, [cancel]);
  const speak = useCallback((text: string) => {
    cancel(); setSpeechError('');
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) {
      setPlayback('error'); setSpeechError('이 브라우저는 음성 재생을 지원하지 않아요. 원문을 열어 확인해주세요.');
      return;
    }
    try {
      const current = new SpeechSynthesisUtterance(text);
      current.lang = 'en-US'; current.rate = 0.95;
      // 목록은 매 재생 시 다시 읽는다. 비어 있으면 브라우저가 lang에 맞는 음성을 선택한다.
      const voices = synth.getVoices();
      current.voice = voices.find(v => v.lang.toLowerCase() === 'en-us')
        ?? voices.find(v => v.lang.toLowerCase().startsWith('en')) ?? null;
      utterance.current = current;
      const fail = () => {
        if (utterance.current !== current) return;
        cancel(); setPlayback('error');
        setSpeechError('음성을 재생하지 못했어요. 다시 듣기를 눌러주세요.');
      };
      current.onstart = () => {
        if (utterance.current !== current) return;
        clearTimeout(timer.current); setPlayback('speaking');
        timer.current = setTimeout(fail, 60000);
      };
      current.onend = () => {
        if (utterance.current !== current) return;
        clearTimeout(timer.current); utterance.current = null; setPlayback('ended');
      };
      current.onerror = fail;
      setPlayback('queued');
      timer.current = setTimeout(fail, 8000);
      synth.speak(current);
    } catch {
      cancel(); setPlayback('error'); setSpeechError('음성을 재생하지 못했어요. 다시 듣기를 눌러주세요.');
    }
  }, [cancel]);
  return { playback, speechError, speak, stop };
}

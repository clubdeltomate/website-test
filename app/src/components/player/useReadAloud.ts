import { useCallback, useEffect, useRef, useState } from 'react';
import type { NarrationUnit } from './narration';

export type ReadAloudStatus = 'off' | 'playing' | 'paused';

export interface ReadAloud {
  supported: boolean;
  status: ReadAloudStatus;
  /** karaoke key of the sentence currently being spoken (slide-tool.md §C5) */
  currentKey: string | null;
  toggle: () => void;
  stop: () => void;
}

/**
 * Web Speech API read-aloud (slide-tool.md §C5): narrates all slide units
 * chunked by sentence, exposes the current sentence key for the karaoke
 * highlight, pauses/resumes, and auto-stops when the slide changes
 * (i.e. when `units` identity changes — memoize it per slide).
 */
export function useReadAloud(
  units: NarrationUnit[],
  voiceURI: string | null,
): ReadAloud {
  const supported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [status, setStatus] = useState<ReadAloudStatus>('off');
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const sessionRef = useRef(0);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    if (supported) window.speechSynthesis.cancel();
    setStatus('off');
    setCurrentKey(null);
  }, [supported]);

  const speakFrom = useCallback(
    (startIdx: number) => {
      if (!supported || units.length === 0) return;
      const session = sessionRef.current;
      const synth = window.speechSynthesis;
      synth.cancel();

      const voice = voiceURI
        ? synth.getVoices().find((v) => v.voiceURI === voiceURI) ?? null
        : null;

      const speakOne = (i: number) => {
        if (sessionRef.current !== session || i >= units.length) {
          if (sessionRef.current === session) {
            setStatus('off');
            setCurrentKey(null);
          }
          return;
        }
        const unit = units[i];
        const utt = new SpeechSynthesisUtterance(unit.text);
        if (voice) utt.voice = voice;
        utt.rate = 1;
        utt.pitch = 1;
        utt.onstart = () => {
          if (sessionRef.current === session) setCurrentKey(unit.key);
        };
        utt.onend = () => speakOne(i + 1);
        utt.onerror = () => {
          if (sessionRef.current === session) {
            setStatus('off');
            setCurrentKey(null);
          }
        };
        synth.speak(utt);
      };

      setStatus('playing');
      speakOne(startIdx);
    },
    [supported, units, voiceURI],
  );

  const toggle = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (status === 'off') {
      speakFrom(0);
    } else if (status === 'playing') {
      synth.pause();
      setStatus('paused');
    } else {
      synth.resume();
      setStatus('playing');
    }
  }, [supported, status, speakFrom]);

  // Auto-stop on slide change (units identity) and on unmount
  useEffect(() => {
    return () => {
      sessionRef.current += 1;
      if (supported) window.speechSynthesis.cancel();
      setStatus('off');
      setCurrentKey(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, supported]);

  return { supported, status, currentKey, toggle, stop };
}

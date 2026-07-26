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
/** Lightweight language sniff so the read-aloud voice matches the TEXT, not
 *  the device locale (a Spanish browser must not read English with a Spanish
 *  accent). Covers the deck languages we expect; defaults to English. */
function detectLang(text: string): string {
  const t = ` ${text.toLowerCase()} `;
  const scores: Record<string, number> = { en: 0, es: 0, fr: 0, de: 0, pt: 0, it: 0 };
  if (/[¿¡]/.test(t)) scores.es += 6;
  if (/ñ/.test(t)) scores.es += 3;
  if (/[ãõ]/.test(t)) scores.pt += 5;
  if (/[äöüß]/.test(t)) scores.de += 5;
  if (/[âêîôûëïç]/.test(t)) scores.fr += 2;
  const words: Record<string, string[]> = {
    en: [' the ', ' and ', ' is ', ' of ', ' to ', ' with ', ' that ', ' this '],
    es: [' el ', ' la ', ' los ', ' las ', ' una ', ' que ', ' y ', ' con ', ' para ', ' del '],
    fr: [' le ', ' les ', ' est ', ' et ', ' une ', ' pour ', ' avec ', ' dans '],
    de: [' der ', ' die ', ' das ', ' und ', ' ist ', ' mit ', ' für ', ' ein '],
    pt: [' os ', ' uma ', ' não ', ' com ', ' para ', ' do ', ' da ', ' em '],
    it: [' il ', ' gli ', ' è ', ' di ', ' che ', ' con ', ' per ', ' una '],
  };
  for (const [lang, list] of Object.entries(words)) {
    for (const w of list) {
      let i = -1;
      while ((i = t.indexOf(w, i + 1)) !== -1) scores[lang] += 1;
    }
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

/** Best available voice for a language: prefers local/default and the
 *  higher-quality "Google"/"Natural" voices when present. */
function voiceForLang(synth: SpeechSynthesis, lang: string): SpeechSynthesisVoice | null {
  const candidates = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  if (candidates.length === 0) return null;
  return (
    candidates.find((v) => /google|natural|neural/i.test(v.name)) ??
    candidates.find((v) => v.default) ??
    candidates[0]
  );
}

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

      // The text's own language decides accent — never the device locale. An
      // explicitly chosen voice still wins over the auto-match.
      const lang = detectLang(units.map((u) => u.text).join(' ').slice(0, 2000));
      const voice =
        (voiceURI ? synth.getVoices().find((v) => v.voiceURI === voiceURI) : null) ??
        voiceForLang(synth, lang);

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
        // set the language even without a matched voice so the engine at
        // least switches pronunciation rules to the text's language
        utt.lang = voice?.lang ?? lang;
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

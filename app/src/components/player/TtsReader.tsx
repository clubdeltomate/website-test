import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Loader2, Square, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';

/* ------------------------------------------------------------------ */
/* ElevenLabs read-aloud (BYOK). A speaker button after each paragraph  */
/* reads THAT paragraph in a natural voice. Click again while it plays  */
/* (or loads) to cancel — the cycle then restarts on the next click.    */
/* Distinct from the browser SpeechSynthesis karaoke in useReadAloud.   */
/* ------------------------------------------------------------------ */

/** localStorage key holding the user's chosen ElevenLabs voice id. */
export const TTS_VOICE_STORAGE_KEY = 'sketchlearn.tts.voice';

function readStoredVoice(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem(TTS_VOICE_STORAGE_KEY)?.trim() || undefined;
}

interface TtsReaderValue {
  /** true only when the viewer has an ElevenLabs key configured */
  available: boolean;
  /** key of the paragraph currently sounding, or null */
  playingKey: string | null;
  /** key of the paragraph whose audio is being fetched, or null */
  loadingKey: string | null;
  /** play this text; if this key is already playing/loading, cancel instead */
  toggle: (key: string, text: string) => void;
}

const TtsReaderContext = createContext<TtsReaderValue | null>(null);

export function TtsReaderProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  // Cheap, cached availability check so the button hides for viewers without a key.
  const status = trpc.tts.status.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const available = status.data?.available ?? false;

  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Monotonic request id: every toggle bumps it, so a superseded fetch/playback
  // knows to bail out instead of racing the newer one.
  const reqRef = useRef(0);

  const getAudio = () => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  };

  const toggle = useCallback(
    async (key: string, text: string) => {
      const audio = getAudio();

      // Clicking the paragraph that's already sounding/loading cancels it.
      if (playingKey === key || loadingKey === key) {
        reqRef.current += 1;
        audio.pause();
        setPlayingKey(null);
        setLoadingKey(null);
        return;
      }

      // Otherwise stop whatever is going and start this paragraph.
      reqRef.current += 1;
      const myReq = reqRef.current;
      audio.pause();
      setPlayingKey(null);
      setLoadingKey(key);

      try {
        const res = await utils.client.tts.speak.mutate({
          text,
          voiceId: readStoredVoice(),
        });
        if (myReq !== reqRef.current) return; // superseded by a newer click
        if (!res?.audio) {
          setLoadingKey(null);
          return;
        }
        audio.src = res.audio;
        audio.onended = () => {
          if (myReq === reqRef.current) setPlayingKey(null);
        };
        audio.onerror = () => {
          if (myReq === reqRef.current) {
            setPlayingKey(null);
            setLoadingKey(null);
          }
        };
        await audio.play();
        if (myReq !== reqRef.current) {
          audio.pause();
          return;
        }
        setLoadingKey(null);
        setPlayingKey(key);
      } catch {
        if (myReq === reqRef.current) {
          setLoadingKey(null);
          setPlayingKey(null);
        }
      }
    },
    [playingKey, loadingKey, utils],
  );

  // Stop any audio when the player unmounts.
  useEffect(() => {
    return () => {
      reqRef.current += 1;
      audioRef.current?.pause();
    };
  }, []);

  return (
    <TtsReaderContext.Provider value={{ available, playingKey, loadingKey, toggle }}>
      {children}
    </TtsReaderContext.Provider>
  );
}

/** Read the reader context; safe to call outside a provider (returns null). */
export function useTtsReader(): TtsReaderValue | null {
  return useContext(TtsReaderContext);
}

/**
 * Speaker button placed after a paragraph. Renders nothing when no ElevenLabs
 * key is configured. Idle → 🔊; loading → spinner; playing → ⏹ (click to stop,
 * then click again to replay from the top).
 */
export function SpeakerButton({ speakKey, text }: { speakKey: string; text: string }) {
  const reader = useTtsReader();
  if (!reader || !reader.available) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const isPlaying = reader.playingKey === speakKey;
  const isLoading = reader.loadingKey === speakKey;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        reader.toggle(speakKey, trimmed);
      }}
      aria-label={isPlaying ? 'Stop reading' : 'Read this aloud'}
      title={isPlaying ? 'Stop' : 'Read aloud'}
      className={cn(
        'ml-1 inline-flex h-6 w-6 shrink-0 translate-y-0.5 items-center justify-center rounded-full border-2 border-ink align-middle shadow-offset-sm transition-transform hover:-translate-y-px',
        isPlaying ? 'bg-purple text-paper-3' : 'bg-paper-3 text-ink',
      )}
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
      ) : isPlaying ? (
        <Square className="h-3 w-3 fill-current" strokeWidth={2.5} />
      ) : (
        <Volume2 className="h-3.5 w-3.5" strokeWidth={2.5} />
      )}
    </button>
  );
}

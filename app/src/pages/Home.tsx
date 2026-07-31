import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen,
  Clapperboard,
  Dices,
  RefreshCw,
  Send,
  History,
  X,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import AuthWall from '@/components/AuthWall';
import StickyNote from '@/components/sketch/StickyNote';
import SketchButton from '@/components/sketch/SketchButton';
import WashiTape from '@/components/sketch/WashiTape';
import Chip from '@/components/sketch/Chip';
import TokenMeter from '@/components/sketch/TokenMeter';
import { Squiggle, Marker } from '@/components/sketch/Squiggle';
import { DoodleSparkle } from '@/components/sketch/DoodleIcons';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import type { CoachAction } from '@contracts/types';
import { say } from '@/lib/i18n';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type TemplateKind = 'course' | 'restaurant' | 'service' | 'shop' | 'walkthrough' | 'news';

interface ActionCard {
  kind: 'lesson-path' | 'slide-tool' | 'resume';
  title: string;
  template?: TemplateKind;
  units?: number;
  lessons?: number;
}

interface ChatMessage {
  id: string;
  role: 'coach' | 'user';
  text: string;
  ts: number;
  cards?: ActionCard[];
  error?: boolean;
  streaming?: boolean;
}

/* ------------------------------------------------------------------ */
/* Coach handoff — maps tRPC coach.chat actions to chat cards          */
/* ------------------------------------------------------------------ */

function mapActions(actions: CoachAction[]): ActionCard[] {
  return actions.map((a) => {
    const template =
      a.payload?.template && a.payload.template !== 'other' ? a.payload.template : undefined;
    if (a.kind === 'lesson-path') {
      return {
        kind: 'lesson-path',
        title: a.payload?.title ?? a.label,
        template,
        units: a.payload?.units,
        lessons: a.payload?.lessons,
      };
    }
    if (a.kind === 'slides') {
      return { kind: 'slide-tool', title: a.payload?.title ?? a.label, template };
    }
    return { kind: 'resume', title: a.label };
  });
}

const TEMPLATE_LABEL: Record<TemplateKind, string> = {
  course: 'Course',
  restaurant: 'Restaurant',
  service: 'Service',
  shop: 'Shop',
  walkthrough: 'Walkthrough',
  news: 'News',
};

/* ------------------------------------------------------------------ */
/* Mock data (backend pass: real recents)                              */
/* ------------------------------------------------------------------ */

const RECENT_NOTEBOOKS = [
  { title: 'Sourdough 101', ref: '#K7J2A', kind: 'repo' as const, meta: '3/8 lessons', to: '/repos' },
  { title: 'Café breakfast menu', ref: '#M4B9Q', kind: 'repo' as const, meta: 'menu · 12 dishes', to: '/repos' },
  { title: 'AC repair basics', ref: 'slide tool', kind: 'slide' as const, meta: 'deck · 9 slides', to: '/slides' },
  { title: 'Fall candle collection', ref: '#T2W8D', kind: 'repo' as const, meta: '2/6 lessons', to: '/repos' },
];

const TIPS = [
  "Lesson 2 reads Lesson 1's log — it will never re-teach what you already covered.",
  'A restaurant menu is just a course: units are categories, lessons are dishes.',
  'Bring your own AI key in Settings → API Keys and text generation costs 0 🪙.',
  'Every generation shows a cost estimate sticky note before it runs.',
];

const SUGGESTIONS = [
  { icon: '🍳', label: 'A breakfast menu for my café' },
  { icon: '🔧', label: 'AC repair basics for my trainees' },
  { icon: '🌱', label: 'Photosynthesis for 7th graders' },
  { icon: '🕯️', label: "My candle shop's fall collection" },
];

const PLACEHOLDERS = [
  'e.g. a 6-lesson course on sourdough…',
  "e.g. my diner's dinner menu…",
  'e.g. onboarding for new baristas…',
];

let idCounter = 0;
const nextId = () => `m${++idCounter}`;

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function TypingDots() {
  return (
    <span className="inline-flex items-end gap-1 px-1 py-1" aria-label={say("Coach is typing")}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-ink animate-dot-bounce"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  );
}

/** Blinking pencil caret shown while a coach message streams */
function PencilCaret() {
  return (
    <span
      className="ml-0.5 inline-block h-[1em] w-[3px] translate-y-[2px] rounded-sm bg-ink animate-caret-blink"
      style={{ animationDuration: '530ms' }}
      aria-hidden="true"
    />
  );
}

function ActionCardView({ card, index }: { card: ActionCard; index: number }) {
  const navigate = useNavigate();
  if (card.kind === 'resume') {
    return (
      <motion.div
        initial={{ opacity: 0, scaleY: 0.6 }}
        animate={{ opacity: 1, scaleY: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24, delay: 0.1 }}
        style={{ transformOrigin: 'top' }}
        className="relative mt-3 rounded-wobble-3 border-2 border-ink bg-paper-3 p-4 shadow-offset"
      >
        <WashiTape rotate={-4} className="left-4 w-16" />
        <p className="micro flex items-center gap-1 text-ink-faint">
          <DoodleSparkle className="h-3.5 w-3.5 text-purple" />  {say("Pick up where you left off")}
        </p>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {RECENT_NOTEBOOKS.slice(0, 3).map((nb) => (
            <Link
              key={nb.title}
              to={nb.to}
              className="flex min-w-[150px] flex-col rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2 px-3 py-2 no-underline transition-all hover:-translate-y-0.5 hover:border-ink"
            >
              <span className="font-heading text-sm font-semibold text-ink">{say(nb.title)}</span>
              <span className="micro mt-0.5 text-[0.65rem] text-ink-faint">
                {nb.ref} · {nb.meta}
              </span>
            </Link>
          ))}
        </div>
      </motion.div>
    );
  }

  const isLessonPath = card.kind === 'lesson-path';
  return (
    <motion.div
      initial={{ opacity: 0, scaleY: 0.6 }}
      animate={{ opacity: 1, scaleY: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24, delay: 0.1 + index * 0.12 }}
      style={{ transformOrigin: 'top' }}
      className="relative mt-3 rounded-wobble-3 border-2 border-ink bg-paper-3 p-4 pt-5 shadow-offset"
    >
      <WashiTape rotate={-4} className="left-4 w-16" color={isLessonPath ? 'yellow' : 'blue'} />
      <p className="micro flex items-center gap-1 text-ink-faint">
        <DoodleSparkle className="h-3.5 w-3.5 text-purple" />
        {isLessonPath ? 'Create your Lesson Path' : 'Just a slide deck?'}
      </p>
      <p className="mt-1 font-display text-2xl leading-tight text-ink">{card.title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {card.template && (
          <Chip kind={isLessonPath ? 'repo-ref' : 'slide-tool'}>
            {TEMPLATE_LABEL[card.template]}
          </Chip>
        )}
        {isLessonPath && card.units && (
          <span className="font-mono text-xs text-ink-soft">
            ~{card.units}  {say("units ×")} {card.lessons}  {say("lessons")}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {isLessonPath ? (
          <>
            <Link to="/lesson-path">
              <SketchButton variant="accent" size="sm">
                
                {say("Open in Lesson Path")}
              </SketchButton>
            </Link>
            <SketchButton variant="ghost" size="sm" onClick={() => navigate('/repos')}>
              
              {say("Quick generate — skip the form")}
            </SketchButton>
          </>
        ) : (
          <Link to="/slides">
            <SketchButton variant="secondary" size="sm">
              
              {say("Open a slide tool with this topic")}
            </SketchButton>
          </Link>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero (empty state)                                                  */
/* ------------------------------------------------------------------ */

function Hero({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const { isGuest } = useAuth();
  const headline: { word: string; wrap?: 'squiggle' | 'marker' }[] = [
    { word: 'What' }, { word: 'do' }, { word: 'you' }, { word: 'want' },
    { word: 'to' }, { word: 'teach', wrap: 'squiggle' }, { word: 'or' },
    { word: 'learn', wrap: 'marker' }, { word: 'today?' },
  ];
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
      {/* collage backdrop */}
      <motion.img
        src="/doodle-collage-home.svg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 mx-auto w-full max-w-3xl select-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.4 }}
        transition={{ duration: 0.6 }}
      />

      <div className="relative flex max-w-2xl flex-col items-center">
        <div className="flex items-center gap-3">
          <motion.img
            src="/coach-avatar.svg"
            alt={say("Coach, your pencil mascot")}
            className="h-16 w-16"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 }}
          />
          <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] font-bold leading-[1.05] text-ink">
            {headline.map((w, i) => (
              <motion.span
                key={i}
                className="inline-block"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.15 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              >
                {w.wrap === 'squiggle' ? (
                  <Squiggle>{w.word}</Squiggle>
                ) : w.wrap === 'marker' ? (
                  <Marker>{w.word}</Marker>
                ) : (
                  w.word
                )}
                {i < headline.length - 1 ? ' ' : ''}
              </motion.span>
            ))}
          </h1>
        </div>

        <motion.p
          className="mt-4 max-w-xl text-lg text-ink-soft"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.55 }}
        >
          
          {say("Tell me about your course, your menu, your services, or your shop — I'll sketch a plan and build the slides with you.")}
        </motion.p>

        <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
          {SUGGESTIONS.map((s, i) => (
            <motion.button
              key={s.label}
              onClick={() => onSuggestion(s.label)}
              className="rounded-wobble-sm border-2 border-dashed border-ink bg-paper-3 px-4 py-3 text-left font-heading font-semibold text-ink shadow-offset transition-all hover:-translate-y-[3px] hover:-rotate-1 hover:shadow-offset-hover active:translate-x-[2px] active:translate-y-[2px] active:shadow-offset-pressed"
              initial={{ y: 24, rotate: 1.5, opacity: 0 }}
              animate={{ y: 0, rotate: 0, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.7 + i * 0.09, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="mr-2" aria-hidden="true">{s.icon}</span>
              {say(s.label)}
            </motion.button>
          ))}
        </div>

        {isGuest && (
          <motion.p
            className="micro mt-5 text-ink-faint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1 }}
          >
            
            {say("The Coach is for members —")}{' '}
            <Link to="/auth" className="squiggle">{say("sign in")}</Link>  {say("to chat (1 🪙 per message).")}
          </motion.p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Context rail (recent notebooks + tips)                              */
/* ------------------------------------------------------------------ */

function ContextRailContent() {
  const { user } = useAuth();
  const [tipIndex, setTipIndex] = useState(0);
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <p className="micro text-ink-faint">{say("Recent notebooks")}</p>
      <div className="flex flex-col gap-2">
        {RECENT_NOTEBOOKS.slice(0, 4).map((nb, i) => (
          <motion.div
            key={nb.title}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + i * 0.07, duration: 0.35 }}
          >
            <Link
              to={nb.to}
              className="flex items-center gap-2.5 rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 no-underline shadow-offset transition-all hover:-translate-y-0.5 hover:shadow-offset-hover"
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink',
                  nb.kind === 'repo' ? 'bg-yellow-soft' : 'bg-blue-soft',
                )}
              >
                {nb.kind === 'repo' ? (
                  <BookOpen className="h-4 w-4 text-ink" strokeWidth={2} />
                ) : (
                  <Clapperboard className="h-4 w-4 text-ink" strokeWidth={2} />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-heading text-sm font-semibold text-ink">
                  {say(nb.title)}
                </span>
                <span className="micro block truncate text-[0.62rem] text-ink-faint">
                  {nb.ref} · {nb.meta}
                </span>
              </span>
            </Link>
          </motion.div>
        ))}
      </div>

      <StickyNote className="mt-2 text-sm">
        <div className="flex items-start justify-between gap-2">
          <p>{TIPS[tipIndex]}</p>
          <button
            onClick={() => setTipIndex((i) => (i + 1) % TIPS.length)}
            aria-label={say("Next tip")}
            className="shrink-0 rounded-full p-1 transition-transform duration-300 hover:rotate-180"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </StickyNote>

      <div className="mt-auto border-t-2 border-dashed border-pencil pt-3">
        {user ? (
          <TokenMeter tokens={user.tokenBalance} />
        ) : (
          <p className="micro text-ink-faint">
            <Link to="/auth" className="squiggle">
              
              {say("Sign in")}
            </Link>{' '}
            
            {say("to earn and spend 🪙 tokens.")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Home — Coach chat                                                   */
/* ------------------------------------------------------------------ */

export default function Home() {
  const navigate = useNavigate();
  const { isGuest } = useAuth();
  const coachChat = trpc.coach.chat.useMutation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [authWallOpen, setAuthWallOpen] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [recentOpen, setRecentOpen] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timersRef = useRef<number[]>([]);

  const started = messages.length > 0;

  /* cleanup pending timers on unmount */
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  /* rotate composer placeholder */
  useEffect(() => {
    const iv = window.setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length),
      3200,
    );
    return () => window.clearInterval(iv);
  }, []);

  /* auto-scroll thread to bottom (native smooth — Lenis is prevented here) */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  /* "/" focuses the composer from anywhere */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const autoGrow = () => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    }
  };

  /** Stream a coach reply token-by-token, then unfold any action cards */
  const streamCoachReply = useCallback((full: string, cards?: ActionCard[]) => {
    const id = nextId();
    setMessages((m) => [
      ...m,
      { id, role: 'coach', text: '', ts: Date.now(), streaming: true },
    ]);
    const words = full.split(' ');
    let i = 0;
    const tick = () => {
      i += 1;
      const done = i >= words.length;
      setMessages((m) =>
        m.map((msg) =>
          msg.id === id
            ? {
                ...msg,
                text: words.slice(0, i).join(' '),
                streaming: !done,
                cards: done ? cards : undefined,
              }
            : msg,
        ),
      );
      if (!done) timersRef.current.push(window.setTimeout(tick, 45));
    };
    timersRef.current.push(window.setTimeout(tick, 120));
  }, []);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;
      // No guest chat: every Coach message is charged to a signed-in account.
      if (isGuest) {
        setAuthWallOpen(true);
        return;
      }
      setMessages((m) => [...m, { id: nextId(), role: 'user', text, ts: Date.now() }]);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setSending(true);

      // real Coach endpoint — reply is fake-streamed word-by-word on arrival
      const history = [...messages.filter((m) => !m.error), { id: 'pending', role: 'user' as const, text, ts: Date.now() }]
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.text }));
      coachChat
        .mutateAsync({ messages: history })
        .then((res) => {
          setSending(false);
          streamCoachReply(res.reply, res.actions.length ? mapActions(res.actions) : undefined);
        })
        .catch(() => {
          setSending(false);
          setMessages((m) => [
            ...m,
            {
              id: nextId(),
              role: 'coach',
              text: 'My pencil slipped — the Coach could not answer just now. Tap retry to try again.',
              ts: Date.now(),
              error: true,
            },
          ]);
        });
    },
    [sending, isGuest, messages, coachChat, streamCoachReply],
  );

  /** Retry the last user message after an error bubble */
  const retryLast = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    setMessages((m) => m.filter((msg) => !msg.error));
    if (lastUser) send(lastUser.text);
  }, [messages, send]);

  /** Suggestion chip tap: text types itself into the composer (30ms/char) */
  const typeSuggestion = useCallback((text: string) => {
    setInput('');
    textareaRef.current?.focus();
    let i = 0;
    const tick = () => {
      i += 1;
      setInput(text.slice(0, i));
      autoGrow();
      if (i < text.length) timersRef.current.push(window.setTimeout(tick, 30));
    };
    tick();
  }, []);

  const surpriseMe = useCallback(() => {
    const pick = SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)];
    send(pick.label);
  }, [send]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };


  return (
    <div className="relative flex h-[calc(100dvh-4rem)]">
      {/* chat column */}
      <div className="flex flex-1 justify-center overflow-hidden">
        <div className="flex w-full max-w-chat flex-col">
          {/* thread / hero */}
          <div
            ref={threadRef}
            data-lenis-prevent
            className="flex flex-1 flex-col overflow-y-auto overscroll-contain"
          >
            {!started ? (
              <Hero onSuggestion={typeSuggestion} />
            ) : (
              <div className="flex flex-col gap-4 px-4 py-6">
                {/* day divider */}
                <div className="flex items-center gap-3 text-ink-faint">
                  <span className="h-0 flex-1 border-t-2 border-dashed border-pencil" />
                  <span className="micro">{say("Today")}</span>
                  <span className="h-0 flex-1 border-t-2 border-dashed border-pencil" />
                </div>

                <AnimatePresence initial={false}>
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 12, rotate: msg.role === 'user' ? 1 : 0 }}
                      animate={{ opacity: 1, y: 0, rotate: 0 }}
                      transition={{ duration: 0.26 }}
                      className={cn(
                        'flex gap-2.5',
                        msg.role === 'user' ? 'justify-end' : 'justify-start',
                      )}
                    >
                      {msg.role === 'coach' && (
                        <img
                          src="/coach-avatar.svg"
                          alt=""
                          className="mt-1 h-10 w-10 shrink-0 self-start"
                        />
                      )}
                      <div
                        className={cn(
                          'max-w-[85%] sm:max-w-[75%]',
                          msg.role === 'user' ? 'text-right' : 'text-left',
                        )}
                      >
                        <div
                          className={cn(
                            'inline-block border-2 border-ink px-4 py-2.5 text-left shadow-offset',
                            msg.role === 'coach'
                              ? 'rounded-wobble-2 bg-yellow-soft'
                              : 'rounded-wobble-1 bg-paper-3',
                            msg.error && 'border-red bg-red-soft',
                          )}
                        >
                          <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">
                            {msg.text}
                            {msg.streaming && <PencilCaret />}
                          </p>
                          {msg.error && (
                            <div className="mt-2">
                              <SketchButton variant="danger" size="sm" onClick={retryLast}>
                                <RotateCcw className="h-3.5 w-3.5" />  {say("Retry")}
                              </SketchButton>
                            </div>
                          )}
                        </div>
                        {msg.cards?.map((card, i) => (
                          <ActionCardView key={`${msg.id}-card-${i}`} card={card} index={i} />
                        ))}
                        <p className="micro mt-1 text-[0.62rem] text-ink-faint">
                          {new Date(msg.ts).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {msg.role === 'coach' && ' · ✦ Coach'}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {sending && (
                  <div className="flex gap-2.5">
                    <img src="/coach-avatar.svg" alt="" className="h-10 w-10" />
                    <div className="rounded-wobble-2 border-2 border-ink bg-yellow-soft px-4 py-2 shadow-offset">
                      <TypingDots />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* "Recent" button for <1440px */}
          <button
            onClick={() => setRecentOpen(true)}
            className="absolute right-4 top-3 flex items-center gap-1.5 rounded-wobble-sm border-2 border-ink bg-paper-3 px-2.5 py-1.5 font-heading text-sm font-semibold text-ink shadow-offset transition-transform hover:-translate-y-0.5 min-[1440px]:hidden"
          >
            <History className="h-4 w-4" strokeWidth={2} />  {say("Recent")}
          </button>

          {/* composer */}
          <div className="px-4 pb-4 pt-2">
            <div className="rounded-wobble-sm border-2 border-ink bg-paper-3 p-3 shadow-offset transition-shadow focus-within:border-blue focus-within:shadow-[4px_4px_0_#DDE9FB]">
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-1 pb-1">
                  <button
                    onClick={() => navigate('/lesson-path')}
                    title={say("New repo")}
                    aria-label={say("New repo")}
                    className="rounded-wobble-sm p-1.5 text-ink-soft transition-all duration-300 hover:rotate-2 hover:bg-paper-2 hover:text-ink"
                  >
                    <BookOpen className="h-[18px] w-[18px]" strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => navigate('/slides/new')}
                    title={say("New slide tool")}
                    aria-label={say("New slide tool")}
                    className="rounded-wobble-sm p-1.5 text-ink-soft transition-all duration-300 hover:rotate-2 hover:bg-paper-2 hover:text-ink"
                  >
                    <Clapperboard className="h-[18px] w-[18px]" strokeWidth={2} />
                  </button>
                  <button
                    onClick={surpriseMe}
                    title={say("Surprise me")}
                    aria-label={say("Surprise me")}
                    className="rounded-wobble-sm p-1.5 text-ink-soft transition-all duration-300 hover:-rotate-2 hover:bg-paper-2 hover:text-ink"
                  >
                    <Dices className="h-[18px] w-[18px]" strokeWidth={2} />
                  </button>
                </div>
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    autoGrow();
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={PLACEHOLDERS[placeholderIdx]}
                  aria-label={say("Message the Coach")}
                  className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 font-body text-[0.95rem] text-ink placeholder:text-ink-faint focus:outline-none"
                />
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || sending}
                  aria-label={say("Send message")}
                  className="rounded-wobble-sm border-2 border-ink bg-ink p-2.5 text-paper-3 shadow-offset transition-all hover:bg-[#3d352b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-offset-pressed disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
              </div>
            </div>
            {isGuest && (
              <p className="mt-1.5 text-center font-mono text-xs text-ink-faint">
                
                {say("Sign in to chat — each Coach message costs 1 🪙")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* right context rail (≥1440px) */}
      <motion.aside
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.5 }}
        className="hidden w-[300px] shrink-0 border-l-2 border-dashed border-pencil min-[1440px]:block"
      >
        <ContextRailContent />
      </motion.aside>

      {/* Recent drawer (<1440px) */}
      <AnimatePresence>
        {recentOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-[65] bg-ink/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setRecentOpen(false)}
            />
            <motion.aside
              className="fixed right-0 top-0 z-[66] h-full w-[300px] border-l-2 border-ink bg-paper-3"
              initial={{ x: 300 }}
              animate={{ x: 0 }}
              exit={{ x: 300 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="flex justify-end p-2">
                <button
                  onClick={() => setRecentOpen(false)}
                  aria-label={say("Close recent notebooks")}
                  className="rounded-wobble-sm p-1.5 text-ink-soft hover:bg-paper-2 hover:text-ink"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ContextRailContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AuthWall
        open={authWallOpen}
        onClose={() => setAuthWallOpen(false)}
        message="You've used your 3 free Coach messages — sign in to keep chatting and save everything you sketch."
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import SketchButton from '@/components/sketch/SketchButton';
import { Squiggle } from '@/components/sketch/Squiggle';
import { normalizeUsername, USERNAME_MAX_LENGTH } from '@contracts/types';
import { say } from '@/lib/i18n';

type Mode = 'signin' | 'signup';

const MAX_FAILURES = 5;
const LOCK_SECONDS = 30;

function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(3, score) as 0 | 1 | 2 | 3;
}

function normalizeAuthErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Something went wrong';
  const cleaned = raw.replace(/^TRPCError:|^\[\w+\]\s*/g, '').slice(0, 220);
  const lowered = cleaned.toLowerCase();
  if (
    lowered.includes('not valid json') ||
    lowered.includes('unexpected token') ||
    lowered.includes('gateway timeout') ||
    lowered.includes('an error occurred with your deployment') ||
    lowered.includes('timed out')
  ) {
    // Keep the friendly headline but preserve the underlying cause — hiding
    // it made server-side problems (unreachable DB, locks) undiagnosable.
    return `Sign-in service timed out. Please try again in a few seconds. — ${cleaned}`;
  }
  return cleaned;
}

export default function Auth() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const { user, login, register } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // countdown while locked out
  useEffect(() => {
    if (!lockedUntil) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [lockedUntil]);
  const lockRemaining = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;

  // already signed in → bounce
  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, navigate, next]);

  const strength = useMemo(() => passwordStrength(password), [password]);
  const strengthLabel = ['', 'Wobbly', 'Decent', 'Strong'][strength];

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (mode === 'signup' && !name.trim()) e.name = 'Give your notebook a name';
    // signin also accepts a bare username (e.g. "admin"), so the email shape
    // and 8-char rules only apply to signup
    if (mode === 'signup' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      e.email = 'Hmm, that email looks smudged';
    if (mode === 'signin' && !email.trim()) e.email = 'Email or username, please';
    if (mode === 'signup' && password.length < 8) e.password = 'At least 8 characters, please';
    if (mode === 'signin' && !password) e.password = 'Password, please';
    if (mode === 'signup' && confirm !== password) e.confirm = "These two don't match yet";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || lockRemaining > 0) return;
    setServerError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (mode === 'signin') {
        const u = await login(email.trim(), password);
        toast.success(`Welcome back, ${u.name}!`);
      } else {
        const u = await register(name.trim(), email.trim(), password);
        toast.success(say("Notebook created — welcome!"));
        void u;
      }
      setFailures(0);
      navigate(next, { replace: true });
    } catch (err) {
      setServerError(normalizeAuthErrorMessage(err));
      const n = failures + 1;
      setFailures(n);
      if (n >= MAX_FAILURES) {
        setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
        setFailures(0);
      }
    } finally {
      setBusy(false);
    }
  };

  const fieldCls = (bad?: string) =>
    cn(
      'w-full rounded-wobble-sm border-2 bg-paper-3 px-3.5 py-2.5 font-body text-ink placeholder:text-ink-faint',
      'transition-shadow focus:outline-none',
      bad
        ? 'border-red focus:border-red focus:shadow-[4px_4px_0_var(--color-red-soft,#FADFDB)]'
        : 'border-ink focus:border-blue focus:shadow-[4px_4px_0_#DDE9FB]',
    );

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col min-[900px]:flex-row">
      {/* ── form panel ─────────────────────────────────────────── */}
      <div className="relative flex flex-1 items-center justify-center px-6 py-10 min-[900px]:max-w-[46%]">
        <Link
          to="/"
          className="absolute left-5 top-5 flex items-center gap-2 no-underline"
          aria-label={say("Back to home")}
        >
          <img src="/logo.svg" alt="" className="h-8 w-8" />
        </Link>
        <Link
          to="/"
          className="micro absolute right-5 top-6 text-ink-soft no-underline hover:text-ink"
        >
          
          {say("Continue as guest →")}
        </Link>

        <motion.div
          className="w-full max-w-[400px]"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.06 } } }}
        >
          <motion.div
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
            className="mb-6 text-center"
          >
            <div className="mb-1 flex items-center justify-center gap-3">
              <img src="/logo.svg" alt={say("SketchLearn")} className="h-12 w-12" />
              <Squiggle color="yellow" className="font-display text-4xl font-bold text-ink">
                
                {say("SketchLearn")}
              </Squiggle>
            </div>
          </motion.div>

          {params.get('next') && (
            <motion.p
              variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
              className="mb-4 rounded-wobble-sm border-2 border-dashed border-blue bg-blue-soft px-3 py-2 text-center text-sm font-semibold text-ink"
            >
              
              {say("Sign in to keep creating — your draft prompt is saved.")}
            </motion.p>
          )}

          {/* mode tabs */}
          <motion.div
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
            className="mb-5 flex justify-center gap-6"
            role="tablist"
          >
            {(
              [
                ['signin', 'Sign in'],
                ['signup', 'Create account'],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setErrors({});
                  setServerError(null);
                }}
                className={cn(
                  'relative pb-1 font-heading text-lg no-underline transition-colors',
                  mode === m ? 'text-ink' : 'text-ink-faint hover:text-ink-soft',
                )}
              >
                {label}
                {mode === m && (
                  <motion.span
                    layoutId="auth-tab-underline"
                    className="absolute -bottom-0.5 left-0 right-0 h-[3px] rounded-full bg-yellow"
                    transition={{ duration: 0.2 }}
                  />
                )}
              </button>
            ))}
          </motion.div>

          {/* oauth row (decorative — email/password is the live path) */}
          <motion.div
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
            className="flex flex-col gap-2"
          >
            {['Continue with Google', 'Continue with GitHub'].map((label) => (
              <SketchButton
                key={label}
                variant="secondary"
                className="w-full"
                onClick={() => toast.info(`${label} is coming soon — email works today ✏️`)}
              >
                {label}
              </SketchButton>
            ))}
          </motion.div>

          <motion.div
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
            className="my-4 flex items-center gap-3 text-ink-faint"
          >
            <span className="h-0 flex-1 border-t-2 border-dashed border-pencil" />
            <span className="micro">{say("or with email")}</span>
            <span className="h-0 flex-1 border-t-2 border-dashed border-pencil" />
          </motion.div>

          {/* server error sticky note */}
          <AnimatePresence>
            {serverError && (
              <motion.div
                key="err"
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: [0, 4, -4, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="mb-4 rounded-wobble-2 border-2 border-red bg-red-soft px-3 py-2 text-sm font-semibold text-ink"
                role="alert"
              >
                ⚠ {serverError}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.form
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
            onSubmit={submit}
            className="flex flex-col gap-3"
            noValidate
          >
            <AnimatePresence initial={false} mode="popLayout">
              {mode === 'signup' && (
                <motion.div
                  key="name"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                >
                  <label className="micro mb-1 block text-ink-soft" htmlFor="auth-name">
                    
                    {say("Username — one word, max")} {USERNAME_MAX_LENGTH}  {say("characters")}
                  </label>
                  {/* Normalized as you type, so the name in the box is the name
                      you'll get. Discovering the rule from a rejected form after
                      filling in the rest would be a worse way to learn it. */}
                  <input
                    id="auth-name"
                    className={fieldCls(errors.name)}
                    value={name}
                    onChange={(e) => setName(normalizeUsername(e.target.value))}
                    placeholder={say("SamSketcher")}
                    autoComplete="username"
                    maxLength={USERNAME_MAX_LENGTH}
                  />
                  <p className="micro mt-1 text-ink-faint">
                    
                    {say("Shown publicly, and lets you sign in without your email.")}{' '}
                    {name.length}/{USERNAME_MAX_LENGTH}
                  </p>
                  {errors.name && <p className="mt-1 text-xs font-bold text-red">{errors.name}</p>}
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="micro mb-1 block text-ink-soft" htmlFor="auth-email">
                {mode === 'signin' ? 'Email or username' : 'Email'}
              </label>
              <input
                id="auth-email"
                type={mode === 'signin' ? 'text' : 'email'}
                className={fieldCls(errors.email)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={mode === 'signin' ? 'you@example.com or admin' : 'you@example.com'}
                autoComplete={mode === 'signin' ? 'username' : 'email'}
              />
              {errors.email && <p className="mt-1 text-xs font-bold text-red">{errors.email}</p>}
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <label className="micro mb-1 block text-ink-soft" htmlFor="auth-password">
                  
                  {say("Password")}
                </label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    className="text-xs font-bold text-blue hover:underline"
                    onClick={() => toast.info(say("Password reset is coming soon — ask a moderator for now ✉️"))}
                  >
                    
                    {say("Forgot?")}
                  </button>
                )}
              </div>
              <input
                id="auth-password"
                type="password"
                className={fieldCls(errors.password)}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={say("8+ characters")}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
              {mode === 'signup' && password && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="flex h-2 flex-1 overflow-hidden rounded-full border border-ink bg-paper-2">
                    <span
                      className={cn(
                        'block h-full transition-all duration-300',
                        strength <= 1 ? 'bg-yellow' : strength === 2 ? 'bg-orange' : 'bg-green',
                      )}
                      style={{ width: `${(strength / 3) * 100}%` }}
                    />
                  </span>
                  <span className="font-mono text-xs text-ink-soft">{strengthLabel}</span>
                </div>
              )}
              {errors.password && <p className="mt-1 text-xs font-bold text-red">{errors.password}</p>}
            </div>

            <AnimatePresence initial={false} mode="popLayout">
              {mode === 'signup' && (
                <motion.div
                  key="confirm"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                >
                  <label className="micro mb-1 block text-ink-soft" htmlFor="auth-confirm">
                    
                    {say("Confirm password")}
                  </label>
                  <input
                    id="auth-confirm"
                    type="password"
                    className={fieldCls(errors.confirm)}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={say("Once more")}
                    autoComplete="new-password"
                  />
                  {errors.confirm && (
                    <p className="mt-1 text-xs font-bold text-red">{errors.confirm}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <SketchButton
              type="submit"
              variant="primary"
              className="mt-1 w-full font-display text-[22px]"
              disabled={busy || lockRemaining > 0}
            >
              {busy
                ? 'Sharpening pencils…'
                : lockRemaining > 0
                  ? `Try again in ${lockRemaining}s`
                  : mode === 'signin'
                    ? 'Open my notebook'
                    : 'Start my notebook'}
            </SketchButton>

            {mode === 'signup' && (
              <p className="micro text-center text-ink-faint">
                
                {say("By joining you agree to the Terms & Privacy — the short, human versions.")}
              </p>
            )}
            <p className="text-center">
              <Link to="/" className="text-sm font-bold text-blue hover:underline">
                
                {say("Just looking? Continue as guest →")}
              </Link>
            </p>
          </motion.form>
        </motion.div>
      </div>

      {/* ── illustration panel ─────────────────────────────────── */}
      <div className="relative hidden items-center justify-center overflow-hidden border-l-2 border-dashed border-pencil bg-paper-2 min-[900px]:flex min-[900px]:flex-1">
        <motion.img
          src="/auth-illustration.svg"
          alt={say("An open sketchbook with slide frames popping out and a pencil rocket")}
          className="w-full max-w-[520px] px-10"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        />
        <motion.p
          className="absolute bottom-10 left-0 right-0 text-center font-display text-2xl text-ink-soft"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          
          {say("“Every great course starts as a doodle.”")}
        </motion.p>
      </div>
    </div>
  );
}

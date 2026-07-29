import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
  PlugZap,
  Check,
  X as XIcon,
  Coins,
  ExternalLink,
  Sparkles,
  User as UserIcon,
  SlidersHorizontal,
} from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import AuthWall from '@/components/AuthWall';
import SketchButton from '@/components/sketch/SketchButton';
import SketchCard from '@/components/sketch/SketchCard';
import SketchTable from '@/components/sketch/SketchTable';
import Chip from '@/components/sketch/Chip';
import StickyNote from '@/components/sketch/StickyNote';
import WashiTape from '@/components/sketch/WashiTape';
import TokenMeter from '@/components/sketch/TokenMeter';
import { DoodleSparkle } from '@/components/sketch/DoodleIcons';
import SketchToaster from '@/components/admin/SketchToaster';
import CountUp from '@/components/admin/CountUp';
import { GateSkeleton } from '@/components/admin/AdminGate';
import { SketchDrawer } from '@/components/admin/overlays';
import {
  LabeledField,
  SketchInput,
  SketchSelect,
  SketchTabs,
  SketchTextarea,
  SketchToggle,
  SkeletonBlock,
} from '@/components/admin/controls';
import { errMsg, formatDate, formatMoney, formatRelative } from '@/components/admin/utils';
import type {
  AiCapability,
  AiProvider,
  ApiKeyRow,
  ImageStyle,
  Level,
  PaymentRow,
  TokenLedgerRow,
  TokenPack,
} from '@contracts/types';
import { IMAGE_STYLES, LEVELS, normalizeUsername } from '@contracts/types';
import { TTS_VOICE_STORAGE_KEY } from '@/components/player/TtsReader';

const TABS = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'keys', label: 'API keys', icon: KeyRound },
  { id: 'tokens', label: 'Tokens & billing', icon: Coins },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PROVIDERS: { id: AiProvider; label: string; hint: string }[] = [
  { id: 'openai', label: 'OpenAI', hint: 'sk-… keys · text, images' },
  { id: 'anthropic', label: 'Anthropic', hint: 'sk-ant-… keys · text' },
  { id: 'gemini', label: 'Gemini', hint: 'AIza… keys · text, images, web search' },
  { id: 'elevenlabs', label: 'ElevenLabs', hint: 'xi-… keys · speech read-aloud 🔊' },
];

const CAPABILITIES: { id: AiCapability; label: string }[] = [
  { id: 'text', label: 'Text ✍️' },
  { id: 'image', label: 'Images 🖼️' },
  { id: 'tts', label: 'Speech 🔊' },
];

/* ------------------------------------------------------------------ */
/* Tab 1 — Profile                                                     */
/* ------------------------------------------------------------------ */

function ProfileTab() {
  const { user, refetch } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [whatsapp, setWhatsapp] = useState(user?.whatsapp ?? '');
  const [contactNote, setContactNote] = useState(user?.contactNote ?? '');
  const [socials, setSocials] = useState((user?.socials ?? []).join('\n'));
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const update = trpc.auth.updateProfile.useMutation({
    onSuccess: () => {
      toast.success('Profile saved ✓');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      refetch();
    },
    onError: (e) => {
      setError(errMsg(e));
      toast.error(errMsg(e));
    },
  });

  if (!user) return null;

  const wantsPasswordChange = currentPassword || newPassword || confirm;

  const save = () => {
    setError(null);
    if (!name.trim()) {
      setError('Give your notebook a name');
      return;
    }
    if (wantsPasswordChange) {
      if (!currentPassword) {
        setError('Enter your current password to change it');
        return;
      }
      if (newPassword.length < 8) {
        setError('New password needs at least 8 characters');
        return;
      }
      if (newPassword !== confirm) {
        setError("The new passwords don't match yet");
        return;
      }
    }
    update.mutate({
      name: name.trim(),
      whatsapp: whatsapp.trim(),
      contactNote: contactNote.trim(),
      socials: socials
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 6),
      ...(wantsPasswordChange ? { currentPassword, newPassword } : {}),
    });
  };

  const strength = (() => {
    if (!newPassword) return 0;
    let s = 0;
    if (newPassword.length >= 8) s++;
    if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) s++;
    if (/\d/.test(newPassword) || /[^A-Za-z0-9]/.test(newPassword)) s++;
    return s;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <SketchCard className="relative">
        <WashiTape rotate={-3} />
        <div className="flex flex-wrap items-center gap-5">
          <span className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-ink bg-purple-soft font-display text-4xl text-ink shadow-offset">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-heading text-xl font-semibold text-ink">
              {user.name}
              <Chip kind={user.role}>{user.role}</Chip>
            </p>
            <p className="truncate text-sm text-ink-soft">{user.email}</p>
            <p className="micro mt-1 text-ink-faint">
              {user.role === 'user'
                ? "You're a User — want to help moderate? Ask an admin."
                : user.role === 'moderator'
                  ? 'You keep the notebook tidy — thank you!'
                  : 'You hold the master pencil.'}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <LabeledField label="Username" helper="One word — spaces are closed up as you type.">
            <SketchInput value={name} onChange={(e) => setName(normalizeUsername(e.target.value))} />
          </LabeledField>
          <LabeledField label="Email" helper="Email is your sign-in — it can't be changed yet.">
            <SketchInput value={user.email} disabled className="opacity-60" />
          </LabeledField>
        </div>

        <div className="mt-6 border-t-2 border-dashed border-pencil pt-5">
          <p className="micro mb-1 text-ink-soft">Contact details (shown on your menu / service / shop presentations)</p>
          <p className="micro mb-3 text-[0.68rem] text-ink-faint">
            These appear at the end of a commercial presentation so viewers can reach you. Leave blank to hide.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledField label="WhatsApp number" helper="With country code, e.g. +1 555 123 4567">
              <SketchInput
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="+1 555 123 4567"
              />
            </LabeledField>
            <LabeledField label="Contact note" helper="A short line, e.g. 'DM to order · ships Mon–Fri'">
              <SketchInput
                value={contactNote}
                onChange={(e) => setContactNote(e.target.value)}
                placeholder="DM to order…"
              />
            </LabeledField>
          </div>
          <div className="mt-4">
            <LabeledField label="Social / web links" helper="One per line — full URLs or @handles">
              <textarea
                value={socials}
                onChange={(e) => setSocials(e.target.value)}
                rows={3}
                placeholder={'https://instagram.com/yourshop\n@yourhandle'}
                className="w-full resize-y rounded-wobble-sm border-2 border-ink bg-paper-3 px-3 py-2 text-sm text-ink shadow-offset outline-none focus:border-blue"
              />
            </LabeledField>
          </div>
        </div>

        <div className="mt-6 border-t-2 border-dashed border-pencil pt-5">
          <p className="micro mb-3 text-ink-soft">Change password (optional)</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <SketchInput
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
            <div>
              <SketchInput
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              {newPassword && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="relative block h-2 w-24 overflow-hidden rounded-full border border-ink bg-paper-2">
                    <span
                      className={
                        strength >= 3 ? 'block h-full bg-green transition-all' : 'block h-full bg-yellow transition-all'
                      }
                      style={{ width: `${(strength / 3) * 100}%` }}
                    />
                  </span>
                  <span className="text-xs font-bold text-ink-faint">
                    {['Wobbly', 'Wobbly', 'Decent', 'Strong'][strength]}
                  </span>
                </div>
              )}
            </div>
            <SketchInput
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              bad={!!confirm && confirm !== newPassword}
            />
          </div>
        </div>

        {error && <p className="squiggle-red mt-4 text-sm font-bold text-red">{error}</p>}

        <div className="mt-6 flex items-center gap-3">
          <SketchButton onClick={save} loading={update.isPending}>
            Save profile
          </SketchButton>
          <AnimatePresence>
            {saved && (
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                className="inline-flex items-center gap-1 font-heading font-semibold text-green"
              >
                <Check className="h-5 w-5" strokeWidth={2.5} /> Saved
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </SketchCard>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 2 — API keys (BYOK)                                             */
/* ------------------------------------------------------------------ */

function KeyRow({ row, index }: { row: ApiKeyRow; index: number }) {
  const utils = trpc.useUtils();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const test = trpc.keys.test.useMutation({
    onSettled: () => setTesting(false),
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    },
    onError: (e) => {
      setResult({ ok: false, message: errMsg(e) });
      toast.error(errMsg(e));
    },
  });

  const remove = trpc.keys.remove.useMutation({
    onSuccess: () => {
      toast.success('Key removed');
      void utils.keys.list.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const provider = PROVIDERS.find((p) => p.id === row.provider);
  const capability = CAPABILITIES.find((c) => c.id === row.capability);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.06 }}
    >
      <SketchCard index={index} className="flex flex-wrap items-center gap-3 p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-green-soft">
          <Check className="h-5 w-5 text-green" strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-heading font-semibold text-ink">
            {provider?.label ?? row.provider}
            <span className="ml-2 text-sm font-normal text-ink-soft">
              · {capability?.label ?? row.capability}
            </span>
          </p>
          <p className="truncate font-mono text-sm text-ink-faint">{row.maskedKey}</p>
        </div>
        {result && (
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            className={
              result.ok
                ? 'inline-flex items-center gap-1 text-sm font-bold text-green'
                : 'inline-flex items-center gap-1 text-sm font-bold text-red'
            }
          >
            {result.ok ? (
              <Check className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <XIcon className="h-4 w-4" strokeWidth={2.5} />
            )}
            {result.ok ? 'Connected' : 'Failed'}
          </motion.span>
        )}
        <div className="flex items-center gap-2">
          <SketchButton
            variant="ghost"
            size="sm"
            loading={testing}
            onClick={() => {
              setResult(null);
              setTesting(true);
              test.mutate({ id: row.id });
            }}
          >
            <PlugZap className="h-4 w-4" strokeWidth={2} /> Test
          </SketchButton>
          {confirmDelete ? (
            <>
              <SketchButton
                variant="danger"
                size="sm"
                loading={remove.isPending}
                onClick={() => remove.mutate({ id: row.id })}
              >
                Really remove
              </SketchButton>
              <SketchButton variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep
              </SketchButton>
            </>
          ) : (
            <SketchButton variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" strokeWidth={2} /> Remove
            </SketchButton>
          )}
        </div>
        {result && !result.ok && (
          <p className="w-full text-sm font-bold text-red">{result.message}</p>
        )}
      </SketchCard>
    </motion.div>
  );
}

/** Read-aloud voice picker — appears once an ElevenLabs speech key is saved. */
function VoicePicker() {
  const voices = trpc.tts.voices.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const [voiceId, setVoiceId] = useState<string>(
    () => localStorage.getItem(TTS_VOICE_STORAGE_KEY) ?? '',
  );

  const choose = (id: string) => {
    setVoiceId(id);
    try {
      if (id) localStorage.setItem(TTS_VOICE_STORAGE_KEY, id);
      else localStorage.removeItem(TTS_VOICE_STORAGE_KEY);
    } catch {
      /* storage best-effort */
    }
    toast.success('Read-aloud voice updated 🔊');
  };

  const list = voices.data ?? [];

  return (
    <SketchCard borderStyle="dashed" className="relative">
      <WashiTape color="blue" rotate={-2} />
      <h3 className="mb-1 flex items-center gap-2 font-heading text-lg font-semibold text-ink">
        Read-aloud voice 🔊
      </h3>
      <p className="micro mb-4 text-ink-faint">
        The voice the speaker button uses to read a paragraph aloud in the player.
      </p>
      {voices.isLoading ? (
        <SkeletonBlock lines={1} status="Fetching your voices…" />
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No voices found yet — save an ElevenLabs speech key above, then reopen this
          tab.
        </p>
      ) : (
        <LabeledField label="Voice" helper="Stored on this device — applies to every read-aloud.">
          <SketchSelect value={voiceId} onChange={(e) => choose(e.target.value)}>
            <option value="">Default (Rachel)</option>
            {list.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </SketchSelect>
        </LabeledField>
      )}
    </SketchCard>
  );
}

function ApiKeysTab() {
  const utils = trpc.useUtils();
  const keys = trpc.keys.list.useQuery();
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [capability, setCapability] = useState<AiCapability>('text');
  const [apiKey, setApiKey] = useState('');
  const [reveal, setReveal] = useState(false);

  // ElevenLabs only does speech; OpenAI/Anthropic/Gemini don't do speech here.
  useEffect(() => {
    if (provider === 'elevenlabs' && capability !== 'tts') setCapability('tts');
    if (provider !== 'elevenlabs' && capability === 'tts') setCapability('text');
  }, [provider, capability]);

  const upsert = trpc.keys.upsert.useMutation({
    onSuccess: () => {
      toast.success('Key saved — stored encrypted, never shown again ✓');
      setApiKey('');
      void utils.keys.list.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const rows = keys.data ?? [];
  const hasTextKey = rows.some((r) => r.capability === 'text');
  const hasTtsKey = rows.some((r) => r.capability === 'tts' && r.provider === 'elevenlabs');

  return (
    <div className="flex flex-col gap-5">
      <StickyNote rotate={-1.5} className="max-w-xl text-[0.95rem]">
        Bring your own keys and generation text costs drop to 0 🪙. Keys are stored
        encrypted and never shown again.
      </StickyNote>

      {hasTextKey && (
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-wobble-sm border-2 border-ink bg-purple-soft px-4 py-2.5 font-heading font-semibold text-ink shadow-offset"
        >
          <DoodleSparkle className="h-5 w-5 text-purple" />
          Your key is active — cost estimates now show 0 🪙 for text.
        </motion.p>
      )}

      {keys.isLoading ? (
        <SkeletonBlock lines={3} status="Peeking at your keyring…" />
      ) : keys.isError ? (
        <div className="rounded-wobble-sm border-2 border-red bg-red-soft p-4">
          <p className="font-bold text-red">Couldn't load your keys.</p>
          <SketchButton variant="secondary" size="sm" className="mt-2" onClick={() => keys.refetch()}>
            Try again
          </SketchButton>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-2 font-display text-2xl text-ink-faint">
          No keys yet — add one below and text generation becomes free ✦
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <KeyRow key={row.id} row={row} index={i} />
          ))}
        </div>
      )}

      <SketchCard borderStyle="dashed" className="relative">
        <WashiTape color="blue" rotate={2} />
        <h3 className="mb-4 font-heading text-lg font-semibold text-ink">Add a key</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <LabeledField label="Provider">
            <SketchSelect
              value={provider}
              onChange={(e) => setProvider(e.target.value as AiProvider)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </SketchSelect>
          </LabeledField>
          <LabeledField label="Capability">
            <SketchSelect
              value={capability}
              onChange={(e) => setCapability(e.target.value as AiCapability)}
            >
              {CAPABILITIES.filter((c) =>
                // speech is ElevenLabs-only; the others don't offer speech here
                provider === 'elevenlabs' ? c.id === 'tts' : c.id !== 'tts',
              ).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </SketchSelect>
          </LabeledField>
        </div>
        <div className="mt-4">
          <LabeledField
            label="API key"
            helper={PROVIDERS.find((p) => p.id === provider)?.hint}
          >
            <div className="relative">
              <SketchInput
                type={reveal ? 'text' : 'password'}
                placeholder="Paste your key here — it stays secret"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-11 font-mono"
                autoComplete="off"
              />
              <button
                type="button"
                aria-label={reveal ? 'Hide key' : 'Reveal key'}
                onClick={() => setReveal((r) => !r)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-wobble-sm p-1.5 text-ink-faint hover:bg-paper-2 hover:text-ink"
              >
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </LabeledField>
        </div>
        <div className="mt-4">
          <SketchButton
            variant="accent"
            loading={upsert.isPending}
            disabled={apiKey.trim().length < 8}
            onClick={() =>
              upsert.mutate({ provider, capability, apiKey: apiKey.trim() })
            }
          >
            <KeyRound className="h-4 w-4" strokeWidth={2} /> Save key
          </SketchButton>
        </div>
      </SketchCard>

      {hasTtsKey && <VoicePicker />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 3 — Tokens & billing                                            */
/* ------------------------------------------------------------------ */

const STATUS_CHIP: Record<PaymentRow['status'], { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-yellow-soft text-ink border-ink' },
  credited: { label: 'Credited', cls: 'bg-green-soft text-ink border-ink' },
  rejected: { label: 'Rejected', cls: 'bg-red-soft text-ink border-ink' },
};

function PaymentDrawer({
  pack,
  googleSheetUrl,
  onClose,
}: {
  pack: TokenPack;
  googleSheetUrl: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [payName, setPayName] = useState(user?.name ?? '');
  const [amount, setAmount] = useState(formatMoney(pack.priceCents));
  const [note, setNote] = useState('');

  const submit = trpc.payments.submitPaidNote.useMutation({
    onSuccess: () => {
      toast.success("Noted! We'll credit you soon ✓");
      void utils.payments.mine.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const perToken = pack.tokens > 0 ? pack.priceCents / pack.tokens : 0;

  const submitNote = () => {
    const composed = [
      `Name on payment: ${payName.trim() || '—'}`,
      `Amount: ${amount.trim() || formatMoney(pack.priceCents)}`,
      note.trim() ? `Note: ${note.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    submit.mutate({ packId: pack.id, note: composed });
  };

  return (
    <SketchDrawer open onClose={onClose} title={`Top up — ${pack.label}`}>
      <div className="flex flex-col gap-5">
        <SketchCard borderStyle="dashed" className="text-center">
          <p className="font-display text-5xl font-bold text-ink">
            {pack.tokens.toLocaleString()} 🪙
          </p>
          <p className="mt-1 font-mono text-lg font-bold text-orange">
            {formatMoney(pack.priceCents)}
          </p>
          <p className="micro mt-1 text-ink-faint">
            ≈ {perToken.toFixed(1)}¢ per token
          </p>
        </SketchCard>

        <ol className="flex flex-col gap-2.5">
          {[
            'Open our payment sheet and add a row with your email + amount.',
            'Come back and leave a payment note below.',
            'A moderator credits your tokens — usually within a day.',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-yellow-soft font-display text-xl font-bold text-ink">
                {i + 1}
              </span>
              <span className="pt-1 text-sm text-ink-soft">{step}</span>
            </li>
          ))}
        </ol>

        {googleSheetUrl ? (
          <a
            href={googleSheetUrl}
            target="_blank"
            rel="noreferrer"
            className="no-underline"
          >
            <SketchButton variant="accent" className="w-full justify-center">
              Open payment sheet <ExternalLink className="h-4 w-4" strokeWidth={2} />
            </SketchButton>
          </a>
        ) : (
          <p className="rounded-wobble-sm border-2 border-dashed border-pencil bg-paper-2 px-4 py-3 text-sm text-ink-soft">
            The payment sheet link isn't configured yet — ask an admin, or leave a
            note anyway and we'll sort it out.
          </p>
        )}

        <div className="border-t-2 border-dashed border-pencil pt-4">
          <p className="mb-3 font-heading font-semibold text-ink">I've paid — leave a note</p>
          <div className="flex flex-col gap-3">
            <LabeledField label="Name on the payment">
              <SketchInput value={payName} onChange={(e) => setPayName(e.target.value)} />
            </LabeledField>
            <LabeledField label="Amount sent">
              <SketchInput value={amount} onChange={(e) => setAmount(e.target.value)} />
            </LabeledField>
            <LabeledField label="Note (optional)">
              <SketchTextarea
                placeholder="Anything that helps us spot your row in the sheet…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </LabeledField>
            <SketchButton
              loading={submit.isPending}
              disabled={!payName.trim()}
              onClick={submitNote}
            >
              Submit payment note
            </SketchButton>
          </div>
        </div>
      </div>
    </SketchDrawer>
  );
}

function TokensTab() {
  const { user, refetch } = useAuth();
  const utils = trpc.useUtils();
  const balance = trpc.tokens.balance.useQuery();
  const packs = trpc.tokens.packs.useQuery();
  const mine = trpc.payments.mine.useQuery();
  const [chosen, setChosen] = useState<TokenPack | null>(null);
  const [historyTab, setHistoryTab] = useState<'topups' | 'usage'>('topups');
  const prevBalance = useRef<number | null>(null);

  // Poll on window focus so a moderator's credit shows up (count-up + toast)
  useEffect(() => {
    const onFocus = () => {
      void balance.refetch();
      void mine.refetch();
      refetch();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentBalance = balance.data?.balance ?? user?.tokenBalance ?? 0;
  useEffect(() => {
    if (prevBalance.current !== null && currentBalance > prevBalance.current) {
      toast.success(
        `+${(currentBalance - prevBalance.current).toLocaleString()} 🪙 landed in your notebook!`,
      );
      void utils.auth.me.invalidate();
    }
    prevBalance.current = currentBalance;
  }, [currentBalance, utils]);

  const ledger = balance.data?.ledger ?? [];
  const payments = mine.data ?? [];
  const sheetUrl = packs.data?.googleSheetUrl ?? '';
  const low = currentBalance < 20;

  return (
    <div className="flex flex-col gap-6">
      {/* 3a — balance hero */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <SketchCard className="relative flex flex-wrap items-center gap-6">
          <WashiTape rotate={-2} />
          <div>
            <p className="font-display text-6xl font-bold leading-none text-ink max-sm:text-5xl">
              <CountUp value={currentBalance} />
            </p>
            <p className="micro mt-2 text-ink-soft">🪙 tokens available</p>
            {low && (
              <p className="mt-2 inline-flex animate-low-pulse items-center gap-1 rounded-wobble-sm border-2 border-ink bg-orange/20 px-2 py-0.5 text-xs font-bold text-ink">
                Running low — top up below ↓
              </p>
            )}
          </div>
          <div className="min-w-[220px] flex-1">
            <TokenMeter
              tokens={currentBalance}
              max={Math.max(200, currentBalance)}
              className="pointer-events-none"
            />
            <p className="mt-2 text-xs text-ink-faint">
              Tokens power deck generation, images, and read-aloud. Text is free
              when you bring your own key (API keys tab).
            </p>
          </div>
        </SketchCard>
      </motion.div>

      {/* 3b — token packs */}
      <section>
        <h3 className="mb-3 font-heading text-xl font-semibold text-ink">
          Top up — manual payment
        </h3>
        {packs.isLoading ? (
          <SkeletonBlock lines={1} status="Counting coins…" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {(packs.data?.packs ?? []).map((pack, i) => (
              <motion.div
                key={pack.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.09, duration: 0.3 }}
              >
                <SketchCard index={i + 1} hover className="relative flex h-full flex-col items-center text-center">
                  {i === 1 && (
                    <span className="absolute -top-3 right-4 rotate-3 rounded-wobble-sm border-2 border-ink bg-purple px-2 py-0.5 text-xs font-bold text-paper-3 shadow-offset">
                      popular
                    </span>
                  )}
                  <p className="font-display text-4xl font-bold text-ink">
                    {pack.tokens.toLocaleString()}
                  </p>
                  <p className="micro text-ink-faint">{pack.label}</p>
                  <p className="mt-1 font-mono text-xl font-bold text-orange">
                    {formatMoney(pack.priceCents)}
                  </p>
                  <p className="micro mt-1 text-ink-faint">
                    ≈ {(pack.priceCents / pack.tokens).toFixed(1)}¢ / token
                  </p>
                  <SketchButton
                    variant={i === 1 ? 'accent' : 'secondary'}
                    size="sm"
                    className="mt-3"
                    onClick={() => setChosen(pack)}
                  >
                    Choose
                  </SketchButton>
                </SketchCard>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* 3c — history */}
      <section>
        <SketchTabs
          tabs={[
            { id: 'topups', label: `Top-ups (${payments.length})` },
            { id: 'usage', label: 'Usage' },
          ]}
          active={historyTab}
          onChange={(id) => setHistoryTab(id as 'topups' | 'usage')}
          className="mb-4"
        />
        {historyTab === 'topups' ? (
          <SketchTable<PaymentRow>
            rows={payments}
            rowKey={(r) => String(r.id)}
            columns={[
              {
                key: 'date',
                header: 'Submitted',
                mono: true,
                sortValue: (r) => r.createdAt.getTime(),
                render: (r) => formatRelative(r.createdAt),
              },
              {
                key: 'pack',
                header: 'Pack',
                render: (r) => (
                  <span>
                    {r.packId} ·{' '}
                    <span className="font-mono text-orange">{r.packTokens} 🪙</span>
                  </span>
                ),
              },
              {
                key: 'amount',
                header: 'Amount',
                mono: true,
                sortValue: (r) => r.amountCents,
                render: (r) => formatMoney(r.amountCents),
              },
              {
                key: 'status',
                header: 'Status',
                sortValue: (r) => r.status,
                render: (r) => {
                  const s = STATUS_CHIP[r.status];
                  return (
                    <span
                      className={`inline-flex rounded-wobble-sm border-2 border-dotted px-2 py-0.5 text-xs font-bold ${s.cls}`}
                    >
                      {s.label}
                    </span>
                  );
                },
              },
              {
                key: 'note',
                header: 'Note',
                render: (r) => (
                  <span className="block max-w-[220px] truncate text-ink-soft" title={r.note ?? ''}>
                    {r.note ?? '—'}
                  </span>
                ),
              },
            ]}
            emptyState={
              <span className="font-display text-2xl text-ink-faint">
                No top-ups yet — pick a pack above when you're ready 🪙
              </span>
            }
          />
        ) : (
          <SketchTable<TokenLedgerRow>
            rows={ledger}
            rowKey={(r) => String(r.id)}
            columns={[
              {
                key: 'date',
                header: 'Date',
                mono: true,
                sortValue: (r) => r.createdAt.getTime(),
                render: (r) => formatDate(r.createdAt),
              },
              {
                key: 'reason',
                header: 'Action',
                render: (r) => <span className="text-ink">{r.reason}</span>,
              },
              {
                key: 'delta',
                header: 'Cost 🪙',
                mono: true,
                sortValue: (r) => r.delta,
                render: (r) => (
                  <span className={r.delta < 0 ? 'font-bold text-orange' : 'font-bold text-green'}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </span>
                ),
              },
              {
                key: 'balance',
                header: 'Balance after',
                mono: true,
                sortValue: (r) => r.balanceAfter,
                render: (r) => r.balanceAfter,
              },
            ]}
            emptyState={
              <span className="font-display text-2xl text-ink-faint">
                Nothing spent yet — your ledger is a blank page ✏️
              </span>
            }
          />
        )}
      </section>

      {chosen && (
        <PaymentDrawer
          pack={chosen}
          googleSheetUrl={sheetUrl}
          onClose={() => setChosen(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 4 — Preferences (local, instant-save)                           */
/* ------------------------------------------------------------------ */

interface Prefs {
  defaultImageStyle: ImageStyle;
  defaultLevel: Level;
  defaultSlides: number;
  reducedMotion: boolean;
  emailPayment: boolean;
  emailWeekly: boolean;
}

const PREFS_KEY = 'sketchlearn:prefs';
const DEFAULT_PREFS: Prefs = {
  defaultImageStyle: 'sketch',
  defaultLevel: 'A1',
  defaultSlides: 8,
  reducedMotion: false,
  emailPayment: true,
  emailWeekly: false,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function PreferencesTab() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [stamp, setStamp] = useState(0);

  const update = (patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — prefs are best-effort */
      }
      return next;
    });
    setStamp((s) => s + 1);
  };

  return (
    <SketchCard className="relative">
      <WashiTape rotate={2} color="blue" />
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-lg font-semibold text-ink">Defaults for new decks</h3>
        <AnimatePresence>
          {stamp > 0 && (
            <motion.span
              key={stamp}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.2 }}
              className="inline-flex items-center gap-1 text-sm font-bold text-green"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} /> Saved
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-4 flex flex-col divide-y-2 divide-dashed divide-pencil">
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-heading font-semibold text-ink">Default level</p>
            <p className="text-xs text-ink-faint">Pre-selected whenever you generate a deck.</p>
          </div>
          <div className="flex gap-2">
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                onClick={() => update({ defaultLevel: lvl })}
                className="focus:outline-none"
              >
                <Chip
                  kind={lvl}
                  className={
                    prefs.defaultLevel === lvl
                      ? 'border-solid shadow-offset'
                      : 'opacity-50'
                  }
                >
                  {lvl}
                </Chip>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-heading font-semibold text-ink">Default image style</p>
            <p className="text-xs text-ink-faint">Used for generated illustrations.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {IMAGE_STYLES.map((style) => (
              <button
                key={style}
                onClick={() => update({ defaultImageStyle: style })}
                className={
                  prefs.defaultImageStyle === style
                    ? 'rounded-wobble-sm border-2 border-ink bg-yellow px-2.5 py-1 text-sm font-bold capitalize text-ink shadow-offset'
                    : 'rounded-wobble-sm border-2 border-dashed border-pencil px-2.5 py-1 text-sm font-bold capitalize text-ink-soft hover:border-ink hover:text-ink'
                }
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-heading font-semibold text-ink">Default slides per deck</p>
            <p className="text-xs text-ink-faint">Between 4 and 15 — the product promise.</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={4}
              max={15}
              value={prefs.defaultSlides}
              onChange={(e) => update({ defaultSlides: Number(e.target.value) })}
              className="h-2 w-40 cursor-pointer appearance-none rounded-full border-2 border-ink bg-paper-2 accent-[#2E2820]"
              aria-label="Default slides per deck"
            />
            <span className="w-8 text-center font-mono font-bold text-ink">
              {prefs.defaultSlides}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-heading font-semibold text-ink">Reduce motion</p>
            <p className="text-xs text-ink-faint">
              Calms wobbles and count-ups; your system setting still wins.
            </p>
          </div>
          <SketchToggle
            label="Reduce motion"
            checked={prefs.reducedMotion}
            onChange={(v) => update({ reducedMotion: v })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-heading font-semibold text-ink">Email: payment credited</p>
            <p className="text-xs text-ink-faint">Ping me when a moderator credits my top-up.</p>
          </div>
          <SketchToggle
            label="Email payment credited"
            checked={prefs.emailPayment}
            onChange={(v) => update({ emailPayment: v })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-heading font-semibold text-ink">Email: weekly summary</p>
            <p className="text-xs text-ink-faint">A gentle recap of your learning, once a week.</p>
          </div>
          <SketchToggle
            label="Email weekly summary"
            checked={prefs.emailWeekly}
            onChange={(v) => update({ emailWeekly: v })}
          />
        </div>
      </div>
    </SketchCard>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Settings() {
  const { user, isLoading, isGuest } = useAuth();
  const [params, setParams] = useSearchParams();
  const [wallDismissed, setWallDismissed] = useState(false);

  const tabParam = params.get('tab') as TabId | null;
  const activeTab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'profile';

  const setTab = (id: string) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('tab', id);
      return next;
    });
  };

  const tabContent = useMemo(() => {
    switch (activeTab) {
      case 'profile':
        return <ProfileTab />;
      case 'keys':
        return <ApiKeysTab />;
      case 'tokens':
        return <TokensTab />;
      case 'preferences':
        return <PreferencesTab />;
    }
  }, [activeTab]);

  if (isLoading) return <GateSkeleton />;

  if (isGuest || !user) {
    return (
      <>
        <GateSkeleton />
        <AuthWall
          open={!wallDismissed}
          onClose={() => setWallDismissed(true)}
          message="Settings — your profile, keys, and tokens — live in a signed-in notebook."
        />
        <SketchToaster />
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-8 lg:px-8">
      <SketchToaster />
      <p className="micro mb-1 text-ink-faint">Your control room</p>
      <h2 className="mb-5 flex items-center gap-2 font-display text-4xl font-bold text-ink">
        Settings
        <Sparkles className="h-5 w-5 text-purple" strokeWidth={2} />
      </h2>

      <SketchTabs
        tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
        active={activeTab}
        onChange={setTab}
        className="mb-6"
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
        >
          {tabContent}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

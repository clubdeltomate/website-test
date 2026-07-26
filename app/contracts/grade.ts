/* ------------------------------------------------------------------ */
/* Answer grading helpers shared by client and server.                  */
/* ------------------------------------------------------------------ */

/** Lowercase, trim, strip punctuation, collapse whitespace. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fill-blank correctness: normalized match against any accepted answer. */
export function isFillBlankCorrect(student: string, accepted: string[]): boolean {
  const n = normalizeAnswer(student);
  if (!n) return false;
  return accepted.some((a) => normalizeAnswer(a) === n);
}

/**
 * Fallback grader for a typed answer when no AI is available: token overlap
 * between the student's answer and the reference answer. Lenient — meant only
 * as a backstop so typed questions still work without an AI key.
 */
export function typedOverlapCorrect(student: string, reference: string): boolean {
  const nRef = normalizeAnswer(reference);
  const nStu = normalizeAnswer(student);
  if (!nStu || !nRef) return false;
  const stop = new Set([
    "the", "a", "an", "is", "are", "to", "of", "and", "or", "in", "on", "it",
    "that", "this", "for", "as", "with", "by", "be", "was", "were", "at",
  ]);
  const toks = (s: string) =>
    normalizeAnswer(s).split(" ").filter((w) => w.length > 2 && !stop.has(w));
  const ref = toks(reference);
  // Short / numeric reference (e.g. "0.20", "20%", "ran") — no long tokens to
  // overlap. Require the student's answer to actually CONTAIN the reference,
  // so random text ("azas") is NOT accepted just for being non-empty.
  if (ref.length === 0) return nStu.includes(nRef);
  const stu = new Set(toks(student));
  const hits = ref.filter((w) => stu.has(w)).length;
  return hits / ref.length >= 0.5;
}

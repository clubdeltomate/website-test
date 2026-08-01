import ts from 'typescript';
import { readFileSync, globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/* How much of the site is translated, and is any of the dictionary dead?
 *
 *   node scripts/i18n-coverage.mjs          numbers only
 *   node scripts/i18n-coverage.mjs --todo   plus every string still English
 *
 * Two things it answers. First, coverage: how many readable strings have a
 * Spanish entry. Second, and the reason this exists at all, dead keys — the
 * dictionary is keyed on English source text, so a key with a typo or a key
 * whose English was later reworded does not fail, it silently never applies.
 * Nothing else in the build would ever tell you.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROPS = new Set(['label', 'hint', 'blurb', 'title', 'note', 'desc', 'description', 'tip', 'quote']);


/* Everything a person can read: the literals the JSX codemod wrapped, plus
 * the ones sitting in module constants that the label pass reaches through a
 * property read. The second kind never appears in a `say("...")` call, so a
 * coverage check that only looked at those would call every nav label dead. */
/* Everything a person can read: the arguments of every say("...") call, plus
 * the literals sitting in module constants that are translated through a
 * property read instead. A check that only looked at say() calls would call
 * every nav label dead. */
const src = new Set();

for (const rel of globSync('src/**/*.{ts,tsx}', { cwd: ROOT })) {
  if (/i18n/.test(rel)) continue;
  const text = readFileSync(`${ROOT}/${rel}`, 'utf8');
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const walk = (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'say' &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      src.add(n.arguments[0].text);
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
}

for (const rel of globSync('src/**/*.{ts,tsx}', { cwd: ROOT })) {
  if (/i18n/.test(rel)) continue;
  const text = readFileSync(`${ROOT}/${rel}`, 'utf8');
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !/^[A-Z][A-Z_0-9]+$/.test(d.name.text) || !d.initializer) continue;
      const walk = (n) => {
        if (
          ts.isPropertyAssignment(n) &&
          ts.isIdentifier(n.name) &&
          PROPS.has(n.name.text) &&
          ts.isStringLiteral(n.initializer)
        ) {
          src.add(n.initializer.text);
        }
        ts.forEachChild(n, walk);
      };
      walk(d.initializer);
    }
  }
}

const es = readFileSync(`${ROOT}/src/lib/i18n.es.ts`, 'utf8');
const keys = [...es.matchAll(/^\s{2}(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_]*)):/gm)]
  .map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'").replace(/\\"/g, '"'));

/* A key is dead only if its English does not appear in the source at all.
 * Some translatable strings reach `say()` through a Record keyed by something
 * other than a label — the card's back hints, for instance — and the two
 * harvests above cannot see those. Falling back to "is this text anywhere in
 * src" keeps the check precise about what it is really for: a typo, or an
 * English string that was reworded and left its translation stranded. */
/* api/ is in the haystack too. The server's error messages are looked up in
 * the same dictionary on their way to a toast, so "Not enough coins" is a
 * perfectly real key even though it is written in a router. */
const haystack = [
  ...globSync('src/**/*.{ts,tsx}', { cwd: ROOT }),
  ...globSync('api/**/*.ts', { cwd: ROOT }),
  ...globSync('contracts/**/*.ts', { cwd: ROOT }),
]
  .filter((r) => !/i18n|\.test\./.test(r))
  .map((r) => readFileSync(`${ROOT}/${r}`, 'utf8'))
  .join('\n');
const dead = keys.filter((k) => !src.has(k) && !haystack.includes(k));
const all = [...src];
const covered = all.filter((s) => keys.includes(s));
console.log(`readable strings : ${all.length}`);
console.log(`dictionary keys  : ${keys.length}`);
console.log(`covered          : ${covered.length} (${((covered.length / all.length) * 100).toFixed(1)}%)`);
console.log(`dead keys        : ${dead.length}`);
if (dead.length) console.log(dead.map((d) => `  x ${JSON.stringify(d)}`).join('\n'));
process.exitCode = dead.length ? 1 : 0;
if (process.argv.includes('--todo')) {
  const todo = all.filter((s) => !keys.includes(s)).sort();
  console.log('\n--- untranslated ---');
  console.log(todo.map((s) => JSON.stringify(s)).join('\n'));
}

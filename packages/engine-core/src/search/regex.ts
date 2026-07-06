import type { SearchMatchRange } from './fold';
import type { SearchRegexQuery } from './types';

/**
 * The portable search-regex dialect: JavaScript `u`-mode syntax MINUS the
 * features RE2 refuses (backreferences, lookaround). The local engine
 * executes patterns with JS `RegExp`; the server executes the SAME
 * pattern with RE2, whose linear-time guarantee is the ReDoS defense.
 * Restricting both sides to the common subset keeps one query string
 * valid — and equally powerful — everywhere.
 */
export const SEARCH_REGEX_MAX_LENGTH = 512;

export type SearchRegexIssue = 'empty' | 'too-long' | 'backreference' | 'lookaround' | 'syntax';

export type SearchRegexValidation =
  | { ok: true }
  | { ok: false; issue: SearchRegexIssue; message: string };

/**
 * Validate a pattern against the dialect. Cheap and dependency-free —
 * viewers call it on keystroke for early feedback; engines re-validate
 * and reject bad patterns with `InvalidArg`.
 */
export function validateSearchRegex(pattern: string): SearchRegexValidation {
  if (pattern.length === 0) {
    return { ok: false, issue: 'empty', message: 'Pattern is empty.' };
  }
  if (pattern.length > SEARCH_REGEX_MAX_LENGTH) {
    return {
      ok: false,
      issue: 'too-long',
      message: `Pattern exceeds ${SEARCH_REGEX_MAX_LENGTH} characters.`,
    };
  }

  // One pass tracking escape/char-class state: backreferences and
  // lookaround only mean what they mean outside a character class.
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1] ?? '';
      if (!inClass && next >= '1' && next <= '9') {
        return {
          ok: false,
          issue: 'backreference',
          message: `Backreference \\${next} is not supported.`,
        };
      }
      if (!inClass && next === 'k' && pattern[i + 2] === '<') {
        return {
          ok: false,
          issue: 'backreference',
          message: 'Named backreferences (\\k<…>) are not supported.',
        };
      }
      i++; // consume the escaped char
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(' && pattern[i + 1] === '?') {
      const tag = pattern[i + 2] ?? '';
      if (tag === '=' || tag === '!') {
        return {
          ok: false,
          issue: 'lookaround',
          message: 'Lookahead ((?=…), (?!…)) is not supported.',
        };
      }
      // "(?<" is lookbehind when followed by = or !, a named GROUP otherwise.
      if (tag === '<' && (pattern[i + 3] === '=' || pattern[i + 3] === '!')) {
        return {
          ok: false,
          issue: 'lookaround',
          message: 'Lookbehind ((?<=…), (?<!…)) is not supported.',
        };
      }
    }
  }

  try {
    // `u` is the strict common ground with RE2's syntax; `m` because ^/$
    // meaning line boundaries is what page-text search wants.
    new RegExp(pattern, 'mu');
  } catch (error) {
    return { ok: false, issue: 'syntax', message: (error as Error).message };
  }
  return { ok: true };
}

/**
 * All matches of a dialect-valid pattern over the RAW page text (regex
 * does not run against folded text — case handling is the `i` flag, and
 * diacritic folding never applies). Zero-length matches are skipped:
 * search UI cannot highlight nothing, and skipping them is also the
 * infinite-loop guard for patterns like `a*`.
 */
export function matchRegex(text: string, query: SearchRegexQuery): SearchMatchRange[] {
  const valid = validateSearchRegex(query.pattern);
  if (!valid.ok) throw new Error(`Invalid search pattern (${valid.issue}): ${valid.message}`);

  const re = new RegExp(query.pattern, query.matchCase ? 'gmu' : 'gimu');
  const out: SearchMatchRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      // Advance one full code point past the empty match.
      const unit = text.charCodeAt(re.lastIndex);
      re.lastIndex += unit >= 0xd800 && unit <= 0xdbff ? 2 : 1;
      continue;
    }
    out.push({ start: m.index, length: m[0].length });
  }
  return out;
}

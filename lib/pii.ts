export type PrivacyMode = "protect" | "review" | "exact";

export interface PiiMatch {
  kind: "candidate name" | "email" | "phone" | "web profile" | "street address" | "government identifier";
  value: string;
  token: string;
  occurrences: number;
}

const PATTERNS: Array<{ kind: PiiMatch["kind"]; pattern: RegExp }> = [
  { kind: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  // An explicit + prefix is the conservative signal for international forms.
  // The digit count follows E.164's broad 8..15 digit envelope without
  // claiming that every national numbering plan is understood here.
  { kind: "phone", pattern: /(?<![\p{L}\p{N}\p{M}])\+\d(?:[.()\-\p{Z}\s]*\d){7,14}(?!\d)/gu },
  // US/NANP-shaped values, including compact and parenthesized forms commonly
  // pasted from resumes. Exact ten-digit delimiting avoids matching inside a
  // longer account or card number.
  { kind: "phone", pattern: /(?<![\p{L}\p{N}\p{M}])(?:\+?1[.\-\p{Z}\s]?)?(?:\(\d{3}\)|\d{3})[.\-\p{Z}\s]?\d{3}[.\-\p{Z}\s]?\d{4}(?![\p{L}\p{N}\p{M}])/gu },
  // Delimit the complete value so dates and longer account/card numbers do not
  // produce a partial match. Compact identifiers can still collide with an
  // unrelated nine-digit identifier; review mode exists for that ambiguity.
  { kind: "government identifier", pattern: /(?<![\p{L}\p{N}\p{M}])(?:\d{3}-\d{2}-\d{4}|\d{3}[\p{Z}\s]\d{2}[\p{Z}\s]\d{4}|\d{9})(?![\p{L}\p{N}\p{M}])/gu },
  // Infer only well-known profile hosts. Generic URLs may identify an
  // employer, project, portfolio, or documentation page.
  { kind: "web profile", pattern: /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/[A-Z0-9_.%-]+|github\.com\/[A-Z0-9-]+|gitlab\.com\/[A-Z0-9_.-]+)(?![A-Z0-9_.\/-])\/?(?:[?#][^\s)\]}]*)?/gi },
  { kind: "street address", pattern: /\b\d{1,6}\s+[A-Z0-9.' -]{2,50}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way)\b[.,]?/gi },
];

export interface ProtectPiiOptions {
  /**
   * Names the user explicitly identifies as their own. Names are not guessed:
   * arbitrary proper-name detection creates unsafe false positives and misses
   * too many cultures and formats to support an automatic claim.
   */
  candidateNames?: readonly string[];
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function candidateNamePatterns(names: readonly string[]): RegExp[] {
  const unique = new Set<string>();
  const patterns: RegExp[] = [];
  for (const rawName of names) {
    const name = rawName.trim().replace(/[\p{Z}\s]+/gu, " ").normalize("NFC");
    const identity = name.toLocaleLowerCase().normalize("NFC");
    if (name.length < 2 || name.length > 120 || !/\p{L}/u.test(name) || unique.has(identity)) continue;
    unique.add(identity);
    const body = name.split(" ").map((word) => {
      const graphemes = word.normalize("NFD").match(/\P{M}\p{M}*/gu) ?? [];
      return graphemes.map((grapheme) => {
        const variants = [...new Set([grapheme.normalize("NFC"), grapheme.normalize("NFD")])].map(escapePattern);
        return variants.length === 1 ? variants[0] : `(?:${variants.join("|")})`;
      }).join("");
    }).join("[\\p{Z}\\s]+");
    patterns.push(new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${body}(?![\\p{L}\\p{N}\\p{M}])`, "giu"));
  }
  return patterns;
}

export function protectPii(text: string, options: ProtectPiiOptions = {}): { text: string; matches: PiiMatch[] } {
  let protectedText = text;
  const matches: PiiMatch[] = [];
  const tokenPrefix = randomTokenPrefix(text);

  const replaceMatches = (kind: PiiMatch["kind"], pattern: RegExp) => {
    protectedText = protectedText.replace(pattern, (value) => {
      const existing = matches.find((match) => match.value === value && match.kind === kind);
      if (existing) { existing.occurrences += 1; return existing.token; }
      const token = `[[RF_${tokenPrefix}_${kind.toUpperCase().replace(/\s+/g, "_")}_${matches.length + 1}]]`;
      matches.push({ kind, value, token, occurrences: 1 });
      return token;
    });
  };

  for (const pattern of candidateNamePatterns(options.candidateNames ?? [])) {
    replaceMatches("candidate name", pattern);
  }
  for (const { kind, pattern } of PATTERNS) {
    replaceMatches(kind, pattern);
  }
  return { text: protectedText, matches };
}

function randomTokenPrefix(source: string): string {
  const cryptoProvider = globalThis.crypto;
  if (!cryptoProvider?.getRandomValues) throw new Error("Secure random values are required for PII protection.");
  for (;;) {
    const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
    const prefix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!source.includes(`[[RF_${prefix}_`)) return prefix;
  }
}

export function restorePii<T>(value: T, matches: PiiMatch[]): T {
  const remaining = new Map(matches.map((match) => [match.token, match.occurrences]));
  const restore = (item: unknown): unknown => {
    if (typeof item === "string") {
      let restored = item;
      for (const match of matches) {
        restored = restored.replaceAll(match.token, () => {
          const available = remaining.get(match.token) ?? 0;
          if (available <= 0) return `[Personal information withheld: unexpected repeated ${match.kind} placeholder]`;
          remaining.set(match.token, available - 1);
          return match.value;
        });
      }
      return restored;
    }
    if (Array.isArray(item)) return item.map(restore);
    if (item && typeof item === "object") {
      const entries = Object.entries(item);
      const priority = new Map(["tailored_resume_markdown", "cover_letter_markdown"].map((key, index) => [key, index]));
      entries.sort(([left], [right]) => {
        const leftPriority = priority.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = priority.get(right) ?? Number.MAX_SAFE_INTEGER;
        return leftPriority - rightPriority || (left < right ? -1 : left > right ? 1 : 0);
      });
      return Object.fromEntries(entries.map(([key, nested]) => [key, restore(nested)]));
    }
    return item;
  };
  return restore(value) as T;
}

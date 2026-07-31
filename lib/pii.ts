export type PrivacyMode = "protect" | "review" | "exact";

export interface PiiMatch {
  kind: "candidate name" | "email" | "phone" | "web profile" | "street address" | "government identifier";
  value: string;
  token: string;
}

const PATTERNS: Array<{ kind: PiiMatch["kind"]; pattern: RegExp }> = [
  { kind: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  // An explicit + prefix is the conservative signal for international forms.
  // The digit count follows E.164's broad 8..15 digit envelope without
  // claiming that every national numbering plan is understood here.
  { kind: "phone", pattern: /(?<![\p{L}\p{N}])\+\d(?:[ .()\-]*\d){7,14}(?!\d)/gu },
  // US/NANP-shaped values, including compact and parenthesized forms commonly
  // pasted from resumes. Exact ten-digit delimiting avoids matching inside a
  // longer account or card number.
  { kind: "phone", pattern: /(?<![\p{L}\p{N}])(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}(?![\p{L}\p{N}])/gu },
  // Delimit the complete value so dates and longer account/card numbers do not
  // produce a partial match. Compact identifiers can still collide with an
  // unrelated nine-digit identifier; review mode exists for that ambiguity.
  { kind: "government identifier", pattern: /(?<![\p{L}\p{N}])(?:\d{3}-\d{2}-\d{4}|\d{3} \d{2} \d{4}|\d{9})(?![\p{L}\p{N}])/gu },
  { kind: "web profile", pattern: /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in|github\.com|gitlab\.com|[A-Z0-9.-]+\.[A-Z]{2,})\/[^\s)\]}]+/gi },
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
    const name = rawName.trim().replace(/\s+/g, " ");
    const identity = name.toLocaleLowerCase();
    if (name.length < 2 || name.length > 120 || !/\p{L}/u.test(name) || unique.has(identity)) continue;
    unique.add(identity);
    const body = name.split(" ").map(escapePattern).join("\\s+");
    patterns.push(new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu"));
  }
  return patterns;
}

export function protectPii(text: string, options: ProtectPiiOptions = {}): { text: string; matches: PiiMatch[] } {
  let protectedText = text;
  const matches: PiiMatch[] = [];

  const replaceMatches = (kind: PiiMatch["kind"], pattern: RegExp) => {
    protectedText = protectedText.replace(pattern, (value) => {
      const existing = matches.find((match) => match.value === value && match.kind === kind);
      if (existing) return existing.token;
      const token = `[[RF_${kind.toUpperCase().replace(/\s+/g, "_")}_${matches.length + 1}]]`;
      matches.push({ kind, value, token });
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

export function restorePii<T>(value: T, matches: PiiMatch[]): T {
  if (typeof value === "string") {
    let restored = value as string;
    for (const match of matches) restored = restored.split(match.token).join(match.value);
    return restored as T;
  }
  if (Array.isArray(value)) return value.map((item) => restorePii(item, matches)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, restorePii(item, matches)]),
    ) as T;
  }
  return value;
}

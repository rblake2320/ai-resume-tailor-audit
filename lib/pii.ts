export type PrivacyMode = "protect" | "review" | "exact";

export interface PiiMatch {
  kind: "email" | "phone" | "web profile" | "street address" | "government identifier";
  value: string;
  token: string;
}

const PATTERNS: Array<{ kind: PiiMatch["kind"]; pattern: RegExp }> = [
  { kind: "government identifier", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "phone", pattern: /(?<!\d)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)/g },
  { kind: "web profile", pattern: /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in|github\.com|gitlab\.com|[A-Z0-9.-]+\.[A-Z]{2,})\/[^\s)\]}]+/gi },
  { kind: "street address", pattern: /\b\d{1,6}\s+[A-Z0-9.' -]{2,50}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way)\b[.,]?/gi },
];

export function protectPii(text: string): { text: string; matches: PiiMatch[] } {
  let protectedText = text;
  const matches: PiiMatch[] = [];
  for (const { kind, pattern } of PATTERNS) {
    protectedText = protectedText.replace(pattern, (value) => {
      const existing = matches.find((match) => match.value === value && match.kind === kind);
      if (existing) return existing.token;
      const token = `[[RF_${kind.toUpperCase().replace(/\s+/g, "_")}_${matches.length + 1}]]`;
      matches.push({ kind, value, token });
      return token;
    });
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

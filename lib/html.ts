/** Minimal, dependency-free HTML → text extraction for job postings. */

const DROP_TAGS = ["script", "style", "noscript", "svg", "iframe", "nav", "footer", "aside", "form"];

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  try {
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  } catch {
    return "";
  }
}

export function htmlToText(html: string): string {
  let s = html;
  for (const tag of DROP_TAGS) {
    s = s.replace(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, "gi"), " ");
  }
  s = s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|ul|ol|table|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1]).trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? decodeEntities(title[1]).replace(/\s+/g, " ").trim() : "";
}

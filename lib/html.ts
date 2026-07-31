/** Minimal, dependency-free HTML → text extraction for job postings. */

const DROP_TAGS = ["script", "style", "noscript", "svg", "iframe", "nav", "footer", "aside", "form", "head", "title", "template"];
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_DROP_TAGS = new Set(["script", "style", "noscript", "iframe", "title"]);
const RAW_VISIBLE_TAGS = new Set(["textarea", "xmp"]);

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

/** Find a tag's closing `>` without treating `>` inside a quoted attribute as markup. */
function findTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return index;
  }
  return -1;
}

/** HTML raw/RCDATA elements recognize only their own literal end tag. */
function findRawTextClose(html: string, start: number, name: string): { open: number; end: number } | null {
  const pattern = new RegExp(`</${name}(?=[\\s/>])`, "gi");
  pattern.lastIndex = start;
  const match = pattern.exec(html);
  if (!match) return null;
  const end = html.indexOf(">", match.index + match[0].length);
  return { open: match.index, end: end < 0 ? html.length : end + 1 };
}

export function htmlToText(html: string): string {
  const output: string[] = [];
  type OpenElement = { name: string; hides: boolean; previousSame: number | undefined };
  const openElements: OpenElement[] = [];
  const latestByName = new Map<string, number>();
  let hiddenDepth = 0;
  const blockTags = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "ul", "ol", "table", "blockquote"]);
  let cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    if (open < 0) {
      if (hiddenDepth === 0) output.push(html.slice(cursor));
      break;
    }
    if (hiddenDepth === 0 && open > cursor) output.push(html.slice(cursor, open));
    if (html.startsWith("<!--", open)) {
      const commentEnd = html.indexOf("-->", open + 4);
      cursor = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }
    const close = findTagEnd(html, open + 1);
    if (close < 0) {
      if (hiddenDepth === 0) output.push(html.slice(open));
      break;
    }
    const rawTag = html.slice(open + 1, close);
    const normalized = rawTag.trimStart();
    const closingName = normalized.match(/^\/([a-z0-9-]+)/i)?.[1].toLowerCase();
    const openingName = normalized.match(/^([a-z0-9-]+)/i)?.[1].toLowerCase();
    if (closingName) {
      const matchingIndex = latestByName.get(closingName);
      if (matchingIndex !== undefined) {
        // Inside a dropped structural region, malformed ancestor closing tags
        // must not pop through still-open descendants and expose later text.
        // Conservatively keep dropping until the actual top element closes.
        if (hiddenDepth > 0 && openElements.at(-1)?.name !== closingName) {
          cursor = close + 1;
          continue;
        }
        while (openElements.length > matchingIndex) {
          const element = openElements.pop()!;
          if (element.hides) hiddenDepth -= 1;
          if (element.previousSame === undefined) latestByName.delete(element.name);
          else latestByName.set(element.name, element.previousSame);
        }
      }
      if (hiddenDepth === 0 && blockTags.has(closingName)) output.push("\n");
    } else if (openingName) {
      const attributes = normalized.slice(openingName.length);
      const style = attributes.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const explicitlyHidden = /(?:^|\s)hidden(?:\s|=|$)/i.test(attributes)
        || /aria-hidden\s*=\s*["']?true\b/i.test(attributes)
        || /display\s*:\s*none\b/i.test(style?.[1] ?? style?.[2] ?? style?.[3] ?? "");
      const hides = DROP_TAGS.includes(openingName) || explicitlyHidden;
      if (RAW_DROP_TAGS.has(openingName) || RAW_VISIBLE_TAGS.has(openingName)) {
        const rawClose = findRawTextClose(html, close + 1, openingName);
        if (RAW_VISIBLE_TAGS.has(openingName) && hiddenDepth === 0 && !explicitlyHidden) {
          output.push(html.slice(close + 1, rawClose?.open ?? html.length));
        }
        cursor = rawClose?.end ?? html.length;
        continue;
      }
      // In HTML, a trailing slash does not self-close script/style (or other
      // non-void HTML elements). Treat only actual void elements as void.
      if (!VOID_TAGS.has(openingName)) {
        const index = openElements.length;
        openElements.push({ name: openingName, hides, previousSame: latestByName.get(openingName) });
        latestByName.set(openingName, index);
        if (hides) hiddenDepth += 1;
      }
      if (hiddenDepth === 0) {
        if (openingName === "br" || openingName === "hr") output.push("\n");
        else if (openingName === "li") output.push("\n• ");
        else output.push(" ");
      }
    }
    cursor = close + 1;
  }
  const s = decodeEntities(output.join(""));
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

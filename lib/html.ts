/** Minimal, dependency-free HTML → text extraction for job postings. */

const DROP_TAGS = ["script", "style", "noscript", "svg", "iframe", "nav", "footer", "aside", "form"];
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

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
    const close = html.indexOf(">", open + 1);
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

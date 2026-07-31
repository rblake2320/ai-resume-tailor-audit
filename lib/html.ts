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
  const hidden: string[] = [];
  const blockTags = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "ul", "ol", "table", "blockquote"]);
  let cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    if (open < 0) {
      if (hidden.length === 0) output.push(html.slice(cursor));
      break;
    }
    if (hidden.length === 0 && open > cursor) output.push(html.slice(cursor, open));
    if (html.startsWith("<!--", open)) {
      const commentEnd = html.indexOf("-->", open + 4);
      cursor = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }
    const close = html.indexOf(">", open + 1);
    if (close < 0) break;
    const rawTag = html.slice(open + 1, close);
    const closing = /^\s*\//.test(rawTag);
    const name = rawTag.match(/^\s*\/?\s*([a-z0-9-]+)/i)?.[1].toLowerCase() ?? "";
    if (closing) {
      const hiddenIndex = hidden.lastIndexOf(name);
      if (hiddenIndex >= 0) hidden.splice(hiddenIndex);
      if (hidden.length === 0 && blockTags.has(name)) output.push("\n");
    } else {
      const attributes = rawTag.slice(name.length);
      const style = attributes.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const explicitlyHidden = /(?:^|\s)hidden(?:\s|=|$)/i.test(attributes)
        || /aria-hidden\s*=\s*["']?true\b/i.test(attributes)
        || /display\s*:\s*none\b/i.test(style?.[1] ?? style?.[2] ?? style?.[3] ?? "");
      const selfClosing = /\/\s*$/.test(rawTag) || VOID_TAGS.has(name);
      if ((DROP_TAGS.includes(name) || explicitlyHidden) && !selfClosing) hidden.push(name);
      if (hidden.length === 0) {
        if (name === "br" || name === "hr") output.push("\n");
        else if (name === "li") output.push("\n• ");
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

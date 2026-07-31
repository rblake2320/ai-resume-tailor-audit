/** Tiny dependency-free Markdown helpers for the resume/cover-letter views. */

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

/** Markdown → HTML. Input is escaped first, so the output is safe to inject. */
export function mdToHtml(md: string): string {
  const lines = escapeHtml(md).split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*[-*•]\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else if (line.trim() === "---") {
      closeList();
      out.push("<hr>");
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

/**
 * Markdown → the plain text an ATS parser would extract.
 * Used for the "what the ATS sees" view and .txt export.
 */
export function mdToAtsText(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      let visible = line
        .replace(/^#{1,4}\s+/, "")
        .replace(/^\s*[-*•]\s+/, "• ")
        .replace(/^---$/, "");
      // Two passes unwrap nested emphasis such as **Built *CI* pipelines**.
      for (let pass = 0; pass < 2; pass += 1) {
        visible = visible
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2");
      }
      return visible.trimEnd();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

/** Split a markdown line into TextRuns, honoring **bold**. */
function runs(text: string, base?: { size?: number }): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part) => {
    const bold = part.startsWith("**") && part.endsWith("**");
    return new TextRun({
      text: bold ? part.slice(2, -2) : part.replace(/\*([^*]+)\*/g, "$1"),
      bold,
      size: base?.size,
    });
  });
}

/**
 * Convert resume/cover-letter Markdown into an ATS-safe single-column DOCX.
 * Standard headings, no tables, no text boxes — parses cleanly in Workday,
 * Greenhouse, Lever, and iCIMS.
 */
export function markdownToDocx(md: string): Document {
  const children: Paragraph[] = [];

  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*[-*•]\s+(.*)$/);

    if (h) {
      const level = h[1].length;
      children.push(
        new Paragraph({
          children: runs(h[2]),
          heading:
            level === 1
              ? HeadingLevel.TITLE
              : level === 2
                ? HeadingLevel.HEADING_1
                : HeadingLevel.HEADING_2,
          alignment: level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: level === 1 ? 0 : 220, after: 80 },
        }),
      );
    } else if (li) {
      children.push(
        new Paragraph({
          children: runs(li[1]),
          bullet: { level: 0 },
          spacing: { after: 40 },
        }),
      );
    } else if (line.trim() !== "" && line.trim() !== "---") {
      children.push(
        new Paragraph({ children: runs(line), spacing: { after: 80 } }),
      );
    }
  }

  return new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 21 } }, // 10.5pt
        title: { run: { font: "Calibri", size: 34, bold: true } },
        heading1: { run: { font: "Calibri", size: 25, bold: true } },
        heading2: { run: { font: "Calibri", size: 22, bold: true } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 864, right: 864 },
          },
        },
        children,
      },
    ],
  });
}

export async function downloadDocx(md: string, filename: string): Promise<void> {
  const blob = await Packer.toBlob(markdownToDocx(md));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

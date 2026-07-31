import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { Packer } from "docx";
import { describe, expect, it } from "vitest";
import { markdownToDocx } from "./docx-export";
import { mdToAtsText } from "./markdown";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("document export regressions", () => {
  it("round-trips the meaningful resume text through the generated DOCX XML", async () => {
    const markdown = [
      "# JANE DOE",
      "jane@example.test | Austin, TX",
      "## EXPERIENCE",
      "### Example Corp",
      "- Built **reliable systems** for 4,000 users.",
      "- Reduced latency by 38%.",
    ].join("\n");
    const bytes = await Packer.toBuffer(markdownToDocx(markdown));
    const archive = await JSZip.loadAsync(bytes);
    const xml = await archive.file("word/document.xml")!.async("string");
    const text = xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
    for (const meaningfulLine of mdToAtsText(markdown).split("\n").filter(Boolean)) {
      expect(text).toContain(meaningfulLine.replace(/^• /, ""));
    }
  });

  it("keeps an always-present printable document for ATS and edit modes", () => {
    const component = source("components/ResultView.tsx");
    const css = source("app/globals.css");
    expect(component).toContain('data-print-area');
    expect(component).toContain('data-print-kind={tab}');
    expect(component).toContain('className="print-document"');
    expect(css).toMatch(/\.print-document\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/@media print[\s\S]*\.print-document\s*\{[^}]*display:\s*block\s*!important/s);
  });

  it("has narrow-screen-safe connector controls and announces completed results", () => {
    const connectors = source("components/SourceConnectors.tsx");
    const page = source("app/page.tsx");
    expect(connectors).not.toMatch(/className="[^"]*\bmin-w-48\b/);
    expect(page).toContain('role="status" aria-live="polite"');
    expect(page).toContain("Tailored documents are ready");
  });
});

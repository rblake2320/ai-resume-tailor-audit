import { describe, expect, it } from "vitest";
import { mdToAtsText, mdToHtml } from "./markdown";

const MD = `# Jane Doe
jane@example.com | Austin, TX

## Experience

### Senior Engineer — Acme
- Built **CI/CD** pipelines
- Cut costs *38%*

---
`;

describe("mdToHtml", () => {
  it("renders headings, lists, bold, italic, and rules", () => {
    const html = mdToHtml(MD);
    expect(html).toContain("<h1>Jane Doe</h1>");
    expect(html).toContain("<h2>Experience</h2>");
    expect(html).toContain("<h3>Senior Engineer — Acme</h3>");
    expect(html).toContain("<li>Built <strong>CI/CD</strong> pipelines</li>");
    expect(html).toContain("<em>38%</em>");
    expect(html).toContain("<hr>");
  });

  it("escapes raw HTML — output is injection-safe", () => {
    const html = mdToHtml(`# Hi <script>alert(1)</script>`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("closes lists before non-list content", () => {
    const html = mdToHtml("- one\n- two\n\nafter");
    expect(html).toContain("</ul>\n<p>after</p>");
  });
});

describe("mdToAtsText", () => {
  it("strips markdown syntax into clean parser text", () => {
    const text = mdToAtsText(MD);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Experience");
    expect(text).toContain("• Built CI/CD pipelines");
    expect(text).not.toContain("**");
    expect(text).not.toContain("#");
    expect(text).not.toContain("---");
  });

  it("collapses excess blank lines", () => {
    expect(mdToAtsText("a\n\n\n\nb")).toBe("a\n\nb");
  });
});

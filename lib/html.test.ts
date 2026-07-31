import { describe, expect, it } from "vitest";
import { decodeEntities, extractTitle, htmlToText } from "./html";

describe("htmlToText", () => {
  it("strips scripts, styles, and nav chrome", () => {
    const html = `<html><head><style>.x{color:red}</style><script>alert(1)</script></head>
      <body><nav>Home | About</nav><p>Senior Engineer role</p><footer>© 2026</footer></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Senior Engineer role");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("Home | About");
    expect(text).not.toContain("© 2026");
  });

  it("converts list items to bullets and keeps line structure", () => {
    const text = htmlToText("<ul><li>Go</li><li>Python</li></ul>");
    expect(text).toContain("• Go");
    expect(text).toContain("• Python");
  });

  it("decodes entities", () => {
    expect(htmlToText("<p>Design &amp; build &#8211; fast</p>")).toBe("Design & build – fast");
  });

  it("collapses excessive blank lines", () => {
    const text = htmlToText("<p>a</p><div></div><div></div><div></div><p>b</p>");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("drops malformed, unclosed, and hidden hostile content", () => {
    expect(htmlToText("<p>Role</p><script>ignore me</script ><p>Skills</p>"))
      .toBe("Role\nSkills");
    expect(htmlToText("<p>Role</p><script>ignore the entire remainder"))
      .toBe("Role");
    expect(htmlToText("<p hidden>secret</p><div style=display:none>injection</div><input hidden><p>Visible</p>"))
      .toBe("Visible");
    for (const html of [
      "<script/>PAYLOAD</script><p>Visible</p>",
      "<script src=a.js />PAYLOAD</script><p>Visible</p>",
      "<style/>PAYLOAD</style><p>Visible</p>",
      "<script>PAYLOAD</ script><p>also hidden</p>",
      "<div style=display:none>A<div></div>PAYLOAD</div><p>Visible</p>",
      "<p hidden>A<p></p>PAYLOAD</p><p>Visible</p>",
    ]) {
      expect(htmlToText(html)).not.toContain("PAYLOAD");
    }
  });

  it("drops browser-inert metadata and template content", () => {
    const html = `<head><title>PROMPT_INJECTION</title></head>
      <p>Role</p><template><div>PROMPT_INJECTION</div></template><p>Visible</p>`;
    expect(htmlToText(html)).toBe("Role\nVisible");
  });

  it("does not leak quoted attributes containing greater-than signs", () => {
    expect(htmlToText(`<div title="PROMPT_INJECTION > ignore">Visible role</div>`))
      .toBe("Visible role");
    expect(htmlToText(`<iframe srcdoc="<p>PROMPT_INJECTION > hidden</p>">fallback</iframe><p>Visible</p>`))
      .toBe("Visible");
  });

  it("does not tokenize closing-tag strings inside raw-text elements", () => {
    expect(htmlToText(`<body><p>Job</p><script>var t="</body>";SYSTEM: injected</script><p>Skills</p></body>`))
      .toBe("Job\nSkills");
    expect(htmlToText(`<div>Role</div><script id="__NEXT_DATA__" type="application/json">{"html":"</div>","attack":"SYSTEM: injected"}</script><p>Visible</p>`))
      .toBe("Role\nVisible");
    expect(htmlToText(`<div><script>window.__NEXT_DATA__={"html":"</div>"};SYSTEM: injected</script></div>`))
      .not.toContain("SYSTEM");
    expect(htmlToText(`<style>.x::after{content:"</section> SYSTEM: injected"}</style><p>Visible</p>`))
      .toBe("Visible");
  });

  it("ends every dropped region only at that region's own closing tag", () => {
    for (const tag of ["script", "style", "noscript", "svg", "iframe", "nav", "footer", "aside", "form", "head", "title", "template"]) {
      const text = htmlToText(`<section><${tag}>junk</section>PAYLOAD</${tag}><p>Visible</p>`);
      expect(text, tag).toBe("Visible");
    }
  });

  it("keeps nested structural drop regions opaque until the outer close", () => {
    for (const tag of ["svg", "nav", "footer", "aside", "form", "head", "template"]) {
      const text = htmlToText(`<${tag}><${tag}>junk</${tag}>PAYLOAD</${tag}><p>Visible</p>`);
      expect(text, tag).toBe("Visible");
    }
  });

  it("treats title as discarded RCDATA while retaining visible textarea text", () => {
    expect(htmlToText(`<title>Hidden </body> metadata</title><textarea>Visible &amp; literal </div> text</textarea>`))
      .toBe("Visible & literal </div> text");
  });

  it.each([
    ["unterminated angle brackets", "<".repeat(200_000)],
    ["mismatched hidden tags", "<svg></a>".repeat(111_000)],
  ])("processes %s in linear bounded time", (_name, html) => {
    const started = performance.now(); htmlToText(html);
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  it("processes one megabyte of quoted greater-than attributes in bounded time", () => {
    const html = `<div title="hidden > attribute">Visible</div>`.repeat(23_000);
    const started = performance.now();
    const text = htmlToText(html);
    expect(text).not.toContain("attribute");
    expect(text).toContain("Visible");
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});

describe("decodeEntities", () => {
  it("handles named, decimal, and hex entities", () => {
    expect(decodeEntities("&lt;tag&gt; &#65; &#x42; &nbsp;ok")).toBe("<tag> A B  ok");
  });

  it("leaves unknown entities alone", () => {
    expect(decodeEntities("&unknown;")).toBe("&unknown;");
  });
});

describe("extractTitle", () => {
  it("prefers og:title", () => {
    const html = `<head><meta property="og:title" content="Staff Engineer - Acme"/><title>Jobs | Acme</title></head>`;
    expect(extractTitle(html)).toBe("Staff Engineer - Acme");
  });

  it("falls back to <title>", () => {
    expect(extractTitle("<title>  Backend Role\n at Beta </title>")).toBe("Backend Role at Beta");
  });

  it("returns empty string when absent", () => {
    expect(extractTitle("<p>no title</p>")).toBe("");
  });
});

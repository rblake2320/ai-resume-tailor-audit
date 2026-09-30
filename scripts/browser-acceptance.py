"""Run against npm start; synthetic NDJSON faults exercise the shipped browser UI."""
import argparse
import json
from pathlib import Path
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:3147")
parser.add_argument("--output", default="docs/evidence/2026-09-30")
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
checks = []
resume = "Software engineer with experience building reliable applications. Designed services, improved testing, documented releases, supported customers, reviewed changes, maintained delivery pipelines, analyzed operational incidents, collaborated with product managers, and developed accessible interfaces. Education includes computer science and applied mathematics. Skills include TypeScript, Python, SQL, and technical writing."
job = "We seek a software engineer to develop reliable applications, collaborate with product managers, review code, improve testing, document releases, and maintain accessible interfaces using TypeScript and SQL."
result = {"match_score_before": 40, "match_score_after": 65, "score_rationale": "Synthetic transport test.",
          "changes": [], "keywords": {"matched": [], "added": [], "not_added": []},
          "gap_analysis": [], "requirement_evidence": [], "ats_checks": [],
          "tailored_resume_markdown": "# José Example\n\n## Experience\nBuilt reliable systems.",
          "cover_letter_markdown": "Dear Hiring Manager,\n\nI built reliable systems."}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.wait_for_load_state("networkidle")
    page.screenshot(path=str(output / "desktop.png"), full_page=True)
    (output / "browser-controls.json").write_text(json.dumps(page.locator("button,textarea,input,select").evaluate_all("els => els.map(e => ({tag:e.tagName,id:e.id,text:e.textContent,aria:e.getAttribute('aria-label')}))"), indent=2), encoding="utf-8")
    for width in [240, 390, 1280]:
        page.set_viewport_size({"width": width, "height": 900})
        overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        assert not overflow, f"Horizontal overflow at {width}px"
        checks.append({"scenario": f"layout-{width}px", "status": "Worked"})
    page.set_viewport_size({"width": 1280, "height": 900})
    page.locator("#resume").fill(resume)
    page.locator("#job-description").fill(job)
    forge = page.get_by_role("button", name="Forge my resume →", exact=True)
    expect(forge).to_be_enabled()
    # Actual local route refusal: no external request is needed.
    private = page.request.post(args.url + "/api/fetch-job", data={"url": "http://127.0.0.1/"})
    assert private.status == 400, private.text()
    checks.append({"scenario": "real-server-private-url-refused", "status": "Worked", "httpStatus": private.status})
    caps = page.request.get(args.url + "/api/capabilities")
    assert caps.status == 200 and caps.json()["service"] == "resume-foundry"
    checks.append({"scenario": "real-server-capabilities", "status": "Worked"})
    page.route("**/api/tailor", lambda route: route.fulfill(status=200, content_type="application/x-ndjson", body=json.dumps({"type": "result", "data": {"broken": True}}) + "\n"))
    forge.click()
    try:
        expect(page.get_by_text("The generated documents were invalid and were withheld. Try again.", exact=True)).to_be_visible()
    except Exception:
        (output / "browser-failure-text.txt").write_text(page.locator("body").inner_text(), encoding="utf-8")
        page.screenshot(path=str(output / "browser-failure.png"), full_page=True)
        raise
    assert not page.get_by_role("tab", name="Tailored resume", exact=True).count()
    checks.append({"scenario": "synthetic-malformed-result-withheld", "status": "Worked"})
    page.unroute("**/api/tailor")
    # No trailing newline: the former browser parser dropped this complete result.
    page.route("**/api/tailor", lambda route: route.fulfill(status=200, content_type="application/x-ndjson", body=json.dumps({"type": "result", "data": result}, ensure_ascii=False)))
    page.get_by_role("button", name="Retry generation", exact=True).click()
    expect(page.get_by_role("tab", name="Tailored resume", exact=True)).to_be_visible()
    expect(page.get_by_text("José Example", exact=True).first).to_be_visible()
    for label in ["What the ATS sees", "Cover letter", "Tailored resume"]:
        page.get_by_role("tab", name=label, exact=True).click()
        expect(page.get_by_role("tab", name=label, exact=True)).to_have_attribute("aria-selected", "true")
    page.get_by_role("button", name="Edit manually", exact=True).click()
    page.locator("#manual-document-editor").fill("# José Example\n\n## Experience\nReviewed edited content.")
    expect(page.locator("[data-print-area]")).to_contain_text("Reviewed edited content.")
    page.screenshot(path=str(output / "result.png"), full_page=True)
    checks.append({"scenario": "synthetic-result-no-newline-tabs-edit-print", "status": "Worked"})
    assert not errors, errors
    checks.append({"scenario": "browser-no-uncaught-errors", "status": "Worked"})
    browser.close()
report = {"observedAt": datetime.now(timezone.utc).isoformat(), "server": "npm start production build",
          "generation": "synthetic intercepted NDJSON; no live Anthropic call", "checks": checks}
(output / "browser-acceptance.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))

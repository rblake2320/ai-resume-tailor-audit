"""Read-only public board acceptance through the shipped browser; no model or employer writes."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://localhost:3100")
parser.add_argument("--board", default="anthropic")
parser.add_argument("--output", default=".resume-foundry/live-public-sources.json")
args = parser.parse_args()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.get_by_role("textbox", name="Greenhouse board token", exact=True).fill(args.board)
    page.get_by_role("button", name="Import source", exact=True).click()
    expect(page.get_by_role("button", name="Import next 20 jobs", exact=True)).to_be_visible(timeout=90_000)
    first = page.evaluate("JSON.parse(localStorage.getItem('art:job-inbox:v1') || '[]')")
    assert len(first) == 20
    page.get_by_role("button", name="Import next 20 jobs", exact=True).click()
    expect(page.get_by_text("20 imported · 0 duplicates skipped", exact=True)).to_be_visible(timeout=90_000)
    inbox = page.locator("section[aria-labelledby='job-inbox-heading']")
    expect(inbox.locator("ul > li")).to_have_count(40, timeout=90_000)
    jobs = page.evaluate("JSON.parse(localStorage.getItem('art:job-inbox:v1'))")
    assert len({job["sourceId"] for job in jobs}) == 40
    selected = jobs[0]
    inbox.get_by_role("button", name=selected["title"] + " @ " + selected["company"], exact=False).first.click()
    expect(page.locator("#job-description")).to_have_value(selected["description"])
    assert not errors
    report = {"observedAt": datetime.now(timezone.utc).isoformat(), "scenario": "live-public-Greenhouse-browser-import-two-pages-select-to-tailor", "status": "Worked", "board": args.board, "savedJobs": len(jobs), "uniqueSourceIds": 40, "selectedDescriptionChars": len(selected["description"]), "modelCalls": 0, "employerWrites": 0, "browserErrors": errors}
    browser.close()
destination = Path(args.output)
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))

"""Run against npm start; synthetic NDJSON faults exercise the shipped browser UI."""
import argparse
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--url", default="http://127.0.0.1:3147")
parser.add_argument("--output", default="docs/evidence/2026-09-30")
parser.add_argument("--live-generation-approved", action="store_true", help="Owner-approved single capped Anthropic call; consumes provider credits.")
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
    google = page.request.get(args.url + "/api/connections/google/status")
    assert google.status == 200
    checks.append({"scenario": "real-server-google-status", "status": "Worked", "configuration": google.json()})
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
    # Follow the actual browser workflow beyond the generated document.
    page.get_by_role("button", name="Save current job", exact=True).click()
    expect(page.get_by_text("1 imported · 0 duplicates skipped", exact=True)).to_be_visible()
    page.get_by_role("button", name="Save current job", exact=True).click()
    expect(page.get_by_text("0 imported · 1 duplicate skipped", exact=True)).to_be_visible()
    checks.append({"scenario": "browser-job-inbox-save-deduplicate", "status": "Worked"})
    page.get_by_role("button", name="Prepare immutable packet", exact=True).click()
    expect(page.get_by_text("Immutable packet prepared and checksummed.", exact=True)).to_be_visible()
    tracker = page.locator("section[aria-labelledby='application-tracker-heading']")
    tracker.get_by_text("Employer-authorized connectors", exact=True).click()
    tracker.get_by_role("button", name="Review official connector:", exact=False).click()
    submission = page.get_by_role("dialog", name="Authorized employer submission", exact=True)
    submission.get_by_label("Authorized board/site", exact=True).fill("synthetic-unapproved-board")
    submission.get_by_label("Job/posting identifier", exact=True).fill("123")
    submission.get_by_label("Applicant and screening fields (JSON)", exact=True).fill(json.dumps({"first_name": "Synthetic", "last_name": "Candidate", "email": "synthetic@example.com"}))
    submission.get_by_label("Human approval secret", exact=True).fill(os.environ["RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET"])
    submission.get_by_role("button", name="Build exact submission preview", exact=True).click()
    expect(submission.get_by_text("Destination: https://boards.greenhouse.io/synthetic-unapproved-board/jobs/123", exact=True)).to_be_visible()
    expect(submission.get_by_role("button", name="Approve and submit once", exact=True)).to_be_disabled()
    submission.get_by_role("checkbox").check()
    submission.get_by_role("button", name="Approve and submit once", exact=True).click()
    expect(submission.get_by_role("status")).to_contain_text("Employer-side submission authorization is not configured")
    expect(submission.get_by_role("button", name="Approve and submit once", exact=True)).to_be_disabled()
    submission.get_by_role("button", name="Close submission review", exact=True).click()
    checks.append({"scenario": "browser-exact-submission-review-unsigned-consent-and-server-allowlist-refusal", "status": "Worked", "providerRequests": 0})
    tracker.get_by_role("combobox").select_option("submitted")
    expect(tracker.get_by_role("button", name="Approve", exact=True)).to_be_visible()
    tracker.get_by_role("button", name="Approve", exact=True).click()
    expect(tracker.get_by_text("scheduled", exact=True)).to_be_visible()
    with page.expect_download() as calendar:
        tracker.get_by_role("button", name="Download calendar reminder", exact=True).click()
    calendar_path = output / "synthetic-reminder.ics"
    calendar.value.save_as(str(calendar_path))
    calendar_text = calendar_path.read_text(encoding="utf-8")
    assert "BEGIN:VEVENT" in calendar_text and "ACTION:DISPLAY" in calendar_text and "TRIGGER:-PT15M" in calendar_text
    checks.append({"scenario": "browser-approved-reminder-calendar-download", "status": "Worked", "delivery": "RFC5545 calendar event with display alarm; import required"})
    tracker.get_by_role("combobox").select_option("recruiter_response")
    tracker.get_by_role("button", name="Interview prep:", exact=False).click()
    expect(page.get_by_role("heading", name="Interview prep · Untitled role")).to_be_visible()
    page.get_by_role("button", name="Close", exact=True).click()
    checks.append({"scenario": "browser-packet-state-reminder-interview-prep", "status": "Worked", "submission": "manual bookkeeping; no employer request", "reminder": "local state; no notification delivered"})
    page.get_by_role("button", name="Guided handoff:", exact=False).click()
    expect(page.get_by_role("button", name="Open official application page", exact=True)).to_be_disabled()
    expect(page.get_by_text("This packet has no application URL. Add an official destination before handoff.", exact=True)).to_be_visible()
    page.get_by_role("button", name="Cancel", exact=True).click()
    checks.append({"scenario": "browser-handoff-missing-destination-refused", "status": "Worked"})
    page.get_by_role("textbox", name="Career vault passphrase").fill("synthetic recovery phrase 2026")
    page.get_by_role("button", name="Create encrypted ledger", exact=True).click()
    expect(page.get_by_text("Encrypted private career ledger ready.", exact=True)).to_be_visible()
    page.get_by_placeholder("What happened?", exact=True).fill("Synthetic audit project")
    page.get_by_placeholder("What did you do, learn, or accomplish?", exact=True).fill("Retained a synthetic career event for a recovery drill.")
    page.get_by_role("button", name="Append entry", exact=True).click()
    expect(page.get_by_text("Entry appended and encrypted. Earlier history was not rewritten.", exact=True)).to_be_visible()
    with page.expect_download() as download:
        page.get_by_role("button", name="Download encrypted backup", exact=True).click()
    backup_path = output / "synthetic-career-backup.json"
    download.value.save_as(str(backup_path))
    assert "Retained a synthetic career event" not in backup_path.read_text(encoding="utf-8")
    page.reload()
    page.get_by_role("textbox", name="Career vault passphrase").fill("wrong recovery phrase")
    page.get_by_role("button", name="Unlock ledger", exact=True).click()
    expect(page.get_by_placeholder("What happened?", exact=True)).to_have_count(0)
    page.get_by_role("textbox", name="Career vault passphrase").fill("synthetic recovery phrase 2026")
    vault = page.locator("section[aria-labelledby='career-ledger-heading']")
    vault.locator("input[type=file]").set_input_files(str(backup_path))
    expect(page.get_by_text("Backup decrypted, integrity-checked, and restored.", exact=True)).to_be_visible()
    expect(vault.get_by_text("Synthetic audit project", exact=True)).to_be_visible()
    expect(tracker.get_by_role("cell", name="recruiter response", exact=True)).to_be_visible()
    checks.append({"scenario": "browser-encrypted-vault-wrong-key-backup-restore-and-tracker-reload", "status": "Worked"})
    # Select one vault entry; inspect the actual outgoing browser request.
    page.get_by_placeholder("What happened?", exact=True).fill("Private unselected project")
    page.get_by_placeholder("What did you do, learn, or accomplish?", exact=True).fill("Never disclose this unselected private note.")
    page.get_by_role("button", name="Append entry", exact=True).click()
    expect(vault.get_by_text("Private unselected project", exact=True)).to_be_visible()
    page.get_by_role("checkbox", name="Select evidence: Synthetic audit project", exact=True).check()
    page.get_by_role("button", name="Use selected evidence for tailoring", exact=True).click()
    expect(page.get_by_text("Selected career evidence is approved for tailoring in this session. It is not saved to your master profile.", exact=True)).to_be_visible()
    outgoing = []
    def tailored(route):
        outgoing.append(route.request.post_data_json)
        route.fulfill(status=200, content_type="application/x-ndjson", body=json.dumps({"type": "result", "data": result}))
    page.route("**/api/tailor", tailored)
    forge.click()
    expect(page.get_by_role("tab", name="Tailored resume", exact=True)).to_be_visible()
    assert outgoing and "Synthetic audit project" in outgoing[-1]["resume"]
    assert "Never disclose this unselected private note" not in outgoing[-1]["resume"]
    profile_text = page.evaluate("localStorage.getItem('art:profile')") or ""
    assert "Retained a synthetic career event" not in profile_text
    checks.append({"scenario": "browser-selected-vault-evidence-only-reaches-tailor-request", "status": "Worked", "generation": "intercepted output, actual outgoing request inspected"})
    # Use the actual authenticated server and durable agent store, not a fixture.
    bridge = page.locator("section[aria-labelledby='agent-workspace-heading']")
    bridge.get_by_role("textbox", name="Agent API token", exact=True).fill(os.environ["RESUME_FOUNDRY_AGENT_API_TOKEN"])
    bridge.get_by_role("textbox", name="Human approval secret", exact=True).fill(os.environ["RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET"])
    bridge.get_by_role("button", name="Review agent snapshot", exact=True).click()
    expect(bridge.get_by_text("Enter an agent token and approve packet disclosure first.", exact=True)).to_be_visible()
    bridge.get_by_role("checkbox").check()
    bridge.get_by_role("button", name="Review agent snapshot", exact=True).click()
    expect(bridge.get_by_text("Reviewed agent snapshot: 0 applications. Local tracker: 1. Choose the direction explicitly.", exact=True)).to_be_visible()
    bridge.get_by_role("button", name="Publish local tracker", exact=True).click()
    expect(bridge.get_by_text("1 reviewed applications published to the audited agent workspace.", exact=True)).to_be_visible()
    headers = {"authorization": "Bearer " + os.environ["RESUME_FOUNDRY_AGENT_API_TOKEN"], "x-resume-foundry-human-approval": os.environ["RESUME_FOUNDRY_HUMAN_APPROVAL_SECRET"]}
    received = page.request.post(args.url + "/api/agent/workspace.read", headers=headers, data={"piiApproved": True, "input": {}})
    assert received.status == 200
    snapshot = received.json()["result"]
    assert len(snapshot["records"]) == 1 and snapshot["records"][0]["state"] == "recruiter_response"
    changed = page.request.post(args.url + "/api/agent/workspace.publish", headers=headers, data={"piiApproved": True, "input": {"records": [], "expectedRevision": snapshot["revision"]}})
    assert changed.status == 200
    bridge.get_by_role("button", name="Publish local tracker", exact=True).click()
    expect(bridge.get_by_text("Agent workspace changed. Reload and review before publishing.", exact=True)).to_be_visible()
    bridge.get_by_role("button", name="Review agent snapshot", exact=True).click()
    expect(bridge.get_by_text("Reviewed agent snapshot: 0 applications. Local tracker: 1. Choose the direction explicitly.", exact=True)).to_be_visible()
    bridge.get_by_role("button", name="Publish local tracker", exact=True).click()
    expect(bridge.get_by_text("1 reviewed applications published to the audited agent workspace.", exact=True)).to_be_visible()
    # Deliberately clear only synthetic local applications, then restore reviewed snapshot.
    page.evaluate("localStorage.removeItem('art:applications:v1'); window.dispatchEvent(new Event('resume-foundry:applications-imported'))")
    page.once("dialog", lambda dialog: dialog.accept())
    bridge.get_by_role("button", name="Load reviewed agent snapshot", exact=True).click()
    expect(bridge.get_by_text("Reviewed agent snapshot loaded into the local tracker.", exact=True)).to_be_visible()
    expect(tracker.get_by_role("cell", name="recruiter response", exact=True)).to_be_visible()
    checks.append({"scenario": "browser-server-agent-consent-publish-read-conflict-and-restore", "status": "Worked", "records": 1})
    if args.live_generation_approved:
        page.unroute("**/api/tailor")
        page.get_by_role("button", name="Clear tailoring evidence", exact=True).click()
        page.locator("#resume").fill(resume)
        page.locator("#job-description").fill(job)
        page.get_by_role("button", name="Forge my resume →", exact=True).click()
        try:
            expect(page.get_by_role("tab", name="Tailored resume", exact=True)).to_be_visible(timeout=190_000)
            assert page.locator("[data-print-area]").inner_text().strip()
            checks.append({"scenario": "live-Anthropic-single-capped-browser-generation", "status": "Worked", "outputTokenCap": 8192, "retries": 0})
        except Exception:
            message = page.get_by_role("alert").all_text_contents()
            report = {"observedAt": datetime.now(timezone.utc).isoformat(), "scenario": "live-Anthropic-single-capped-browser-generation", "status": "Failed", "alerts": message, "outputTokenCap": 8192, "retries": 0}
            (output / "live-generation-failure.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
            raise
    assert not errors, errors
    checks.append({"scenario": "browser-no-uncaught-errors", "status": "Worked"})
    browser.close()
report = {"observedAt": datetime.now(timezone.utc).isoformat(), "server": "npm start production build",
          "generation": "synthetic fault fixtures plus one owner-approved live call" if args.live_generation_approved else "synthetic intercepted NDJSON; no live Anthropic call", "checks": checks}
(output / "browser-acceptance.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))

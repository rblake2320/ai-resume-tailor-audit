"""Bounded real-browser gateway load; no generation or paid provider calls."""
import json, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
base = 'https://resume-foundry-private-pilot.rblake2320.workers.dev'
root = Path('.resume-foundry/pilot')
bundle = json.loads((root/'operator/owner-secrets.json').read_text(encoding='utf-8'))
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto(base+'/pilot/login')
    page.get_by_label('Invite code').fill(bundle['invites'][2]['code'])
    page.get_by_role('button',name='Enter',exact=True).click()
    expect(page.locator('#resume')).to_be_visible(timeout=30000)
    report = page.evaluate("async () => {\n      const started=performance.now(),results=[];let next=0;\n      async function run(){while(next++<200){const start=performance.now();let ok=false;try{const r=await fetch('/api/capabilities');const d=await r.json();ok=r.ok&&d.generationEnabled===true;}catch{}results.push({ok,ms:Math.round(performance.now()-start)});}}\n      await Promise.all(Array.from({length:20},run));\n      const durations=results.map(x=>x.ms).sort((a,b)=>a-b),errors=results.filter(x=>!x.ok).length;\n      return {observedAt:new Date().toISOString(),scenario:'public-authenticated-capabilities-200-reads-20-concurrent',status:errors===0&&durations[189]<3000?'Worked':'Failed',requests:results.length,concurrency:20,errors,p95Ms:durations[189],durationMs:Math.round(performance.now()-started),paidCalls:0,generationCalls:0};\n    }")
    browser.close()
(root/'hosted-load.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
if report['status']!='Worked': raise SystemExit(1)

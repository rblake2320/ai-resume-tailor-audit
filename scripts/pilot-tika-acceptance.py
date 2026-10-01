"""Actual hosted document-upload acceptance; no model or paid calls."""
import json, time, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
base='https://resume-foundry-private-pilot.rblake2320.workers.dev'
root=Path('.resume-foundry')
bundle=json.loads((root/'pilot/operator/owner-secrets.json').read_text(encoding='utf-8'))
checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page()
    page.goto(base+'/pilot/login')
    page.get_by_label('Invite code').fill(bundle['invites'][1]['code'])
    page.get_by_role('button',name='Enter',exact=True).click()
    expect(page.locator('#resume')).to_be_visible(timeout=30000)
    page.get_by_role('button',name='Allow usage sharing').click()
    expect(page.get_by_role('button',name='Withdraw and delete shared data')).to_be_visible()
    for extension in ['docx','pdf','rtf','odt']:
        started=time.monotonic()
        with page.expect_response(lambda r:'/api/parse-resume' in r.url) as response:
            page.locator('input[type=file]').first.set_input_files(str(root/f'tika-fixtures/resume.{extension}'))
        r=response.value
        body=r.json()
        assert r.status==200 and body['parser']=='apache-tika' and body['parserVersion']=='4.1.0'
        assert 'TypeScript' in body['text'] and 'dc:creator' not in body
        expect(page.locator('#resume')).to_have_value(re.compile('TypeScript'))
        checks.append(dict(scenario=f'hosted-upload-{extension}',status='Worked',durationMs=round((time.monotonic()-started)*1000)))
    # Identical bytes with a misleading extension must fail without replacing the existing résumé.
    before=page.locator('#resume').input_value()
    with page.expect_response(lambda r:'/api/parse-resume' in r.url) as response:
        page.locator('input[type=file]').first.set_input_files(dict(name='disguised.docx',mimeType='application/octet-stream',buffer=(root/'tika-fixtures/resume.odt').read_bytes()))
    assert response.value.status==415
    assert page.locator('#resume').input_value()==before
    checks.append(dict(scenario='hosted-disguised-upload-refused-preserves-profile',status='Worked'))
    page.screenshot(path=str(root/'pilot/hosted-tika-upload.png'),full_page=True)
    owner=browser.new_page()
    owner.goto(base+'/pilot/admin')
    owner.get_by_label('Owner secret').fill(bundle['ADMIN_SECRET'])
    owner.get_by_role('button',name='Enter',exact=True).click()
    expect(owner.locator('#steps')).to_contain_text('Documents uploaded',timeout=15000)
    exported=owner.evaluate("async()=>await(await fetch('/api/pilot/admin/export')).json()")
    assert exported['eventCounts'].get('upload_completed',0)==4 and exported['eventCounts'].get('upload_failed',0)==1
    assert 'TypeScript' not in json.dumps(exported)
    checks.append(dict(scenario='owner-receives-content-free-upload-success-and-error-events',status='Worked'))
    page.get_by_role('button',name='Withdraw and delete shared data').click()
    expect(page.get_by_role('button',name='Allow usage sharing')).to_be_visible()
    browser.close()
report=dict(observedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),url=base,transport='real public gateway/native upload/private Tika Docker',paidCalls=0,checks=checks)
(root/'tika-fixtures/hosted-acceptance.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))

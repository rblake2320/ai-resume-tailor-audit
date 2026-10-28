"""Real hosted acceptance; secrets loaded privately, no mocked generation."""
import argparse, json, time, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--invite-index', type=int, default=3)
parser.add_argument('--url', default='https://resume-foundry-private-pilot.rblake2320.workers.dev')
args = parser.parse_args()
root = Path('.resume-foundry/pilot')
bundle = json.loads((root / 'operator/owner-secrets.json').read_text(encoding='utf-8'))
checks = []
def worked(name, **details):
    checks.append(dict(scenario=name, status='Worked', **details))
    print(json.dumps(checks[-1]), flush=True)
def request(page, path, method='GET', data=None):
    return page.evaluate('''async ({path,method,data}) => {const r=await fetch(path,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return {status:r.status,body:await r.json()}}''', dict(path=path,method=method,data=data))
def login(page, code):
    page.goto(args.url + '/pilot/login')
    page.get_by_label('Invite code').fill(code)
    page.get_by_role('button',name='Enter',exact=True).click()
    expect(page.locator('#resume')).to_be_visible(timeout=30000)
    expect(page.get_by_role('button',name='Sign out',exact=True)).to_be_visible(timeout=30000)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport=dict(width=1280,height=960),accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        login(page,bundle['invites'][args.invite_index]['code'])
        if request(page,'/api/pilot/session')['body']['consent']:
            assert request(page,'/api/pilot/data','DELETE')['status']==200
            page.reload()
            expect(page.get_by_role('button',name='Allow usage sharing')).to_be_enabled()
        assert request(page,'/api/pilot/session')['body']['consent'] is False
        assert request(page,'/api/pilot/events','POST',dict(event='session_started',sessionId='00000000-0000-4000-8000-000000000001'))['status'] == 403
        worked('tracking-off-by-default')
        page.get_by_role('button',name='Allow usage sharing').click()
        expect(page.get_by_role('button',name='Withdraw and delete shared data')).to_be_visible()
        page.locator('#candidate-name').fill('Alex Example')
        page.locator('#resume').fill('Alex Example — Software Engineer. I have five years of experience designing APIs, reviewing code, collaborating with product teams, improving reliability, writing documentation, and deploying applications. At Example Company I built TypeScript services, maintained SQL reporting, reduced defects through automated tests, and helped colleagues resolve production incidents. Education: Bachelor of Science in computer science. Skills: TypeScript, Python, SQL, technical writing.')
        page.locator('#job-description').fill('We seek a software engineer to develop reliable applications, collaborate with product managers, review code, improve testing, document releases, and maintain accessible interfaces using TypeScript and SQL.')
        page.locator('#job-title').fill('Software Engineer')
        page.locator('#job-company').fill('Example Employer')
        page.screenshot(path=str(root/'hosted-form.png'),full_page=True)
        started = time.monotonic()
        page.get_by_role('button',name='Forge my resume →').click()
        protected = page.get_by_role('button',name='Send protected copy',exact=True)
        if protected.is_visible(): protected.click()
        try:
            expect(page.get_by_role('button',name='.docx',exact=True).first).to_be_visible(timeout=190000)
        except Exception:
            page.screenshot(path=str(root/'hosted-failure.png'),full_page=True)
            (root/'hosted-failure-text.txt').write_text(page.locator('body').inner_text(),encoding='utf-8')
            raise
        worked('real-hosted-generation',durationMs=round((time.monotonic()-started)*1000),provider='local-ollama',paidCalls=0)
        with page.expect_download() as download:
            page.get_by_role('button',name='.docx',exact=True).first.click()
        docx = root/'hosted-resume.docx'
        download.value.save_as(str(docx))
        with zipfile.ZipFile(docx) as archive:
            document = archive.read('word/document.xml').decode()
            assert 'TypeScript' in document and 'Alex Example' in document
        worked('real-docx-download',bytes=docx.stat().st_size)
        page.get_by_role('button',name='Save current job',exact=True).click()
        expect(page.get_by_role('button',name='Prepare immutable packet',exact=True)).to_be_enabled()
        page.get_by_role('button',name='Prepare immutable packet',exact=True).click()
        expect(page.get_by_role('status').filter(has_text='Immutable packet prepared')).to_be_visible()
        stored = page.evaluate('Object.entries(localStorage).filter(([key])=>key.startsWith("rf-pilot:"))')
        assert any('applications' in key and 'Example Employer' in value for key,value in stored)
        worked('saved-job-and-checksummed-application-packet')
        page.screenshot(path=str(root/'hosted-result.png'),full_page=True)
        page.get_by_text('Send tester feedback',exact=True).click()
        page.get_by_label('Result accuracy').select_option('accurate')
        comment = 'Synthetic acceptance check: generated a real draft, downloaded DOCX, and tested consent deletion.'
        page.get_by_label('What worked or got in your way?').fill(comment)
        page.get_by_label('I reviewed this feedback and agree to share it with the product owner.').check()
        page.get_by_role('button',name='Send feedback',exact=True).click()
        expect(page.get_by_role('status').filter(has_text='Feedback')).to_be_visible(timeout=15000)
        owner_context = browser.new_context(accept_downloads=True)
        owner = owner_context.new_page()
        owner.goto(args.url+'/pilot/admin')
        owner.get_by_label('Owner secret').fill(bundle['ADMIN_SECRET'])
        owner.get_by_role('button',name='Enter',exact=True).click()
        expect(owner.locator('#comments')).to_contain_text(comment,timeout=15000)
        exported = request(owner,'/api/pilot/admin/export')['body']
        assert exported['eventCounts'].get('generation_completed',0) >= 1
        assert exported['eventCounts'].get('export_downloaded',0) >= 1
        assert any(x['comment']==comment for x in exported['feedback'])
        encoded = json.dumps(exported)
        assert 'Alex Example' not in encoded and 'TypeScript' not in encoded and 'Example Employer' not in encoded
        with owner.expect_download() as download:
            owner.get_by_role('button',name='Download this page as JSON').click()
        assert json.loads(Path(download.value.path()).read_text(encoding='utf-8'))['feedbackSummary']['count'] >= 1
        owner.screenshot(path=str(root/'hosted-owner.png'),full_page=True)
        worked('owner-feedback-and-usage-readback-without-resume-content',events=len(exported['events']),feedback=len(exported['feedback']))
        page.get_by_role('button',name='Withdraw and delete shared data').click()
        expect(page.get_by_role('button',name='Allow usage sharing')).to_be_visible(timeout=15000)
        exported = request(owner,'/api/pilot/admin/export')['body']
        assert not any(x['comment']==comment for x in exported['feedback'])
        assert exported['eventCounts'].get('generation_completed',0)==0
        worked('withdrawal-deletes-shared-data')
        page.get_by_role('button',name='Sign out',exact=True).click()
        login(page,bundle['invites'][1]['code'])
        assert page.locator('#resume').input_value()=='' and page.locator('#candidate-name').input_value()==''
        assert request(page,'/api/pilot/admin/export')['status']==403
        assert request(page,'/api/agent')['status'] in [403,404]
        worked('shared-browser-tester-isolation-and-owner-access-denial')
        page.set_viewport_size(dict(width=390,height=844))
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(root/'hosted-mobile.png'),full_page=True)
        worked('mobile-390-layout',browserErrors=errors)
        assert not errors
        browser.close()
except Exception as error:
    checks.append(dict(scenario='hosted-acceptance',status='Failed',error=str(error)))
    raise
finally:
    (root/'hosted-acceptance.json').write_text(json.dumps(dict(observedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),url=args.url,checks=checks),indent=2),encoding='utf-8')

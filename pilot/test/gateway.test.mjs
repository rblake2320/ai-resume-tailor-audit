import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { cleanup } from '../src/worker.js';
import { JSDOM } from 'jsdom';
const origin='https://pilot.example', version='2026-10-01-v1';
const ids=[randomUUID(),randomUUID()], codes=['a'.repeat(32),'b'.repeat(32)];
const bindings={SESSION_SECRET:'session-synthetic-secret-'.repeat(3),ORIGIN_SECRET:'origin-synthetic-secret-'.repeat(3),ADMIN_SECRET:'admin-synthetic-secret-'.repeat(3),ORIGIN_URL:'https://synthetic-pilot.trycloudflare.com',PILOT_AI_ENABLED:'false'};
const event={event:'demo_opened',sessionId:randomUUID(),details:{device:'desktop'}};
const feedback={rating:4,accuracy:'accurate',goal:'tailor_resume',outcome:'not_tested',comment:'The review panel was clear. <img src=x onerror=window.pwned=1>',reviewed:true};
await test('actual workerd + SQLite D1 + native HTTP receiving security acceptance', async t=>{
 let received=[];
 const server=createServer(async(req,res)=>{let data='';for await(const chunk of req)data+=chunk;received.push({path:req.url,headers:req.headers,body:data});res.setHeader('content-type','application/json');res.setHeader('set-cookie','unexpected=secret');res.end(JSON.stringify({received:true}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port;
 const service=async req=>{const u=new URL(req.url);return fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`,{method:req.method,headers:req.headers,body:req.method==='POST'?await req.arrayBuffer():undefined,redirect:'manual'});};
 const config={modules:[{type:'ESModule',path:'src/worker.js',contents:await readFile(new URL('../src/worker.js',import.meta.url),'utf8')},{type:'ESModule',path:'src/dashboard.js',contents:await readFile(new URL('../src/dashboard.js',import.meta.url),'utf8')}],compatibilityDate:'2026-10-01',bindings,d1Databases:['DB'],outboundService:service};
 const mf=new Miniflare(convertV4MiniflareOptions(config));
 t.after(()=>mf.dispose());
 let db=await mf.getD1Database('DB');
 const sql=(await readFile(new URL('../migrations/0001_pilot.sql',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('../migrations/0002_consent_receipt.sql',import.meta.url),'utf8'));
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
 for(let i=0;i<2;i++)await db.prepare('INSERT INTO invites(id,code_hash,created_at,expires_at) VALUES(?,?,?,?)').bind(ids[i],createHash('sha256').update(codes[i]).digest('hex'),Date.now(),Date.now()+86400000).run();
 async function call(path,method='GET',data,cookie,extra={}) {return mf.dispatchFetch(origin+path,{method,redirect:'manual',headers:{...(method!=='GET'?{origin,'content-type':'application/json','sec-fetch-site':'same-origin'}:{}),...(cookie?{cookie}:{}),...extra},...(data!==undefined?{body:typeof data==='string'?data:JSON.stringify(data)}:{})});}
 async function login(index){const res=await call('/api/pilot/login','POST',{code:codes[index]});assert.equal(res.status,200);const cookie=res.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);return cookie.split(';')[0];}
 let a,b,admin;
 await t.test('anonymous, code-in-query, forged tokens, CSRF and invalid invite fail closed',async()=>{
  assert.equal((await call('/api/pilot/session')).status,401);
  assert.equal((await call('/')).status,302);
  assert.equal((await call('/?code=secret')).status,400);
  assert.equal((await call('/api/pilot/login','POST',{code:codes[0]},null,{origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/pilot/login','POST',{code:'c'.repeat(32)})).status,403);
  assert.equal((await call('/api/pilot/session','GET',undefined,'__Host-rf-pilot=forged.signature')).status,401);
  a=await login(0);b=await login(1);
  const rows=await db.prepare('SELECT * FROM invites').all();assert.equal(JSON.stringify(rows).includes(codes[0]),false);
 });
 await t.test('default consent off; no telemetry stored until explicit versioned consent',async()=>{
  const state=await (await call('/api/pilot/session','GET',undefined,a)).json();assert.deepEqual(state,{authenticated:true,consent:false,aiEnabled:false,consentVersion:version});
  assert.equal((await call('/api/pilot/events','POST',event,a)).status,403);
  assert.equal((await call('/api/pilot/consent','POST',{consent:true,version:'old'},a)).status,400);
  assert.equal((await call('/api/pilot/consent','POST',{consent:true,version},a)).status,200);
  assert.equal((await call('/api/pilot/consent','POST',{consent:true,version},b)).status,200);
  assert.equal((await call('/api/pilot/events','POST',event,a)).status,201);
  assert.equal((await call('/api/pilot/events','POST',event,b)).status,201);
  assert.equal((await call('/api/pilot/feedback','POST',feedback,a)).status,201);
  assert.equal((await call('/api/pilot/feedback','POST',feedback,b)).status,201);
 });
 await t.test('strict bounded telemetry rejects text/URLs/actor overrides; feedback requires review',async()=>{
  for(const bad of [{...event,participant_id:ids[1]},{...event,event:'resume_text'},{...event,details:{url:'https://secret'}},{...event,details:{durationMs:300001}},{...event,details:{count:1.5}}])assert.equal((await call('/api/pilot/events','POST',bad,a)).status,400);
  for(const bad of [{...feedback,reviewed:false},{...feedback,rating:6},{...feedback,comment:'x'.repeat(2001)},{...feedback,comment:'person@example.com'},{...feedback,comment:'https://secret.example'}])assert.equal((await call('/api/pilot/feedback','POST',bad,a)).status,400);
  assert.equal((await call('/api/pilot/events','POST',event,a,{origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/pilot/events','POST','x'.repeat(5000),a)).status,413);
 });
 await t.test('receiving native strips credentials/spoofed participant; all privileged routes blocked',async()=>{
  received=[];const res=await call('/','GET',undefined,a,{authorization:'Bearer private','x-resume-pilot-origin':'forged','x-resume-pilot-participant':ids[1],'x-api-key':'private'});
  assert.equal(res.status,200);assert.equal(res.headers.get('set-cookie'),null);
  assert.equal(received.length,1);assert.equal(received[0].headers['x-resume-pilot-origin'],bindings.ORIGIN_SECRET);assert.equal(received[0].headers['x-resume-pilot-participant'],ids[0]);
  for(const key of ['cookie','authorization','x-api-key','x-forwarded-for'])assert.equal(received[0].headers[key],undefined);
  for(const path of ['/api/agent/execute','/api/submissions/execute','/api/connections/google/actions','/api/attestation','/api/capabilities','/api/unknown'])assert.equal((await call(path,'POST',{},a)).status,403);
  assert.equal((await call('/api/tailor','POST',{},a)).status,403);assert.equal(received.length,1);
  assert.equal((await call('/api/fetch-job','POST',{},a,{origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/fetch-job','PUT',{},a)).status,403);
  assert.equal((await call('/api/capabilities','GET',undefined,a)).status,200);assert.equal(received.at(-1).path,'/api/capabilities');
 });
 await t.test('separate admin role, bounded export, own deletion preserves other participant',async()=>{
  assert.equal((await call('/api/pilot/admin/export','GET',undefined,a)).status,403);
  const res=await call('/api/pilot/admin/login','POST',{secret:bindings.ADMIN_SECRET});assert.equal(res.status,200);admin=res.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/pilot/session','GET',undefined,admin)).status,401);
  let exported=await (await call('/api/pilot/admin/export','GET',undefined,admin)).json();assert.equal(exported.eventCounts.demo_opened,2);assert.equal(exported.feedback.length,2);assert.ok(exported.coverage.first);assert.equal(JSON.stringify(exported).includes(bindings.SESSION_SECRET),false);
  assert.equal((await call('/api/pilot/data?participant_id='+ids[1],'DELETE',undefined,a)).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM events WHERE participant_id=?').bind(ids[0]).first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM events WHERE participant_id=?').bind(ids[1]).first()).n,1);
  assert.equal((await call('/api/pilot/events','POST',event,a)).status,403);
  exported=await (await call('/api/pilot/admin/export','GET',undefined,admin)).json();assert.equal(exported.events.length,1);assert.equal(exported.feedback.length,1);
 });
 await t.test('owner dashboard renders actual D1 feedback as text with cards and JSON download',async()=>{
  const html=await (await call('/pilot/admin')).text();
  const dom=new JSDOM(html,{url:origin+'/pilot/admin',runScripts:'dangerously',beforeParse(window){window.fetch=async(path,options={})=>call(path,options.method||'GET',options.body,admin);window.URL.createObjectURL=()=> 'blob:fixture';window.URL.revokeObjectURL=()=>{};}});
  dom.window.document.querySelector('#credential').value=bindings.ADMIN_SECRET;
  await dom.window.document.querySelector('#login').onsubmit({preventDefault(){}});
  assert.equal(dom.window.document.querySelector('#dashboard').hidden,false);
  assert.match(dom.window.document.querySelector('#comments').textContent,/The review panel was clear/);
  assert.match(dom.window.document.querySelector('#cards').textContent,/Average rating/);
  assert.equal(dom.window.document.querySelector('#comments img'),null);assert.equal(dom.window.pwned,undefined);
  assert.match(dom.window.document.querySelector('#coverage').textContent,/30 days/);
  assert.equal(dom.window.document.querySelector('#export').textContent,'Download this page as JSON');
  dom.window.close();
 });
 await t.test('durable caps cannot be reset by withdraw/reconsent; concurrent feedback atomic',async()=>{
  const now=Date.now(),today=new Date().toISOString().slice(0,10);
  for(let i=0;i<18;i++)await db.prepare('INSERT INTO admissions(id,participant_id,kind,day,created_at) VALUES(?,?,?,?,?)').bind(randomUUID(),ids[1],'feedback',today,now).run();
  const statuses=await Promise.all(Array.from({length:8},async()=> (await call('/api/pilot/feedback','POST',feedback,b)).status));assert.equal(statuses.filter(s=>s===201).length,1);assert.equal(statuses.filter(s=>s===429).length,7);
  await call('/api/pilot/data','DELETE',undefined,b);await call('/api/pilot/consent','POST',{consent:true,version},b);
  assert.equal((await call('/api/pilot/feedback','POST',feedback,b)).status,429);
  for(let i=0;i<499;i++)await db.prepare('INSERT INTO admissions(id,participant_id,kind,day,created_at) VALUES(?,?,?,?,?)').bind(randomUUID(),ids[1],'event',today,now).run();
  assert.equal((await call('/api/pilot/events','POST',event,b)).status,429);
 });
 await t.test('AI explicit flag + atomic per-tester/global caps admit exactly bounded native forwards',async()=>{
  await mf.setOptions(convertV4MiniflareOptions({...config,bindings:{...bindings,PILOT_AI_ENABLED:'true',PILOT_AI_PROVIDER:'ollama',PILOT_AI_PER_TESTER_PER_DAY:'2',PILOT_AI_GLOBAL_PER_DAY:'3'}}));db=await mf.getD1Database('DB');received=[];
  const statuses=await Promise.all(Array.from({length:6},async()=> (await call('/api/tailor','POST',{},a)).status));assert.equal(statuses.filter(s=>s===200).length,2);assert.equal(statuses.filter(s=>s===429).length,4);
  const next=await Promise.all(Array.from({length:4},async()=> (await call('/api/tailor','POST',{},b)).status));assert.equal(next.filter(s=>s===200).length,1);assert.equal(received.length,3);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM admissions WHERE kind='ai'").first()).n,3);
 });
 await t.test('invalid origin rejected before network; no arbitrary upstream URLs',async()=>{
  await mf.setOptions(convertV4MiniflareOptions({...config,bindings:{...bindings,ORIGIN_URL:'http://127.0.0.1:1234'}}));received=[];
  assert.equal((await call('/','GET',undefined,a)).status,503);assert.equal(received.length,0);
  await mf.setOptions(convertV4MiniflareOptions(config));db=await mf.getD1Database('DB');
 });
 await t.test('admin export paginates bounded records while aggregates cover all 30-day rows',async()=>{
  await db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1001) INSERT INTO events(id,participant_id,name,session_id,details_json,created_at) SELECT 'fixture-'||x,?,'demo_opened',?,'{}',? FROM n").bind(ids[1],event.sessionId,Date.now()).run();
  const first=await (await call('/api/pilot/admin/export','GET',undefined,admin)).json();assert.equal(first.events.length,1000);assert.equal(first.nextOffset,1000);assert.equal(first.eventCounts.demo_opened,1001);
  const next=await (await call('/api/pilot/admin/export?offset=1000','GET',undefined,admin)).json();assert.equal(next.events.length,1);assert.equal(next.nextOffset,null);
  assert.equal((await call('/api/pilot/admin/export?offset=-1','GET',undefined,admin)).status,400);
 });
 await t.test('failed login admission cap is durable and atomic without collecting identifiers',async()=>{
  await db.prepare("DELETE FROM admissions WHERE kind='login'").run();
  await db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<999) INSERT INTO admissions(id,participant_id,kind,day,created_at) SELECT 'failed-fixture-'||x,'login-tester','login',?,? FROM n").bind(new Date().toISOString().slice(0,10),Date.now()).run();
  const statuses=await Promise.all(Array.from({length:6},async()=> (await call('/api/pilot/login','POST',{code:'z'.repeat(32)})).status));assert.equal(statuses.filter(s=>s===403).length,1);assert.equal(statuses.filter(s=>s===429).length,5);
  const rows=await db.prepare("SELECT * FROM admissions WHERE kind='login'").all();assert.equal(rows.results.length,1000);assert.equal(JSON.stringify(rows).includes('zzzzzz'),false);
 });
 await t.test('logout and invite disable revoke signed-cookie replay',async()=>{
  assert.equal((await call('/api/pilot/logout','POST',undefined,a)).status,200);
  assert.equal((await call('/api/pilot/session','GET',undefined,a)).status,401);
  await db.prepare('UPDATE invites SET enabled=0 WHERE id=?').bind(ids[1]).run();
  assert.equal((await call('/api/pilot/session','GET',undefined,b)).status,401);
  assert.equal((await call('/api/pilot/admin/logout','POST',undefined,admin)).status,200);assert.equal((await call('/api/pilot/admin/export','GET',undefined,admin)).status,403);
 });
 await t.test('30-day telemetry/2-day operational retention expires actual D1 rows',async()=>{
  const now=Date.now();await db.prepare('UPDATE events SET created_at=?').bind(now-31*86400000).run();await db.prepare('UPDATE feedback SET created_at=?').bind(now-31*86400000).run();await db.prepare('UPDATE admissions SET created_at=?').bind(now-3*86400000).run();await db.prepare('UPDATE sessions SET expires_at=?').bind(now-1).run();
  await cleanup({DB:db},now);
  for(const table of ['events','feedback','admissions','sessions'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0);
 });
});

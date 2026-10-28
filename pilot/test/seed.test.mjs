import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, stat, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const exec=promisify(execFile);
await test('native seed secures output before generating, stores hashes, fsyncs, refuses overwrite',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const directory=path.resolve(root,'.resume-foundry/pilot/seed-acceptance-'+randomUUID());
 assert.ok(directory.startsWith(path.join(root,'.resume-foundry','pilot')+path.sep));
 try{
  const result=await exec(process.execPath,['scripts/invite-seed.mjs','--output-dir',directory],{cwd:path.join(root,'pilot'),timeout:30000,windowsHide:true,maxBuffer:65536});
  assert.match(result.stdout,/No secret values printed/);
  const raw=await readFile(path.join(directory,'owner-secrets.json'),'utf8');const bundle=JSON.parse(raw);const sql=await readFile(path.join(directory,'owner-secrets-seed.sql'),'utf8');
  assert.equal(bundle.invites.length,10);assert.equal(new Set(bundle.invites.map(i=>i.code)).size,10);
  for(const invite of bundle.invites){assert.equal(sql.includes(invite.code),false);assert.ok(sql.includes(createHash('sha256').update(invite.code).digest('hex')));assert.equal(result.stdout.includes(invite.code),false);}
  for(const key of ['SESSION_SECRET','ORIGIN_SECRET','ADMIN_SECRET'])assert.ok(bundle[key].length>=32);
  await assert.rejects(exec(process.execPath,['scripts/invite-seed.mjs','--output-dir',directory],{cwd:path.join(root,'pilot'),timeout:30000,windowsHide:true,maxBuffer:65536}),/Owner bundle exists/);
  assert.equal(await readFile(path.join(directory,'owner-secrets.json'),'utf8'),raw);
  if(process.platform!=='win32')assert.equal((await stat(directory)).mode&0o777,0o700);
 }finally{await rm(directory,{recursive:true,force:true});}
});

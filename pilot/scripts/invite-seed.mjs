import { randomBytes, randomUUID, createHash } from "node:crypto";
import { open, access, mkdir, link, unlink, chmod } from "node:fs/promises";
import path from "node:path";
import { enforceConfiguredWindowsSensitivePathAcls } from "../../lib/windows-sensitive-path-acl.ts";
import { withFileLock } from "../../lib/file-lock.ts";
const repository = path.resolve(import.meta.dirname, "../..");
// The shared ACL runner resolves the shipped PowerShell helper from the repository.
process.chdir(repository);
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output-dir")) throw new Error("Usage: invite-seed.mjs [--output-dir absolute-directory]");
const directory = args.length ? path.resolve(args[1]) : path.resolve(import.meta.dirname, "../../.resume-foundry/pilot/operator");
await enforceConfiguredWindowsSensitivePathAcls({ env: { RESUME_FOUNDRY_AGENT_STORE: path.join(directory, "private-marker.json"), RESUME_FOUNDRY_WINDOWS_ACL_MODE: "apply" } });
await mkdir(directory, { recursive: true, mode: 0o700 });
if (process.platform !== "win32") await chmod(directory, 0o700);
await withFileLock(path.join(directory, "seed.lock"), async () => {
 const names = ["owner-secrets.json", "owner-secrets-seed.sql"];
 for (const name of names) { try { await access(path.join(directory,name)); } catch (error) { if(error.code === "ENOENT") continue; throw error; } throw new Error("Owner bundle exists; refusing overwrite."); }
 const now=Date.now();
 const codes=Array.from({length:10},()=>({id:randomUUID(),code:randomBytes(24).toString("base64url")}));
 const secrets={createdAt:new Date(now).toISOString(),invites:codes,SESSION_SECRET:randomBytes(32).toString("base64url"),ORIGIN_SECRET:randomBytes(32).toString("base64url"),ADMIN_SECRET:randomBytes(32).toString("base64url")};
 const sql=codes.map(({id,code})=>`INSERT INTO invites(id,code_hash,created_at,expires_at) VALUES('${id}','${createHash("sha256").update(code).digest("hex")}',${now},${now+30*86400000});`).join("\n")+"\n";
 const staged=[];
 try {
  for(const [i,data] of [JSON.stringify(secrets,null,2),sql].entries()) {
   const temporary=path.join(directory,`.${names[i]}.${randomUUID()}.tmp`);staged.push(temporary);
   const file=await open(temporary,"wx",0o600);
   try{await file.writeFile(data,"utf8");await file.sync();}finally{await file.close();}
  }
  for(const [i,temporary] of staged.entries()) await link(temporary,path.join(directory,names[i]));
 }finally{for(const temporary of staged) await unlink(temporary).catch(()=>undefined);}
});
process.stdout.write("Created 10 private invites and hash-only SQL in secured operator directory. No secret values printed.\n");

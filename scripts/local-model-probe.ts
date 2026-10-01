import { generateLocalTailor } from '../lib/local-tailor.ts';
import { writeFile } from 'node:fs/promises';
const input={resume:'Alex Example — Software Engineer. I have five years of experience designing APIs, reviewing code, collaborating with product teams, improving reliability, writing documentation, and deploying applications. At Example Company I built TypeScript services, maintained SQL reporting, reduced defects through automated tests, and helped colleagues resolve production incidents. Education: Bachelor of Science in computer science. Skills: TypeScript, Python, SQL, technical writing.',jobDescription:'We seek a software engineer to develop reliable applications, collaborate with product managers, review code, improve testing, document releases, and maintain accessible interfaces using TypeScript and SQL.',jobTitle:'Software Engineer',company:'Example Employer',emphasis:'balanced' as const};
const started=Date.now();
try {
  const result=await generateLocalTailor(input,AbortSignal.timeout(180000));
  const report={observedAt:new Date().toISOString(),scenario:'real-resident-local-model-tailoring',status:'Worked',durationMs:Date.now()-started,provider:'local-ollama',model:'qwen3-vl:8b-instruct',paidCalls:0,documents:[result.tailored_resume_markdown.length,result.cover_letter_markdown.length],evidenceRows:result.requirement_evidence.length};
  await writeFile('.resume-foundry/pilot/local-model-acceptance.json',JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify(report));
} catch(error) {
  process.stdout.write(JSON.stringify({status:'Failed',durationMs:Date.now()-started,error:error instanceof Error?error.message:'unknown'}));process.exitCode=1;
}

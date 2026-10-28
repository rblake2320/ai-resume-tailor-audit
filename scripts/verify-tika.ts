import { mkdir, writeFile } from "node:fs/promises";
import { Document, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { extractWithTika } from "../lib/tika.ts";

const root = ".resume-foundry/tika-fixtures";
await mkdir(root, { recursive: true });
const text = "Alex Example has TypeScript and SQL experience. Built reliable applications and documented releases.";
const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] }));
const zip = new JSZip();
zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
zip.file("content.xml", `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text><text:p>${text}</text:p></office:text></office:body></office:document-content>`);
zip.file("META-INF/manifest.xml", '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
const odt = await zip.generateAsync({ type: "nodebuffer" });
const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
const content = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
let pdf = "%PDF-1.4\n"; const offsets = [0];
for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index+1} 0 obj\n${object}\nendobj\n`; }
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const files = new Map<string, Uint8Array>([["docx",docx],["odt",odt],["rtf",Buffer.from(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 ${text}\\par}`)],["pdf",Buffer.from(pdf)]]);
const checks = [];
for (const [extension, bytes] of files) {
  await writeFile(`${root}/resume.${extension}`,bytes);
  const started=Date.now();
  const extracted=await extractWithTika(bytes,extension,AbortSignal.timeout(30_000));
  if (!extracted.includes("TypeScript") || !extracted.includes("Alex Example")) throw new Error(`Receiving ${extension} extraction lost fixture text.`);
  checks.push({ scenario:`real-tika-${extension}`,status:"Worked",durationMs:Date.now()-started,inputBytes:bytes.length,textChars:extracted.length });
}
for (const [scenario,bytes,extension] of [["disguised-zip",new Uint8Array(odt),"docx"],["malformed-pdf",Buffer.from("%PDF-1.7 broken"),"pdf"]] as const) {
  let rejected=false;try { await extractWithTika(bytes,extension,AbortSignal.timeout(30_000)); } catch { rejected=true; }
  if (!rejected) throw new Error(`Receiving ${scenario} was accepted.`);
  checks.push({scenario,status:"Worked",rejected:true});
}
const expanded = await JSZip.loadAsync(docx);
const documentXml = await expanded.file("word/document.xml")!.async("string");
expanded.file("word/document.xml", documentXml.replace(text, "x".repeat(200_000)));
let oversizedRejected=false;
try { await extractWithTika(await expanded.generateAsync({type:"nodebuffer"}),"docx",AbortSignal.timeout(30_000)); } catch { oversizedRejected=true; }
if(!oversizedRejected) throw new Error("Large extracted content was accepted.");
checks.push({scenario:"real-tika-expanded-document-output-limit",status:"Worked",rejected:true});
const entity = await JSZip.loadAsync(docx);
entity.file("word/document.xml",documentXml.replace(/<\?xml[^?]*\?>/, '$&<!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>').replace(text,"&xxe;"));
let disclosed=false;
try { disclosed=(await extractWithTika(await entity.generateAsync({type:"nodebuffer"}),"docx",AbortSignal.timeout(30_000))).includes("root:"); } catch { /* Refusal is the expected safe alternative. */ }
if(disclosed) throw new Error("XML external entity exposed container file contents.");
checks.push({scenario:"real-tika-xml-external-entity-no-file-disclosure",status:"Worked"});
for (const path of ["/config", "/pipes", "/async", "/rmeta", "/tika/config/json"]) {
  const response=await fetch(`http://127.0.0.1:9998${path}`);
  if(response.status!==403) throw new Error(`Private gateway exposed ${path}.`);
}
checks.push({scenario:"private-parser-config-and-batch-endpoints-denied",status:"Worked"});
const report={observedAt:new Date().toISOString(),parser:"Apache Tika 4.1.0",transport:"actual loopback gateway to isolated Docker parser",paidCalls:0,checks};
await writeFile(`${root}/acceptance.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));

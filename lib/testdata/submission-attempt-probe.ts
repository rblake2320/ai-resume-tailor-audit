import { appendFile, readFile } from "node:fs/promises";
import { executeSubmissionAttempt } from "../submission-attempts.ts";
import type { ApprovalReceipt } from "../submission-connectors.ts";

const [directory, receiptPath, transportLog, secret, mode] = process.argv.slice(2);
const receipt = JSON.parse(await readFile(receiptPath!, "utf8")) as ApprovalReceipt;
try {
  await executeSubmissionAttempt({ receipt, approvalSecret: secret!, directory }, async () => {
    await appendFile(transportLog!, `${process.pid}\n`);
    if (mode === "crash") process.exit(17);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { accepted: true };
  });
  process.stdout.write("TRANSPORTED");
} catch {
  process.stdout.write("BLOCKED");
}

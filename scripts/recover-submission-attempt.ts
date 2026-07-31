import { recoverPendingSubmissionAttempt, type SubmissionAttemptIdentity } from "../lib/submission-attempts.ts";

const [provider, applicationId, packetChecksum, confirmation] = process.argv.slice(2);
if (!provider || !applicationId || !/^[a-f0-9]{64}$/u.test(packetChecksum ?? "")
  || confirmation !== "--confirm-all-submitters-stopped") {
  throw new Error("Usage: npm run submission-attempt:recover -- <provider> <applicationId> <packetChecksum> --confirm-all-submitters-stopped");
}

const record = await recoverPendingSubmissionAttempt({ provider, applicationId, packetChecksum } as SubmissionAttemptIdentity);
process.stdout.write(`${record.attemptId} marked uncertain; a new signed acknowledgement is required.\n`);

import { enforceConfiguredWindowsSensitivePathAcls } from "../lib/windows-sensitive-path-acl.ts";

const result = await enforceConfiguredWindowsSensitivePathAcls();
if (result.status === "secured") {
  process.stdout.write(`Windows sensitive-storage ACL check passed (${result.checked.length} paths).\n`);
}

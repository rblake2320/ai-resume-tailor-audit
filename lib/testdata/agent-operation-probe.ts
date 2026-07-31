/**
 * Child-process probe for the cross-process agent-store race test.
 *
 * Deliberately a separate OS process: the defect was a module-scoped promise
 * queue that serialises only inside one Node process, so a same-process test
 * cannot detect it.
 *
 * Usage: node --experimental-strip-types agent-operation-probe.ts <storePath> <json-request>
 * Prints the JSON result.
 */
import { executeAgentOperation, type AgentRequest } from "../agent-service.ts";

const [storePath, payload] = process.argv.slice(2);
process.env.RESUME_FOUNDRY_AGENT_STORE = storePath;
const result = await executeAgentOperation(JSON.parse(payload) as AgentRequest);
process.stdout.write(JSON.stringify(result));

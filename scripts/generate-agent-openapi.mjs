import { readFile, writeFile } from "node:fs/promises";

const file = new URL("../public/openapi.json", import.meta.url);
const spec = JSON.parse(await readFile(file, "utf8"));
const operations = ["jobs.import", "jobs.search", "jobs.get", "jobs.compare", "jobs.dismiss", "matches.score", "applications.prepare", "applications.review", "applications.approve", "applications.open_handoff", "applications.mark_submitted", "applications.record_response", "applications.schedule_followup", "analytics.summary"];
for (const operation of operations) {
  spec.paths[`/api/agent/${operation}`] = { post: {
    operationId: operation.replaceAll(".", "_"), tags: ["Agent operations"],
    description: `Policy-enforced ${operation}. Every allowed or denied call is audited.`,
    security: [{ bearerAuth: [] }], requestBody: { required: false, content: { "application/json": { schema: { $ref: "#/components/schemas/AgentOperationRequest" } } } },
    responses: { "200": { description: "Operation completed" }, "400": { $ref: "#/components/responses/Error" }, "401": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" } },
  } };
}
spec.paths["/api/agent/audit"] = { get: { operationId: "queryAgentAudit", tags: ["Agent operations"], security: [{ bearerAuth: [] }], responses: { "200": { description: "Queryable allowed and denied action log" }, "401": { $ref: "#/components/responses/Error" } } } };
spec.components.securitySchemes = { ...(spec.components.securitySchemes ?? {}), bearerAuth: { type: "http", scheme: "bearer" } };
spec.components.schemas.AgentOperationRequest = { type: "object", additionalProperties: false, properties: { input: { type: "object", additionalProperties: true }, actor: { type: "string" }, piiApproved: { type: "boolean", default: false } } };
await writeFile(file, `${JSON.stringify(spec, null, 2)}\n`);

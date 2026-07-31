import { readFile, writeFile } from "node:fs/promises";

const file = new URL("../public/openapi.json", import.meta.url);
const spec = JSON.parse(await readFile(file, "utf8"));
const operations = ["jobs.import", "jobs.search", "jobs.get", "jobs.compare", "jobs.dismiss", "matches.score", "applications.prepare", "applications.review", "applications.approve", "applications.open_handoff", "applications.mark_submitted", "applications.record_response", "applications.schedule_followup", "analytics.summary"];
for (const operation of operations) {
  spec.paths[`/api/agent/${operation}`] = { post: {
    operationId: operation.replaceAll(".", "_"), tags: ["Agent operations"],
    description: `Policy-enforced ${operation}. Every allowed or denied call is audited.`,
    security: [{ bearerAuth: [] }], requestBody: { required: false, content: { "application/json": { schema: { $ref: "#/components/schemas/AgentOperationRequest" } } } },
    responses: { "200": { description: "Operation completed" }, "400": { $ref: "#/components/responses/Error" }, "401": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" }, "413": { $ref: "#/components/responses/Error" }, "415": { $ref: "#/components/responses/Error" } },
  } };
}
spec.paths["/api/agent/audit"] = { get: { operationId: "queryAgentAudit", tags: ["Agent operations"], security: [{ bearerAuth: [] }], responses: { "200": { description: "Queryable allowed and denied action log" }, "401": { $ref: "#/components/responses/Error" } } } };
spec.components.securitySchemes = { ...(spec.components.securitySchemes ?? {}), bearerAuth: { type: "http", scheme: "bearer" } };
spec.components.schemas.AgentOperationRequest = { type: "object", additionalProperties: false, properties: { input: { type: "object", additionalProperties: true }, actor: { type: "string" }, piiApproved: { type: "boolean", default: false } } };
spec.paths["/api/submissions/approve"] = { post: { operationId: "approveSubmissionPreview", tags: ["Official submissions"], description: "Human-only approval of an exact final preview; returns a short-lived, exact-content-bound receipt.", responses: { "200": { description: "Signed approval receipt" }, "400": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" } } } };
spec.paths["/api/submissions/execute"] = { post: { operationId: "executeAuthorizedSubmission", tags: ["Official submissions"], description: "Consumes a one-time approval receipt and calls only an explicitly allowlisted, credentialed official connector.", responses: { "200": { description: "Provider accepted the operation" }, "403": { $ref: "#/components/responses/Error" } } } };
await writeFile(file, `${JSON.stringify(spec, null, 2)}\n`);

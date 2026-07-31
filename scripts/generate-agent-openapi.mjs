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
const sha256 = { type: "string", pattern: "^[a-f0-9]{64}$" };
spec.components.schemas.SubmissionTarget = { oneOf: [
  { type: "object", additionalProperties: false, required: ["provider", "boardToken", "jobId"], properties: { provider: { const: "greenhouse" }, boardToken: { type: "string" }, jobId: { type: "string" } } },
  { type: "object", additionalProperties: false, required: ["provider", "site", "postingId", "requiredFields"], properties: { provider: { const: "lever" }, site: { type: "string" }, postingId: { type: "string" }, requiredFields: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } } } },
  { type: "object", additionalProperties: false, required: ["provider", "rawMessage"], properties: { provider: { const: "gmail" }, rawMessage: { type: "string", minLength: 1, maxLength: 5000000 } } },
] };
spec.components.schemas.SubmissionPreview = { type: "object", additionalProperties: false, required: ["applicationId", "provider", "company", "role", "destination", "packetVersion", "resumeChecksum", "coverLetterChecksum", "packetChecksum", "personalDataCategories", "fields", "createdAt", "target"], properties: {
  applicationId: { type: "string", minLength: 1 }, provider: { type: "string", enum: ["greenhouse", "lever", "gmail"] }, company: { type: "string", minLength: 1 }, role: { type: "string", minLength: 1 }, destination: { type: "string", format: "uri" }, packetVersion: { type: "integer", minimum: 1 }, resumeChecksum: sha256, coverLetterChecksum: sha256, packetChecksum: sha256, personalDataCategories: { type: "array", items: { type: "string" } }, fields: { type: "object", additionalProperties: true }, createdAt: { type: "string", format: "date-time" }, target: { $ref: "#/components/schemas/SubmissionTarget" },
} };
spec.components.schemas.ApprovalReceipt = { type: "object", additionalProperties: false, required: ["preview", "approvedAt", "expiresAt", "nonce", "signature"], properties: { preview: { $ref: "#/components/schemas/SubmissionPreview" }, approvedAt: { type: "string", format: "date-time" }, expiresAt: { type: "string", format: "date-time" }, nonce: { type: "string", minLength: 8, maxLength: 200 }, signature: { type: "string", minLength: 1 } } };
spec.components.schemas.ApplicationPacket = { type: "object", additionalProperties: true, required: ["id", "version", "checksums", "jobSnapshot"], properties: { id: { type: "string", minLength: 1 }, version: { type: "integer", minimum: 1 }, checksums: { type: "object", additionalProperties: false, required: ["packet", "resume", "coverLetter"], properties: { packet: sha256, resume: sha256, coverLetter: sha256 } }, jobSnapshot: { type: "object", additionalProperties: true, required: ["company", "title"], properties: { company: { type: "string" }, title: { type: "string" } } } } };
spec.components.schemas.ExecuteSubmissionRequest = { type: "object", additionalProperties: false, required: ["receipt", "packet"], properties: { receipt: { $ref: "#/components/schemas/ApprovalReceipt" }, packet: { $ref: "#/components/schemas/ApplicationPacket" } } };
spec.paths["/api/submissions/approve"] = { post: { operationId: "approveSubmissionPreview", tags: ["Official submissions"], description: "Human-only approval of an exact final preview; returns a short-lived, exact-content-bound receipt. JSON request body is capped at 6,000,000 bytes.", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SubmissionPreview" } } } }, responses: { "200": { description: "Signed approval receipt" }, "400": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" }, "413": { $ref: "#/components/responses/Error" }, "415": { $ref: "#/components/responses/Error" } } } };
spec.paths["/api/submissions/execute"] = { post: { operationId: "executeAuthorizedSubmission", tags: ["Official submissions"], description: "Consumes a one-time approval receipt and calls only an explicitly allowlisted, credentialed official connector. JSON request body is capped at 8,000,000 bytes.", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ExecuteSubmissionRequest" } } } }, responses: { "200": { description: "Provider accepted the operation" }, "400": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" }, "413": { $ref: "#/components/responses/Error" }, "415": { $ref: "#/components/responses/Error" } } } };
spec.paths["/api/jobs/import"] = { post: {
  operationId: "importJobsFromOfficialSource", tags: ["Browser operations"],
  description: "Imports bounded job records from a configured official connector or forwarded alert.",
  requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["source"], properties: { source: { type: "string", enum: ["greenhouse", "lever", "usajobs", "email"] }, query: { type: "string" }, payload: { type: "string" }, maxPages: { type: "integer", minimum: 1, maximum: 20 } } } } } },
  responses: { "200": { description: "Imported normalized job records" }, "400": { $ref: "#/components/responses/Error" }, "413": { $ref: "#/components/responses/Error" }, "415": { $ref: "#/components/responses/Error" } },
} };
spec.paths["/api/labor-market/onet"] = { post: {
  operationId: "lookupOnetOccupation", tags: ["Labor market"],
  description: "Looks up a bounded O*NET occupation overview. O*NET characteristics are not hiring or fit guarantees.",
  requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["occupationCode"], properties: { occupationCode: { type: "string", pattern: "^[0-9]{2}-[0-9]{4}\\.[0-9]{2}$" } } } } } },
  responses: { "200": { description: "Validated O*NET occupation profile" }, "400": { $ref: "#/components/responses/Error" }, "413": { $ref: "#/components/responses/Error" }, "415": { $ref: "#/components/responses/Error" } },
} };
spec.paths["/api/labor-market/bls-series"] = { post: {
  operationId: "fetchBlsObservations", tags: ["Labor market"],
  description: "Fetches bounded BLS time-series observations. These observations are not occupational projections.",
  requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["seriesIds", "startYear", "endYear"], description: "The public contract advertises the conservative unregistered BLS tier: unique IDs and an ordered inclusive range of at most 10 years. Deployments with BLS_API_KEY also accept the official registered tier of 50 series and 20 years.", properties: { seriesIds: { type: "array", minItems: 1, maxItems: 25, uniqueItems: true, items: { type: "string", pattern: "^[A-Z0-9_#-]{1,100}$" } }, startYear: { type: "integer", minimum: 1900, maximum: 2200 }, endYear: { type: "integer", minimum: 1900, maximum: 2200 } } } } } },
  responses: { "200": { description: "Validated BLS observation series" }, "400": { $ref: "#/components/responses/Error" }, "413": { $ref: "#/components/responses/Error" }, "415": { $ref: "#/components/responses/Error" } },
} };
spec.components.schemas.RateLimitError = { type: "object", additionalProperties: false, required: ["error", "code"], properties: { error: { type: "string" }, code: { type: "string", enum: ["RATE_LIMITED"] } } };
spec.components.schemas.RateLimitUnavailableError = { type: "object", additionalProperties: false, required: ["error", "code"], properties: { error: { type: "string" }, code: { type: "string", enum: ["RATE_LIMIT_UNAVAILABLE"] } } };
const retryAfter = { description: "Whole seconds before retrying.", required: true, schema: { type: "string", pattern: "^[1-9][0-9]*$" } };
spec.components.responses.RateLimited = { description: "Configured fixed-window capacity is exhausted.", headers: { "Retry-After": retryAfter }, content: { "application/json": { schema: { $ref: "#/components/schemas/RateLimitError" } } } };
spec.components.responses.RateLimitUnavailable = { description: "The required production safety limiter is unavailable or invalid.", headers: { "Retry-After": retryAfter }, content: { "application/json": { schema: { $ref: "#/components/schemas/RateLimitUnavailableError" } } } };
for (const path of ["/api/fetch-job", "/api/jobs/import", "/api/labor-market/onet", "/api/labor-market/bls-series", "/api/parse-resume", "/api/tailor"]) {
  const responses = spec.paths[path]?.post?.responses;
  if (!responses) throw new Error(`Public OpenAPI path ${path} is missing.`);
  responses["429"] = { $ref: "#/components/responses/RateLimited" };
  responses["503"] = { $ref: "#/components/responses/RateLimitUnavailable" };
}
await writeFile(file, `${JSON.stringify(spec, null, 2)}\n`);

import { describe, expect, it } from "vitest";
import spec from "../public/openapi.json";

type ApiOperation = { requestBody?: { required?: boolean; content?: Record<string, { schema?: { $ref?: string } }> } };

describe("official-submission OpenAPI request contracts", () => {
  it("binds approval to the explicit SubmissionPreview JSON schema", () => {
    const operation = (spec.paths["/api/submissions/approve"] as { post: ApiOperation }).post;
    expect(operation.requestBody?.required).toBe(true);
    expect(operation.requestBody?.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/SubmissionPreview");
    const schema = spec.components.schemas.SubmissionPreview;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["applicationId", "packetChecksum", "personalDataCategories", "fields", "target"]));
  });

  it("binds execution to exactly a receipt and application packet", () => {
    const operation = (spec.paths["/api/submissions/execute"] as { post: ApiOperation }).post;
    expect(operation.requestBody?.required).toBe(true);
    expect(operation.requestBody?.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/ExecuteSubmissionRequest");
    const schema = spec.components.schemas.ExecuteSubmissionRequest;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["receipt", "packet"]);
    expect(schema.properties.receipt.$ref).toBe("#/components/schemas/ApprovalReceipt");
    expect(schema.properties.packet.$ref).toBe("#/components/schemas/ApplicationPacket");
  });
});

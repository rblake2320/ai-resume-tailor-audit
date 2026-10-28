import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { issueSubmissionApproval, outgoingDataCategories, submissionDestination, submitLever, type SubmissionPreview, type SubmissionTarget } from "./submission-connectors";

const secret = "synthetic-lever-approval-fixture-secret";
const baseFields = { name: "Synthetic Applicant", email: "fixture@example.invalid", resume_text: "Approved résumé\nExact frozen synthetic experience.", cover_letter_text: "Approved synthetic cover letter." };
const form = {
  personalInformation: [
    { name: "fullName", type: "text", required: true },
    { name: "email", type: "text", required: true },
    { name: "phone", type: "text", required: false },
    { name: "resume", type: "file-upload", required: true },
    { name: "additionalInformation", type: "textarea", required: false },
  ],
  customQuestions: [{ id: "screening-fixture", fields: [
    { id: "work", type: "textarea", required: true },
    { id: "languages", type: "multiple-select", required: true, options: [{ text: "TypeScript" }, { text: "Python" }] },
  ] }],
  urls: [{ name: "Portfolio", type: "text", required: false }],
  eeoQuestions: { gender: { type: "dropdown", required: false, options: [{ text: "Decline to self-identify", optionId: "Decline to self-identify" }] } },
};

function receipt(extras: Record<string, unknown> = {}) {
  const target: SubmissionTarget = { provider: "lever", site: "synthetic-employer", postingId: "synthetic-posting", requiredFields: ["name", "email"] };
  const fields = { ...baseFields, ...extras };
  const preview: SubmissionPreview = {
    applicationId: "local-packet-1", provider: "lever", company: "Synthetic Employer", role: "Fixture Engineer", destination: submissionDestination(target),
    packetVersion: 1, resumeChecksum: "a".repeat(64), coverLetterChecksum: "b".repeat(64), packetChecksum: "c".repeat(64),
    personalDataCategories: outgoingDataCategories(fields, target), fields, createdAt: new Date().toISOString(), target,
  };
  return issueSubmissionApproval(preview, secret);
}
const screening = { customQuestions: [{ id: "screening-fixture", fields: [{ value: "Approved screening response" }, { value: ["TypeScript"] }] }] };

describe("Lever native authenticated provider contract", () => {
  it("executes real local GET form → multipart resume upload → ordered native apply and retains provider ID", async () => {
    const requests: { method: string; path: string }[] = [];
    let uploaded = "";
    let uploadedName = "";
    let applied: Record<string, unknown> = {};
    const errors: unknown[] = [];
    const server = createServer(async (req, res) => {
      try {
        requests.push({ method: req.method ?? "", path: req.url ?? "" });
        expect(req.headers.authorization).toMatch(/^Basic /u);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        res.setHeader("content-type", "application/json");
        if (req.method === "GET" && req.url === "/v1/postings/synthetic-posting/apply") {
          res.end(JSON.stringify({ data: form }));
        } else if (req.method === "POST" && req.url === "/v1/uploads") {
          const decoded = await new Request("http://synthetic.local/upload", { method: "POST", headers: { "content-type": req.headers["content-type"] ?? "" }, body: new Uint8Array(bytes) }).formData();
          const file = decoded.get("file");
          if (!(file instanceof File)) throw new Error("Missing multipart resume file");
          uploaded = await file.text();
          uploadedName = file.name;
          res.writeHead(201);
          res.end(JSON.stringify({ data: { uri: "https://api.lever.co/v1/uploads/synthetic-resume.txt" } }));
        } else if (req.method === "POST" && req.url === "/v1/postings/synthetic-posting/apply") {
          applied = JSON.parse(bytes.toString("utf8"));
          res.writeHead(201);
          res.end(JSON.stringify({ data: { applicationId: "provider-application-fixture-1" } }));
        } else throw new Error("Unexpected local fixture request");
      } catch (error) { errors.push(error); res.writeHead(500); res.end("{}"); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture listener");
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.lever.co");
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return fetch(`http://127.0.0.1:${address.port}${url.pathname}`, init);
    };
    try {
      const result = await submitLever({ apiKey: "synthetic-local-key", receipt: receipt(screening), approvalSecret: secret }, fetcher);
      expect(errors).toEqual([]);
      expect(requests).toEqual([{ method: "GET", path: "/v1/postings/synthetic-posting/apply" }, { method: "POST", path: "/v1/uploads" }, { method: "POST", path: "/v1/postings/synthetic-posting/apply" }]);
      expect(uploaded).toBe(baseFields.resume_text);
      expect(uploadedName).toBe("approved-resume.txt");
      expect(applied.personalInformation).toEqual([
        { name: "fullName", value: baseFields.name }, { name: "email", value: baseFields.email }, { name: "phone", value: null },
        { name: "resume", value: "https://api.lever.co/v1/uploads/synthetic-resume.txt" }, { name: "additionalInformation", value: baseFields.cover_letter_text },
      ]);
      expect(applied.customQuestions).toEqual(screening.customQuestions);
      expect(applied.urls).toEqual([{ name: "Portfolio", value: null }]);
      expect(applied.eeoResponses).toEqual({ gender: null });
      expect(applied).not.toHaveProperty("resume_text");
      expect(result).toMatchObject({ accepted: true, applicationId: "local-packet-1", providerApplicationId: "provider-application-fixture-1", status: 201 });
      console.info(JSON.stringify({ scenario: "lever-native-local-transport", requests, uploadedExactApprovedResume: uploaded === baseFields.resume_text, orderedPersonalFields: (applied.personalInformation as { name: string }[]).map((field) => field.name), result }));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("enforces live required screening fields before upload even when target.requiredFields omits them", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: form }));
    await expect(submitLever({ apiKey: "synthetic", receipt: receipt(), approvalSecret: secret }, fetcher)).rejects.toThrow(/screening-fixture\[0\]/u);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects invalid option values before uploading any personal data", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: form }));
    const invalid = { customQuestions: [{ id: "screening-fixture", fields: [{ value: "Answer" }, { value: ["Invented language"] }] }] };
    await expect(submitLever({ apiKey: "synthetic", receipt: receipt(invalid), approvalSecret: secret }, fetcher)).rejects.toThrow(/invalid option/u);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("never automatically retries a rate-limited file upload", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: form })).mockResolvedValueOnce(new Response("rate", { status: 429 }));
    await expect(submitLever({ apiKey: "synthetic", receipt: receipt(screening), approvalSecret: secret }, fetcher)).rejects.toThrow(/429/u);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects inherited object names as unknown EEO questions before any upload", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: form }));
    await expect(submitLever({ apiKey: "synthetic", receipt: receipt({ ...screening, eeoResponses: { constructor: "not a question" } }), approvalSecret: secret }, fetcher)).rejects.toThrow(/Unknown Lever EEO question: constructor/u);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("requires a real created application ID instead of promoting any HTTP success", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: form })).mockResolvedValueOnce(Response.json({ data: { uri: "https://api.lever.co/v1/uploads/synthetic.txt" } }, { status: 201 })).mockResolvedValueOnce(Response.json({}, { status: 201 }));
    await expect(submitLever({ apiKey: "synthetic", receipt: receipt(screening), approvalSecret: secret }, fetcher)).rejects.toThrow(/application identifier/u);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid receipt before even reading the employer form", async () => {
    const approved = receipt(screening);
    approved.preview.fields.name = "Tampered applicant";
    const fetcher = vi.fn();
    await expect(submitLever({ apiKey: "synthetic", receipt: approved, approvalSecret: secret }, fetcher)).rejects.toThrow(/invalid/u);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

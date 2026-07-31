import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { appendCareerEvent, createCareerLedger } from "./career-ledger";
import { careerVaultDatabaseName, deleteCareerLedger, hasCareerLedger, loadCareerLedger, saveCareerLedger } from "./career-vault";

beforeEach(() => { Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true }); });
async function rawStored() {
  const request = indexedDB.open(careerVaultDatabaseName); const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const result = db.transaction("ledgers", "readonly").objectStore("ledgers").get("active"); const value = await new Promise<unknown>((resolve, reject) => { result.onsuccess = () => resolve(result.result); result.onerror = () => reject(result.error); }); db.close(); return value;
}
describe("browser career vault", () => {
  it("stores only an encrypted envelope at rest and restores losslessly", async () => {
    const ledger = await appendCareerEvent(createCareerLedger("owner"), { occurredAt: "2026-01-01T00:00:00Z", category: "project", title: "Private project", description: "Sensitive career evidence", originalSource: "", claimState: "fact", verification: "self_reported", skills: [], measurableResult: "", collaborators: [], context: "", confidence: 1, tags: [], occupationCodes: [], evidence: [], visibility: "private", supersedesEventId: null, correctionReason: "" });
    await saveCareerLedger(ledger, "long recovery phrase"); const raw = await rawStored();
    expect(JSON.stringify(raw)).not.toContain("Private project"); expect(JSON.stringify(raw)).not.toContain("Sensitive career evidence");
    expect(await loadCareerLedger("long recovery phrase")).toEqual(ledger);
    await expect(loadCareerLedger("wrong passphrase")).rejects.toThrow(/could not be decrypted/);
  });
  it("supports complete local account deletion", async () => {
    await saveCareerLedger(createCareerLedger("owner"), "long recovery phrase"); expect(await hasCareerLedger()).toBe(true);
    await deleteCareerLedger(); expect(await hasCareerLedger()).toBe(false);
  });
});

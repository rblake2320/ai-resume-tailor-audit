import { EncryptedCareerBackupSchema, exportEncryptedCareerLedger, importEncryptedCareerLedger, migrateCareerLedger, type CareerLedger } from "./career-ledger";

const DB_NAME = "resume-foundry-career-vault";
const DB_VERSION = 1;
const STORE = "ledgers";
const ACTIVE = "active";

function openVault(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Encrypted career vault storage is unavailable in this browser."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Career vault could not be opened."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Career vault operation failed."));
  });
}

async function storedValue(): Promise<unknown> {
  const db = await openVault();
  try { return await requestResult(db.transaction(STORE, "readonly").objectStore(STORE).get(ACTIVE)); }
  finally { db.close(); }
}

export async function hasCareerLedger(): Promise<boolean> { return Boolean(await storedValue()); }

export async function loadCareerLedger(passphrase: string): Promise<CareerLedger | null> {
  const value = await storedValue(); if (!value) return null;
  const encrypted = EncryptedCareerBackupSchema.safeParse(value);
  if (encrypted.success) return importEncryptedCareerLedger(encrypted.data, passphrase);
  throw new Error("A legacy plaintext career vault was detected. Use the explicit migration action before unlocking it.");
}

/** Explicit, one-time migration. Unknown/current plaintext objects are rejected. */
export async function migrateLegacyPlaintextCareerLedger(passphrase: string): Promise<CareerLedger> {
  const value = await storedValue();
  if (!value || typeof value !== "object" || (value as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new Error("No supported legacy plaintext-v1 career vault was found.");
  }
  const migrated = migrateCareerLedger(value);
  await saveCareerLedger(migrated, passphrase);
  return migrated;
}

export async function saveCareerLedger(ledger: CareerLedger, passphrase: string): Promise<void> {
  const encrypted = await exportEncryptedCareerLedger(ledger, passphrase); const db = await openVault();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(encrypted, ACTIVE);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Career vault write failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Career vault write was aborted."));
    });
  } finally { db.close(); }
}

export async function deleteCareerLedger(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Career vault deletion failed."));
    request.onblocked = () => reject(new Error("Career vault deletion was blocked by another open tab."));
  });
}

export const careerVaultDatabaseName = DB_NAME;

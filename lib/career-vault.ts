import { CareerLedgerSchema, type CareerLedger } from "./career-ledger";

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

export async function loadCareerLedger(): Promise<CareerLedger | null> {
  const db = await openVault();
  try {
    const value = await requestResult(db.transaction(STORE, "readonly").objectStore(STORE).get(ACTIVE));
    return value ? CareerLedgerSchema.parse(value) : null;
  } finally { db.close(); }
}

export async function saveCareerLedger(ledger: CareerLedger): Promise<void> {
  const parsed = CareerLedgerSchema.parse(ledger); const db = await openVault();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(parsed, ACTIVE);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Career vault write failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Career vault write was aborted."));
    });
  } finally { db.close(); }
}

export async function deleteCareerLedger(): Promise<void> {
  const db = await openVault();
  try { await requestResult(db.transaction(STORE, "readwrite").objectStore(STORE).delete(ACTIVE)); }
  finally { db.close(); }
}

export const careerVaultDatabaseName = DB_NAME;

/**
 * Where plans live between sessions.
 *
 * Local-first: the browser holds the plans, and the app is fully usable with no
 * account and no network. Cloud sync (M10) becomes another implementation of
 * the same interface rather than a rewrite of everything that saves.
 *
 * The interface is deliberately narrow and asynchronous. IndexedDB is async,
 * a network store will be too, and a synchronous interface here would have to
 * be unpicked later.
 */

import { loadDocument } from '../core/model/migrations.ts';
import { type HouseDocument } from '../core/model/schema.ts';

export interface DocumentSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly floorCount: number;
}

export interface DocumentStore {
  list(): Promise<DocumentSummary[]>;
  /** Raw stored value; run it through `loadDocument` before trusting it. */
  read(id: string): Promise<unknown | null>;
  write(document: HouseDocument): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Summarise a document for a "recent plans" list without loading all of it. */
export function summarise(document: HouseDocument): DocumentSummary {
  return {
    id: document.id,
    name: document.name,
    updatedAt: document.updatedAt,
    floorCount: document.floors.length,
  };
}

// ---------------------------------------------------------------------------
// In-memory
// ---------------------------------------------------------------------------

/**
 * A store that keeps everything in a Map.
 *
 * Used by tests, and as the fallback when IndexedDB is unavailable — private
 * browsing modes and locked-down enterprise profiles both block it. Falling
 * back means the app still works for the session rather than failing to start;
 * the caller is told so it can warn that nothing will be kept.
 */
export function createMemoryStore(seed: readonly HouseDocument[] = []): DocumentStore {
  const documents = new Map<string, string>();
  for (const document of seed) documents.set(document.id, JSON.stringify(document));

  return {
    async list() {
      return [...documents.values()]
        .map((raw) => JSON.parse(raw) as HouseDocument)
        .map(summarise)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    async read(id) {
      const raw = documents.get(id);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async write(document) {
      // Stored as a string so callers cannot mutate what is "on disk" through
      // a reference they still hold — the same guarantee a real store gives.
      documents.set(document.id, JSON.stringify(document));
    },
    async remove(id) {
      documents.delete(id);
    },
    async clear() {
      documents.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

const DATABASE_NAME = 'interiordesign';
const DATABASE_VERSION = 1;
const OBJECT_STORE = 'documents';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE)) {
        database.createObjectStore(OBJECT_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the plan store'));
    request.onblocked = () =>
      reject(new Error('Another tab is holding the plan store open; close it and try again.'));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE, mode);
        const request = work(transaction.objectStore(OBJECT_STORE));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Plan store request failed'));
        transaction.oncomplete = () => database.close();
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('Plan store transaction aborted'));
      }),
  );
}

export function createIndexedDbStore(): DocumentStore {
  return {
    async list() {
      const rows = await runTransaction<unknown[]>('readonly', (store) => store.getAll());
      return rows
        .map((row) => loadDocument(row))
        .flatMap((result) => (result.ok ? [summarise(result.document)] : []))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    async read(id) {
      return (await runTransaction<unknown>('readonly', (store) => store.get(id))) ?? null;
    },
    async write(document) {
      // Structured-clone the document so IndexedDB stores a snapshot rather
      // than choking on anything non-cloneable that has crept into it.
      await runTransaction('readwrite', (store) => store.put(JSON.parse(JSON.stringify(document))));
    },
    async remove(id) {
      await runTransaction('readwrite', (store) => store.delete(id));
    },
    async clear() {
      await runTransaction('readwrite', (store) => store.clear());
    },
  };
}

/**
 * The best store available here.
 *
 * Reports which one it picked so the app can say "changes will not be kept"
 * rather than silently losing someone's evening of measuring.
 */
export function createDocumentStore(): { store: DocumentStore; persistent: boolean } {
  if (typeof indexedDB === 'undefined') {
    return { store: createMemoryStore(), persistent: false };
  }

  try {
    return { store: createIndexedDbStore(), persistent: true };
  } catch {
    return { store: createMemoryStore(), persistent: false };
  }
}

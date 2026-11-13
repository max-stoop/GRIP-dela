/** Sleutel-waarde opslag op IndexedDB (geen limiet van 5 MB). idb gebruikt de opslag die nu geldt, idbEcht altijd de echte. */

const ECHT = 'grip-regelplekken';
const TEST = 'grip-regelplekken-test';
const STORE = 'kv';

function maak(naam: string) {
  let dbp: Promise<IDBDatabase> | null = null;

  function openVersie(versie?: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = versie ? indexedDB.open(naam, versie) : indexedDB.open(naam);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('De opslag is in een ander tabblad in gebruik. Sluit andere tabbladen van GRIP.'));
    });
  }

  function open(): Promise<IDBDatabase> {
    if (dbp) return dbp;
    dbp = (async () => {
      if (typeof indexedDB === 'undefined') throw new Error('Opslaan in deze browser is niet mogelijk.');
      let db = await openVersie();
      // database bestaat maar zonder tabel (bijv. afgebroken eerste keer): versie ophogen en alsnog aanmaken
      if (!db.objectStoreNames.contains(STORE)) {
        const v = db.version + 1;
        db.close();
        db = await openVersie(v);
      }
      db.onversionchange = () => { db.close(); dbp = null; };
      return db;
    })();
    dbp.catch(() => { dbp = null; });
    return dbp;
  }

  function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    return open().then(
      (db) =>
        new Promise<T | undefined>((resolve, reject) => {
          const t = db.transaction(STORE, mode);
          const req = fn(t.objectStore(STORE));
          t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        }),
    );
  }

  return {
    get<T>(key: string): Promise<T | undefined> {
      return tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
    },
    set(key: string, value: unknown): Promise<void> {
      return tx('readwrite', (s) => { s.put(value, key); }).then(() => undefined);
    },
    del(key: string): Promise<void> {
      return tx('readwrite', (s) => { s.delete(key); }).then(() => undefined);
    },
    keys(): Promise<string[]> {
      return tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((k) => (k ?? []).map(String));
    },
    clear(): Promise<void> {
      return tx('readwrite', (s) => { s.clear(); }).then(() => undefined);
    },
  };
}

type Opslag = ReturnType<typeof maak>;
const echt: Opslag = maak(ECHT);
let test: Opslag | null = null;
let nu: Opslag = echt;

/** Ook als de testomgeving aan staat. */
export const idbEcht: Opslag = echt;

/** Zonder te wisselen, om een oude testkopie op te ruimen. */
export function testOpslag(): Opslag {
  return (test ??= maak(TEST));
}

export function kiesOpslag(soort: 'echt' | 'test') {
  nu = soort === 'test' ? testOpslag() : echt;
}

export const idb: Opslag = {
  get: (k) => nu.get(k),
  set: (k, v) => nu.set(k, v),
  del: (k) => nu.del(k),
  keys: () => nu.keys(),
  clear: () => nu.clear(),
};

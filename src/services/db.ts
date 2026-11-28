import type { Customer, StoredBackupInfo } from '../types/customer';

const DB_NAME = 'customer_manager_db';
const DB_VERSION = 1;
const STORE_CUSTOMERS = 'customers';
const STORE_MEDIA = 'media';
const STORE_BACKUPS = 'backups';

export interface StoredMediaRecord {
  id: string;
  blob: Blob;
  mimeType: string;
  name: string;
  createdAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CUSTOMERS)) {
        db.createObjectStore(STORE_CUSTOMERS, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BACKUPS)) {
        db.createObjectStore(STORE_BACKUPS, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open database'));
  });
}

function txPromise<T>(tx: IDBTransaction, result?: T): Promise<T> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result as T);
    tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Request failed'));
  });
}

export async function getAllCustomers(): Promise<Customer[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_CUSTOMERS, 'readonly');
  const store = tx.objectStore(STORE_CUSTOMERS);
  const rows = await reqPromise<Customer[]>(store.getAll());
  db.close();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getCustomerById(id: number): Promise<Customer | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_CUSTOMERS, 'readonly');
  const row = await reqPromise<Customer | undefined>(tx.objectStore(STORE_CUSTOMERS).get(id));
  db.close();
  return row;
}

export async function upsertCustomer(customer: Omit<Customer, 'id'> & { id?: number }): Promise<Customer> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_CUSTOMERS, 'readwrite');
  const store = tx.objectStore(STORE_CUSTOMERS);
  const record: Record<string, unknown> = { ...customer };
  if (!record.id || record.id === 0) {
    delete record.id;
  }
  const id = await reqPromise<IDBValidKey>(store.put(record));
  await txPromise(tx);
  db.close();
  return { ...customer, id: Number(id) } as Customer;
}

export async function deleteCustomer(id: number): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_CUSTOMERS, 'readwrite');
  tx.objectStore(STORE_CUSTOMERS).delete(id);
  await txPromise(tx);
  db.close();
}

export async function replaceAllCustomers(customers: Customer[]): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_CUSTOMERS, 'readwrite');
  const store = tx.objectStore(STORE_CUSTOMERS);
  store.clear();
  for (const c of customers) {
    store.put(c);
  }
  await txPromise(tx);
  db.close();
}

let seedDemoPromise: Promise<void> | null = null;

export function seedDemoCustomerIfNeeded(): Promise<void> {
  if (seedDemoPromise) return seedDemoPromise;
  seedDemoPromise = (async () => {
    const seededKey = 'customer_manager_demo_seeded';
    if (localStorage.getItem(seededKey) === 'true') return;
    const existing = await getAllCustomers();
    const hasDemo = existing.some((c) => c.name === 'Demo Customer' && c.mobile === '9999999999');
    if (!hasDemo) {
      await upsertCustomer({
        name: 'Demo Customer',
        mobile: '9999999999',
        address: 'Demo Address, Ahmedabad',
        loanType: 'Personal Loan',
        loanAmount: '100000',
        photoUri: '',
        photos: '',
        documents: '',
        videos: '',
        notes: 'DEMO RECORD — use this profile to test the app. You can edit or delete it.',
        createdAt: Date.now(),
        applicationDetails: JSON.stringify({
          relationship: 'Self',
          workStatus: 'Working',
          business: 'Demo Business',
          salary: '25000',
          salaryMode: 'Cash',
          email: 'demo@example.com',
          totalMembers: '4',
          villageCity: 'Ahmedabad',
          addressStreet: 'Demo Address',
        }),
        coApplicantsJson: '[]',
        status: 'Pending',
      });
    }
    localStorage.setItem(seededKey, 'true');
  })().finally(() => {
    seedDemoPromise = null;
  });
  return seedDemoPromise;
}

// Media storage in IndexedDB using idb://<id> URIs
const objectUrlCache = new Map<string, string>();

export async function saveMediaBlob(blob: Blob, name: string, mimeType?: string): Promise<string> {
  const id = `media_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const record: StoredMediaRecord = {
    id,
    blob,
    mimeType: mimeType || blob.type || 'application/octet-stream',
    name,
    createdAt: Date.now(),
  };
  const db = await openDatabase();
  const tx = db.transaction(STORE_MEDIA, 'readwrite');
  tx.objectStore(STORE_MEDIA).put(record);
  await txPromise(tx);
  db.close();
  return `idb://${id}`;
}

export async function getMediaRecord(uri: string): Promise<StoredMediaRecord | undefined> {
  if (!uri.startsWith('idb://')) return undefined;
  const id = uri.slice('idb://'.length);
  const db = await openDatabase();
  const tx = db.transaction(STORE_MEDIA, 'readonly');
  const rec = await reqPromise<StoredMediaRecord | undefined>(tx.objectStore(STORE_MEDIA).get(id));
  db.close();
  return rec;
}

export async function getAllMediaRecords(): Promise<StoredMediaRecord[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_MEDIA, 'readonly');
  const rows = await reqPromise<StoredMediaRecord[]>(tx.objectStore(STORE_MEDIA).getAll());
  db.close();
  return rows;
}

export async function replaceAllMediaRecords(records: StoredMediaRecord[]): Promise<void> {
  objectUrlCache.forEach((url) => URL.revokeObjectURL(url));
  objectUrlCache.clear();
  const db = await openDatabase();
  const tx = db.transaction(STORE_MEDIA, 'readwrite');
  const store = tx.objectStore(STORE_MEDIA);
  store.clear();
  for (const r of records) {
    store.put(r);
  }
  await txPromise(tx);
  db.close();
}

export async function deleteMediaRecord(uri: string): Promise<void> {
  if (!uri.startsWith('idb://')) return;
  const id = uri.slice('idb://'.length);
  const cached = objectUrlCache.get(uri);
  if (cached) {
    URL.revokeObjectURL(cached);
    objectUrlCache.delete(uri);
  }
  const db = await openDatabase();
  const tx = db.transaction(STORE_MEDIA, 'readwrite');
  tx.objectStore(STORE_MEDIA).delete(id);
  await txPromise(tx);
  db.close();
}

export async function resolveMediaUrl(uri: string): Promise<{ url: string; mimeType: string; name: string } | null> {
  if (!uri) return null;
  if (!uri.startsWith('idb://')) {
    return { url: uri, mimeType: '', name: uri.split('/').pop() || 'file' };
  }
  const rec = await getMediaRecord(uri);
  if (!rec) return null;
  let url = objectUrlCache.get(uri);
  if (!url) {
    url = URL.createObjectURL(rec.blob);
    objectUrlCache.set(uri, url);
  }
  return { url, mimeType: rec.mimeType, name: rec.name };
}

// Rolling Backup storage in IndexedDB
export async function saveLatestBackup(info: Omit<StoredBackupInfo, 'id'>): Promise<StoredBackupInfo> {
  const full: StoredBackupInfo = { ...info, id: 'latest' };
  const db = await openDatabase();
  const tx = db.transaction(STORE_BACKUPS, 'readwrite');
  tx.objectStore(STORE_BACKUPS).put(full);
  await txPromise(tx);
  db.close();
  return full;
}

export async function getLatestBackup(): Promise<StoredBackupInfo | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_BACKUPS, 'readonly');
  const rec = await reqPromise<StoredBackupInfo | undefined>(tx.objectStore(STORE_BACKUPS).get('latest'));
  db.close();
  return rec;
}

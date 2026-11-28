import JSZip from 'jszip';
import type { Customer, StoredBackupInfo } from '../types/customer';
import {
  getAllCustomers,
  getAllMediaRecords,
  replaceAllCustomers,
  replaceAllMediaRecords,
  saveLatestBackup,
  type StoredMediaRecord,
} from './db';

const MAGIC = 'CMBAK01';
const BACKUP_PREFS_KEY = 'customer_manager_backup_prefs';

export interface BackupPrefs {
  dailyEnabled: boolean;
  lastDailyRunAt: number;
  folderLabel: string;
}

export function loadBackupPrefs(): BackupPrefs {
  try {
    const raw = localStorage.getItem(BACKUP_PREFS_KEY);
    if (!raw) return { dailyEnabled: false, lastDailyRunAt: 0, folderLabel: '' };
    return { dailyEnabled: false, lastDailyRunAt: 0, folderLabel: '', ...JSON.parse(raw) };
  } catch {
    return { dailyEnabled: false, lastDailyRunAt: 0, folderLabel: '' };
  }
}

export function saveBackupPrefs(prefs: BackupPrefs): void {
  localStorage.setItem(BACKUP_PREFS_KEY, JSON.stringify(prefs));
}

async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 210_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptBytes(plainBytes: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);
  const key = await deriveAesKey(password, salt);
  const plainBuffer = new ArrayBuffer(plainBytes.byteLength);
  new Uint8Array(plainBuffer).set(plainBytes);
  const ivBuffer = new ArrayBuffer(iv.byteLength);
  new Uint8Array(ivBuffer).set(iv);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBuffer }, key, plainBuffer);
  const cipherBytes = new Uint8Array(cipherBuffer);

  const magicBytes = new TextEncoder().encode(MAGIC);
  const out = new Uint8Array(magicBytes.length + salt.length + iv.length + cipherBytes.length);
  out.set(magicBytes, 0);
  out.set(salt, magicBytes.length);
  out.set(iv, magicBytes.length + salt.length);
  out.set(cipherBytes, magicBytes.length + salt.length + iv.length);
  return out;
}

async function decryptBytes(encryptedBytes: Uint8Array, password: string): Promise<Uint8Array> {
  const magicLen = MAGIC.length;
  if (encryptedBytes.length < magicLen + 16 + 12 + 16) {
    throw new Error('Invalid or damaged backup file.');
  }
  const header = new TextDecoder().decode(encryptedBytes.slice(0, magicLen));
  if (header !== MAGIC) {
    throw new Error('Invalid backup file format.');
  }
  const salt = encryptedBytes.slice(magicLen, magicLen + 16);
  const iv = encryptedBytes.slice(magicLen + 16, magicLen + 28);
  const cipher = encryptedBytes.slice(magicLen + 28);
  const key = await deriveAesKey(password, salt);

  const ivBuffer = new ArrayBuffer(iv.byteLength);
  new Uint8Array(ivBuffer).set(iv);
  const cipherBuffer = new ArrayBuffer(cipher.byteLength);
  new Uint8Array(cipherBuffer).set(cipher);

  try {
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuffer }, key, cipherBuffer);
    return new Uint8Array(plainBuffer);
  } catch {
    throw new Error('Incorrect backup password or corrupted backup file.');
  }
}

export async function createEncryptedBackup(password: string): Promise<StoredBackupInfo> {
  if (password.length < 8) {
    throw new Error('Backup password must contain at least 8 characters.');
  }
  const customers = await getAllCustomers();
  const media = await getAllMediaRecords();

  const zip = new JSZip();
  zip.file('customers.json', JSON.stringify(customers));

  const mediaIndex: Array<{ id: string; mimeType: string; name: string; createdAt: number; entry: string }> = [];
  for (const item of media) {
    const entry = `attachments/${item.id}`;
    const buf = await item.blob.arrayBuffer();
    zip.file(entry, buf);
    mediaIndex.push({
      id: item.id,
      mimeType: item.mimeType,
      name: item.name,
      createdAt: item.createdAt,
      entry,
    });
  }
  zip.file('media_index.json', JSON.stringify(mediaIndex));

  const uiPrefs = {
    visible_profile_tabs: localStorage.getItem('customer_manager_visible_tabs'),
  };
  zip.file('ui_preferences.json', JSON.stringify(uiPrefs));

  const now = Date.now();
  zip.file(
    'backup_info.txt',
    `Customer Manager backup\nFormat: 2\nCreated: ${now}\nCustomers: ${customers.length}\nMedia: ${media.length}\n`
  );

  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const encryptedBytes = await encryptBytes(zipBytes, password);

  // Verify round-trip decryption before committing rolling copy
  const verified = await decryptBytes(encryptedBytes, password);
  if (verified.length === 0) {
    throw new Error('Backup verification failed.');
  }

  const blobBuffer = new ArrayBuffer(encryptedBytes.byteLength);
  new Uint8Array(blobBuffer).set(encryptedBytes);
  const blob = new Blob([blobBuffer], { type: 'application/octet-stream' });

  const saved = await saveLatestBackup({
    fileName: 'CustomerManager_Backup.cmbak',
    size: blob.size,
    createdAt: now,
    blob,
  });

  return saved;
}

export async function restoreEncryptedBackup(file: File, password: string): Promise<number> {
  if (password.length < 8) {
    throw new Error('Backup password must contain at least 8 characters.');
  }
  const rawBuffer = await file.arrayBuffer();
  const plainBytes = await decryptBytes(new Uint8Array(rawBuffer), password);
  const zip = await JSZip.loadAsync(plainBytes);

  const infoFile = zip.file('backup_info.txt');
  const customersFile = zip.file('customers.json');
  if (!infoFile || !customersFile) {
    throw new Error('Backup is incomplete or unsupported.');
  }

  const customersJson = await customersFile.async('string');
  const customers = JSON.parse(customersJson) as Customer[];
  if (!Array.isArray(customers)) {
    throw new Error('Invalid customer database inside backup.');
  }

  const mediaRecords: StoredMediaRecord[] = [];
  const mediaIndexFile = zip.file('media_index.json');
  if (mediaIndexFile) {
    const indexList = JSON.parse(await mediaIndexFile.async('string')) as Array<{
      id: string;
      mimeType: string;
      name: string;
      createdAt: number;
      entry: string;
    }>;
    for (const meta of indexList) {
      const entryFile = zip.file(meta.entry);
      if (!entryFile) continue;
      const bytes = await entryFile.async('uint8array');
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      mediaRecords.push({
        id: meta.id,
        mimeType: meta.mimeType,
        name: meta.name,
        createdAt: meta.createdAt,
        blob: new Blob([buf], { type: meta.mimeType }),
      });
    }
  }

  // Keep a verified safety backup of the current state before replacing
  await createEncryptedBackup(password);

  await replaceAllMediaRecords(mediaRecords);
  await replaceAllCustomers(customers);

  const uiFile = zip.file('ui_preferences.json');
  if (uiFile) {
    try {
      const uiPrefs = JSON.parse(await uiFile.async('string')) as { visible_profile_tabs?: string | null };
      if (uiPrefs.visible_profile_tabs) {
        localStorage.setItem('customer_manager_visible_tabs', uiPrefs.visible_profile_tabs);
      }
    } catch {
      // Ignore invalid UI prefs
    }
  }

  return customers.length;
}

interface AndroidDownloaderBridge {
  saveBase64File?: (fileName: string, mimeType: string, base64Data: string) => void;
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const bridge = (window as unknown as { AndroidDownloader?: AndroidDownloaderBridge })
    .AndroidDownloader;
  if (bridge?.saveBase64File) {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      bridge.saveBase64File?.(fileName, blob.type || 'application/octet-stream', base64);
    };
    reader.readAsDataURL(blob);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export interface FullZipExportResult {
  blob: Blob;
  fileName: string;
  customerCount: number;
  fileCount: number;
}

function sanitizePathSegment(raw: string, fallback = 'Item'): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '');
  return (cleaned || fallback).slice(0, 80);
}

function extensionFromMime(mimeType: string): string {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('pdf')) return '.pdf';
  if (lower.includes('jpeg') || lower.includes('jpg')) return '.jpg';
  if (lower.includes('png')) return '.png';
  if (lower.includes('webp')) return '.webp';
  if (lower.includes('mp4')) return '.mp4';
  if (lower.includes('webm')) return '.webm';
  if (lower.includes('quicktime')) return '.mov';
  if (lower.includes('plain')) return '.txt';
  return '';
}

function ensureFileName(rawName: string, mimeType: string, fallbackBase: string): string {
  const safe = sanitizePathSegment(rawName || '', fallbackBase);
  if (/\.[a-zA-Z0-9]{2,5}$/.test(safe)) return safe;
  const ext = extensionFromMime(mimeType);
  return `${safe}${ext}`;
}

function uniqueEntryPath(used: Set<string>, dir: string, fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let candidate = `${dir}/${fileName}`;
  let idx = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${dir}/${base}_${idx}${ext}`;
    idx += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function csvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatReadableDocLabel(key: string): string {
  if (key.startsWith('cat_')) {
    const rest = key.replace(/^cat_\d+_/, '');
    return sanitizePathSegment(rest, 'Document');
  }
  if (key.startsWith('custom_')) {
    const rest = key.replace(/^custom_\d+_/, '');
    return sanitizePathSegment(rest, 'Custom_Document');
  }
  if (key.startsWith('prop_')) {
    return sanitizePathSegment(key.slice('prop_'.length), 'Property_Document');
  }
  if (key.startsWith('other_')) {
    return sanitizePathSegment(key.slice('other_'.length), 'Other_Document');
  }
  return sanitizePathSegment(key, 'Document');
}

function buildCustomerProfileText(
  customer: Customer,
  details: Record<string, unknown>,
  coApplicants: Array<Record<string, unknown>>
): string {
  const lines: string[] = [
    `CUSTOMER PROFILE`,
    `================`,
    `ID: ${customer.id}`,
    `Name: ${customer.name}`,
    `Status: ${customer.status}`,
  ];
  const customerId = typeof details.customerId === 'string' ? details.customerId.trim() : '';
  const loanId = typeof details.loanId === 'string' ? details.loanId.trim() : '';
  if (customerId) lines.push(`Customer ID: ${customerId}`);
  if (loanId) lines.push(`Loan ID: ${loanId}`);
  lines.push(
    `Mobile: ${customer.mobile}`,
    `Loan Type: ${customer.loanType}`,
    `Loan Amount: ${customer.loanAmount}`,
    `Address: ${customer.address}`,
    `Created At: ${new Date(customer.createdAt).toLocaleString()}`,
    ''
  );

  const detailFields: Array<[string, string]> = [
    ['Relationship', 'relationship'],
    ['Work Status', 'workStatus'],
    ['Business / Occupation', 'business'],
    ['Salary / Income', 'salary'],
    ['Salary Mode', 'salaryMode'],
    ['Email', 'email'],
    ['Total Family Members', 'totalMembers'],
    ['ITR Status', 'itrStatus'],
    ['House / Flat No.', 'addressHouseNo'],
    ['Street / Area', 'addressStreet'],
    ['Village / City', 'villageCity'],
    ['Taluka', 'addressTaluka'],
    ['District', 'addressDistrict'],
    ['State', 'addressState'],
    ['PIN Code', 'addressPinCode'],
    ['Bank Name', 'bankName'],
    ['Account Holder Name', 'accountHolderName'],
    ['Bank Account Number', 'bankAccountNumber'],
    ['IFSC Code', 'ifsc'],
    ['Bank Branch', 'bankBranch'],
    ['Cheque Available', 'checkAvailable'],
  ];

  const nonEmptyDetails = detailFields
    .map(([label, key]) => [label, String(details[key] ?? '').trim()] as const)
    .filter(([, val]) => val.length > 0);

  if (nonEmptyDetails.length > 0) {
    lines.push('APPLICATION DETAILS', '-------------------');
    for (const [label, val] of nonEmptyDetails) {
      lines.push(`${label}: ${val}`);
    }
    lines.push('');
  }

  if (coApplicants.length > 0) {
    lines.push('CO-APPLICANTS', '-------------');
    coApplicants.forEach((co, index) => {
      lines.push(`Co-Applicant ${index + 1}: ${String(co.name ?? '').trim() || 'Unnamed'}`);
      const coFields: Array<[string, string]> = [
        ['Relationship', 'relationship'],
        ['Mobile', 'mobile'],
        ['Address', 'address'],
        ['Work Status', 'workStatus'],
        ['Business', 'business'],
        ['Salary', 'salary'],
        ['Email', 'email'],
        ['Bank Name', 'bankName'],
        ['Account Number', 'bankAccountNumber'],
        ['IFSC', 'ifsc'],
      ];
      for (const [label, key] of coFields) {
        const val = String(co[key] ?? '').trim();
        if (val) lines.push(`  ${label}: ${val}`);
      }
      lines.push('');
    });
  }

  if (customer.notes.trim()) {
    lines.push('NOTES', '-----', customer.notes.trim(), '');
  }

  return lines.join('\n');
}

export async function exportAllDataAsZip(): Promise<FullZipExportResult> {
  const customers = await getAllCustomers();
  const mediaList = await getAllMediaRecords();
  const mediaById = new Map<string, StoredMediaRecord>();
  for (const rec of mediaList) {
    mediaById.set(rec.id, rec);
  }

  const exportedMediaIds = new Set<string>();
  const usedPaths = new Set<string>();
  const zip = new JSZip();

  const dateStamp = new Date().toISOString().slice(0, 10);
  const rootFolder = `CustomerManager_Data_${dateStamp}`;
  let fileCount = 0;

  const addMediaUriToFolder = async (
    uri: string,
    targetDir: string,
    preferredName?: string,
    fallbackBase = 'file'
  ): Promise<boolean> => {
    if (!uri || !uri.startsWith('idb://')) return false;
    const id = uri.slice('idb://'.length);
    const rec = mediaById.get(id);
    if (!rec) return false;
    const fileName = ensureFileName(preferredName || rec.name, rec.mimeType, fallbackBase);
    const entryPath = uniqueEntryPath(usedPaths, targetDir, fileName);
    const buf = await rec.blob.arrayBuffer();
    zip.file(entryPath, buf);
    exportedMediaIds.add(id);
    fileCount += 1;
    return true;
  };

  const csvRows: string[] = [
    [
      'ID',
      'Name',
      'Status',
      'Customer ID',
      'Loan ID',
      'Mobile',
      'Loan Type',
      'Loan Amount',
      'Village/City',
      'Address',
      'Work Status',
      'Business',
      'Salary',
      'Email',
      'Created At',
      'Notes',
    ]
      .map(csvCell)
      .join(','),
  ];

  const allCustomersStructured: Array<Record<string, unknown>> = [];

  for (const customer of customers) {
    let details: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(customer.applicationDetails || '{}');
      if (parsed && typeof parsed === 'object') details = parsed as Record<string, unknown>;
    } catch {
      details = {};
    }

    let coApplicants: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse(customer.coApplicantsJson || '[]');
      if (Array.isArray(parsed)) coApplicants = parsed as Array<Record<string, unknown>>;
    } catch {
      coApplicants = [];
    }

    const safeCustomerName = sanitizePathSegment(customer.name || `Customer_${customer.id}`, `Customer_${customer.id}`);
    const customerDir = `${rootFolder}/Customers/${customer.id}_${safeCustomerName}`;

    const structuredRecord = {
      ...customer,
      parsedApplicationDetails: details,
      parsedCoApplicants: coApplicants,
    };
    allCustomersStructured.push(structuredRecord);

    // 1. Customer JSON & readable TXT profile
    zip.file(`${customerDir}/profile.json`, JSON.stringify(structuredRecord, null, 2));
    fileCount += 1;
    zip.file(`${customerDir}/profile.txt`, buildCustomerProfileText(customer, details, coApplicants));
    fileCount += 1;

    if (customer.notes.trim()) {
      zip.file(`${customerDir}/notes.txt`, customer.notes.trim());
      fileCount += 1;
    }

    // 2. Profile Photo
    if (customer.photoUri) {
      await addMediaUriToFolder(customer.photoUri, `${customerDir}/Profile_Photo`, undefined, 'profile_photo');
    }

    // 3. Photos folder
    const photoUris = (customer.photos || '').split('|').filter(Boolean);
    for (let i = 0; i < photoUris.length; i++) {
      await addMediaUriToFolder(photoUris[i], `${customerDir}/Photos`, undefined, `photo_${i + 1}`);
    }

    // 4. Videos folder
    const videoUris = (customer.videos || '').split('|').filter(Boolean);
    for (let i = 0; i < videoUris.length; i++) {
      await addMediaUriToFolder(videoUris[i], `${customerDir}/Videos`, undefined, `video_${i + 1}`);
    }

    // 5. Extra documents (if any)
    const extraDocUris = (customer.documents || '').split('|').filter(Boolean);
    for (let i = 0; i < extraDocUris.length; i++) {
      await addMediaUriToFolder(extraDocUris[i], `${customerDir}/Other_Attachments`, undefined, `attachment_${i + 1}`);
    }

    // 6. Checklist Documents organized by Person / Property / Other -> Document Type
    const checklist = details.documentChecklist as Record<string, Record<string, unknown>> | undefined;
    if (checklist && typeof checklist === 'object') {
      for (const [bucketKey, bucket] of Object.entries(checklist)) {
        if (!bucket || typeof bucket !== 'object') continue;
        let bucketFolder = sanitizePathSegment(bucketKey, 'Documents');
        if (bucketKey === 'propertyDocuments') {
          bucketFolder = 'Property_Documents';
        } else if (bucketKey === 'otherDocuments') {
          bucketFolder = 'Other_Documents';
        } else if (bucketKey.startsWith('person_')) {
          const idx = Number(bucketKey.slice('person_'.length));
          if (idx === 0) {
            bucketFolder = sanitizePathSegment(`${customer.name || 'Applicant'} (Applicant)`, 'Applicant');
          } else {
            const coName = String(coApplicants[idx - 1]?.name ?? '').trim() || `Co-Applicant ${idx}`;
            bucketFolder = sanitizePathSegment(`${coName} (Co-Applicant ${idx})`, `Co-Applicant_${idx}`);
          }
        }

        for (const [entryKey, entryVal] of Object.entries(bucket)) {
          if (!entryKey.startsWith('files_') || !Array.isArray(entryVal)) continue;
          const docKey = entryKey.slice('files_'.length);
          const docFolder = formatReadableDocLabel(docKey);
          for (let i = 0; i < entryVal.length; i++) {
            const item = entryVal[i] as { uri?: string; name?: string } | undefined;
            if (!item?.uri) continue;
            await addMediaUriToFolder(
              item.uri,
              `${customerDir}/Documents/${bucketFolder}/${docFolder}`,
              item.name,
              `${docFolder}_${i + 1}`
            );
          }
        }
      }
    }

    // CSV Summary row
    csvRows.push(
      [
        customer.id,
        customer.name,
        customer.status,
        details.customerId ?? '',
        details.loanId ?? '',
        customer.mobile,
        customer.loanType,
        customer.loanAmount,
        details.villageCity ?? '',
        customer.address,
        details.workStatus ?? '',
        details.business ?? '',
        details.salary ?? '',
        details.email ?? '',
        new Date(customer.createdAt).toLocaleString(),
        customer.notes,
      ]
        .map(csvCell)
        .join(',')
    );
  }

  // Export any media records not linked to a customer so zero data is missed
  for (const rec of mediaList) {
    if (exportedMediaIds.has(rec.id)) continue;
    const fileName = ensureFileName(rec.name, rec.mimeType, rec.id);
    const entryPath = uniqueEntryPath(usedPaths, `${rootFolder}/Unassigned_Media`, fileName);
    const buf = await rec.blob.arrayBuffer();
    zip.file(entryPath, buf);
    fileCount += 1;
  }

  // Root summary files
  zip.file(`${rootFolder}/customers_summary.csv`, `\uFEFF${csvRows.join('\r\n')}`);
  fileCount += 1;
  zip.file(`${rootFolder}/all_customers.json`, JSON.stringify(allCustomersStructured, null, 2));
  fileCount += 1;
  zip.file(
    `${rootFolder}/app_settings.json`,
    JSON.stringify(
      {
        visibleProfileTabs: localStorage.getItem('customer_manager_visible_tabs'),
        backupPrefs: loadBackupPrefs(),
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  fileCount += 1;
  zip.file(
    `${rootFolder}/README.txt`,
    [
      `Customer Manager - Full Data Export`,
      `Exported At: ${new Date().toLocaleString()}`,
      `Total Customers: ${customers.length}`,
      `Total Media Files Exported: ${exportedMediaIds.size} linked / ${mediaList.length} total`,
      ``,
      `Folder Structure:`,
      `- customers_summary.csv      -> Open in Excel / Google Sheets`,
      `- all_customers.json         -> Complete JSON database`,
      `- app_settings.json          -> App UI preferences`,
      `- Customers/<ID>_<Name>/     -> Individual customer folder`,
      `    - profile.txt / profile.json / notes.txt`,
      `    - Profile_Photo/`,
      `    - Photos/`,
      `    - Videos/`,
      `    - Documents/<Person or Property or Other>/<DocumentType>/`,
      `- Unassigned_Media/          -> Any other saved files`,
    ].join('\n')
  );
  fileCount += 1;

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return {
    blob,
    fileName: `CustomerManager_AllData_${dateStamp}.zip`,
    customerCount: customers.length,
    fileCount,
  };
}


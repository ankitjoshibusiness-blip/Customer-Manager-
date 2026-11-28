const SECURITY_PREFS_KEY = 'customer_manager_security_prefs';

export type SecurityMethod = 'PIN' | 'PATTERN';

export interface SecurityLogEntry {
  timestamp: number;
  event: string;
}

export interface SecurityPrefs {
  configured: boolean;
  method: SecurityMethod;
  salt: string;
  hash: string;
  recoverySalt: string;
  recoveryHash: string;
  failedAttempts: number;
  lockUntil: number;
  backgroundLock: boolean;
  autoLockMinutes: number; // 0 = Off, 1, 5, 10, 30
  failedAttemptLimit: number; // 3, 5, 10
  securityLog: SecurityLogEntry[];
}

const DEFAULT_PREFS: SecurityPrefs = {
  configured: false,
  method: 'PIN',
  salt: '',
  hash: '',
  recoverySalt: '',
  recoveryHash: '',
  failedAttempts: 0,
  lockUntil: 0,
  backgroundLock: false,
  autoLockMinutes: 0,
  failedAttemptLimit: 5,
  securityLog: [],
};

export function loadSecurityPrefs(): SecurityPrefs {
  try {
    const raw = localStorage.getItem(SECURITY_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveSecurityPrefs(next: SecurityPrefs): void {
  localStorage.setItem(SECURITY_PREFS_KEY, JSON.stringify(next));
}

export function appendSecurityLog(event: string): SecurityPrefs {
  const prefs = loadSecurityPrefs();
  const updated: SecurityPrefs = {
    ...prefs,
    securityLog: [{ timestamp: Date.now(), event }, ...prefs.securityLog].slice(0, 50),
  };
  saveSecurityPrefs(updated);
  return updated;
}

export function generateSaltHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (!hex || hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function generateRecoveryCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  return Array.from(rand)
    .map((v) => chars[v % chars.length])
    .join('');
}

export async function hashCredential(value: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(value),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const saltBytes = hexToBytes(saltHex);
  const saltBuffer = new ArrayBuffer(saltBytes.byteLength);
  new Uint8Array(saltBuffer).set(saltBytes);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 120_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

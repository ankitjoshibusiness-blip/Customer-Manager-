import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Fingerprint, History, Lock, RefreshCw, Shield, Unlock } from 'lucide-react';
import {
  appendSecurityLog,
  generateRecoveryCode,
  generateSaltHex,
  hashCredential,
  loadSecurityPrefs,
  saveSecurityPrefs,
  type SecurityMethod,
  type SecurityPrefs,
} from '../services/security';

interface PatternDotsProps {
  value: string;
  onChange: (next: string) => void;
}

export const PatternDots: React.FC<PatternDotsProps> = ({ value, onChange }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const pathRef = useRef(value);

  useEffect(() => {
    pathRef.current = value;
  }, [value]);

  const active = value
    .split('')
    .map((ch) => parseInt(ch, 10))
    .filter((n) => n >= 1 && n <= 9);

  const centerForDot = (dot: number, width: number, height: number) => {
    const cellX = width / 3;
    const cellY = height / 3;
    const col = (dot - 1) % 3;
    const row = Math.floor((dot - 1) / 3);
    return { x: (col + 0.5) * cellX, y: (row + 0.5) * cellY };
  };

  const nearestDot = (clientX: number, clientY: number): number | null => {
    const el = boxRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    const cellX = rect.width / 3;
    const cellY = rect.height / 3;
    const col = Math.min(2, Math.max(0, Math.floor(x / cellX)));
    const row = Math.min(2, Math.max(0, Math.floor(y / cellY)));
    const cx = (col + 0.5) * cellX;
    const cy = (row + 0.5) * cellY;
    const dist = Math.hypot(x - cx, y - cy);
    return dist <= Math.min(cellX, cellY) * 0.48 ? row * 3 + col + 1 : null;
  };

  const addDot = (path: string, dot: number): string => {
    if (path.includes(String(dot))) return path;
    if (!path) return String(dot);
    const last = parseInt(path[path.length - 1], 10);
    const dx = ((dot - 1) % 3) - ((last - 1) % 3);
    const dy = Math.floor((dot - 1) / 3) - Math.floor((last - 1) / 3);
    const midX = ((last - 1) % 3) + Math.trunc(dx / 2);
    const midY = Math.floor((last - 1) / 3) + Math.trunc(dy / 2);
    const midpoint = midY * 3 + midX + 1;
    if (
      (Math.abs(dx) === 2 || Math.abs(dy) === 2) &&
      (dx % 2 === 0 && dy % 2 === 0) &&
      midpoint >= 1 &&
      midpoint <= 9 &&
      !path.includes(String(midpoint))
    ) {
      return `${path}${midpoint}${dot}`;
    }
    return `${path}${dot}`;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    const dot = nearestDot(e.clientX, e.clientY);
    const next = dot ? String(dot) : '';
    pathRef.current = next;
    onChange(next);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dot = nearestDot(e.clientX, e.clientY);
    if (dot) {
      const updated = addDot(pathRef.current, dot);
      if (updated !== pathRef.current) {
        pathRef.current = updated;
        onChange(updated);
      }
    }
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  const size = 252;

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div
        ref={boxRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative w-[252px] h-[252px] touch-none cursor-crosshair rounded-2xl bg-[#FAF8FD] border border-[#E3D9F4]"
      >
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
          {active.slice(0, -1).map((fromDot, idx) => {
            const toDot = active[idx + 1];
            const a = centerForDot(fromDot, size, size);
            const b = centerForDot(toDot, size, size);
            return (
              <line
                key={`${fromDot}-${toDot}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#7042C1"
                strokeWidth="7"
                strokeLinecap="round"
                opacity="0.85"
              />
            );
          })}
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((dot) => {
            const c = centerForDot(dot, size, size);
            const selected = active.includes(dot);
            return (
              <g key={dot}>
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={selected ? 16 : 11}
                  fill={selected ? '#7042C1' : '#C9C2D8'}
                />
                {selected && <circle cx={c.x} cy={c.y} r={5} fill="#FFFFFF" />}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-xs text-[#77718A] text-center">
        Draw across 4 or more dots. Release when finished.
      </p>
      <button
        type="button"
        onClick={() => onChange('')}
        className="text-xs font-semibold text-[#7042C1] hover:underline px-2 py-1"
      >
        Clear pattern
      </button>
    </div>
  );
};

interface SecurityGateProps {
  onUnlocked: () => void;
}

export const SecurityGate: React.FC<SecurityGateProps> = ({ onUnlocked }) => {
  const [prefs, setPrefs] = useState<SecurityPrefs>(() => loadSecurityPrefs());
  const [setupMode, setSetupMode] = useState<boolean>(() => !loadSecurityPrefs().configured);
  const [revealCode, setRevealCode] = useState<string | null>(null);
  const [method, setMethod] = useState<SecurityMethod>(() => loadSecurityPrefs().method || 'PIN');
  const [credential, setCredential] = useState('');
  const [confirm, setConfirm] = useState('');
  const [patternStep, setPatternStep] = useState(0);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (prefs.lockUntil <= Date.now()) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [prefs.lockUntil]);

  const handleSetupSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const valid =
      method === 'PIN'
        ? credential.length >= 4 && credential.length <= 8 && credential === confirm
        : credential.length >= 4 &&
          confirm.length >= 4 &&
          credential === confirm &&
          /^[1-9]+$/.test(credential);

    if (!valid) {
      setError(
        method === 'PIN'
          ? 'PINs must match and contain 4–8 digits.'
          : 'Patterns do not match. Draw the same pattern again.'
      );
      return;
    }

    setBusy(true);
    try {
      const salt = generateSaltHex();
      const recovery = generateRecoveryCode();
      const recoverySalt = generateSaltHex();
      const [hash, recoveryHash] = await Promise.all([
        hashCredential(credential, salt),
        hashCredential(recovery, recoverySalt),
      ]);
      const next: SecurityPrefs = {
        ...prefs,
        configured: true,
        method,
        salt,
        hash,
        recoverySalt,
        recoveryHash,
        failedAttempts: 0,
        lockUntil: 0,
      };
      saveSecurityPrefs(next);
      setPrefs(appendSecurityLog(`Security configured (${method})`));
      setRevealCode(recovery);
      setError('');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const now = Date.now();
    if (now < prefs.lockUntil) {
      const secs = Math.ceil((prefs.lockUntil - now) / 1000);
      setError(`Too many failed attempts. Try again in ${secs}s.`);
      return;
    }
    if (!credential) {
      setError(method === 'PIN' ? 'Enter your PIN.' : 'Draw your unlock pattern.');
      return;
    }

    setBusy(true);
    try {
      const computed = await hashCredential(credential, prefs.salt);
      if (prefs.salt && computed === prefs.hash) {
        const next: SecurityPrefs = {
          ...prefs,
          failedAttempts: 0,
          lockUntil: 0,
        };
        saveSecurityPrefs(next);
        appendSecurityLog('Successful unlock');
        setError('');
        onUnlocked();
      } else {
        const attempts = prefs.failedAttempts + 1;
        const limit = prefs.failedAttemptLimit || 5;
        const nextLock = attempts >= limit ? Date.now() + 30_000 : 0;
        const next: SecurityPrefs = {
          ...prefs,
          failedAttempts: nextLock > 0 ? 0 : attempts,
          lockUntil: nextLock,
        };
        saveSecurityPrefs(next);
        setPrefs(appendSecurityLog('Failed unlock attempt'));
        setError(
          nextLock > 0
            ? 'Too many failed attempts. Locked for 30 seconds.'
            : 'Incorrect PIN or Pattern.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const computed = await hashCredential(recoveryInput.trim().toUpperCase(), prefs.recoverySalt);
      if (prefs.recoverySalt && computed === prefs.recoveryHash) {
        const next: SecurityPrefs = { ...prefs, configured: false };
        saveSecurityPrefs(next);
        setPrefs(next);
        setShowRecovery(false);
        setSetupMode(true);
        setCredential('');
        setConfirm('');
        setPatternStep(0);
        setRevealCode(null);
        setError('Recovery verified. Create a new PIN or Pattern and save the new recovery code.');
      } else {
        setError('Invalid recovery code.');
      }
    } finally {
      setBusy(false);
    }
  };

  const remainingLockSeconds = prefs.lockUntil > nowMs ? Math.ceil((prefs.lockUntil - nowMs) / 1000) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-[#F5F1FC] overflow-y-auto flex items-center justify-center p-6">
      <div className="w-full max-w-[420px] bg-white rounded-[28px] border border-[#E3D9F4] p-7 shadow-sm">
        <div className="flex flex-col items-center text-center gap-2 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-[#F0EAFB] flex items-center justify-center text-[#7042C1]">
            <Fingerprint className="w-7 h-7" />
          </div>
          <p className="text-xs font-bold tracking-wider text-[#89819C]">CUSTOMER MANAGER</p>
          <h1 className="text-2xl font-bold text-[#211936]">
            {setupMode ? 'Set up app security' : 'App is locked'}
          </h1>
          <p className="text-sm text-[#77718A]">
            {setupMode
              ? 'Choose a PIN or Pattern. A private recovery code will be generated.'
              : 'Verify your identity to access your customer records.'}
          </p>
        </div>

        {setupMode && revealCode === null && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 p-1 bg-[#F0EAFB] rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setMethod('PIN');
                  setCredential('');
                  setConfirm('');
                  setPatternStep(0);
                  setError('');
                }}
                className={`py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  method === 'PIN' ? 'bg-white text-[#211936] shadow-sm' : 'text-[#77718A]'
                }`}
              >
                PIN
              </button>
              <button
                type="button"
                onClick={() => {
                  setMethod('PATTERN');
                  setCredential('');
                  setConfirm('');
                  setPatternStep(0);
                  setError('');
                }}
                className={`py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  method === 'PATTERN' ? 'bg-white text-[#211936] shadow-sm' : 'text-[#77718A]'
                }`}
              >
                Pattern
              </button>
            </div>

            {method === 'PIN' ? (
              <form onSubmit={handleSetupSave} className="space-y-3">
                <p className="text-xs text-[#625A78] text-center">Create a 4–8 digit PIN</p>
                <div>
                  <label className="block text-xs font-semibold text-[#625A78] mb-1">New PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={credential}
                    onChange={(e) => setCredential(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="4–8 digits"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#D4D8E1] bg-[#FAF8FD] text-[#211936] focus:outline-none focus:border-[#7042C1]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#625A78] mb-1">Confirm PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="Re-enter PIN"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#D4D8E1] bg-[#FAF8FD] text-[#211936] focus:outline-none focus:border-[#7042C1]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white font-semibold text-sm transition-colors disabled:opacity-60"
                >
                  Save security & generate recovery code
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                {patternStep === 0 ? (
                  <>
                    <p className="text-sm font-medium text-[#625A78] text-center">Draw your pattern</p>
                    <PatternDots
                      value={credential}
                      onChange={(v) => {
                        setCredential(v);
                        setError('');
                      }}
                    />
                    <button
                      type="button"
                      disabled={credential.length < 4}
                      onClick={() => {
                        if (credential.length >= 4) {
                          setConfirm('');
                          setPatternStep(1);
                          setError('');
                        } else {
                          setError('Connect at least 4 dots to continue.');
                        }
                      }}
                      className="w-full py-2.5 px-4 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white font-semibold text-sm transition-colors disabled:opacity-40"
                    >
                      Next
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-[#625A78] text-center">
                      Confirm your pattern (draw the same pattern again)
                    </p>
                    <PatternDots
                      value={confirm}
                      onChange={(v) => {
                        setConfirm(v);
                        setError('');
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPatternStep(0);
                          setConfirm('');
                          setError('');
                        }}
                        className="px-4 py-2.5 rounded-xl border border-[#E3D9F4] text-[#7042C1] font-semibold text-sm"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleSetupSave()}
                        className="flex-1 py-2.5 px-4 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white font-semibold text-sm transition-colors"
                      >
                        Save security & generate code
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {setupMode && revealCode !== null && (
          <div className="space-y-4 text-center">
            <p className="text-sm font-semibold text-[#211936]">Your recovery code</p>
            <div className="py-3 px-4 rounded-xl bg-[#F0EAFB] border border-[#E3D9F4]">
              <p className="text-2xl font-bold font-mono-nums tracking-widest text-[#7042C1]">{revealCode}</p>
            </div>
            <p className="text-xs text-[#7042C1]">
              Write this code down and keep it private. It is shown only once.
            </p>
            <button
              type="button"
              onClick={() => {
                setSetupMode(false);
                onUnlocked();
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white font-semibold text-sm transition-colors"
            >
              I saved my code — Continue
            </button>
          </div>
        )}

        {!setupMode && !showRecovery && (
          <form onSubmit={handleUnlock} className="space-y-4">
            {method === 'PIN' ? (
              <div>
                <label className="block text-xs font-semibold text-[#625A78] mb-1">Enter PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoFocus
                  value={credential}
                  onChange={(e) => {
                    setCredential(e.target.value.replace(/\D/g, '').slice(0, 8));
                    setError('');
                  }}
                  placeholder="Enter your PIN"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#D4D8E1] bg-[#FAF8FD] text-[#211936] focus:outline-none focus:border-[#7042C1]"
                />
              </div>
            ) : (
              <div>
                <p className="text-xs font-medium text-[#625A78] text-center mb-2">Draw your unlock pattern</p>
                <PatternDots
                  value={credential}
                  onChange={(v) => {
                    setCredential(v);
                    setError('');
                  }}
                />
              </div>
            )}
            <button
              type="submit"
              disabled={busy || remainingLockSeconds > 0}
              className="w-full py-2.5 px-4 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Unlock className="w-4 h-4" />
              {remainingLockSeconds > 0 ? `Locked (${remainingLockSeconds}s)` : 'Unlock'}
            </button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setShowRecovery(true);
                  setRecoveryInput('');
                  setError('');
                }}
                className="text-xs font-semibold text-[#7042C1] hover:underline"
              >
                Forgot PIN / Pattern?
              </button>
            </div>
          </form>
        )}

        {!setupMode && showRecovery && (
          <form onSubmit={handleVerifyRecovery} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#625A78] mb-1">
                10-character recovery code
              </label>
              <input
                type="text"
                maxLength={10}
                value={recoveryInput}
                onChange={(e) =>
                  setRecoveryInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))
                }
                placeholder="e.g. A7K9M2P4Q8"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D4D8E1] bg-[#FAF8FD] font-mono-nums uppercase text-[#211936] focus:outline-none focus:border-[#7042C1]"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white font-semibold text-sm transition-colors"
            >
              Verify recovery code
            </button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setShowRecovery(false);
                  setError('');
                }}
                className="text-xs font-semibold text-[#7042C1] hover:underline"
              >
                Back to unlock
              </button>
            </div>
          </form>
        )}

        {error && <p className="mt-4 text-xs font-medium text-[#B42318] text-center">{error}</p>}
      </div>
    </div>
  );
};

interface SecuritySettingsScreenProps {
  onBack: () => void;
  onLockNow: () => void;
}

export const SecuritySettingsScreen: React.FC<SecuritySettingsScreenProps> = ({ onBack, onLockNow }) => {
  const [prefs, setPrefs] = useState<SecurityPrefs>(() => loadSecurityPrefs());
  const [verified, setVerified] = useState(false);
  const [current, setCurrent] = useState('');
  const [currentPattern, setCurrentPattern] = useState('');
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  const [showChange, setShowChange] = useState(false);
  const [newMethod, setNewMethod] = useState<SecurityMethod>(prefs.method);
  const [newCredential, setNewCredential] = useState('');
  const [confirmCredential, setConfirmCredential] = useState('');
  const [patternConfirm, setPatternConfirm] = useState('');
  const [patternStep, setPatternStep] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const verifyCurrent = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = prefs.method === 'PIN' ? current : currentPattern;
    if (!prefs.salt || !candidate) {
      setError('Incorrect current PIN or Pattern.');
      return;
    }
    const hashed = await hashCredential(candidate, prefs.salt);
    if (hashed === prefs.hash) {
      setVerified(true);
      setError('');
      setPrefs(appendSecurityLog('Security settings opened'));
    } else {
      setError('Incorrect current PIN or Pattern.');
    }
  };

  const saveNewSecurityMethod = async () => {
    const candidate = newMethod === 'PIN' ? newCredential : patternConfirm;
    const valid =
      newMethod === 'PIN'
        ? newCredential.length >= 4 && newCredential.length <= 8 && newCredential === confirmCredential
        : newCredential.length >= 4 && candidate === newCredential;
    if (!valid) {
      setError('New credentials do not match.');
      return;
    }
    const salt = generateSaltHex();
    const hash = await hashCredential(candidate, salt);
    const updated: SecurityPrefs = { ...prefs, method: newMethod, salt, hash };
    saveSecurityPrefs(updated);
    setPrefs(appendSecurityLog(`Changed security type to ${newMethod}`));
    setShowChange(false);
    setCurrent('');
    setCurrentPattern('');
    setError('');
    setStatusMsg('Security method updated.');
  };

  const updateSetting = (patch: Partial<SecurityPrefs>, logText: string) => {
    const next = { ...prefs, ...patch };
    saveSecurityPrefs(next);
    setPrefs(appendSecurityLog(logText));
  };

  const handleRegenerateRecovery = async () => {
    const code = generateRecoveryCode();
    const salt = generateSaltHex();
    const recoveryHash = await hashCredential(code, salt);
    const next = { ...prefs, recoverySalt: salt, recoveryHash };
    saveSecurityPrefs(next);
    setPrefs(appendSecurityLog('Recovery code regenerated'));
    setRecoveryCode(code);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl bg-white border border-[#E3D9F4] text-[#7042C1] hover:bg-[#F0EAFB]"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-[#211936]">Security & Privacy</h2>
            <p className="text-xs text-[#77718A]">Manage your app protection</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLockNow}
          className="px-4 py-2 rounded-xl bg-white border border-[#E3D9F4] text-[#7042C1] text-xs font-semibold hover:bg-[#F0EAFB] flex items-center gap-1.5 whitespace-nowrap"
        >
          <Lock className="w-3.5 h-3.5" />
          Lock App Now
        </button>
      </div>

      {!verified ? (
        <form
          onSubmit={verifyCurrent}
          className="bg-white rounded-2xl border border-[#E3D9F4] p-6 space-y-4 max-w-md"
        >
          <div className="flex items-center gap-2 text-[#211936] font-bold">
            <Shield className="w-5 h-5 text-[#7042C1]" />
            <span>Verify your current {prefs.method}</span>
          </div>
          {prefs.method === 'PIN' ? (
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={current}
              onChange={(e) => setCurrent(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="Current PIN"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#D4D8E1] bg-[#FAF8FD] text-[#211936] focus:outline-none focus:border-[#7042C1]"
            />
          ) : (
            <PatternDots value={currentPattern} onChange={setCurrentPattern} />
          )}
          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white font-semibold text-sm"
          >
            Verify & Continue
          </button>
          {error && <p className="text-xs font-medium text-[#B42318]">{error}</p>}
        </form>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-[#E3D9F4] p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#7042C1]">Authentication</h3>
            <p className="text-sm text-[#211936]">
              Current method: <span className="font-semibold">{prefs.method}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setShowChange(!showChange);
                setNewMethod(prefs.method);
                setNewCredential('');
                setConfirmCredential('');
                setPatternConfirm('');
                setPatternStep(0);
                setError('');
              }}
              className="px-4 py-2 rounded-xl border border-[#E3D9F4] text-[#7042C1] text-sm font-semibold hover:bg-[#F0EAFB]"
            >
              Change PIN / Pattern or Security Type
            </button>

            {showChange && (
              <div className="pt-3 border-t border-[#E3D9F4] space-y-3">
                <div className="flex gap-2">
                  {(['PIN', 'PATTERN'] as SecurityMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setNewMethod(m);
                        setNewCredential('');
                        setConfirmCredential('');
                        setPatternConfirm('');
                        setPatternStep(0);
                      }}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border ${
                        newMethod === m
                          ? 'bg-[#7042C1] text-white border-[#7042C1]'
                          : 'bg-white text-[#77718A] border-[#E3D9F4]'
                      }`}
                    >
                      {m === 'PIN' ? 'PIN' : 'Pattern'}
                    </button>
                  ))}
                </div>
                {newMethod === 'PIN' ? (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      value={newCredential}
                      onChange={(e) => setNewCredential(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="New 4–8 digit PIN"
                      className="px-3.5 py-2.5 rounded-xl border border-[#D4D8E1] bg-[#FAF8FD] text-sm"
                    />
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      value={confirmCredential}
                      onChange={(e) => setConfirmCredential(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="Confirm new PIN"
                      className="px-3.5 py-2.5 rounded-xl border border-[#D4D8E1] bg-[#FAF8FD] text-sm"
                    />
                  </div>
                ) : patternStep === 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-[#625A78]">Draw new pattern (at least 4 dots)</p>
                    <PatternDots value={newCredential} onChange={setNewCredential} />
                    <button
                      type="button"
                      onClick={() => {
                        if (newCredential.length >= 4) setPatternStep(1);
                        else setError('Use at least 4 dots.');
                      }}
                      className="px-4 py-2 rounded-xl bg-[#7042C1] text-white text-sm font-semibold"
                    >
                      Next
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-[#625A78]">Draw the same pattern again</p>
                    <PatternDots value={patternConfirm} onChange={setPatternConfirm} />
                    <button
                      type="button"
                      onClick={() => {
                        setPatternStep(0);
                        setPatternConfirm('');
                      }}
                      className="text-xs font-semibold text-[#7042C1]"
                    >
                      Back
                    </button>
                  </div>
                )}
                {(newMethod === 'PIN' || patternStep === 1) && (
                  <button
                    type="button"
                    onClick={saveNewSecurityMethod}
                    className="px-4 py-2 rounded-xl bg-[#7042C1] text-white text-sm font-semibold"
                  >
                    Save new security method
                  </button>
                )}
              </div>
            )}
            {statusMsg && <p className="text-xs font-medium text-[#16845F]">{statusMsg}</p>}
            {error && <p className="text-xs font-medium text-[#B42318]">{error}</p>}
          </div>

          <div className="bg-white rounded-2xl border border-[#E3D9F4] p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#7042C1]">Automatic Lock</h3>
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[#211936]">Lock when tab goes to background</p>
                <p className="text-xs text-[#77718A]">Require authentication when switching back</p>
              </div>
              <input
                type="checkbox"
                checked={prefs.backgroundLock}
                onChange={(e) =>
                  updateSetting(
                    { backgroundLock: e.target.checked },
                    `Background lock ${e.target.checked ? 'enabled' : 'disabled'}`
                  )
                }
                className="w-4 h-4 accent-[#7042C1]"
              />
            </label>

            <div>
              <p className="text-sm font-medium text-[#211936] mb-2">Auto-lock after inactivity</p>
              <div className="flex flex-wrap gap-2">
                {[0, 1, 5, 10, 30].map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() =>
                      updateSetting({ autoLockMinutes: min }, `Auto-lock set to ${min} minutes`)
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      prefs.autoLockMinutes === min
                        ? 'bg-[#7042C1] text-white border-[#7042C1]'
                        : 'bg-[#FAF8FD] text-[#625A78] border-[#E3D9F4]'
                    }`}
                  >
                    {min === 0 ? 'Off' : `${min}m`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-[#211936] mb-2">Failed unlock protection</p>
              <div className="flex flex-wrap gap-2">
                {[3, 5, 10].map((limit) => (
                  <button
                    key={limit}
                    type="button"
                    onClick={() =>
                      updateSetting(
                        { failedAttemptLimit: limit },
                        `Failed attempt limit set to ${limit}`
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      prefs.failedAttemptLimit === limit
                        ? 'bg-[#7042C1] text-white border-[#7042C1]'
                        : 'bg-[#FAF8FD] text-[#625A78] border-[#E3D9F4]'
                    }`}
                  >
                    {limit} attempts
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#77718A] mt-1.5">
                After the selected number of failures, unlock is paused for 30 seconds.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E3D9F4] p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#7042C1]">Recovery Code</h3>
            <p className="text-xs text-[#77718A]">
              Regenerate a recovery code. The old code will stop working.
            </p>
            <button
              type="button"
              onClick={handleRegenerateRecovery}
              className="px-4 py-2 rounded-xl bg-[#7042C1] text-white text-sm font-semibold hover:bg-[#5E35A8]"
            >
              Regenerate recovery code
            </button>
            {recoveryCode && (
              <p className="text-sm font-bold font-mono-nums text-[#7042C1] bg-[#F0EAFB] px-3 py-2 rounded-xl">
                Save this new code securely: {recoveryCode}
              </p>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-[#E3D9F4] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#7042C1] font-bold text-sm">
                <History className="w-4 h-4" />
                <span>Security Activity Log</span>
              </div>
              <button
                type="button"
                onClick={() => setPrefs(loadSecurityPrefs())}
                className="p-1.5 rounded-lg text-[#7042C1] hover:bg-[#F0EAFB]"
                title="Refresh log"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            {prefs.securityLog.length === 0 ? (
              <p className="text-xs text-[#77718A]">No security activity recorded yet.</p>
            ) : (
              <div className="divide-y divide-[#E3D9F4] max-h-60 overflow-y-auto">
                {prefs.securityLog.slice(0, 20).map((entry, idx) => (
                  <div key={`${entry.timestamp}-${idx}`} className="py-2 text-xs text-[#625A78] flex items-center justify-between gap-4">
                    <span className="font-medium text-[#211936]">{entry.event}</span>
                    <span className="font-mono-nums text-[#77718A] shrink-0">
                      {new Date(entry.timestamp).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

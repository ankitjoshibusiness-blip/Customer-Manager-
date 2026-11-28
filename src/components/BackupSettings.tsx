import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CloudUpload, Download, Folder, FolderArchive, Lock, RotateCcw } from 'lucide-react';
import type { StoredBackupInfo } from '../types/customer';
import { getLatestBackup } from '../services/db';
import {
  createEncryptedBackup,
  exportAllDataAsZip,
  loadBackupPrefs,
  restoreEncryptedBackup,
  saveBackupPrefs,
  triggerBlobDownload,
} from '../services/backup';

interface BackupSettingsProps {
  onBack: () => void;
  onRestored: () => Promise<void>;
}

export const BackupSettings: React.FC<BackupSettingsProps> = ({ onBack, onRestored }) => {
  const [password, setPassword] = useState('');
  const [prefs, setPrefs] = useState(() => loadBackupPrefs());
  const [latestBackup, setLatestBackup] = useState<StoredBackupInfo | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getLatestBackup().then(setLatestBackup).catch(() => {});
  }, []);

  useEffect(() => {
    const handleAndroidBack = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (showRestoreConfirm) setShowRestoreConfirm(false);
      else onBack();
    };
    window.addEventListener('androidback', handleAndroidBack, true);
    return () => window.removeEventListener('androidback', handleAndroidBack, true);
  }, [showRestoreConfirm, onBack]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleExportFolderZip = async () => {
    setZipBusy(true);
    setMessage(null);
    try {
      const result = await exportAllDataAsZip();
      if (dirHandle) {
        try {
          const fileHandle = await dirHandle.getFileHandle(result.fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(result.blob);
          await writable.close();
          setMessage({
            type: 'ok',
            text: `ZIP exported to "${dirHandle.name}": ${result.fileName} (${result.customerCount} customers, ${result.fileCount} files).`,
          });
          return;
        } catch {
          // fallback to browser download
        }
      }
      triggerBlobDownload(result.blob, result.fileName);
      setMessage({
        type: 'ok',
        text: `Downloaded ${result.fileName} (${result.customerCount} customers, ${result.fileCount} files organized in folders).`,
      });
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'ZIP export failed.',
      });
    } finally {
      setZipBusy(false);
    }
  };

  const handleChooseFolder = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker;
    if (!picker) {
      setMessage({
        type: 'ok',
        text: 'Browser downloads folder will be used when saving backup files.',
      });
      return;
    }
    try {
      const handle = await picker();
      setDirHandle(handle);
      const next = { ...prefs, folderLabel: handle.name || 'Selected folder' };
      setPrefs(next);
      saveBackupPrefs(next);
      setMessage({ type: 'ok', text: `Backup folder selected: ${handle.name}` });
    } catch {
      // User cancelled
    }
  };

  const handleBackupNow = async () => {
    if (password.length < 8) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await createEncryptedBackup(password);
      setLatestBackup(saved);
      if (dirHandle) {
        try {
          const fileHandle = await dirHandle.getFileHandle(saved.fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(saved.blob);
          await writable.close();
          setMessage({
            type: 'ok',
            text: `Encrypted backup saved to "${dirHandle.name}" and browser vault (${saved.fileName}).`,
          });
        } catch {
          triggerBlobDownload(saved.blob, saved.fileName);
          setMessage({
            type: 'ok',
            text: `Encrypted backup created and downloaded: ${saved.fileName}`,
          });
        }
      } else {
        triggerBlobDownload(saved.blob, saved.fileName);
        setMessage({
          type: 'ok',
          text: `Encrypted backup created and downloaded: ${saved.fileName}`,
        });
      }
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Backup failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const count = await restoreEncryptedBackup(file, password);
      const latest = await getLatestBackup();
      setLatestBackup(latest);
      await onRestored();
      setMessage({
        type: 'ok',
        text: `Backup restored successfully (${count} customer record(s)).`,
      });
    } catch (err) {
      setMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Restore failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
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
          <h2 className="text-xl font-bold text-[#211936]">Backup & Restore</h2>
          <p className="text-xs text-[#77718A]">Folder-wise ZIP export & encrypted local backup</p>
        </div>
      </div>

      {/* Full Data & Folders ZIP Export */}
      <div className="bg-white rounded-2xl border border-[#D4C2F2] p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[#211936] font-bold">
              <FolderArchive className="w-5 h-5 text-[#7042C1]" />
              <span>Export All Data & Folders (.zip)</span>
            </div>
            <p className="text-xs text-[#625A78]">
              Downloads every customer profile (CSV, JSON, TXT), notes, profile photos, photos, videos, and scanned/uploaded documents organized cleanly in customer folders. No password required.
            </p>
          </div>
          <button
            type="button"
            disabled={zipBusy || busy}
            onClick={handleExportFolderZip}
            className="px-4 py-2.5 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {zipBusy ? 'Preparing ZIP…' : 'Download All Data (.zip)'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E3D9F4] p-5 space-y-3">
        <div className="flex items-center gap-2 text-[#211936] font-bold">
          <Lock className="w-5 h-5 text-[#7042C1]" />
          <span>Encrypted Backup (.cmbak)</span>
        </div>
        <p className="text-xs text-[#625A78]">
          A password is required to encrypt and restore your backup. Keep it safe; without it, backup files cannot be opened.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Backup password (8+ characters)"
          className="w-full px-3.5 py-2.5 rounded-xl border border-[#D4D8E1] bg-[#FAF8FD] text-sm text-[#211936] focus:outline-none focus:border-[#7042C1]"
        />
      </div>

      <div className="bg-white rounded-2xl border border-[#E3D9F4] p-5 space-y-3">
        <h3 className="text-sm font-bold text-[#211936]">Backup locations</h3>
        <div className="flex items-center gap-3">
          <Folder className="w-5 h-5 text-[#7042C1] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#211936]">Local browser vault</p>
            <p className="text-xs text-[#77718A]">Encrypted rolling copy stored in IndexedDB</p>
          </div>
        </div>
        <div className="border-t border-[#E3D9F4] pt-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CloudUpload className="w-5 h-5 text-[#7042C1] shrink-0" />
            <div>
              <p className="text-sm font-medium text-[#211936]">Cloud / Device folder</p>
              <p className="text-xs text-[#77718A]">
                {prefs.folderLabel || 'Downloads .cmbak file or choose a synced Drive folder'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleChooseFolder}
            className="px-3.5 py-2 rounded-xl border border-[#E3D9F4] text-xs font-semibold text-[#7042C1] hover:bg-[#F0EAFB] whitespace-nowrap"
          >
            Choose folder
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E3D9F4] p-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[#211936]">Automatic daily backup reminder</p>
          <p className="text-xs text-[#77718A]">
            Tracks daily encrypted snapshot cadence when password is set.
          </p>
        </div>
        <input
          type="checkbox"
          disabled={password.length < 8}
          checked={prefs.dailyEnabled}
          onChange={(e) => {
            const next = { ...prefs, dailyEnabled: e.target.checked };
            setPrefs(next);
            saveBackupPrefs(next);
          }}
          className="w-4 h-4 accent-[#7042C1]"
        />
      </div>

      <div className="bg-white rounded-2xl border border-[#E3D9F4] p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#211936]">Latest backup</h3>
          <span className="text-xs font-semibold text-[#7042C1]">
            {latestBackup ? '1 rolling copy' : 'Not created'}
          </span>
        </div>
        {!latestBackup ? (
          <p className="text-xs text-[#77718A]">
            Only the latest encrypted backup is retained. Each successful backup replaces the previous copy.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <Lock className="w-4 h-4 text-[#7042C1] shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#211936] truncate">{latestBackup.fileName}</p>
                <p className="text-xs text-[#77718A] font-mono-nums">
                  {formatSize(latestBackup.size)} · {new Date(latestBackup.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => triggerBlobDownload(latestBackup.blob, latestBackup.fileName)}
              className="px-3 py-1.5 rounded-lg border border-[#E3D9F4] text-xs font-semibold text-[#7042C1] hover:bg-[#F0EAFB] flex items-center gap-1.5 shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
          </div>
        )}
      </div>

      {message && (
        <div
          className={`px-4 py-3 rounded-xl text-xs font-medium border ${
            message.type === 'ok'
              ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#16845F]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#B42318]'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          disabled={busy || password.length < 8}
          onClick={handleBackupNow}
          className="flex-1 py-3 px-4 rounded-xl bg-[#7042C1] hover:bg-[#5E35A8] text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <CloudUpload className="w-4 h-4" />
          {busy ? 'Encrypting backup…' : 'Backup now'}
        </button>
        <button
          type="button"
          disabled={busy || password.length < 8}
          onClick={() => setShowRestoreConfirm(true)}
          className="flex-1 py-3 px-4 rounded-xl bg-white border border-[#E3D9F4] text-[#7042C1] hover:bg-[#F0EAFB] font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <RotateCcw className="w-4 h-4" />
          Restore from backup file
        </button>
      </div>

      {/* Android Studio Project ZIP Download */}
      <div className="bg-white rounded-2xl border border-[#E3D9F4] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[#211936] font-bold text-sm">
            <FolderArchive className="w-4 h-4 text-[#7042C1]" />
            <span>Android Studio Project (.zip)</span>
          </div>
          <p className="text-xs text-[#625A78]">
            Complete Android Studio Gradle + Kotlin project with built app assets and full web source code ready to open, edit, and build an APK.
          </p>
        </div>
        <a
          href="./CustomerManager_AndroidStudio.zip"
          download="CustomerManager_AndroidStudio.zip"
          className="px-4 py-2.5 rounded-xl bg-[#F0EAFB] hover:bg-[#E4D7F8] border border-[#D4C2F2] text-[#7042C1] text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          Download Project ZIP
        </a>
      </div>

      <input
        ref={restoreInputRef}
        type="file"
        accept=".cmbak,*/*"
        onChange={handleRestoreFile}
        className="hidden"
      />

      {showRestoreConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-[#E3D9F4] max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-[#211936]">Restore backup?</h3>
            <p className="text-sm text-[#625A78]">
              Restoring replaces the current customer database and media with the selected backup. Continue only if you have a recent backup of current data.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRestoreConfirm(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-[#625A78] hover:bg-[#F5F1FC]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRestoreConfirm(false);
                  restoreInputRef.current?.click();
                }}
                className="px-4 py-2 rounded-xl bg-[#7042C1] text-white text-sm font-semibold hover:bg-[#5E35A8]"
              >
                Choose backup file
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

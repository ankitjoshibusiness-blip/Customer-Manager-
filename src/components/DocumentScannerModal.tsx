import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, Loader2, X } from 'lucide-react';

declare global {
  interface Window {
    AndroidDocumentScanner?: {
      startDocumentScan: () => void;
    };
  }
}

interface NativeDocumentScanResult {
  pdfBase64?: string;
  pageCount?: number;
  fileName?: string;
  error?: string;
}

export interface DocumentScannerModalProps {
  docTitle: string;
  onClose: () => void;
  onSavePdf: (pdfBlob: Blob, pageCount: number) => Promise<void>;
}

/**
 * Native Google ML Kit document scanner bridge.
 * All camera viewfinder, edge detection, crop, rotate, filters and page review
 * are provided by Google's scanner UI; this component only receives the PDF.
 */
export const DocumentScannerModal: React.FC<DocumentScannerModalProps> = ({
  docTitle,
  onClose,
  onSavePdf,
}) => {
  const [status, setStatus] = useState('Opening Google Document Scanner…');
  const [error, setError] = useState('');
  const onCloseRef = useRef(onClose);
  const onSavePdfRef = useRef(onSavePdf);
  onCloseRef.current = onClose;
  onSavePdfRef.current = onSavePdf;

  useEffect(() => {
    let active = true;

    const handleResult = async (event: Event) => {
      const detail = (event as CustomEvent<NativeDocumentScanResult>).detail;
      if (!active) return;
      if (detail?.error) {
        setError(detail.error);
        setStatus('Scanner could not finish');
        return;
      }
      if (!detail?.pdfBase64) {
        setError('Google Scanner did not return a PDF file.');
        setStatus('Scan unavailable');
        return;
      }

      try {
        setStatus('Saving scanned document…');
        const binary = window.atob(detail.pdfBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
        await onSavePdfRef.current(pdfBlob, Math.max(1, Number(detail.pageCount) || 1));
        if (active) onCloseRef.current();
      } catch (saveError) {
        if (!active) return;
        setError(saveError instanceof Error ? saveError.message : 'Could not save scanned PDF.');
        setStatus('Saving failed');
      }
    };

    const handleCancelled = () => {
      if (active) onCloseRef.current();
    };

    window.addEventListener('nativeDocumentScanResult', handleResult);
    window.addEventListener('nativeDocumentScanCancelled', handleCancelled);

    if (window.AndroidDocumentScanner?.startDocumentScan) {
      try {
        window.AndroidDocumentScanner.startDocumentScan();
      } catch (startError) {
        setError(startError instanceof Error ? startError.message : 'Could not start Google Scanner.');
        setStatus('Scanner unavailable');
      }
    } else {
      setError('Google Document Scanner is available in the installed Android APK. Please rebuild and install the latest version.');
      setStatus('Android scanner connection not found');
    }

    return () => {
      active = false;
      window.removeEventListener('nativeDocumentScanResult', handleResult);
      window.removeEventListener('nativeDocumentScanCancelled', handleCancelled);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black/55 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-[24px] bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#EAF2FF] text-[#1A73E8] flex items-center justify-center">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#211936]">Google Document Scanner</h3>
              <p className="text-xs text-[#77718A] mt-0.5 line-clamp-1">{docTitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close scanner" className="p-1.5 rounded-lg text-[#77718A] hover:bg-[#F5F1FC]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error ? (
          <div className="rounded-xl bg-[#FFF4F2] border border-[#F8D7D2] p-3 flex gap-2 text-sm text-[#A12B22]">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="rounded-xl bg-[#F5F8FF] p-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-[#1A73E8] animate-spin shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[#26354D]">{status}</p>
              <p className="text-xs text-[#6B7280] mt-1">Google provides camera detection, page crop, filters and multi-page PDF preview.</p>
            </div>
          </div>
        )}

        <button type="button" onClick={onClose} className="w-full rounded-xl border border-[#E3D9F4] py-2.5 text-sm font-bold text-[#625A78] hover:bg-[#FAF8FD]">
          {error ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Crop,
  Eraser,
  Flashlight,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  applyScannerFilter,
  detectDocumentQuad,
  FULL_IMAGE_QUAD,
  FULL_QUAD,
  warpPerspectiveQuad,
  type DocumentQuad,
  type ScannerFilterType,
} from '../services/documentScannerEngine';
import { createPdfFromImageBlobs } from '../services/pdfExport';
import {
  createInitialAutoCaptureState,
  renderCleanStrokesOnContext,
  stepAutoCaptureState,
  type AutoCaptureState,
  type CleanStroke,
} from '../utils/cleanBrush';
import { computeContainedRect } from '../utils/scannerQuad';
import { CleanBrushOverlay } from './CleanBrushOverlay';
import { SmoothCropEditor } from './SmoothCropEditor';

interface ScannedPage {
  id: string;
  sourceBlob: Blob;
  previewUrl: string;
  quad: DocumentQuad;
  rotation: 0 | 90 | 180 | 270;
  filter: ScannerFilterType;
  cleanStrokes: CleanStroke[];
}

export interface DocumentScannerModalProps {
  docTitle: string;
  /** 'document' outputs multi-page PDF (default); 'photo' outputs cropped/cleaned JPEG photos */
  scanKind?: 'document' | 'photo';
  onClose: () => void;
  onSavePdf?: (pdfBlob: Blob, pageCount: number) => Promise<void>;
  onSavePhotos?: (photos: Array<{ blob: Blob; fileName: string }>) => Promise<void>;
}

const FILTER_OPTIONS: Array<{ id: ScannerFilterType; label: string }> = [
  { id: 'clean', label: 'Auto' },
  { id: 'color', label: 'Color' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'bw', label: 'B&W' },
  { id: 'original', label: 'Original' },
];

function quadMovement(a: DocumentQuad, b: DocumentQuad): number {
  let maxDist = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
    if (d > maxDist) maxDist = d;
  }
  return maxDist;
}

function lerpQuad(prev: DocumentQuad, next: DocumentQuad, alpha = 0.35): DocumentQuad {
  return [
    { x: prev[0].x + (next[0].x - prev[0].x) * alpha, y: prev[0].y + (next[0].y - prev[0].y) * alpha },
    { x: prev[1].x + (next[1].x - prev[1].x) * alpha, y: prev[1].y + (next[1].y - prev[1].y) * alpha },
    { x: prev[2].x + (next[2].x - prev[2].x) * alpha, y: prev[2].y + (next[2].y - prev[2].y) * alpha },
    { x: prev[3].x + (next[3].x - prev[3].x) * alpha, y: prev[3].y + (next[3].y - prev[3].y) * alpha },
  ];
}

function loadImgFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

type ReviewSubMode = 'preview' | 'crop' | 'clean';

export const DocumentScannerModal: React.FC<DocumentScannerModalProps> = ({
  docTitle,
  scanKind = 'document',
  onClose,
  onSavePdf,
  onSavePhotos,
}) => {
  const defaultFilter: ScannerFilterType = scanKind === 'photo' ? 'original' : 'clean';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const pagesRef = useRef<ScannedPage[]>([]);
  const cameraReqIdRef = useRef<number>(0);
  const warpedCacheRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const filteredBaseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const autoRingCircleRef = useRef<SVGCircleElement | null>(null);

  // Live detection & Google Drive Auto-Capture refs
  const smoothedQuadRef = useRef<DocumentQuad | null>(null);
  const autoStateRef = useRef<AutoCaptureState>(createInitialAutoCaptureState());
  const scanStatusRef = useRef<string>(
    scanKind === 'photo' ? 'Position photo in frame' : 'Position document in frame'
  );

  const [mode, setMode] = useState<'camera' | 'review'>('camera');
  const [autoCapture, setAutoCapture] = useState(true);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [scanStatus, setScanStatus] = useState(scanStatusRef.current);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [stackPulse, setStackPulse] = useState(false);

  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [retakingIndex, setRetakingIndex] = useState<number | null>(null);

  // Google Drive Review editor states
  const [reviewSubMode, setReviewSubMode] = useState<ReviewSubMode>('preview');
  const [draftQuad, setDraftQuad] = useState<DocumentQuad>(FULL_QUAD);
  const [showFiltersBar, setShowFiltersBar] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [cleanBaseCanvas, setCleanBaseCanvas] = useState<HTMLCanvasElement | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    return () => {
      pagesRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, []);

  const stopCamera = useCallback(() => {
    cameraReqIdRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    const reqId = cameraReqIdRef.current;
    setCameraError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Live camera is unavailable in this browser. Pick from Gallery or use Phone Camera below.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      if (reqId !== cameraReqIdRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track && typeof track.getCapabilities === 'function') {
        const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
        setTorchSupported(Boolean(caps.torch));
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        if (reqId === cameraReqIdRef.current) {
          setCameraReady(true);
        }
      }
    } catch (err) {
      if (reqId !== cameraReqIdRef.current) return;
      setCameraError(
        err instanceof Error ? err.message : 'Camera permission denied or no camera detected.'
      );
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (mode === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [mode, startCamera, stopCamera]);

  // Consume device Back inside the scanner: exit crop editing first, then close scanner.
  useEffect(() => {
    const handleAndroidBack = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (mode === 'review' && reviewSubMode === 'crop') {
        setReviewSubMode('preview');
      } else {
        stopCamera();
        onClose();
      }
    };
    window.addEventListener('androidback', handleAndroidBack, true);
    return () => window.removeEventListener('androidback', handleAndroidBack, true);
  }, [mode, reviewSubMode, stopCamera, onClose]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // torch unsupported by device hardware
    }
  };

  const captureFromVideo = useCallback(
    async (detectedQuad: DocumentQuad | null) => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) return;

      setCaptureFlash(true);
      setStackPulse(true);
      window.setTimeout(() => setCaptureFlash(false), 180);
      window.setTimeout(() => setStackPulse(false), 420);

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.94)
      );
      if (!blob) return;

      const previewUrl = URL.createObjectURL(blob);
      const quad = detectedQuad ?? detectDocumentQuad(canvas) ?? FULL_IMAGE_QUAD;

      if (retakingIndex !== null) {
        setPages((prev) =>
          prev.map((p, idx) => {
            if (idx !== retakingIndex) return p;
            URL.revokeObjectURL(p.previewUrl);
            return {
              ...p,
              sourceBlob: blob,
              previewUrl,
              quad,
              rotation: 0,
              cleanStrokes: [],
            };
          })
        );
        setActiveIndex(retakingIndex);
        setRetakingIndex(null);
        setReviewSubMode('preview');
        setMode('review');
      } else {
        const nextPage: ScannedPage = {
          id: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          sourceBlob: blob,
          previewUrl,
          quad,
          rotation: 0,
          filter: defaultFilter,
          cleanStrokes: [],
        };
        setPages((prev) => {
          const next = [...prev, nextPage];
          setActiveIndex(next.length - 1);
          return next;
        });
      }
    },
    [defaultFilter, retakingIndex]
  );

  // Real-time Google Drive blue edge-detection quad + Auto-Capture circular progress loop
  useEffect(() => {
    if (mode !== 'camera' || !cameraReady) return;
    let cancelled = false;
    let rafId = 0;
    let lastDetectAt = 0;
    const RING_CIRCUMFERENCE = 2 * Math.PI * 33;

    const setShutterProgress = (progress: number) => {
      const circle = autoRingCircleRef.current;
      if (!circle) return;
      const clamped = Math.max(0, Math.min(1, progress));
      circle.style.strokeDashoffset = `${(RING_CIRCUMFERENCE * (1 - clamped)).toFixed(2)}`;
      circle.style.opacity = clamped > 0.02 ? '1' : '0';
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const video = videoRef.current;
      const overlay = overlayCanvasRef.current;

      if (video && overlay && video.videoWidth > 0 && video.videoHeight > 0) {
        const rect = overlay.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const targetW = Math.round(rect.width * dpr);
          const targetH = Math.round(rect.height * dpr);
          if (overlay.width !== targetW || overlay.height !== targetH) {
            overlay.width = targetW;
            overlay.height = targetH;
          }

          const fitted = computeContainedRect(
            overlay.width,
            overlay.height,
            video.videoWidth,
            video.videoHeight
          );
          const { x: offX, y: offY, width: drawW, height: drawH } = fitted;

          if (now - lastDetectAt > 130) {
            lastDetectAt = now;
            const rawQuad = detectDocumentQuad(video);
            if (rawQuad) {
              const prev = smoothedQuadRef.current;
              const next = prev ? lerpQuad(prev, rawQuad, 0.42) : rawQuad;
              const moved = prev ? quadMovement(prev, rawQuad) : 1;
              smoothedQuadRef.current = next;

              const step = stepAutoCaptureState(autoStateRef.current, now, {
                detected: true,
                autoEnabled: autoCapture,
                movement: moved,
                scanKind,
              });
              autoStateRef.current = step.nextState;
              setShutterProgress(step.progress);
              if (step.statusText !== scanStatusRef.current) {
                scanStatusRef.current = step.statusText;
                setScanStatus(step.statusText);
              }
              if (step.shouldCapture) {
                captureFromVideo(next);
              }
            } else {
              const step = stepAutoCaptureState(autoStateRef.current, now, {
                detected: false,
                autoEnabled: autoCapture,
                movement: 1,
                scanKind,
              });
              autoStateRef.current = step.nextState;
              if (step.nextState.missCount > 3) {
                smoothedQuadRef.current = null;
              }
              setShutterProgress(0);
              if (step.statusText !== scanStatusRef.current) {
                scanStatusRef.current = step.statusText;
                setScanStatus(step.statusText);
              }
            }
          }

          // Render Google Drive ML Kit blue translucent quadrilateral + glowing edges
          const ctx = overlay.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            const q = smoothedQuadRef.current;
            if (q) {
              const pts = q.map((p) => ({
                x: offX + p.x * drawW,
                y: offY + p.y * drawH,
              }));

              ctx.save();
              ctx.beginPath();
              ctx.moveTo(pts[0].x, pts[0].y);
              ctx.lineTo(pts[1].x, pts[1].y);
              ctx.lineTo(pts[2].x, pts[2].y);
              ctx.lineTo(pts[3].x, pts[3].y);
              ctx.closePath();

              // Authentic Google Drive blue tint inside detected paper/photo
              ctx.fillStyle = 'rgba(66, 133, 244, 0.22)';
              ctx.fill();
              ctx.lineWidth = 3 * dpr;
              ctx.lineJoin = 'round';
              ctx.strokeStyle = '#8AB4F8';
              ctx.stroke();

              // Crisp corner indicators
              for (const pt of pts) {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 5.5 * dpr, 0, Math.PI * 2);
                ctx.fillStyle = '#1A73E8';
                ctx.fill();
                ctx.lineWidth = 2 * dpr;
                ctx.strokeStyle = '#FFFFFF';
                ctx.stroke();
              }
              ctx.restore();
            } else {
              // Subtle Google Drive viewfinder corner brackets while locating document/photo
              const mX = offX + drawW * 0.1;
              const mY = offY + drawH * 0.1;
              const rX = offX + drawW * 0.9;
              const rY = offY + drawH * 0.9;
              const arm = Math.min(drawW, drawH) * 0.06;
              ctx.save();
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
              ctx.lineWidth = 2.5 * dpr;
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(mX, mY + arm);
              ctx.lineTo(mX, mY);
              ctx.lineTo(mX + arm, mY);
              ctx.moveTo(rX - arm, mY);
              ctx.lineTo(rX, mY);
              ctx.lineTo(rX, mY + arm);
              ctx.moveTo(rX, rY - arm);
              ctx.lineTo(rX, rY);
              ctx.lineTo(rX - arm, rY);
              ctx.moveTo(mX + arm, rY);
              ctx.lineTo(mX, rY);
              ctx.lineTo(mX, rY - arm);
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      setShutterProgress(0);
    };
  }, [mode, cameraReady, autoCapture, captureFromVideo, scanKind]);

  const activePage = pages[activeIndex] ?? null;

  // Render warped + filtered + clean-brushed preview canvas in Review mode (with warp cache for instant filters)
  useEffect(() => {
    if (mode !== 'review' || reviewSubMode !== 'preview' || !activePage) return;
    let cancelled = false;
    let rafId = 0;

    const quadKey = activePage.quad.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(';');
    const warpCacheKey = `${activePage.id}|${activePage.previewUrl}|${quadKey}|${activePage.rotation}`;

    const renderWithBase = (warpedBase: HTMLCanvasElement) => {
      if (cancelled || !previewCanvasRef.current) return;
      // Clone cached warped canvas before applying filter so warp cache remains untouched
      const filteredCanvas = document.createElement('canvas');
      filteredCanvas.width = warpedBase.width;
      filteredCanvas.height = warpedBase.height;
      const wCtx = filteredCanvas.getContext('2d');
      if (!wCtx) return;
      wCtx.drawImage(warpedBase, 0, 0);

      applyScannerFilter(filteredCanvas, activePage.filter);
      // Save filtered base (pre-clean strokes) so entering Clean mode is instantaneous
      filteredBaseCanvasRef.current = filteredCanvas;

      const target = previewCanvasRef.current;
      if (!target || cancelled) return;
      target.width = filteredCanvas.width;
      target.height = filteredCanvas.height;
      const ctx = target.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, target.width, target.height);
        ctx.drawImage(filteredCanvas, 0, 0);
        if (activePage.cleanStrokes.length > 0) {
          renderCleanStrokesOnContext(ctx, target.width, target.height, activePage.cleanStrokes);
        }
      }
      setPreviewBusy(false);
    };

    const cached = warpedCacheRef.current;
    if (cached && cached.key === warpCacheKey) {
      rafId = requestAnimationFrame(() => renderWithBase(cached.canvas));
      return () => {
        cancelled = true;
        cancelAnimationFrame(rafId);
      };
    }

    setPreviewBusy(true);
    loadImgFromUrl(activePage.previewUrl)
      .then((img) => {
        if (cancelled) return;
        rafId = requestAnimationFrame(() => {
          if (cancelled) return;
          const warped = warpPerspectiveQuad(img, activePage.quad, activePage.rotation, 960);
          warpedCacheRef.current = { key: warpCacheKey, canvas: warped };
          renderWithBase(warped);
        });
      })
      .catch(() => {
        if (!cancelled) setPreviewBusy(false);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [mode, reviewSubMode, activePage]);

  const openCleanEditor = useCallback(async () => {
    if (!activePage) return;
    if (filteredBaseCanvasRef.current) {
      setCleanBaseCanvas(filteredBaseCanvasRef.current);
      setReviewSubMode('clean');
      return;
    }
    try {
      const img = await loadImgFromUrl(activePage.previewUrl);
      const warped = warpPerspectiveQuad(img, activePage.quad, activePage.rotation, 960);
      const filtered = applyScannerFilter(warped, activePage.filter);
      filteredBaseCanvasRef.current = filtered;
      setCleanBaseCanvas(filtered);
      setReviewSubMode('clean');
    } catch {
      // ignore
    }
  }, [activePage]);

  const handleImportPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setSaveError('');

    const added: ScannedPage[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const url = URL.createObjectURL(file);
      let detectedQuad: DocumentQuad = FULL_IMAGE_QUAD;
      try {
        const img = await loadImgFromUrl(url);
        detectedQuad = detectDocumentQuad(img) ?? FULL_IMAGE_QUAD;
      } catch {
        detectedQuad = FULL_IMAGE_QUAD;
      }
      added.push({
        id: `scan_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        sourceBlob: file,
        previewUrl: url,
        quad: detectedQuad,
        rotation: 0,
        filter: defaultFilter,
        cleanStrokes: [],
      });
    }

    setPages((prev) => {
      if (retakingIndex !== null && added.length > 0) {
        const next = prev.map((p, idx) => {
          if (idx !== retakingIndex) return p;
          URL.revokeObjectURL(p.previewUrl);
          return added[0];
        });
        setActiveIndex(retakingIndex);
        setRetakingIndex(null);
        return next;
      }
      const next = [...prev, ...added];
      setActiveIndex(prev.length);
      return next;
    });
    setReviewSubMode('preview');
    setMode('review');
    e.target.value = '';
  };

  const updateActivePage = (updater: (page: ScannedPage) => ScannedPage) => {
    setPages((prev) => prev.map((p, idx) => (idx === activeIndex ? updater(p) : p)));
  };

  const handleDeletePage = (idxToDelete: number) => {
    setPages((prev) => {
      const target = prev[idxToDelete];
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((_, i) => i !== idxToDelete);
      if (next.length === 0) {
        setActiveIndex(0);
        setReviewSubMode('preview');
        setMode('camera');
      } else {
        setActiveIndex((cur) => Math.min(cur, next.length - 1));
      }
      return next;
    });
  };

  const handleMovePage = (dir: -1 | 1) => {
    const targetIdx = activeIndex + dir;
    if (targetIdx < 0 || targetIdx >= pages.length) return;
    setPages((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(activeIndex, 1);
      copy.splice(targetIdx, 0, moved);
      return copy;
    });
    setActiveIndex(targetIdx);
  };

  const handleSaveOutput = async () => {
    if (pages.length === 0 || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const renderedPages: Array<{ blob: Blob; mimeType: string; fileName: string }> = [];
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safeTitle = docTitle.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32) || 'Scan';

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const img = await loadImgFromUrl(page.previewUrl);
        const warped = warpPerspectiveQuad(img, page.quad, page.rotation, 1800);
        const filtered = applyScannerFilter(warped, page.filter);
        if (page.cleanStrokes.length > 0) {
          const ctx = filtered.getContext('2d');
          if (ctx) {
            renderCleanStrokesOnContext(ctx, filtered.width, filtered.height, page.cleanStrokes);
          }
        }
        const blob = await new Promise<Blob>((resolve, reject) => {
          filtered.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Failed to encode scanned image'))),
            'image/jpeg',
            0.92
          );
        });
        renderedPages.push({
          blob,
          mimeType: 'image/jpeg',
          fileName: `${safeTitle}_scan_${stamp}_${i + 1}.jpg`,
        });
      }

      if (scanKind === 'photo' && onSavePhotos) {
        await onSavePhotos(
          renderedPages.map((r) => ({ blob: r.blob, fileName: r.fileName }))
        );
      } else if (onSavePdf) {
        const pdfBlob = await createPdfFromImageBlobs(
          renderedPages.map((r) => ({ blob: r.blob, mimeType: r.mimeType }))
        );
        await onSavePdf(pdfBlob, pages.length);
      }

      stopCamera();
      onClose();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save scan. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const isEditingSubMode = mode === 'review' && reviewSubMode !== 'preview';
  const lastCapturedPage = pages.length > 0 ? pages[pages.length - 1] : null;
  const saveCtaLabel =
    scanKind === 'photo'
      ? saving
        ? 'Saving…'
        : `Save ${pages.length === 1 ? 'Photo' : `Photos (${pages.length})`}`
      : saving
        ? 'Creating PDF…'
        : `Save PDF (${pages.length} ${pages.length === 1 ? 'page' : 'pages'})`;

  return (
    <div
      data-testid="google-drive-scanner"
      className="fixed inset-0 z-[60] bg-[#0E0E11] text-white flex flex-col select-none"
    >
      {/* Top Bar */}
      <div className="px-3.5 py-2.5 bg-[#1B1B1F] border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (mode === 'review' && reviewSubMode !== 'preview') {
                setReviewSubMode('preview');
                return;
              }
              stopCamera();
              onClose();
            }}
            className="p-2 rounded-full hover:bg-white/10 disabled:opacity-40 transition-colors"
            aria-label={isEditingSubMode ? 'Back to preview' : 'Close scanner'}
          >
            {isEditingSubMode ? <ArrowLeft className="w-5 h-5" /> : <X className="w-5 h-5" />}
          </button>

          {mode === 'camera' ? (
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                <ScanLine className="w-4 h-4 text-[#8AB4F8] shrink-0" />
                {retakingIndex !== null
                  ? `Retake page ${retakingIndex + 1}`
                  : scanKind === 'photo'
                    ? 'Photo Scanner'
                    : docTitle}
              </p>
              <p className="text-[11px] text-white/60 truncate">
                {pages.length > 0
                  ? `${pages.length} ${scanKind === 'photo' ? 'photo' : 'page'}${pages.length === 1 ? '' : 's'} captured`
                  : scanKind === 'photo'
                    ? 'Auto-crop & enhance photos'
                    : 'Auto-crop & scan into PDF'}
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                <ScanLine className="w-4 h-4 text-[#8AB4F8] shrink-0" />
                {reviewSubMode === 'crop'
                  ? 'Crop & Adjust'
                  : reviewSubMode === 'clean'
                    ? 'Clean Page'
                    : docTitle}
              </p>
              <p className="text-[11px] text-white/60">
                {reviewSubMode === 'crop'
                  ? 'Drag corners or edges to frame cleanly'
                  : reviewSubMode === 'clean'
                    ? 'Erase marks, shadows, or fingers'
                    : `${scanKind === 'photo' ? 'Photo' : 'Page'} ${activeIndex + 1} of ${pages.length}`}
              </p>
            </div>
          )}
        </div>

        {/* Center/Right Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {mode === 'camera' && (
            <>
              {/* Google Drive Auto | Manual Segmented Pill */}
              <div
                role="group"
                aria-label="Capture mode"
                className="inline-flex items-center rounded-full bg-white/10 p-0.5 border border-white/10"
              >
                <button
                  type="button"
                  onClick={() => {
                    autoStateRef.current = createInitialAutoCaptureState();
                    setAutoCapture(true);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    autoCapture
                      ? 'bg-[#1A73E8] text-white shadow'
                      : 'text-white/75 hover:text-white'
                  }`}
                >
                  Auto
                </button>
                <button
                  type="button"
                  onClick={() => {
                    autoStateRef.current = createInitialAutoCaptureState();
                    setAutoCapture(false);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    !autoCapture
                      ? 'bg-[#1A73E8] text-white shadow'
                      : 'text-white/75 hover:text-white'
                  }`}
                >
                  Manual
                </button>
              </div>

              {torchSupported && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  className={`p-2 rounded-full transition-colors ${
                    torchOn ? 'bg-[#FDD663] text-black' : 'bg-white/10 hover:bg-white/15'
                  }`}
                  aria-label="Toggle flash"
                  title="Flash"
                >
                  <Flashlight className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                onClick={() => setFacingMode((f) => (f === 'environment' ? 'user' : 'environment'))}
                className="p-2 rounded-full bg-white/10 hover:bg-white/15 transition-colors"
                aria-label="Switch camera"
                title="Switch camera"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </>
          )}

          {mode === 'review' && reviewSubMode === 'preview' && (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setRetakingIndex(null);
                  setMode('camera');
                }}
                className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center gap-1.5"
              >
                <Camera className="w-3.5 h-3.5" />
                + Add
              </button>
              <button
                type="button"
                disabled={pages.length === 0 || saving}
                onClick={handleSaveOutput}
                className="px-4 py-1.5 rounded-full bg-[#1A73E8] hover:bg-[#1765CC] disabled:opacity-50 text-xs font-bold flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                {saving ? 'Saving…' : 'Done'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      {mode === 'camera' ? (
        <div className="relative flex-1 flex items-center justify-center bg-black overflow-hidden">
          {cameraError ? (
            <div className="max-w-sm mx-auto p-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-[#1A73E8]/20 text-[#8AB4F8] flex items-center justify-center mx-auto">
                <Camera className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <p className="font-bold text-sm">Camera preview unavailable</p>
                <p className="text-xs text-white/70 leading-relaxed">{cameraError}</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold"
                >
                  Retry Camera
                </button>
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold flex items-center gap-1.5"
                >
                  <ImagePlus className="w-4 h-4" />
                  Import Gallery
                </button>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="w-full h-full object-contain"
              />
              {/* Real-time Google Drive Blue Edge-Detection Overlay */}
              <canvas
                ref={overlayCanvasRef}
                className="pointer-events-none absolute inset-0 w-full h-full"
              />

              {/* Floating Google Drive Status Pill (bottom-center above controls) */}
              <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-[#1B1B1F]/85 backdrop-blur-md border border-white/15 text-xs font-medium text-white whitespace-nowrap shadow-lg">
                {scanStatus}
              </div>

              {/* Crisp Shutter Flash */}
              {captureFlash && (
                <div className="pointer-events-none absolute inset-0 bg-white/80 transition-opacity" />
              )}
            </>
          )}
        </div>
      ) : reviewSubMode === 'clean' && activePage && cleanBaseCanvas ? (
        <CleanBrushOverlay
          baseCanvas={cleanBaseCanvas}
          strokes={activePage.cleanStrokes}
          onChangeStrokes={(nextStrokes) =>
            updateActivePage((p) => ({ ...p, cleanStrokes: nextStrokes }))
          }
          onDone={() => setReviewSubMode('preview')}
        />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#141418]">
          {/* Preview OR Smooth 4-Corner + Edge Crop Editor */}
          <div
            className={`relative flex-1 flex items-center justify-center overflow-hidden ${
              reviewSubMode === 'crop' ? 'p-0' : 'p-4'
            }`}
          >
            {activePage && reviewSubMode === 'preview' && (
              <>
                <canvas
                  ref={previewCanvasRef}
                  data-testid="scanner-preview-canvas"
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl bg-white"
                />

                {/* Left / Right Page Switcher Arrows when > 1 page */}
                {pages.length > 1 && (
                  <>
                    <button
                      type="button"
                      disabled={activeIndex === 0}
                      onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                      aria-label="Previous page"
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 flex items-center justify-center disabled:opacity-20 transition-opacity"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      disabled={activeIndex === pages.length - 1}
                      onClick={() => setActiveIndex((i) => Math.min(pages.length - 1, i + 1))}
                      aria-label="Next page"
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 flex items-center justify-center disabled:opacity-20 transition-opacity"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}

                {previewBusy && (
                  <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-black/80 border border-white/15 text-xs font-medium text-white/90">
                    Enhancing…
                  </div>
                )}
              </>
            )}

            {activePage && reviewSubMode === 'crop' && (
              <SmoothCropEditor
                imageUrl={activePage.previewUrl}
                rotation={activePage.rotation}
                quad={draftQuad}
                onChange={setDraftQuad}
              />
            )}
          </div>

          {/* Crop Editor Toolbar */}
          {reviewSubMode === 'crop' && activePage && (
            <div className="bg-[#1B1B1F] border-t border-white/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const img = await loadImgFromUrl(activePage.previewUrl);
                      setDraftQuad(detectDocumentQuad(img) ?? FULL_QUAD);
                    } catch {
                      setDraftQuad(FULL_QUAD);
                    }
                  }}
                  className="px-3 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#8AB4F8]" />
                  Auto-Detect
                </button>
                <button
                  type="button"
                  onClick={() => setDraftQuad(FULL_IMAGE_QUAD)}
                  className="px-3 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  No Crop
                </button>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setReviewSubMode('preview')}
                  className="px-3.5 py-2 rounded-full text-xs font-semibold text-white/75 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateActivePage((p) => ({
                      ...p,
                      quad: draftQuad,
                      // Reset clean strokes when crop geometry changes so strokes never misalign
                      cleanStrokes: [],
                    }));
                    setReviewSubMode('preview');
                  }}
                  className="px-4 py-2 rounded-full bg-[#1A73E8] hover:bg-[#1765CC] text-xs font-bold flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  Apply
                </button>
              </div>
            </div>
          )}

          {/* Authentic Google Drive Review Action Strip */}
          {reviewSubMode === 'preview' && activePage && (
            <div className="bg-[#1B1B1F] border-t border-white/10 px-3 pt-2.5 pb-2 space-y-2.5 shrink-0">
              {showFiltersBar && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1 px-1">
                  {FILTER_OPTIONS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => updateActivePage((p) => ({ ...p, filter: f.id }))}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                        activePage.filter === f.id
                          ? 'bg-[#1A73E8] text-white'
                          : 'bg-white/10 text-white/80 hover:bg-white/15'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                  {pages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const chosen = activePage.filter;
                        setPages((prev) => prev.map((p) => ({ ...p, filter: chosen })));
                      }}
                      className="px-3 py-1.5 rounded-full text-[11px] font-semibold text-[#8AB4F8] bg-[#8AB4F8]/10 hover:bg-[#8AB4F8]/20 whitespace-nowrap ml-auto"
                    >
                      Apply to all
                    </button>
                  )}
                </div>
              )}

              {/* Icon-over-Label Google Drive Tool Bar */}
              <div className="flex items-center justify-around gap-1 max-w-xl mx-auto overflow-x-auto">
                <button
                  type="button"
                  onClick={() => {
                    setDraftQuad(activePage.quad);
                    setReviewSubMode('crop');
                  }}
                  className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-white/10 transition-colors min-w-[58px]"
                >
                  <Crop className="w-5 h-5 text-[#8AB4F8]" />
                  <span className="text-[11px] font-medium text-white/90">Crop</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    updateActivePage((p) => ({
                      ...p,
                      rotation: ((p.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                      cleanStrokes: [],
                    }))
                  }
                  className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-white/10 transition-colors min-w-[58px]"
                >
                  <RotateCw className="w-5 h-5 text-white/90" />
                  <span className="text-[11px] font-medium text-white/90">Rotate</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowFiltersBar((v) => !v)}
                  className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-colors min-w-[58px] ${
                    showFiltersBar ? 'bg-white/15 text-[#8AB4F8]' : 'hover:bg-white/10 text-white/90'
                  }`}
                >
                  <SlidersHorizontal className="w-5 h-5" />
                  <span className="text-[11px] font-medium">Filter</span>
                </button>

                <button
                  type="button"
                  onClick={openCleanEditor}
                  className="relative flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-white/10 transition-colors min-w-[58px]"
                >
                  <Eraser className="w-5 h-5 text-white/90" />
                  <span className="text-[11px] font-medium text-white/90">Clean</span>
                  {activePage.cleanStrokes.length > 0 && (
                    <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-[#8AB4F8]" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRetakingIndex(activeIndex);
                    setMode('camera');
                  }}
                  className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-white/10 transition-colors min-w-[58px]"
                >
                  <Camera className="w-5 h-5 text-white/90" />
                  <span className="text-[11px] font-medium text-white/90">Retake</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDeletePage(activeIndex)}
                  className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-[#B3261E]/30 text-[#FFB4AB] transition-colors min-w-[58px]"
                >
                  <Trash2 className="w-5 h-5" />
                  <span className="text-[11px] font-medium">Delete</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom Camera Controls OR Review Thumbnail Strip + Save Bar */}
      {!isEditingSubMode && (
        <div className="bg-[#121216] border-t border-white/10 px-4 py-3 space-y-3 shrink-0">
          {saveError && (
            <p className="text-xs text-[#FFB4AB] text-center bg-[#B3261E]/25 border border-[#B3261E]/40 rounded-lg px-3 py-1.5">
              {saveError}
            </p>
          )}

          {mode === 'review' && pages.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              {pages.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={`relative w-11 h-14 rounded-lg overflow-hidden border-2 shrink-0 transition-all ${
                    activeIndex === idx
                      ? 'border-[#8AB4F8] scale-105'
                      : 'border-white/20 opacity-70 hover:opacity-100'
                  }`}
                >
                  <img
                    src={p.previewUrl}
                    alt={`Page ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/80 text-[9px] font-bold font-mono-nums">
                    {idx + 1}
                  </span>
                </button>
              ))}

              {pages.length > 1 && (
                <div className="flex items-center gap-1 ml-auto shrink-0 pl-2">
                  <button
                    type="button"
                    disabled={activeIndex === 0}
                    onClick={() => handleMovePage(-1)}
                    className="p-2 rounded-full bg-white/10 hover:bg-white/15 disabled:opacity-30"
                    aria-label="Move page left"
                    title="Move page left"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={activeIndex === pages.length - 1}
                    onClick={() => handleMovePage(1)}
                    className="p-2 rounded-full bg-white/10 hover:bg-white/15 disabled:opacity-30"
                    aria-label="Move page right"
                    title="Move page right"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === 'camera' ? (
            /* Authentic Google Drive Camera Bottom Dock: Gallery (Left) | Shutter+Progress Ring (Center) | Stack Thumbnail (Right) */
            <div className="flex items-center justify-between gap-3 max-w-md mx-auto py-0.5">
              {/* Left: Gallery Picker + Phone Camera shortcut */}
              <div className="flex items-center gap-2 min-w-[96px]">
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-11 h-11 rounded-full bg-white/12 hover:bg-white/20 border border-white/15 flex items-center justify-center transition-colors"
                  aria-label="Import from gallery"
                  title="Import from gallery"
                >
                  <ImagePlus className="w-5 h-5" />
                </button>
              </div>

              {/* Center: Google Drive Shutter Button with Live Auto-Capture Progress Arc */}
              <div className="relative flex items-center justify-center w-[76px] h-[76px]">
                <svg
                  className="pointer-events-none absolute inset-0 w-full h-full -rotate-90"
                  viewBox="0 0 76 76"
                >
                  <circle
                    cx="38"
                    cy="38"
                    r="33"
                    fill="none"
                    stroke="rgba(255,255,255,0.28)"
                    strokeWidth="3.5"
                  />
                  <circle
                    ref={autoRingCircleRef}
                    cx="38"
                    cy="38"
                    r="33"
                    fill="none"
                    stroke="#4285F4"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 33}
                    strokeDashoffset={2 * Math.PI * 33}
                    style={{ opacity: 0, transition: 'stroke-dashoffset 110ms linear' }}
                  />
                </svg>
                <button
                  type="button"
                  disabled={!cameraReady || saving}
                  onClick={() => captureFromVideo(smoothedQuadRef.current)}
                  className="w-[58px] h-[58px] rounded-full bg-white hover:bg-white/95 active:scale-90 disabled:opacity-40 transition-transform shadow-xl flex items-center justify-center"
                  aria-label="Capture scan"
                >
                  <span className="w-[48px] h-[48px] rounded-full border-2 border-[#121216]/15 block" />
                </button>
              </div>

              {/* Right: Google Drive Captured Pages Stack Thumbnail */}
              <div className="flex items-center justify-end min-w-[96px]">
                {lastCapturedPage ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setReviewSubMode('preview');
                      setMode('review');
                    }}
                    aria-label={`Review ${pages.length} captured ${scanKind === 'photo' ? 'photos' : 'pages'}`}
                    className={`relative flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-[#1A73E8] hover:bg-[#1765CC] shadow-lg transition-transform ${
                      stackPulse ? 'scale-110' : 'scale-100'
                    }`}
                  >
                    <div className="relative w-8 h-9 shrink-0">
                      {pages.length > 1 && (
                        <span className="absolute inset-0 rounded bg-white/40 -rotate-6 -translate-x-0.5" />
                      )}
                      <img
                        src={lastCapturedPage.previewUrl}
                        alt="Last captured"
                        className="relative w-full h-full object-cover rounded border border-white/80"
                      />
                    </div>
                    <span className="text-xs font-bold font-mono-nums">{pages.length}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="w-11 h-11 rounded-full border border-dashed border-white/15 flex items-center justify-center text-[10px] text-white/35 font-mono-nums">
                    0
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 max-w-lg mx-auto">
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center gap-1.5"
              >
                <ImagePlus className="w-4 h-4" />
                Add Gallery
              </button>

              <button
                type="button"
                disabled={pages.length === 0 || saving}
                onClick={handleSaveOutput}
                className="flex-1 py-2.5 px-5 rounded-full bg-[#1A73E8] hover:bg-[#1765CC] disabled:opacity-50 text-sm font-bold flex items-center justify-center gap-2 shadow-lg"
              >
                <Check className="w-4 h-4" />
                {saveCtaLabel}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hidden Gallery & Native Camera Inputs */}
      <input
        ref={galleryInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleImportPhotos}
        className="hidden"
      />
    </div>
  );
};

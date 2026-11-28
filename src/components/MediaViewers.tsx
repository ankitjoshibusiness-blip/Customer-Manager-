import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from 'lucide-react';

interface PhotoViewerModalProps {
  urls: string[];
  currentIndex: number;
  onChangeIndex: (idx: number) => void;
  onClose: () => void;
}

export const PhotoViewerModal: React.FC<PhotoViewerModalProps> = ({
  urls,
  currentIndex,
  onChangeIndex,
  onClose,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) onChangeIndex(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < urls.length - 1) onChangeIndex(currentIndex + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentIndex, urls.length, onChangeIndex, onClose]);

  const currentUrl = urls[currentIndex];
  if (!currentUrl) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[#F7F8FB] rounded-[24px] w-full max-w-4xl h-[86vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 bg-white border-b border-[#E3D9F4] flex items-center justify-between">
          <p className="font-bold text-sm text-[#211936]">
            Photo Viewer{' '}
            {urls.length > 1 && (
              <span className="text-xs font-mono-nums text-[#77718A] ml-2">
                {currentIndex + 1} / {urls.length}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#211936] hover:bg-[#F0EAFB]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative flex-1 flex items-center justify-center p-4 overflow-hidden">
          <img
            src={currentUrl}
            alt="Customer photo"
            className="max-w-full max-h-full object-contain rounded-xl"
          />

          {urls.length > 1 && (
            <>
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => onChangeIndex(currentIndex - 1)}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/45 text-white flex items-center justify-center disabled:opacity-25 hover:bg-black/65"
                aria-label="Previous photo"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                disabled={currentIndex === urls.length - 1}
                onClick={() => onChangeIndex(currentIndex + 1)}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/45 text-white flex items-center justify-center disabled:opacity-25 hover:bg-black/65"
                aria-label="Next photo"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface VideoViewerModalProps {
  url: string;
  onClose: () => void;
}

export const VideoViewerModal: React.FC<VideoViewerModalProps> = ({ url, onClose }) => (
  <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
    <div className="bg-[#111116] rounded-[24px] w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden text-white">
      <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
        <p className="font-bold text-sm">Video Player</p>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-white hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center p-4 bg-black">
        <video src={url} controls autoPlay className="max-w-full max-h-[72vh] rounded-xl" />
      </div>
    </div>
  </div>
);

interface DocumentViewerModalProps {
  url: string;
  mimeType: string;
  name: string;
  onClose: () => void;
}

export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  url,
  mimeType,
  name,
  onClose,
}) => {
  const isImage =
    mimeType.startsWith('image/') || /\\.(png|jpe?g|webp|gif)$/i.test(name);
  const isPdf = mimeType.toLowerCase().includes('pdf') || /\\.pdf$/i.test(name);
  const [pdfDocument, setPdfDocument] = React.useState<any>(null);
  const [pageNumber, setPageNumber] = React.useState(1);
  const [scale, setScale] = React.useState(1.15);
  const [rotation, setRotation] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [rendering, setRendering] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const pageHostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isPdf) return;
    let active = true;
    let loadedDocument: any = null;
    setLoading(true);
    setError('');
    setPdfDocument(null);
    setPageNumber(1);

    import('pdfjs-dist').then(async (pdfjs: any) => {
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const task = pdfjs.getDocument({ url });
      loadedDocument = await task.promise;
      if (!active) {
        await loadedDocument.destroy();
        return;
      }
      setPdfDocument(loadedDocument);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'Unable to open this PDF');
      setLoading(false);
    });

    return () => {
      active = false;
      if (loadedDocument) void loadedDocument.destroy();
    };
  }, [url, isPdf]);

  React.useEffect(() => {
    if (!pdfDocument || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: any = null;

    const drawPage = async () => {
      setRendering(true);
      setError('');
      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas rendering is not supported on this device');
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
        });
        await renderTask.promise;
      } catch (reason: any) {
        if (!cancelled && reason?.name !== 'RenderingCancelledException') {
          setError(reason instanceof Error ? reason.message : 'Unable to render this PDF page');
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    void drawPage();
    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [pdfDocument, pageNumber, scale, rotation]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setPageNumber((page) => Math.max(1, page - 1));
      if (event.key === 'ArrowRight' && pdfDocument) {
        setPageNumber((page) => Math.min(pdfDocument.numPages, page + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pdfDocument]);

  const downloadFile = () => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    anchor.click();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#202124] flex items-center justify-center">
      <div className="w-full h-full flex flex-col overflow-hidden bg-[#F1F3F4]">
        <header className="h-14 shrink-0 bg-[#202124] text-white flex items-center gap-3 px-3 sm:px-5 shadow-md">
          <button type="button" onClick={onClose} aria-label="Close viewer" className="p-2 rounded-full hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{name}</p>
            <p className="text-[10px] text-white/60">{isPdf ? 'PDF document' : 'Document preview'}</p>
          </div>
          <button type="button" onClick={downloadFile} title="Download" className="p-2 rounded-full hover:bg-white/10">
            <Download className="w-5 h-5" />
          </button>
        </header>

        {isPdf && (
          <div className="min-h-12 shrink-0 bg-[#303134] text-white flex items-center justify-center gap-2 sm:gap-4 px-2 py-2">
            <button type="button" disabled={!pdfDocument || pageNumber <= 1} onClick={() => setPageNumber((p) => Math.max(1, p - 1))} aria-label="Previous page" className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1 text-xs">
              <input aria-label="Page number" type="number" min={1} max={pdfDocument?.numPages || 1} value={pageNumber} onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && pdfDocument) setPageNumber(Math.min(pdfDocument.numPages, Math.max(1, value)));
              }} className="w-12 rounded bg-[#202124] border border-white/20 px-1.5 py-1 text-center text-white" />
              <span className="text-white/70">/ {pdfDocument?.numPages || '—'}</span>
            </div>
            <button type="button" disabled={!pdfDocument || pageNumber >= pdfDocument.numPages} onClick={() => setPageNumber((p) => Math.min(pdfDocument.numPages, p + 1))} aria-label="Next page" className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30">
              <ChevronRight className="w-5 h-5" />
            </button>
            <span className="h-6 w-px bg-white/20 mx-1" />
            <button type="button" disabled={!pdfDocument} onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))} title="Zoom out" className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30">
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs tabular-nums w-11 text-center">{Math.round(scale * 100)}%</span>
            <button type="button" disabled={!pdfDocument} onClick={() => setScale((s) => Math.min(3, Number((s + 0.15).toFixed(2))))} title="Zoom in" className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30">
              <ZoomIn className="w-4 h-4" />
            </button>
            <button type="button" disabled={!pdfDocument} onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate page" className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30">
              <RotateCw className="w-4 h-4" />
            </button>
          </div>
        )}

        <main ref={pageHostRef} className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-3 sm:p-6">
          {isImage ? (
            <img src={url} alt={name} className="max-w-full max-h-full object-contain bg-white shadow-lg" />
          ) : isPdf ? (
            <div className="w-full flex flex-col items-center gap-3">
              {(loading || rendering) && (
                <div className="text-xs text-[#5F6368] bg-white rounded-full px-4 py-2 shadow-sm">
                  {loading ? 'Opening PDF…' : 'Rendering page…'}
                </div>
              )}
              {error ? (
                <div className="max-w-md mt-10 bg-white rounded-2xl p-5 text-center shadow-sm">
                  <p className="text-sm font-semibold text-[#B3261E]">Could not open PDF</p>
                  <p className="text-xs text-[#5F6368] mt-2 break-words">{error}</p>
                  <button type="button" onClick={downloadFile} className="mt-4 px-4 py-2 rounded-lg bg-[#1A73E8] text-white text-xs font-semibold">Download PDF</button>
                </div>
              ) : (
                <canvas ref={canvasRef} className="bg-white shadow-md max-w-none" />
              )}
            </div>
          ) : (
            <iframe src={url} title={name} className="w-full h-full rounded-lg bg-white border border-[#DADCE0]" />
          )}
        </main>
      </div>
    </div>
  );
};

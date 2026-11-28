import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Download, RotateCw, X, ZoomIn, ZoomOut,
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward,
} from 'lucide-react';

interface PhotoViewerModalProps {
  urls: string[];
  currentIndex: number;
  onChangeIndex: (idx: number) => void;
  onClose: () => void;
}

export const PhotoViewerModal: React.FC<PhotoViewerModalProps> = ({
  urls, currentIndex, onChangeIndex, onClose,
}) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const touchStart = useRef<{x:number;y:number}|null>(null);
  const currentUrl = urls[currentIndex];

  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [currentIndex, currentUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) onChangeIndex(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < urls.length - 1) onChangeIndex(currentIndex + 1);
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(5, z + 0.25));
      if (e.key === '-') setZoom((z) => Math.max(0.5, z - 0.25));
      if (e.key.toLowerCase() === 'r') setRotation((r) => (r + 90) % 360);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentIndex, urls.length, onChangeIndex, onClose]);

  if (!currentUrl) return null;
  const downloadPhoto = () => {
    const a = document.createElement('a');
    a.href = currentUrl;
    a.download = `Photo-${currentIndex + 1}.jpg`;
    a.rel = 'noopener';
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#09090B] text-white flex flex-col" onMouseMove={() => setShowControls(true)}>
      <header className={`shrink-0 flex items-center gap-3 px-4 py-3 bg-gradient-to-b from-black/80 to-transparent transition-opacity ${showControls ? 'opacity-100' : 'opacity-60'}`}>
        <button type="button" onClick={onClose} aria-label="Close photo viewer" className="p-2 rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Photos</p>
          <p className="text-[11px] text-white/60">{currentIndex + 1} of {urls.length}</p>
        </div>
        <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate" className="p-2 rounded-full hover:bg-white/10"><RotateCw className="w-5 h-5" /></button>
        <button type="button" onClick={downloadPhoto} title="Download photo" className="p-2 rounded-full hover:bg-white/10"><Download className="w-5 h-5" /></button>
      </header>

      <main
        className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden px-3"
        onDoubleClick={() => setZoom((z) => z > 1 ? 1 : 2)}
        onWheel={(e) => setZoom((z) => Math.max(0.5, Math.min(5, z + (e.deltaY < 0 ? 0.15 : -0.15))))}
        onTouchStart={(e) => { const t=e.touches[0]; touchStart.current={x:t.clientX,y:t.clientY}; }}
        onTouchEnd={(e) => {
          if (!touchStart.current || zoom > 1) return;
          const dx=e.changedTouches[0].clientX-touchStart.current.x;
          const dy=e.changedTouches[0].clientY-touchStart.current.y;
          if (Math.abs(dx)>65 && Math.abs(dx)>Math.abs(dy)) {
            if (dx<0 && currentIndex<urls.length-1) onChangeIndex(currentIndex+1);
            if (dx>0 && currentIndex>0) onChangeIndex(currentIndex-1);
          }
          touchStart.current=null;
        }}
      >
        {urls.length > 1 && <button type="button" disabled={currentIndex===0} onClick={() => onChangeIndex(currentIndex-1)} aria-label="Previous photo" className="absolute left-3 z-10 p-3 rounded-full bg-black/45 hover:bg-black/70 disabled:opacity-20"><ChevronLeft className="w-6 h-6" /></button>}
        <img
          src={currentUrl}
          alt="Customer photo"
          draggable={false}
          className="max-w-full max-h-full object-contain select-none transition-transform duration-200"
          style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
        />
        {urls.length > 1 && <button type="button" disabled={currentIndex===urls.length-1} onClick={() => onChangeIndex(currentIndex+1)} aria-label="Next photo" className="absolute right-3 z-10 p-3 rounded-full bg-black/45 hover:bg-black/70 disabled:opacity-20"><ChevronRight className="w-6 h-6" /></button>}
      </main>

      <footer className="shrink-0 flex items-center justify-center gap-3 px-4 py-4 bg-gradient-to-t from-black/80 to-transparent">
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z-0.25))} title="Zoom out" className="p-2.5 rounded-full bg-white/10 hover:bg-white/20"><ZoomOut className="w-5 h-5" /></button>
        <span className="text-xs tabular-nums text-white/75 min-w-12 text-center">{Math.round(zoom*100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(5, z+0.25))} title="Zoom in" className="p-2.5 rounded-full bg-white/10 hover:bg-white/20"><ZoomIn className="w-5 h-5" /></button>
        <button type="button" onClick={() => {setZoom(1);setRotation(0);}} title="Reset view" className="px-3 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-xs">Reset</button>
      </footer>
    </div>
  );
};

interface VideoViewerModalProps {
  url: string;
  onClose: () => void;
}

export const VideoViewerModal: React.FC<VideoViewerModalProps> = ({ url, onClose }) => {
  const videoRef = useRef<HTMLVideoElement|null>(null);
  const [playing,setPlaying] = useState(false);
  const [muted,setMuted] = useState(false);
  const [speed,setSpeed] = useState(1);
  const [isFullscreen,setIsFullscreen] = useState(false);
  const [playbackError,setPlaybackError] = useState('');

  useEffect(() => {
    const video=videoRef.current;
    const onKey=(e:KeyboardEvent) => {
      if(e.key==='Escape') onClose();
      if(!video) return;
      if(e.key===' '){e.preventDefault(); if(video.paused) void video.play(); else video.pause();}
      if(e.key==='ArrowRight') video.currentTime=Math.min(video.duration||0,video.currentTime+10);
      if(e.key==='ArrowLeft') video.currentTime=Math.max(0,video.currentTime-10);
    };
    const onFullscreen=()=>setIsFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('keydown',onKey);
    document.addEventListener('fullscreenchange',onFullscreen);
    return ()=>{window.removeEventListener('keydown',onKey);document.removeEventListener('fullscreenchange',onFullscreen);};
  },[onClose]);

  const togglePlay=()=>{const v=videoRef.current;if(!v)return;if(v.paused){setPlaybackError('');void v.play().catch((error: unknown)=>setPlaybackError(error instanceof Error ? error.message : 'Video playback failed. Tap play again or check the video format.'));}else v.pause();};
  const toggleFullscreen=async()=>{const v=videoRef.current;if(!v)return;try{if(!document.fullscreenElement)await v.parentElement?.requestFullscreen();else await document.exitFullscreen();}catch{/* Fullscreen may be unavailable in some WebViews. */}};

  return (
    <div className="fixed inset-0 z-50 bg-[#09090B] text-white flex flex-col">
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 bg-gradient-to-b from-black/80 to-transparent">
        <button type="button" onClick={onClose} aria-label="Close video player" className="p-2 rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
        <div className="flex-1 min-w-0"><p className="text-sm font-semibold">Videos</p><p className="text-[11px] text-white/60">Video player</p></div>
        <select aria-label="Playback speed" value={speed} onChange={(e)=>{const n=Number(e.target.value);setSpeed(n);if(videoRef.current)videoRef.current.playbackRate=n;}} className="bg-white/10 border border-white/15 rounded-lg px-2 py-1.5 text-xs text-white">
          {[0.5,0.75,1,1.25,1.5,2].map((n)=><option key={n} value={n} className="bg-[#202124]">{n}x</option>)}
        </select>
      </header>
      <main className="flex-1 min-h-0 flex items-center justify-center bg-black p-2">
        <div className="relative w-full h-full flex items-center justify-center">
          <video
            ref={videoRef}
            src={url}
            controls
            playsInline
            preload="metadata"
            muted={false}
            onLoadedMetadata={(e)=>{e.currentTarget.muted=false;e.currentTarget.volume=1;setMuted(false);setPlaybackError('');}}
            onCanPlay={()=>setPlaybackError('')}
            onError={(e)=>{const code=e.currentTarget.error?.code;setPlaybackError(code===4?'This video format or audio codec is not supported by this Android device.':'Unable to play this video. Check the file and try again.');setPlaying(false);}}
            onPlay={()=>{setPlaying(true);setPlaybackError('');}}
            onPause={()=>setPlaying(false)}
            onVolumeChange={(e)=>setMuted(e.currentTarget.muted || e.currentTarget.volume===0)}
            className="max-w-full max-h-full w-full h-full object-contain"
          />
          {playbackError && <div className="absolute bottom-4 left-3 right-3 mx-auto max-w-lg rounded-xl bg-black/85 border border-white/15 p-3 text-center text-xs text-red-200">{playbackError}</div>}
          {!playing && !playbackError && <button type="button" onClick={togglePlay} aria-label="Play video" className="absolute p-4 rounded-full bg-black/55 hover:bg-black/75"><Play className="w-8 h-8 fill-current" /></button>}
        </div>
      </main>
      <footer className="shrink-0 flex items-center justify-center gap-3 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent">
        <button type="button" onClick={()=>{const v=videoRef.current;if(v)v.currentTime=Math.max(0,v.currentTime-10);}} title="Back 10 seconds" className="p-2.5 rounded-full bg-white/10 hover:bg-white/20"><SkipBack className="w-5 h-5" /></button>
        <button type="button" onClick={togglePlay} title={playing?'Pause':'Play'} className="p-3 rounded-full bg-white text-black hover:bg-white/85">{playing?<Pause className="w-5 h-5 fill-current"/>:<Play className="w-5 h-5 fill-current"/>}</button>
        <button type="button" onClick={()=>{const v=videoRef.current;if(v)v.currentTime=Math.min(v.duration||0,v.currentTime+10);}} title="Forward 10 seconds" className="p-2.5 rounded-full bg-white/10 hover:bg-white/20"><SkipForward className="w-5 h-5" /></button>
        <button type="button" onClick={()=>{const v=videoRef.current;if(v){v.muted=!v.muted;setMuted(v.muted);}}} title={muted?'Unmute':'Mute'} className="p-2.5 rounded-full bg-white/10 hover:bg-white/20">{muted?<VolumeX className="w-5 h-5"/>:<Volume2 className="w-5 h-5"/>}</button>
        <button type="button" onClick={toggleFullscreen} title="Fullscreen" className="p-2.5 rounded-full bg-white/10 hover:bg-white/20">{isFullscreen?<Minimize className="w-5 h-5"/>:<Maximize className="w-5 h-5"/>}</button>
      </footer>
    </div>
  );
};

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
    mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name);
  const isPdf = mimeType.toLowerCase().includes('pdf') || /\.pdf$/i.test(name);
  const [pdfDocument, setPdfDocument] = React.useState<any>(null);
  const [pageNumber, setPageNumber] = React.useState(1);
  const [scale, setScale] = React.useState(1.15);
  const [rotation, setRotation] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [rendering, setRendering] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

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

        <main className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-3 sm:p-6">
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

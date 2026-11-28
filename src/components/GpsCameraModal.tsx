import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, MapPin, RefreshCw, Square, Video } from 'lucide-react';

interface GpsCameraModalProps {
  customerName: string;
  initialVideoMode: boolean;
  onClose: () => void;
  onPhotoCaptured: (blob: Blob, fileName: string) => Promise<void>;
  onVideoCaptured: (blob: Blob, fileName: string) => Promise<void>;
}

function getEsriTileUrl(lat: number, lon: number, zoom = 15): string {
  const n = 1 << zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
}

function formatGpsDate(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = days[date.getDay()];
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  let hours = date.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMin);
  const oh = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const om = String(absOffset % 60).padStart(2, '0');
  return `${dayName}, ${dd}/${mm}/${yyyy} ${hh}:${min} ${ampm} GMT ${sign}${oh}:${om}`;
}

export const GpsCameraModal: React.FC<GpsCameraModalProps> = ({
  customerName,
  initialVideoMode,
  onClose,
  onPhotoCaptured,
  onVideoCaptured,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mapImgRef = useRef<HTMLImageElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const rafRef = useRef<number | null>(null);

  const [videoMode, setVideoMode] = useState(initialVideoMode);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);

  const [cityTitle, setCityTitle] = useState('Locating...');
  const [address, setAddress] = useState('Waiting for GPS location...');
  const [coordinates, setCoordinates] = useState('Latitude / Longitude loading...');
  const [mapTileUrl, setMapTileUrl] = useState<string | null>(null);
  const [stampTime, setStampTime] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setStampTime(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Acquire GPS & reverse geocode
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setCityTitle('Location unavailable');
      setAddress('Geolocation is not supported in this browser');
      setCoordinates('Latitude / Longitude unavailable');
      return;
    }

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled) return;
        const { latitude, longitude } = pos.coords;
        setCoordinates(`Lat ${latitude.toFixed(6)}°  Long ${longitude.toFixed(6)}°`);
        const tileUrl = getEsriTileUrl(latitude, longitude);
        setMapTileUrl(tileUrl);

        // Preload tile image with crossOrigin anonymous for canvas stamping
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          mapImgRef.current = img;
        };
        img.onerror = () => {
          mapImgRef.current = null;
        };
        img.src = tileUrl;

        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
          );
          if (res.ok && !cancelled) {
            const data = await res.json();
            const addr = data.address || {};
            const city = [
              addr.city || addr.town || addr.village || addr.suburb,
              addr.state,
              addr.country,
            ]
              .filter(Boolean)
              .join(', ');
            setCityTitle(city || 'GPS Location');
            setAddress(data.display_name || city || 'Address acquired');
          }
        } catch {
          if (!cancelled) {
            setCityTitle('GPS Location');
            setAddress('Address unavailable - GPS acquired');
          }
        }
      },
      () => {
        if (cancelled) return;
        setCityTitle('Location unavailable');
        setAddress('Turn on location permission in your browser');
        setCoordinates('Latitude / Longitude unavailable');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  // Start / restart camera stream
  const startCamera = async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: videoMode ? 1280 : 1600 },
          height: { ideal: videoMode ? 720 : 1200 },
        },
        audio: videoMode,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setCameraError(
        err instanceof Error ? err.message : 'Unable to access camera. Check browser permissions.'
      );
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode, videoMode]);

  const drawStampOnCanvas = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const stampHeight = Math.min(height * 0.24, Math.max(96, height * 0.19));
    const margin = width * 0.015;
    const gap = width * 0.016;
    const mapSize = Math.min(stampHeight * 0.9, width * 0.24);
    const mapTop = height - stampHeight - margin;
    const mapLeft = margin;

    // Map box
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(mapLeft, mapTop, mapSize, mapSize, stampHeight * 0.06);
    ctx.clip();
    if (mapImgRef.current) {
      ctx.drawImage(mapImgRef.current, mapLeft, mapTop, mapSize, mapSize);
    } else {
      ctx.fillStyle = '#30343B';
      ctx.fillRect(mapLeft, mapTop, mapSize, mapSize);
    }
    ctx.restore();

    // Pin on map
    const pinX = mapLeft + mapSize / 2;
    const pinY = mapTop + mapSize / 2;
    const pinR = stampHeight * 0.075;
    ctx.fillStyle = '#EF3741';
    ctx.beginPath();
    ctx.arc(pinX, pinY - pinR * 0.35, pinR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pinX - pinR * 0.72, pinY + pinR * 0.15);
    ctx.lineTo(pinX, pinY + pinR * 1.65);
    ctx.lineTo(pinX + pinR * 0.72, pinY + pinR * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(pinX, pinY - pinR * 0.35, pinR * 0.34, 0, Math.PI * 2);
    ctx.fill();

    // Esri tag
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(mapLeft + 4, mapTop + mapSize - 16, 28, 12);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.max(8, Math.round(stampHeight * 0.07))}px sans-serif`;
    ctx.fillText('Esri', mapLeft + 7, mapTop + mapSize - 7);

    // Text panel
    const panelLeft = mapLeft + mapSize + gap;
    const panelWidth = width - panelLeft - margin;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.80)';
    ctx.beginPath();
    ctx.roundRect(panelLeft, mapTop, panelWidth, mapSize, stampHeight * 0.06);
    ctx.fill();

    // Badge
    const badgeW = Math.min(panelWidth * 0.42, stampHeight * 1.15);
    const badgeH = stampHeight * 0.18;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    ctx.roundRect(panelLeft + panelWidth - badgeW, mapTop - badgeH - 4, badgeW, badgeH, 6);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 ${Math.max(8, Math.round(stampHeight * 0.08))}px sans-serif`;
    ctx.fillText('GPS Map Camera', panelLeft + panelWidth - badgeW + 8, mapTop - 8);

    // Panel text
    const tx = panelLeft + stampHeight * 0.09;
    const maxTextW = panelWidth - stampHeight * 0.16;
    let ty = mapTop + stampHeight * 0.19;

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.max(12, Math.round(stampHeight * 0.14))}px sans-serif`;
    ctx.fillText(`${cityTitle}`, tx, ty, maxTextW);

    ty += stampHeight * 0.16;
    ctx.font = `${Math.max(10, Math.round(stampHeight * 0.1))}px sans-serif`;
    ctx.fillText(address, tx, ty, maxTextW);

    ty += stampHeight * 0.15;
    ctx.font = `${Math.max(9, Math.round(stampHeight * 0.09))}px monospace`;
    ctx.fillText(coordinates, tx, ty, maxTextW);

    ty += stampHeight * 0.14;
    ctx.fillText(formatGpsDate(new Date()), tx, ty, maxTextW);

    ty += stampHeight * 0.14;
    ctx.fillText('Note : Captured by GPS Map Camera', tx, ty, maxTextW);
  };

  const handleCapturePhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || capturing) return;
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawStampOnCanvas(ctx, canvas.width, canvas.height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Photo encoding failed'))),
          'image/jpeg',
          0.92
        );
      });
      await onPhotoCaptured(blob, `GPS_${Date.now()}.jpg`);
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Photo capture failed');
    } finally {
      setCapturing(false);
    }
  };

  const handleToggleVideo = () => {
    if (recording && recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || !video.videoWidth) {
      setCameraError('Camera is not ready yet');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderLoop = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawStampOnCanvas(ctx, canvas.width, canvas.height);
      rafRef.current = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    const canvasStream = canvas.captureStream(30);
    stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));

    const mimeType = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm',
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setRecording(false);
      const blob = new Blob(chunks, { type: mimeType });
      const safeName = customerName.replace(/[^A-Za-z0-9_-]/g, '_');
      await onVideoCaptured(blob, `CustomerManager_${safeName}_${Date.now()}.webm`);
    };

    recorder.start(250);
    setRecording(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between text-white">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/70">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (!recording) onClose();
              else setCameraError('Stop recording before closing');
            }}
            className="p-2 rounded-xl hover:bg-white/10"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-xs font-bold tracking-wider">GPS CAMERA</p>
            <p className="text-xs text-white/75">{customerName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={recording}
            onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
            className="p-2 rounded-xl hover:bg-white/10 disabled:opacity-40"
            title="Switch camera"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <span
            className={`text-xs font-bold font-mono-nums ${
              recording ? 'text-red-400' : 'text-[#8BE28B]'
            }`}
          >
            {recording ? '● REC' : 'LIVE'}
          </span>
        </div>
      </div>

      {/* Camera Viewport + Live Stamp Overlay */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="max-h-full max-w-full object-contain"
        />

        {/* Live GPS Stamp Preview */}
        <div className="absolute bottom-3 left-3 right-3 max-w-2xl mx-auto flex items-end gap-2.5 pointer-events-none">
          <div className="w-24 h-24 rounded-xl bg-[#30343B] overflow-hidden relative shrink-0 border border-white/15">
            {mapTileUrl && (
              <img
                src={mapTileUrl}
                alt="GPS satellite map"
                className="w-full h-full object-cover"
              />
            )}
            <MapPin className="w-7 h-7 text-[#FF3030] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 drop-shadow" />
            <span className="absolute bottom-1 left-1 bg-black/60 text-[9px] font-bold px-1.5 py-0.5 rounded">
              Esri
            </span>
          </div>

          <div className="flex-1 min-w-0 relative">
            <div className="inline-flex items-center gap-1 bg-black/80 px-2 py-0.5 rounded-t-md text-[10px] font-medium float-right mb-0.5">
              <Camera className="w-3 h-3 text-[#80C8FF]" />
              <span>GPS Map Camera</span>
            </div>
            <div className="clear-both bg-black/80 rounded-xl px-3 py-2 space-y-0.5 border border-white/10">
              <p className="text-sm font-semibold truncate">{cityTitle}</p>
              <p className="text-[11px] text-white/90 line-clamp-2 leading-tight">{address}</p>
              <p className="text-[10px] font-mono-nums text-white/80 truncate">{coordinates}</p>
              <p className="text-[10px] font-mono-nums text-white/75 truncate">
                {formatGpsDate(stampTime)}
              </p>
              <p className="text-[10px] text-white/70 truncate">
                Note : Captured by GPS Map Camera
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-[#0B0B0E] px-4 py-4 flex flex-col items-center gap-2">
        {cameraError && <p className="text-xs text-red-400 text-center">{cameraError}</p>}
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={recording}
            onClick={() => setVideoMode((v) => !v)}
            className="px-4 py-2 rounded-full bg-[#263238] text-xs font-bold tracking-wide disabled:opacity-40"
          >
            {videoMode ? 'VIDEO MODE' : 'PHOTO MODE'}
          </button>

          <button
            type="button"
            disabled={capturing}
            onClick={videoMode ? handleToggleVideo : handleCapturePhoto}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-transform active:scale-95 ${
              recording ? 'bg-[#E53935] text-white' : 'bg-[#FFC400] text-black'
            }`}
            aria-label={videoMode ? (recording ? 'Stop recording' : 'Start recording') : 'Capture photo'}
          >
            {videoMode ? (
              recording ? (
                <Square className="w-7 h-7 fill-current" />
              ) : (
                <Video className="w-7 h-7" />
              )
            ) : (
              <Camera className="w-7 h-7" />
            )}
          </button>
        </div>
        <p className="text-[11px] text-white/70">
          {recording
            ? 'Tap red STOP button to finish and save GPS video'
            : videoMode
              ? 'GPS video recording with live map overlay'
              : capturing
                ? 'Saving GPS-stamped photo…'
                : 'GPS photo capture · Stamp burned into image'}
        </p>
      </div>
    </div>
  );
};

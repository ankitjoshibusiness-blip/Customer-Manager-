import React, { useEffect, useRef, useState } from 'react';
import { Camera, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';

interface ProfilePhotoCropModalProps {
  onClose: () => void;
  onSaveCropped: (blob: Blob) => Promise<void>;
}

export const ProfilePhotoCropModal: React.FC<ProfilePhotoCropModalProps> = ({
  onClose,
  onSaveCropped,
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    return () => {
      if (imageSrc) URL.revokeObjectURL(imageSrc);
    };
  }, [imageSrc]);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  const openCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera is not available on this device. Check camera permission.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Camera permission denied.');
    }
  };

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [cameraOpen]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const captureCameraPhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (imageSrc) URL.revokeObjectURL(imageSrc);
      setImageSrc(URL.createObjectURL(blob));
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      stopCamera();
    }, 'image/jpeg', 0.94);
  };

  useEffect(() => {
    if (!cameraOpen) return;
    const handleAndroidBack = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      stopCamera();
    };
    window.addEventListener('androidback', handleAndroidBack, true);
    return () => window.removeEventListener('androidback', handleAndroidBack, true);
  }, [cameraOpen]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (imageSrc) URL.revokeObjectURL(imageSrc);
    setImageSrc(URL.createObjectURL(file));
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleSave = async () => {
    const img = imgRef.current;
    if (!img || !imageSrc) return;
    setSaving(true);
    try {
      const boxSize = 260;
      const outSize = 1200;
      const canvas = document.createElement('canvas');
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outSize, outSize);

      const baseScale = Math.max(boxSize / img.naturalWidth, boxSize / img.naturalHeight);
      const scale = baseScale * zoom * (outSize / boxSize);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      const cx = outSize / 2 + offset.x * (outSize / boxSize);
      const cy = outSize / 2 + offset.y * (outSize / boxSize);

      ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to export cropped photo'))),
          'image/jpeg',
          0.92
        );
      });
      await onSaveCropped(blob);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[24px] border border-[#E3D9F4] w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#211936]">Customer Photo</h3>
            <p className="text-xs text-[#77718A]">
              Choose from gallery or camera, then crop 1:1 before saving.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#77718A] hover:bg-[#F5F1FC]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            className="py-2.5 px-3 rounded-xl bg-[#F3ECFC] border border-[#E3D9F4] text-[#7042C1] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#EAE0FA]"
          >
            <Upload className="w-4 h-4" />
            Gallery / File
          </button>
          <button
            type="button"
            onClick={openCamera}
            className="py-2.5 px-3 rounded-xl bg-[#F3ECFC] border border-[#E3D9F4] text-[#7042C1] text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#EAE0FA]"
          >
            <Camera className="w-4 h-4" />
            Camera
          </button>
        </div>

        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
        />

        {cameraError && <p className="text-xs text-red-600">{cameraError}</p>}

        {cameraOpen && (
          <div className="space-y-3">
            <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-[48vh] rounded-2xl bg-black object-cover" />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={stopCamera} className="py-2.5 rounded-xl border border-[#D4D8E1] text-sm font-semibold text-[#625A78]">Cancel</button>
              <button type="button" onClick={captureCameraPhoto} className="py-2.5 rounded-xl bg-[#7042C1] text-white text-sm font-bold flex items-center justify-center gap-2"><Camera className="w-4 h-4" /> Capture Photo</button>
            </div>
          </div>
        )}

        {imageSrc && (
          <div className="space-y-3 flex flex-col items-center">
            <div
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragging(true);
                dragStartRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  ox: offset.x,
                  oy: offset.y,
                };
              }}
              onPointerMove={(e) => {
                if (!dragging) return;
                setOffset({
                  x: dragStartRef.current.ox + (e.clientX - dragStartRef.current.x),
                  y: dragStartRef.current.oy + (e.clientY - dragStartRef.current.y),
                });
              }}
              onPointerUp={() => setDragging(false)}
              className="w-[260px] h-[260px] rounded-2xl overflow-hidden bg-[#161321] relative cursor-move touch-none border-2 border-[#7042C1]"
            >
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Crop preview"
                draggable={false}
                style={{
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
                }}
                className="absolute top-1/2 left-1/2 max-w-none max-h-none min-w-full min-h-full object-cover select-none"
              />
            </div>

            <div className="flex items-center gap-3 w-full max-w-[260px]">
              <ZoomOut className="w-4 h-4 text-[#77718A]" />
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="flex-1 accent-[#7042C1]"
              />
              <ZoomIn className="w-4 h-4 text-[#77718A]" />
            </div>

            <div className="flex justify-end gap-2 w-full pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#625A78]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="px-5 py-2 rounded-xl bg-[#7042C1] text-white text-xs font-semibold hover:bg-[#5E35A8] disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save cropped photo'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

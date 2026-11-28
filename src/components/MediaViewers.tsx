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
    mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[#F5F1FC] rounded-[24px] w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 bg-white border-b border-[#E3D9F4] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-sm text-[#211936] truncate">{name}</p>
            <p className="text-[11px] text-[#77718A]">Document Viewer</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={url}
              download={name}
              className="px-3 py-1.5 rounded-lg border border-[#E3D9F4] text-xs font-semibold text-[#7042C1] hover:bg-[#F0EAFB] flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-lg text-[#7042C1] hover:bg-[#F0EAFB]"
              title="Open in new tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#211936] hover:bg-[#F0EAFB]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3 flex items-center justify-center">
          {isImage ? (
            <img src={url} alt={name} className="max-w-full max-h-full object-contain rounded-xl" />
          ) : (
            <iframe
              src={url}
              title={name}
              className="w-full h-full rounded-xl bg-white border border-[#E3D9F4]"
            />
          )}
        </div>
      </div>
    </div>
  );
};

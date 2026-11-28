import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, RotateCcw, Undo2, Check } from 'lucide-react';
import {
  renderCleanStrokesOnContext,
  sampleLocalPaperColor,
  type CleanStroke,
  type CleanStrokePoint,
} from '../utils/cleanBrush';
import { computeContainedRect } from '../utils/scannerQuad';

interface CleanBrushOverlayProps {
  /** Base warped + filtered canvas (without clean strokes yet) */
  baseCanvas: HTMLCanvasElement;
  strokes: CleanStroke[];
  onChangeStrokes: (next: CleanStroke[]) => void;
  onDone: () => void;
}

const BRUSH_SIZES: Array<{ label: string; ratio: number; dotClass: string }> = [
  { label: 'S', ratio: 0.025, dotClass: 'w-2 h-2' },
  { label: 'M', ratio: 0.048, dotClass: 'w-3 h-3' },
  { label: 'L', ratio: 0.082, dotClass: 'w-4 h-4' },
];

export const CleanBrushOverlay: React.FC<CleanBrushOverlayProps> = ({
  baseCanvas,
  strokes,
  onChangeStrokes,
  onDone,
}) => {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const basePixelsRef = useRef<ImageData | null>(null);
  const strokesRef = useRef<CleanStroke[]>(strokes);
  const activeStrokeRef = useRef<CleanStroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);

  const [brushIdx, setBrushIdx] = useState(1);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  // Cache pixel data of baseCanvas for instant local paper color sampling on pointerdown
  useEffect(() => {
    const ctx = baseCanvas.getContext('2d', { willReadFrequently: true });
    if (ctx && baseCanvas.width > 0 && baseCanvas.height > 0) {
      basePixelsRef.current = ctx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
    }
  }, [baseCanvas]);

  // Fit canvas tightly to container
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const update = () => {
      const rect = outer.getBoundingClientRect();
      const pad = rect.width < 460 ? 16 : 24;
      const fitted = computeContainedRect(
        Math.max(100, rect.width - pad * 2),
        Math.max(100, rect.height - pad * 2),
        baseCanvas.width,
        baseCanvas.height
      );
      setStageSize({
        width: Math.max(80, Math.round(fitted.width)),
        height: Math.max(80, Math.round(fitted.height)),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [baseCanvas]);

  const redrawCanvas = useCallback(
    (list: CleanStroke[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== baseCanvas.width || canvas.height !== baseCanvas.height) {
        canvas.width = baseCanvas.width;
        canvas.height = baseCanvas.height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(baseCanvas, 0, 0);
      renderCleanStrokesOnContext(ctx, canvas.width, canvas.height, list);
    },
    [baseCanvas]
  );

  useEffect(() => {
    redrawCanvas(strokes);
  }, [strokes, stageSize, redrawCanvas]);

  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>): CleanStrokePoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = getNormalizedPoint(e);
    if (!pt) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events
    }
    activePointerIdRef.current = e.pointerId;

    const radiusRatio = BRUSH_SIZES[brushIdx].ratio;
    const pixels = basePixelsRef.current;
    const ringPx = Math.max(18, Math.round(radiusRatio * Math.min(baseCanvas.width, baseCanvas.height) * 1.45));
    const fillColor = pixels
      ? sampleLocalPaperColor(pixels.data, pixels.width, pixels.height, pt.x, pt.y, ringPx)
      : '#FFFFFF';

    const nextStroke: CleanStroke = {
      id: `clean_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      radiusRatio,
      fillColor,
      points: [pt],
    };
    activeStrokeRef.current = nextStroke;
    redrawCanvas([...strokesRef.current, nextStroke]);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const active = activeStrokeRef.current;
    if (!active || activePointerIdRef.current !== e.pointerId) return;
    const pt = getNormalizedPoint(e);
    if (!pt) return;
    e.preventDefault();
    const last = active.points[active.points.length - 1];
    if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.003) return;
    active.points.push(pt);
    redrawCanvas([...strokesRef.current, active]);
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const active = activeStrokeRef.current;
    if (!active || activePointerIdRef.current !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    activePointerIdRef.current = null;
    activeStrokeRef.current = null;
    const next = [...strokesRef.current, active];
    strokesRef.current = next;
    onChangeStrokes(next);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#141418]">
      <div
        ref={outerRef}
        data-testid="clean-brush-stage"
        className="relative flex-1 flex items-center justify-center overflow-hidden touch-none select-none"
      >
        {stageSize.width > 0 && stageSize.height > 0 && (
          <canvas
            ref={canvasRef}
            data-testid="clean-brush-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            style={{
              width: `${stageSize.width}px`,
              height: `${stageSize.height}px`,
            }}
            className="rounded-lg shadow-2xl bg-white cursor-crosshair touch-none"
          />
        )}
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-black/75 border border-white/15 text-[11px] font-medium text-white/90 whitespace-nowrap flex items-center gap-1.5">
          <Eraser className="w-3.5 h-3.5 text-[#8AB4F8]" />
          Brush over fingers, shadows or marks to clean
        </div>
      </div>

      {/* Google Drive Clean Brush Toolbar */}
      <div className="bg-[#1B1B1F] border-t border-white/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-white/60 mr-1">Brush</span>
          {BRUSH_SIZES.map((b, idx) => (
            <button
              key={b.label}
              type="button"
              onClick={() => setBrushIdx(idx)}
              aria-label={`Brush size ${b.label}`}
              className={`w-9 h-9 rounded-full flex items-center justify-center border transition-colors ${
                brushIdx === idx
                  ? 'bg-[#1A73E8] border-[#8AB4F8] text-white'
                  : 'bg-white/10 border-white/10 text-white/80 hover:bg-white/15'
              }`}
            >
              <span className={`${b.dotClass} rounded-full bg-white block`} />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            disabled={strokes.length === 0}
            onClick={() => onChangeStrokes(strokes.slice(0, -1))}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-35 text-xs font-semibold flex items-center gap-1.5"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Undo
          </button>
          <button
            type="button"
            disabled={strokes.length === 0}
            onClick={() => onChangeStrokes([])}
            className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-35 text-xs font-semibold flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={onDone}
            className="px-4 py-2 rounded-xl bg-[#1A73E8] hover:bg-[#1765CC] text-xs font-bold flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentQuad, NormalizedPoint } from '../services/documentScannerEngine';
import {
  cloneQuad,
  computeContainedRect,
  findNearestCropHandle,
  getEdgeMidpoint,
  moveQuadCorner,
  moveQuadEdge,
  rotateQuadForDisplay,
  unrotateQuadFromDisplay,
  type CropDragTarget,
  type QuadRotation,
} from '../utils/scannerQuad';

interface SmoothCropEditorProps {
  imageUrl: string;
  rotation: QuadRotation;
  /** Quad in unrotated source-image normalized coordinates (0..1) */
  quad: DocumentQuad;
  /** Called whenever the user finishes dragging or nudges a handle (in source-image coords) */
  onChange: (nextSourceQuad: DocumentQuad) => void;
}

const CORNER_LABELS = [
  'Top-left corner',
  'Top-right corner',
  'Bottom-right corner',
  'Bottom-left corner',
] as const;

const EDGE_LABELS = ['Top edge', 'Right edge', 'Bottom edge', 'Left edge'] as const;

interface ActiveDragState {
  pointerId: number;
  target: CropDragTarget;
  stageRect: DOMRect;
  /** Grab offset (handlePos - pointerPos) in normalized space so touch/mouse never jumps */
  offsetX: number;
  offsetY: number;
  /** For edge drag: initial pointer normalized coordinates and quad snapshot at drag start */
  startPointerX: number;
  startPointerY: number;
  startQuad: DocumentQuad;
}

export const SmoothCropEditor: React.FC<SmoothCropEditorProps> = ({
  imageUrl,
  rotation,
  quad,
  onChange,
}) => {
  const outerContainerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotatedSourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loupeWrapRef = useRef<HTMLDivElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Direct DOM refs for 60/120fps drag updates with zero React re-renders during drag
  const scrimPathRef = useRef<SVGPathElement | null>(null);
  const quadPolyRef = useRef<SVGPolygonElement | null>(null);
  const gridGroupRef = useRef<SVGGElement | null>(null);
  const gridLinesRef = useRef<Array<SVGLineElement | null>>([null, null, null, null]);
  const cornerElsRef = useRef<Array<HTMLButtonElement | null>>([null, null, null, null]);
  const edgeElsRef = useRef<Array<HTMLButtonElement | null>>([null, null, null, null]);

  // Display-space quad (matches what the user sees after `rotation` is applied)
  const displayQuadRef = useRef<DocumentQuad>(rotateQuadForDisplay(quad, rotation));
  const dragRef = useRef<ActiveDragState | null>(null);
  const rafRef = useRef<number | null>(null);
  const stageSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [imageReady, setImageReady] = useState(false);
  const [activeTarget, setActiveTarget] = useState<CropDragTarget | null>(null);

  // Sync external quad prop changes (e.g., Auto-Detect or Full Image buttons)
  useEffect(() => {
    if (dragRef.current) return;
    displayQuadRef.current = rotateQuadForDisplay(quad, rotation);
    paintOverlayImmediate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quad, rotation]);

  // Build rotated offscreen source canvas once per (imageUrl, rotation)
  useEffect(() => {
    let cancelled = false;
    setImageReady(false);

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const rawW = img.naturalWidth || img.width || 1;
      const rawH = img.naturalHeight || img.height || 1;

      // Bound rotated working canvas to crisp high-res display size for fast loupe & smooth rendering
      const maxWork = 1800;
      const scale = Math.min(1, maxWork / Math.max(rawW, rawH));
      const w = Math.max(1, Math.round(rawW * scale));
      const h = Math.max(1, Math.round(rawH * scale));

      const rotW = rotation === 90 || rotation === 270 ? h : w;
      const rotH = rotation === 90 || rotation === 270 ? w : h;

      const offscreen = document.createElement('canvas');
      offscreen.width = rotW;
      offscreen.height = rotH;
      const ctx = offscreen.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.translate(rotW / 2, rotH / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
      rotatedSourceCanvasRef.current = offscreen;
      setImageReady(true);
    };
    img.onerror = () => {
      if (!cancelled) setImageReady(false);
    };
    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl, rotation]);

  // Measure outer container and compute exact tight image stage dimensions (no letterbox drift!)
  useEffect(() => {
    const outer = outerContainerRef.current;
    const src = rotatedSourceCanvasRef.current;
    if (!outer || !src || !imageReady) return;

    const updateSize = () => {
      const rect = outer.getBoundingClientRect();
      // Reserve comfortable touch margin around image so (0,0) and (1,1) handles never clip
      const pad = rect.width < 460 ? 34 : 44;
      const availW = Math.max(120, rect.width - pad * 2);
      const availH = Math.max(120, rect.height - pad * 2);
      const fitted = computeContainedRect(availW, availH, src.width, src.height);
      const nextW = Math.max(80, Math.round(fitted.width));
      const nextH = Math.max(80, Math.round(fitted.height));
      stageSizeRef.current = { width: nextW, height: nextH };
      setStageSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH }
      );
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [imageReady]);

  // Draw crisp DPR-scaled image onto the stage canvas whenever size or image changes
  useEffect(() => {
    const canvas = imageCanvasRef.current;
    const src = rotatedSourceCanvasRef.current;
    if (!canvas || !src || !imageReady || stageSize.width <= 0 || stageSize.height <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(stageSize.width * dpr);
    canvas.height = Math.round(stageSize.height * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    }
    paintOverlayImmediate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageSize, imageReady]);

  const drawLoupe = useCallback((focusPt: NormalizedPoint, q: DocumentQuad) => {
    const loupe = loupeCanvasRef.current;
    const loupeWrap = loupeWrapRef.current;
    const src = rotatedSourceCanvasRef.current;
    if (!loupe || !loupeWrap || !src) return;

    // Smart auto-flip: keep loupe on opposite side of the dragged corner/edge so it never obscures it
    const placeOnLeft = focusPt.x > 0.5;
    loupeWrap.style.left = placeOnLeft ? '14px' : '';
    loupeWrap.style.right = placeOnLeft ? '' : '14px';

    const ctx = loupe.getContext('2d');
    if (!ctx) return;

    const lw = loupe.width;
    const lh = loupe.height;
    const iw = src.width;
    const ih = src.height;
    const sampleRadius = Math.max(36, Math.min(iw, ih) * 0.085);
    const centerSrcX = focusPt.x * iw;
    const centerSrcY = focusPt.y * ih;
    const sx = centerSrcX - sampleRadius;
    const sy = centerSrcY - sampleRadius;

    ctx.fillStyle = '#0B0B0E';
    ctx.fillRect(0, 0, lw, lh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, sampleRadius * 2, sampleRadius * 2, 0, 0, lw, lh);

    // Project quad polygon into loupe coordinate space so user aligns blue border directly on paper edge
    const scaleX = lw / (sampleRadius * 2);
    const scaleY = lh / (sampleRadius * 2);
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const lx = (q[i].x * iw - sx) * scaleX;
      const ly = (q[i].y * ih - sy) * scaleY;
      if (i === 0) ctx.moveTo(lx, ly);
      else ctx.lineTo(lx, ly);
    }
    ctx.closePath();
    ctx.strokeStyle = '#8AB4F8';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Precision crosshair
    const cx = lw / 2;
    const cy = lh / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy);
    ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy);
    ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 18);
    ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5);
    ctx.lineTo(cx, cy + 18);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#1A73E8';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }, []);

  /**
   * Imperatively updates SVG scrim, polygon, rule-of-thirds grid, handle transforms,
   * and magnifying loupe in a single GPU-friendly frame (zero React re-renders!).
   */
  const paintOverlayImmediate = useCallback(() => {
    const q = displayQuadRef.current;
    const { width: w, height: h } = stageSizeRef.current;
    if (w <= 0 || h <= 0) return;

    const p0x = q[0].x * w;
    const p0y = q[0].y * h;
    const p1x = q[1].x * w;
    const p1y = q[1].y * h;
    const p2x = q[2].x * w;
    const p2y = q[2].y * h;
    const p3x = q[3].x * w;
    const p3y = q[3].y * h;

    // 1. Dark translucent outside scrim via even-odd path
    if (scrimPathRef.current) {
      const d = `M 0 0 H ${w} V ${h} H 0 Z M ${p0x.toFixed(2)} ${p0y.toFixed(2)} L ${p1x.toFixed(
        2
      )} ${p1y.toFixed(2)} L ${p2x.toFixed(2)} ${p2y.toFixed(2)} L ${p3x.toFixed(2)} ${p3y.toFixed(
        2
      )} Z`;
      scrimPathRef.current.setAttribute('d', d);
    }

    // 2. Crisp quadrilateral outline
    if (quadPolyRef.current) {
      quadPolyRef.current.setAttribute(
        'points',
        `${p0x.toFixed(2)},${p0y.toFixed(2)} ${p1x.toFixed(2)},${p1y.toFixed(2)} ${p2x.toFixed(
          2
        )},${p2y.toFixed(2)} ${p3x.toFixed(2)},${p3y.toFixed(2)}`
      );
    }

    // 3. Perspective rule-of-thirds alignment grid (shown softly while dragging)
    const dragging = dragRef.current !== null;
    if (gridGroupRef.current) {
      gridGroupRef.current.style.opacity = dragging ? '1' : '0';
    }
    if (dragging) {
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const lines = gridLinesRef.current;
      // Vertical thirds (1/3 and 2/3)
      if (lines[0]) {
        lines[0].setAttribute('x1', lerp(p0x, p1x, 1 / 3).toFixed(1));
        lines[0].setAttribute('y1', lerp(p0y, p1y, 1 / 3).toFixed(1));
        lines[0].setAttribute('x2', lerp(p3x, p2x, 1 / 3).toFixed(1));
        lines[0].setAttribute('y2', lerp(p3y, p2y, 1 / 3).toFixed(1));
      }
      if (lines[1]) {
        lines[1].setAttribute('x1', lerp(p0x, p1x, 2 / 3).toFixed(1));
        lines[1].setAttribute('y1', lerp(p0y, p1y, 2 / 3).toFixed(1));
        lines[1].setAttribute('x2', lerp(p3x, p2x, 2 / 3).toFixed(1));
        lines[1].setAttribute('y2', lerp(p3y, p2y, 2 / 3).toFixed(1));
      }
      // Horizontal thirds (1/3 and 2/3)
      if (lines[2]) {
        lines[2].setAttribute('x1', lerp(p0x, p3x, 1 / 3).toFixed(1));
        lines[2].setAttribute('y1', lerp(p0y, p3y, 1 / 3).toFixed(1));
        lines[2].setAttribute('x2', lerp(p1x, p2x, 1 / 3).toFixed(1));
        lines[2].setAttribute('y2', lerp(p1y, p2y, 1 / 3).toFixed(1));
      }
      if (lines[3]) {
        lines[3].setAttribute('x1', lerp(p0x, p3x, 2 / 3).toFixed(1));
        lines[3].setAttribute('y1', lerp(p0y, p3y, 2 / 3).toFixed(1));
        lines[3].setAttribute('x2', lerp(p1x, p2x, 2 / 3).toFixed(1));
        lines[3].setAttribute('y2', lerp(p1y, p2y, 2 / 3).toFixed(1));
      }
    }

    // 4. GPU-composited corner handles
    for (let i = 0; i < 4; i++) {
      const el = cornerElsRef.current[i];
      if (!el) continue;
      const cx = q[i].x * w;
      const cy = q[i].y * h;
      el.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0) translate(-50%, -50%)`;
    }

    // 5. GPU-composited edge midpoint handles rotated to align flush with each edge
    for (let i = 0; i < 4; i++) {
      const el = edgeElsRef.current[i];
      if (!el) continue;
      const a = q[i];
      const b = q[(i + 1) % 4];
      const mx = ((a.x + b.x) * 0.5) * w;
      const my = ((a.y + b.y) * 0.5) * h;
      const angleDeg = (Math.atan2((b.y - a.y) * h, (b.x - a.x) * w) * 180) / Math.PI;
      el.style.transform = `translate3d(${mx.toFixed(2)}px, ${my.toFixed(2)}px, 0) translate(-50%, -50%) rotate(${angleDeg.toFixed(2)}deg)`;
    }

    // 6. Magnifying loupe during active drag
    if (dragRef.current) {
      const t = dragRef.current.target;
      const focusPt =
        t.kind === 'corner' ? q[t.index] : getEdgeMidpoint(q, t.index);
      drawLoupe(focusPt, q);
    }
  }, [drawLoupe]);

  const scheduleOverlayPaint = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paintOverlayImmediate();
    });
  }, [paintOverlayImmediate]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const commitDisplayQuad = useCallback(
    (nextDisplayQuad: DocumentQuad) => {
      const nextSourceQuad = unrotateQuadFromDisplay(nextDisplayQuad, rotation);
      onChange(nextSourceQuad);
    },
    [onChange, rotation]
  );

  const beginDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, explicitTarget?: CropDragTarget) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const q = displayQuadRef.current;

      const target =
        explicitTarget ??
        findNearestCropHandle(
          { x: localX, y: localY },
          q,
          rect.width,
          rect.height,
          e.pointerType === 'touch' ? 46 : 36,
          e.pointerType === 'touch' ? 36 : 26
        );

      if (!target) return;

      e.preventDefault();
      e.stopPropagation();

      // Capture pointer on the stage itself so pointermove/pointerup stay rock-solid even outside bounds
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        // Fallback if synthetic pointer event has no active pointerId
      }

      const normPtrX = localX / rect.width;
      const normPtrY = localY / rect.height;

      const anchorPt =
        target.kind === 'corner'
          ? q[target.index]
          : getEdgeMidpoint(q, target.index);

      // Zero-jump grab offset: pressing slightly off-center of a handle drags smoothly from its current spot
      const offsetX = anchorPt.x - normPtrX;
      const offsetY = anchorPt.y - normPtrY;

      dragRef.current = {
        pointerId: e.pointerId,
        target,
        stageRect: rect,
        offsetX,
        offsetY,
        startPointerX: normPtrX,
        startPointerY: normPtrY,
        startQuad: cloneQuad(q),
      };

      setActiveTarget(target);
      // Paint loupe & grid immediately on next frame once loupe element mounts
      requestAnimationFrame(() => paintOverlayImmediate());
    },
    [paintOverlayImmediate]
  );

  const handleStagePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      e.preventDefault();
      const { stageRect, target } = drag;
      const normX = (e.clientX - stageRect.left) / stageRect.width;
      const normY = (e.clientY - stageRect.top) / stageRect.height;

      if (target.kind === 'corner') {
        displayQuadRef.current = moveQuadCorner(displayQuadRef.current, target.index, {
          x: normX + drag.offsetX,
          y: normY + drag.offsetY,
        });
      } else {
        const dx = normX - drag.startPointerX;
        const dy = normY - drag.startPointerY;
        displayQuadRef.current = moveQuadEdge(drag.startQuad, target.index, dx, dy);
      }

      scheduleOverlayPaint();
    },
    [scheduleOverlayPaint]
  );

  const finishDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      try {
        stageRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if not captured
      }
      dragRef.current = null;
      setActiveTarget(null);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      paintOverlayImmediate();
      commitDisplayQuad(displayQuadRef.current);
    },
    [commitDisplayQuad, paintOverlayImmediate]
  );

  const handleHandleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, target: CropDragTarget) => {
      const step = e.shiftKey ? 0.04 : 0.01;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;

      e.preventDefault();
      if (target.kind === 'corner') {
        const cur = displayQuadRef.current[target.index];
        displayQuadRef.current = moveQuadCorner(displayQuadRef.current, target.index, {
          x: cur.x + dx,
          y: cur.y + dy,
        });
      } else {
        displayQuadRef.current = moveQuadEdge(displayQuadRef.current, target.index, dx, dy);
      }
      paintOverlayImmediate();
      commitDisplayQuad(displayQuadRef.current);
    },
    [commitDisplayQuad, paintOverlayImmediate]
  );

  return (
    <div
      ref={outerContainerRef}
      data-testid="smooth-crop-editor"
      className="relative w-full h-full flex items-center justify-center overflow-hidden select-none touch-none"
    >
      {stageSize.width > 0 && stageSize.height > 0 && (
        <div
          ref={stageRef}
          data-testid="crop-stage"
          onPointerDown={(e) => beginDrag(e)}
          onPointerMove={handleStagePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          style={{
            width: `${stageSize.width}px`,
            height: `${stageSize.height}px`,
          }}
          className="relative shrink-0 touch-none cursor-crosshair"
        >
          {/* Rotated crisp source document canvas */}
          <canvas
            ref={imageCanvasRef}
            className="block w-full h-full rounded-[4px] shadow-2xl pointer-events-none"
          />

          {/* SVG Dark Outside Mask + Border + Perspective Alignment Grid */}
          <svg
            width={stageSize.width}
            height={stageSize.height}
            viewBox={`0 0 ${stageSize.width} ${stageSize.height}`}
            className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
          >
            {/* Dim outside of crop area */}
            <path
              ref={scrimPathRef}
              fill="rgba(0, 0, 0, 0.56)"
              fillRule="evenodd"
            />
            {/* Rule-of-thirds perspective guide grid (visible while dragging) */}
            <g
              ref={gridGroupRef}
              style={{ opacity: 0, transition: 'opacity 140ms ease' }}
              stroke="rgba(26, 115, 232, 0.48)"
              strokeWidth="1"
              strokeDasharray="4 4"
            >
              {[0, 1, 2, 3].map((idx) => (
                <line
                  key={idx}
                  ref={(el) => {
                    gridLinesRef.current[idx] = el;
                  }}
                />
              ))}
            </g>
            {/* Primary blue document outline */}
            <polygon
              ref={quadPolyRef}
              fill="rgba(66, 133, 244, 0.08)"
              stroke="#8AB4F8"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </svg>

          {/* 4 Edge Midpoint Handles (slide entire edge smoothly) */}
          {([0, 1, 2, 3] as const).map((edgeIdx) => {
            const isDragging =
              activeTarget?.kind === 'edge' && activeTarget.index === edgeIdx;
            return (
              <button
                key={`edge-${edgeIdx}`}
                ref={(el) => {
                  edgeElsRef.current[edgeIdx] = el;
                }}
                type="button"
                aria-label={EDGE_LABELS[edgeIdx]}
                onPointerDown={(e) => beginDrag(e, { kind: 'edge', index: edgeIdx })}
                onKeyDown={(e) => handleHandleKeyDown(e, { kind: 'edge', index: edgeIdx })}
                style={{ left: 0, top: 0, willChange: 'transform' }}
                className="absolute w-10 h-8 flex items-center justify-center focus:outline-none touch-none cursor-grab active:cursor-grabbing"
              >
                <span
                  className={`block h-1.5 rounded-full border border-white/90 shadow-md transition-colors ${
                    isDragging
                      ? 'w-7 bg-[#1A73E8] ring-2 ring-[#8AB4F8]/60'
                      : 'w-5 bg-[#4285F4]/95 hover:bg-[#1A73E8]'
                  }`}
                />
              </button>
            );
          })}

          {/* 4 Corner Handles (generous 44px touch target, crisp precision ring) */}
          {([0, 1, 2, 3] as const).map((cornerIdx) => {
            const isDragging =
              activeTarget?.kind === 'corner' && activeTarget.index === cornerIdx;
            return (
              <button
                key={`corner-${cornerIdx}`}
                ref={(el) => {
                  cornerElsRef.current[cornerIdx] = el;
                }}
                type="button"
                aria-label={CORNER_LABELS[cornerIdx]}
                onPointerDown={(e) => beginDrag(e, { kind: 'corner', index: cornerIdx })}
                onKeyDown={(e) => handleHandleKeyDown(e, { kind: 'corner', index: cornerIdx })}
                style={{ left: 0, top: 0, willChange: 'transform' }}
                className="absolute w-11 h-11 flex items-center justify-center focus:outline-none touch-none cursor-grab active:cursor-grabbing"
              >
                <span
                  className={`flex items-center justify-center rounded-full border-2 border-white shadow-[0_2px_10px_rgba(0,0,0,0.65)] transition-[width,height,background-color] duration-100 ${
                    isDragging
                      ? 'w-8 h-8 bg-[#1A73E8]/90 ring-4 ring-[#8AB4F8]/45'
                      : 'w-6 h-6 bg-[#4285F4]/90 hover:w-7 hover:h-7'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-white" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* High-DPI Auto-Flipping Magnifying Loupe while dragging */}
      {activeTarget !== null && (
        <div
          ref={loupeWrapRef}
          data-testid="crop-loupe"
          className="pointer-events-none absolute top-3 right-3.5 w-28 h-28 sm:w-32 sm:h-32 rounded-full border-[2.5px] border-[#8AB4F8] overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.75)] bg-black z-20"
        >
          <canvas
            ref={loupeCanvasRef}
            width={256}
            height={256}
            className="w-full h-full block"
          />
        </div>
      )}
    </div>
  );
};

export interface CleanStrokePoint {
  x: number; // 0..1 normalized to warped+rotated preview space
  y: number; // 0..1 normalized to warped+rotated preview space
}

export interface CleanStroke {
  id: string;
  /** Brush diameter as a fraction of min(width, height), e.g. 0.03..0.12 */
  radiusRatio: number;
  /** RGB fill sampled from clean surrounding paper/background at stroke start */
  fillColor: string;
  points: CleanStrokePoint[];
}

/**
 * Samples the brightest quartile (clean paper/background) around a normalized point
 * in an ImageData buffer so the Google Drive "Clean" eraser paints out dark smudges,
 * shadows, or fingers using the actual surrounding page tone rather than harsh pure white.
 */
export function sampleLocalPaperColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  normX: number,
  normY: number,
  ringRadiusPx = 28
): string {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return '#FFFFFF';
  }
  const cx = Math.max(0, Math.min(width - 1, Math.round(normX * (width - 1))));
  const cy = Math.max(0, Math.min(height - 1, Math.round(normY * (height - 1))));

  const samples: Array<{ r: number; g: number; b: number; lum: number }> = [];
  const angles = 24;
  const radii = [ringRadiusPx * 0.75, ringRadiusPx * 1.15, ringRadiusPx * 1.6];

  for (const rad of radii) {
    for (let a = 0; a < angles; a++) {
      const ang = (a / angles) * Math.PI * 2;
      const sx = Math.round(cx + Math.cos(ang) * rad);
      const sy = Math.round(cy + Math.sin(ang) * rad);
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
      const idx = (sy * width + sx) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      samples.push({ r, g, b, lum });
    }
  }

  if (samples.length === 0) return '#FFFFFF';

  // Pick the upper-brightest 30% of surrounding pixels (clean paper, ignoring ink/smudge)
  samples.sort((a, b) => b.lum - a.lum);
  const take = Math.max(1, Math.ceil(samples.length * 0.3));
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let i = 0; i < take; i++) {
    sr += samples[i].r;
    sg += samples[i].g;
    sb += samples[i].b;
  }
  const r = Math.round(sr / take);
  const g = Math.round(sg / take);
  const b = Math.round(sb / take);
  return `rgb(${r}, ${g}, ${b})`;
}

export function renderCleanStrokesOnContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strokes: CleanStroke[]
): void {
  if (!strokes.length || width <= 0 || height <= 0) return;
  const minDim = Math.min(width, height);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const radiusPx = Math.max(4, stroke.radiusRatio * minDim);
    ctx.strokeStyle = stroke.fillColor;
    ctx.fillStyle = stroke.fillColor;
    ctx.lineWidth = radiusPx * 2;

    if (stroke.points.length === 1) {
      const pt = stroke.points[0];
      ctx.beginPath();
      ctx.arc(pt.x * width, pt.y * height, radiusPx, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
    for (let i = 1; i < stroke.points.length; i++) {
      const prev = stroke.points[i - 1];
      const curr = stroke.points[i];
      const mx = ((prev.x + curr.x) * 0.5) * width;
      const my = ((prev.y + curr.y) * 0.5) * height;
      ctx.quadraticCurveTo(prev.x * width, prev.y * height, mx, my);
    }
    const last = stroke.points[stroke.points.length - 1];
    ctx.lineTo(last.x * width, last.y * height);
    ctx.stroke();
  }

  ctx.restore();
}

export interface AutoCaptureState {
  steadySince: number | null;
  cooldownUntil: number;
  missCount: number;
}

export interface AutoCaptureUpdate {
  nextState: AutoCaptureState;
  /** 0..1 progress ring around the Google Drive shutter button */
  progress: number;
  shouldCapture: boolean;
  statusText: string;
}

export const AUTO_CAPTURE_HOLD_MS = 950;
export const AUTO_CAPTURE_COOLDOWN_MS = 2400;
export const AUTO_CAPTURE_MOVEMENT_LIMIT = 0.042;

export function createInitialAutoCaptureState(): AutoCaptureState {
  return {
    steadySince: null,
    cooldownUntil: 0,
    missCount: 0,
  };
}

/**
 * Pure state transition for Google Drive-style Auto-Capture stability & progress ring.
 */
export function stepAutoCaptureState(
  state: AutoCaptureState,
  now: number,
  options: {
    detected: boolean;
    autoEnabled: boolean;
    movement: number;
    scanKind: 'document' | 'photo';
  }
): AutoCaptureUpdate {
  const subject = options.scanKind === 'photo' ? 'photo' : 'document';

  if (!options.detected) {
    const missCount = state.missCount + 1;
    const lost = missCount > 3;
    return {
      nextState: {
        ...state,
        missCount,
        steadySince: lost ? null : state.steadySince,
      },
      progress: 0,
      shouldCapture: false,
      statusText:
        now <= state.cooldownUntil
          ? `Captured! Ready for next ${subject}`
          : options.autoEnabled
            ? `Looking for ${subject}…`
            : `Manual mode · Tap shutter`,
    };
  }

  if (now <= state.cooldownUntil) {
    return {
      nextState: {
        ...state,
        missCount: 0,
        steadySince: null,
      },
      progress: 0,
      shouldCapture: false,
      statusText: `Captured! Scan next or tap preview`,
    };
  }

  if (!options.autoEnabled) {
    return {
      nextState: {
        ...state,
        missCount: 0,
        steadySince: null,
      },
      progress: 0,
      shouldCapture: false,
      statusText: `${subject === 'photo' ? 'Photo' : 'Document'} detected · Tap shutter`,
    };
  }

  if (options.movement >= AUTO_CAPTURE_MOVEMENT_LIMIT) {
    return {
      nextState: {
        ...state,
        missCount: 0,
        steadySince: now,
      },
      progress: 0.08,
      shouldCapture: false,
      statusText: 'Hold still…',
    };
  }

  const steadySince = state.steadySince ?? now;
  const elapsed = Math.max(0, now - steadySince);
  const progress = Math.min(1, elapsed / AUTO_CAPTURE_HOLD_MS);

  if (elapsed >= AUTO_CAPTURE_HOLD_MS) {
    return {
      nextState: {
        steadySince: null,
        cooldownUntil: now + AUTO_CAPTURE_COOLDOWN_MS,
        missCount: 0,
      },
      progress: 1,
      shouldCapture: true,
      statusText: 'Scanning…',
    };
  }

  return {
    nextState: {
      ...state,
      missCount: 0,
      steadySince,
    },
    progress,
    shouldCapture: false,
    statusText: progress > 0.35 ? 'Hold still · Capturing…' : 'Hold still…',
  };
}

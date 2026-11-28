import { isAxisAlignedRectQuad } from '../utils/scannerQuad';

export interface NormalizedPoint {
  x: number; // 0..1
  y: number; // 0..1
}

// Ordered: Top-Left, Top-Right, Bottom-Right, Bottom-Left
export type DocumentQuad = [
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
  NormalizedPoint,
];

export type ScannerFilterType = 'clean' | 'color' | 'bw' | 'grayscale' | 'original';

export const FULL_QUAD: DocumentQuad = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
];

export const FULL_IMAGE_QUAD: DocumentQuad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function quadArea(q: DocumentQuad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

function isConvexQuad(q: DocumentQuad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-5) return false;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

function orderQuadClockwise(pts: NormalizedPoint[]): DocumentQuad {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  // Rotate so Top-Left (min x + y) is index 0; since screen y goes down, atan2 order is clockwise
  let tlIdx = 0;
  let minSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const s = sorted[i].x + sorted[i].y;
    if (s < minSum) {
      minSum = s;
      tlIdx = i;
    }
  }
  return [
    sorted[tlIdx],
    sorted[(tlIdx + 1) % 4],
    sorted[(tlIdx + 2) % 4],
    sorted[(tlIdx + 3) % 4],
  ];
}

function intersectHoughLines(
  t1: number,
  r1: number,
  t2: number,
  r2: number,
  w: number,
  h: number
): NormalizedPoint | null {
  const c1 = Math.cos(t1);
  const s1 = Math.sin(t1);
  const c2 = Math.cos(t2);
  const s2 = Math.sin(t2);
  const det = c1 * s2 - s1 * c2;
  if (Math.abs(det) < 0.35) return null; // lines too parallel
  const xCentered = (r1 * s2 - r2 * s1) / det;
  const yCentered = (r2 * c1 - r1 * c2) / det;
  const nx = (xCentered + w / 2) / w;
  const ny = (yCentered + h / 2) / h;
  if (nx < -0.05 || nx > 1.05 || ny < -0.05 || ny > 1.05) return null;
  return { x: clamp01(nx), y: clamp01(ny) };
}

// Reusable scratch canvas & typed buffers to avoid GC pauses during live scanning
let detectCanvas: HTMLCanvasElement | null = null;
let detectBufSize = 0;
let lumR = new Float32Array(0);
let lumG = new Float32Array(0);
let lumB = new Float32Array(0);
let tmpBuf = new Float32Array(0);
let gxArr = new Float32Array(0);
let gyArr = new Float32Array(0);
let magArr = new Float32Array(0);

function ensureDetectBuffers(size: number) {
  if (detectBufSize >= size) return;
  detectBufSize = size;
  lumR = new Float32Array(size);
  lumG = new Float32Array(size);
  lumB = new Float32Array(size);
  tmpBuf = new Float32Array(size);
  gxArr = new Float32Array(size);
  gyArr = new Float32Array(size);
  magArr = new Float32Array(size);
}

function blurChannelInPlace(ch: Float32Array, tmp: Float32Array, w: number, h: number) {
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const p = row + x;
        tmp[p] =
          (ch[p - w - 1] +
            2 * ch[p - w] +
            ch[p - w + 1] +
            2 * ch[p - 1] +
            4 * ch[p] +
            2 * ch[p + 1] +
            ch[p + w - 1] +
            2 * ch[p + w] +
            ch[p + w + 1]) *
          0.0625;
      }
    }
    ch.set(tmp.subarray(0, w * h));
  }
}

/**
 * Fast real-time document boundary detector modeled after Google Drive's ML Kit scanner.
 * Uses multi-channel RGB Gaussian smoothing -> Max-channel Sobel gradients ->
 * Oriented Hough Line Peaks -> 4-line quad fitting with edge-alignment verification
 * so documents on both dark and light colored surfaces detect reliably.
 */
export function detectDocumentQuad(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): DocumentQuad | null {
  const srcW =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth || source.width
        : source.width;
  const srcH =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight || source.height
        : source.height;

  if (!srcW || !srcH) return null;

  const targetMax = 180;
  const scale = targetMax / Math.max(srcW, srcH);
  const w = Math.max(48, Math.round(srcW * scale));
  const h = Math.max(48, Math.round(srcH * scale));

  if (!detectCanvas) {
    detectCanvas = document.createElement('canvas');
  }
  if (detectCanvas.width !== w || detectCanvas.height !== h) {
    detectCanvas.width = w;
    detectCanvas.height = h;
  }
  const ctx = detectCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h).data;
  const size = w * h;
  ensureDetectBuffers(size);

  for (let i = 0, p = 0; i < img.length; i += 4, p++) {
    lumR[p] = img[i];
    lumG[p] = img[i + 1];
    lumB[p] = img[i + 2];
  }

  // Two passes of 3x3 Gaussian blur per RGB channel to suppress printed text & desk grain
  blurChannelInPlace(lumR, tmpBuf, w, h);
  blurChannelInPlace(lumG, tmpBuf, w, h);
  blurChannelInPlace(lumB, tmpBuf, w, h);

  let sumMag = 0;
  let countMag = 0;

  for (let y = 3; y < h - 3; y++) {
    const row = y * w;
    for (let x = 3; x < w - 3; x++) {
      const p = row + x;

      // Pick the channel with strongest Sobel response so color edges (e.g. white paper on wood)
      // are just as crisp as luminance edges
      const gxR =
        -lumR[p - w - 1] +
        lumR[p - w + 1] -
        2 * lumR[p - 1] +
        2 * lumR[p + 1] -
        lumR[p + w - 1] +
        lumR[p + w + 1];
      const gyR =
        -lumR[p - w - 1] -
        2 * lumR[p - w] -
        lumR[p - w + 1] +
        lumR[p + w - 1] +
        2 * lumR[p + w] +
        lumR[p + w + 1];
      let bestGx = gxR;
      let bestGy = gyR;
      let bestMagSq = gxR * gxR + gyR * gyR;

      const gxG =
        -lumG[p - w - 1] +
        lumG[p - w + 1] -
        2 * lumG[p - 1] +
        2 * lumG[p + 1] -
        lumG[p + w - 1] +
        lumG[p + w + 1];
      const gyG =
        -lumG[p - w - 1] -
        2 * lumG[p - w] -
        lumG[p - w + 1] +
        lumG[p + w - 1] +
        2 * lumG[p + w] +
        lumG[p + w + 1];
      const magGSq = gxG * gxG + gyG * gyG;
      if (magGSq > bestMagSq) {
        bestMagSq = magGSq;
        bestGx = gxG;
        bestGy = gyG;
      }

      const gxB =
        -lumB[p - w - 1] +
        lumB[p - w + 1] -
        2 * lumB[p - 1] +
        2 * lumB[p + 1] -
        lumB[p + w - 1] +
        lumB[p + w + 1];
      const gyB =
        -lumB[p - w - 1] -
        2 * lumB[p - w] -
        lumB[p - w + 1] +
        lumB[p + w - 1] +
        2 * lumB[p + w] +
        lumB[p + w + 1];
      const magBSq = gxB * gxB + gyB * gyB;
      if (magBSq > bestMagSq) {
        bestMagSq = magBSq;
        bestGx = gxB;
        bestGy = gyB;
      }

      const mag = Math.sqrt(bestMagSq);
      gxArr[p] = bestGx;
      gyArr[p] = bestGy;
      magArr[p] = mag;
      sumMag += mag;
      countMag++;
    }
  }

  const meanMag = sumMag / Math.max(1, countMag);
  if (meanMag < 3) return null;

  // Oriented Hough accumulator over [0, PI) and centered rho
  const nTheta = 90;
  const rMax = Math.ceil(Math.hypot(w, h) / 2);
  const rhoStep = 2;
  const nRho = Math.ceil((2 * rMax) / rhoStep) + 1;
  const acc = new Float32Array(nTheta * nRho);

  const cosTable = new Float32Array(nTheta);
  const sinTable = new Float32Array(nTheta);
  for (let t = 0; t < nTheta; t++) {
    const ang = (t * Math.PI) / nTheta;
    cosTable[t] = Math.cos(ang);
    sinTable[t] = Math.sin(ang);
  }

  const edgeFloor = Math.max(16, meanMag * 1.38);
  const capWeight = Math.max(80, meanMag * 8);
  const halfW = w / 2;
  const halfH = h / 2;

  for (let y = 4; y < h - 4; y++) {
    for (let x = 4; x < w - 4; x++) {
      const p = y * w + x;
      const mag = magArr[p];
      if (mag < edgeFloor) continue;

      let theta = Math.atan2(gyArr[p], gxArr[p]);
      if (theta < 0) theta += Math.PI;
      if (theta >= Math.PI) theta -= Math.PI;

      const tBin = Math.floor((theta / Math.PI) * nTheta) % nTheta;
      const cx = x - halfW;
      const cy = y - halfH;
      const weight = Math.min(mag, capWeight);

      for (let dt = -1; dt <= 1; dt++) {
        const tb = (tBin + dt + nTheta) % nTheta;
        const rho = cx * cosTable[tb] + cy * sinTable[tb];
        const rBin = Math.round((rho + rMax) / rhoStep);
        if (rBin >= 1 && rBin < nRho - 1) {
          const tw = dt === 0 ? weight : weight * 0.45;
          acc[tb * nRho + rBin] += tw;
          acc[tb * nRho + rBin - 1] += tw * 0.35;
          acc[tb * nRho + rBin + 1] += tw * 0.35;
        }
      }
    }
  }

  // Non-Maximum Suppression to extract top candidate straight lines
  interface HoughLine {
    theta: number;
    tBin: number;
    rho: number;
    score: number;
  }
  const candidates: HoughLine[] = [];
  for (let t = 0; t < nTheta; t++) {
    for (let r = 2; r < nRho - 2; r++) {
      const val = acc[t * nRho + r];
      if (val <= 0) continue;
      let isPeak = true;
      for (let dt = -3; dt <= 3 && isPeak; dt++) {
        const tb = (t + dt + nTheta) % nTheta;
        for (let dr = -4; dr <= 4; dr++) {
          if (dt === 0 && dr === 0) continue;
          const rb = r + dr;
          if (rb >= 0 && rb < nRho && acc[tb * nRho + rb] > val) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) {
        candidates.push({
          theta: (t * Math.PI) / nTheta,
          tBin: t,
          rho: r * rhoStep - rMax,
          score: val,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const topLines = candidates.slice(0, 20);
  if (topLines.length < 4) return null;

  const angleDiff = (a: number, b: number) => {
    let d = Math.abs(a - b);
    if (d > Math.PI / 2) d = Math.PI - d;
    return d;
  };

  // Helper: verify edge pixel alignment along middle 80% of a segment (robust to rounded ID corners)
  const measureEdgeSupport = (a: NormalizedPoint, b: NormalizedPoint): number => {
    const dx = (b.x - a.x) * w;
    const dy = (b.y - a.y) * h;
    const len = Math.hypot(dx, dy);
    if (len < Math.min(w, h) * 0.16) return 0;
    const nx = -dy / len;
    const ny = dx / len;
    const samples = 22;
    let hits = 0;

    for (let s = 0; s < samples; s++) {
      const t = 0.1 + (0.8 * s) / (samples - 1);
      const px = Math.round((a.x + (b.x - a.x) * t) * (w - 1));
      const py = Math.round((a.y + (b.y - a.y) * t) * (h - 1));
      let best = false;
      for (let oy = -2; oy <= 2 && !best; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const sx = px + ox;
          const sy = py + oy;
          if (sx < 2 || sx >= w - 2 || sy < 2 || sy >= h - 2) continue;
          const idx = sy * w + sx;
          const m = magArr[idx];
          if (m >= edgeFloor) {
            const align = Math.abs(gxArr[idx] * nx + gyArr[idx] * ny) / (m + 1e-5);
            if (align >= 0.68) {
              best = true;
              break;
            }
          }
        }
      }
      if (best) hits++;
    }
    return hits / samples;
  };

  // Helper: distinguish true outer paper/photo edges from internal printed headers or boxes.
  // For a clockwise quad in screen space (+y down), (-dy/len, dx/len) points INWARD into the page.
  const measureBoundaryContrast = (a: NormalizedPoint, b: NormalizedPoint): number => {
    const dx = (b.x - a.x) * w;
    const dy = (b.y - a.y) * h;
    const len = Math.hypot(dx, dy);
    if (len < Math.min(w, h) * 0.16) return 0;
    const inNx = -dy / len;
    const inNy = dx / len;
    const offset = Math.max(4, Math.round(Math.min(w, h) * 0.035));
    const samples = 14;
    let strongSep = 0;
    let validSamples = 0;

    for (let s = 0; s < samples; s++) {
      const t = 0.12 + (0.76 * s) / (samples - 1);
      const bx = (a.x + (b.x - a.x) * t) * (w - 1);
      const by = (a.y + (b.y - a.y) * t) * (h - 1);

      const ix = Math.round(bx + inNx * offset);
      const iy = Math.round(by + inNy * offset);
      const ox = Math.round(bx - inNx * offset);
      const oy = Math.round(by - inNy * offset);

      if (ix < 1 || ix >= w - 1 || iy < 1 || iy >= h - 1) continue;
      if (ox < 1 || ox >= w - 1 || oy < 1 || oy >= h - 1) continue;
      validSamples++;

      const iIdx = iy * w + ix;
      const oIdx = oy * w + ox;
      const colorDiff =
        Math.abs(lumR[iIdx] - lumR[oIdx]) +
        Math.abs(lumG[iIdx] - lumG[oIdx]) +
        Math.abs(lumB[iIdx] - lumB[oIdx]);

      // True paper/photo boundary shows clear sustained inside-vs-outside color/tone separation
      if (colorDiff > 65) strongSep++;
    }
    return validSamples > 0 ? strongSep / validSamples : 0;
  };

  let bestQuad: DocumentQuad | null = null;
  let bestScore = 0;

  // Test pairs of near-parallel lines paired with near-orthogonal pairs (tolerant of perspective tilt)
  const n = topLines.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const l1 = topLines[i];
      const l2 = topLines[j];
      if (angleDiff(l1.theta, l2.theta) > 0.42) continue; // ~24 deg parallel tolerance for tilted docs
      const sep1 = Math.abs(l1.rho - l2.rho);
      if (sep1 < Math.min(w, h) * 0.16) continue;

      const avgTheta1 = l1.theta;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const l3 = topLines[k];
        if (Math.abs(angleDiff(avgTheta1, l3.theta) - Math.PI / 2) > 0.48) continue;

        for (let m = k + 1; m < n; m++) {
          if (m === i || m === j) continue;
          const l4 = topLines[m];
          if (angleDiff(l3.theta, l4.theta) > 0.42) continue;
          const sep2 = Math.abs(l3.rho - l4.rho);
          if (sep2 < Math.min(w, h) * 0.16) continue;

          const p1 = intersectHoughLines(l1.theta, l1.rho, l3.theta, l3.rho, w, h);
          const p2 = intersectHoughLines(l1.theta, l1.rho, l4.theta, l4.rho, w, h);
          const p3 = intersectHoughLines(l2.theta, l2.rho, l4.theta, l4.rho, w, h);
          const p4 = intersectHoughLines(l2.theta, l2.rho, l3.theta, l3.rho, w, h);
          if (!p1 || !p2 || !p3 || !p4) continue;

          const quad = orderQuadClockwise([p1, p2, p3, p4]);
          const area = quadArea(quad);
          if (area < 0.06 || area > 0.92 || !isConvexQuad(quad)) continue;

          // Reject quads hugging the outer frame edge (camera bezel / vignette artifacts)
          const nearBorderCount = quad.filter(
            (pt) => pt.x < 0.02 || pt.x > 0.98 || pt.y < 0.02 || pt.y > 0.98
          ).length;
          if (nearBorderCount >= 3 && area > 0.82) continue;

          const s0 = measureEdgeSupport(quad[0], quad[1]);
          const s1 = measureEdgeSupport(quad[1], quad[2]);
          const s2 = measureEdgeSupport(quad[2], quad[3]);
          const s3 = measureEdgeSupport(quad[3], quad[0]);
          const minEdge = Math.min(s0, s1, s2, s3);
          const avgEdge = (s0 + s1 + s2 + s3) / 4;

          if (minEdge < 0.18 || avgEdge < 0.36) continue;

          const c0 = measureBoundaryContrast(quad[0], quad[1]);
          const c1 = measureBoundaryContrast(quad[1], quad[2]);
          const c2 = measureBoundaryContrast(quad[2], quad[3]);
          const c3 = measureBoundaryContrast(quad[3], quad[0]);
          const minContrast = Math.min(c0, c1, c2, c3);
          const avgContrast = (c0 + c1 + c2 + c3) / 4;

          // Strongly reward quads where ALL 4 sides separate true document/photo from background
          const totalScore =
            avgEdge * 1.25 +
            minEdge * 0.4 +
            avgContrast * 1.35 +
            minContrast * 0.9 +
            Math.sqrt(area) * 0.85 +
            area * 0.8;
          if (totalScore > bestScore) {
            bestScore = totalScore;
            bestQuad = quad;
          }
        }
      }
    }
  }

  return bestQuad;
}

/**
 * Solve 8x8 linear system A*x = b via Gaussian elimination with partial pivoting
 */
function solveLinear8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > maxVal) {
        maxVal = Math.abs(M[r][col]);
        pivotRow = r;
      }
    }
    if (maxVal < 1e-10) return null;
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pivot;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let j = col; j <= n; j++) {
        M[r][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Computes projective homography H mapping (dx, dy) in destination canvas
 * to (sx, sy) in source image pixel space.
 */
function computeInverseHomography(
  dstPts: Array<{ x: number; y: number }>,
  srcPts: Array<{ x: number; y: number }>
): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const x = dstPts[i].x;
    const y = dstPts[i].y;
    const u = srcPts[i].x;
    const v = srcPts[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinear8(A, b);
  if (!h) return null;
  return [...h, 1];
}

function rotateCanvas(source: HTMLCanvasElement, rotation: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (rotation === 0) return source;
  const outW = source.width;
  const outH = source.height;
  const rotW = rotation === 90 || rotation === 270 ? outH : outW;
  const rotH = rotation === 90 || rotation === 270 ? outW : outH;
  const rotCanvas = document.createElement('canvas');
  rotCanvas.width = rotW;
  rotCanvas.height = rotH;
  const rotCtx = rotCanvas.getContext('2d');
  if (!rotCtx) return source;
  rotCtx.translate(rotW / 2, rotH / 2);
  rotCtx.rotate((rotation * Math.PI) / 180);
  rotCtx.drawImage(source, -outW / 2, -outH / 2);
  return rotCanvas;
}

/**
 * Straightens a skewed/tilted 4-corner quadrilateral into a flat rectangular canvas
 * using hardware-accelerated fast path for rectangular crops and exact projective
 * homography + bilinear interpolation for perspective quads.
 */
export function warpPerspectiveQuad(
  sourceImg: HTMLImageElement | HTMLCanvasElement,
  quad: DocumentQuad,
  rotation: 0 | 90 | 180 | 270 = 0,
  maxDim = 1800
): HTMLCanvasElement {
  const srcW =
    sourceImg instanceof HTMLImageElement
      ? sourceImg.naturalWidth || sourceImg.width || 1
      : sourceImg.width;
  const srcH =
    sourceImg instanceof HTMLImageElement
      ? sourceImg.naturalHeight || sourceImg.height || 1
      : sourceImg.height;

  const safeQuad: DocumentQuad = isConvexQuad(quad) ? quad : orderQuadClockwise([...quad]);

  // Fast native path for axis-aligned rectangular crops (20x faster & sharper)
  if (isAxisAlignedRectQuad(safeQuad)) {
    const sx = clamp01(safeQuad[0].x) * srcW;
    const sy = clamp01(safeQuad[0].y) * srcH;
    const sw = Math.max(1, (clamp01(safeQuad[1].x) - clamp01(safeQuad[0].x)) * srcW);
    const sh = Math.max(1, (clamp01(safeQuad[3].y) - clamp01(safeQuad[0].y)) * srcH);

    const outScale = Math.min(1, maxDim / Math.max(sw, sh));
    const outW = Math.max(32, Math.round(sw * outScale));
    const outH = Math.max(32, Math.round(sh * outScale));

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = outW;
    cropCanvas.height = outH;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) throw new Error('Canvas unavailable');
    cropCtx.imageSmoothingEnabled = true;
    cropCtx.imageSmoothingQuality = 'high';
    cropCtx.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, outW, outH);
    return rotateCanvas(cropCanvas, rotation);
  }

  // Draw source image onto readable canvas (bounded so mobile memory stays happy)
  const capScale = Math.min(1, 2200 / Math.max(srcW, srcH));
  const workW = Math.max(2, Math.round(srcW * capScale));
  const workH = Math.max(2, Math.round(srcH * capScale));

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = workW;
  srcCanvas.height = workH;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) throw new Error('Canvas unavailable');
  srcCtx.drawImage(sourceImg, 0, 0, workW, workH);
  const srcData = srcCtx.getImageData(0, 0, workW, workH).data;

  const srcPts = safeQuad.map((p) => ({
    x: clamp01(p.x) * (workW - 1),
    y: clamp01(p.y) * (workH - 1),
  }));

  const widthTop = Math.hypot(srcPts[1].x - srcPts[0].x, srcPts[1].y - srcPts[0].y);
  const widthBottom = Math.hypot(srcPts[2].x - srcPts[3].x, srcPts[2].y - srcPts[3].y);
  const heightLeft = Math.hypot(srcPts[3].x - srcPts[0].x, srcPts[3].y - srcPts[0].y);
  const heightRight = Math.hypot(srcPts[2].x - srcPts[1].x, srcPts[2].y - srcPts[1].y);

  const rawOutW = Math.max(32, Math.round(Math.max(widthTop, widthBottom)));
  const rawOutH = Math.max(32, Math.round(Math.max(heightLeft, heightRight)));
  const outScale = Math.min(1, maxDim / Math.max(rawOutW, rawOutH));
  const outW = Math.max(32, Math.round(rawOutW * outScale));
  const outH = Math.max(32, Math.round(rawOutH * outScale));

  const dstPts = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];

  const H = computeInverseHomography(dstPts, srcPts);

  const warpedCanvas = document.createElement('canvas');
  warpedCanvas.width = outW;
  warpedCanvas.height = outH;
  const warpedCtx = warpedCanvas.getContext('2d');
  if (!warpedCtx) throw new Error('Canvas unavailable');

  if (!H) {
    warpedCtx.drawImage(srcCanvas, 0, 0, outW, outH);
  } else {
    const outImg = warpedCtx.createImageData(outW, outH);
    const dst = outImg.data;
    const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = H;
    const maxSrcX = workW - 1;
    const maxSrcY = workH - 1;

    for (let y = 0; y < outH; y++) {
      const yH1 = h1 * y + h2;
      const yH4 = h4 * y + h5;
      const yH7 = h7 * y + h8;
      let outIdx = y * outW * 4;

      for (let x = 0; x < outW; x++, outIdx += 4) {
        const denom = h6 * x + yH7;
        const rawSx = (h0 * x + yH1) / denom;
        const rawSy = (h3 * x + yH4) / denom;

        if (rawSx < -0.5 || rawSx > maxSrcX + 0.5 || rawSy < -0.5 || rawSy > maxSrcY + 0.5) {
          dst[outIdx] = 255;
          dst[outIdx + 1] = 255;
          dst[outIdx + 2] = 255;
          dst[outIdx + 3] = 255;
          continue;
        }

        const sx = rawSx < 0 ? 0 : rawSx > maxSrcX ? maxSrcX : rawSx;
        const sy = rawSy < 0 ? 0 : rawSy > maxSrcY ? maxSrcY : rawSy;

        const x0 = Math.min(workW - 2, sx | 0);
        const y0 = Math.min(workH - 2, sy | 0);
        const fx = sx - x0;
        const fy = sy - y0;
        const invFx = 1 - fx;
        const invFy = 1 - fy;

        const i00 = (y0 * workW + x0) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + workW * 4;
        const i11 = i01 + 4;

        const w00 = invFx * invFy;
        const w10 = fx * invFy;
        const w01 = invFx * fy;
        const w11 = fx * fy;

        dst[outIdx] =
          srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
        dst[outIdx + 1] =
          srcData[i00 + 1] * w00 +
          srcData[i10 + 1] * w10 +
          srcData[i01 + 1] * w01 +
          srcData[i11 + 1] * w11;
        dst[outIdx + 2] =
          srcData[i00 + 2] * w00 +
          srcData[i10 + 2] * w10 +
          srcData[i01 + 2] * w01 +
          srcData[i11 + 2] * w11;
        dst[outIdx + 3] = 255;
      }
    }
    warpedCtx.putImageData(outImg, 0, 0);
  }

  return rotateCanvas(warpedCanvas, rotation);
}

/**
 * Applies Google Drive-style adaptive document scan filters using local illumination estimation.
 */
export function applyScannerFilter(
  canvas: HTMLCanvasElement,
  filter: ScannerFilterType
): HTMLCanvasElement {
  if (filter === 'original') return canvas;

  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const total = w * h;

  if (filter === 'grayscale') {
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const enhanced = Math.max(0, Math.min(255, (lum - 122) * 1.24 + 132));
      d[i] = enhanced;
      d[i + 1] = enhanced;
      d[i + 2] = enhanced;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // Compute grayscale array & 2D integral image for fast local background shadow estimation
  const gray = new Float32Array(total);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }

  const stride = w + 1;
  const integral = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const rowOff = (y + 1) * stride;
    const prevOff = y * stride;
    const gOff = y * w;
    for (let x = 0; x < w; x++) {
      rowSum += gray[gOff + x];
      integral[rowOff + x + 1] = integral[prevOff + x + 1] + rowSum;
    }
  }

  const boxMean = (x: number, y: number, r: number): number => {
    const x1 = Math.max(0, x - r);
    const y1 = Math.max(0, y - r);
    const x2 = Math.min(w - 1, x + r);
    const y2 = Math.min(h - 1, y + r);
    const area = (x2 - x1 + 1) * (y2 - y1 + 1);
    const sum =
      integral[(y2 + 1) * stride + (x2 + 1)] -
      integral[y1 * stride + (x2 + 1)] -
      integral[(y2 + 1) * stride + x1] +
      integral[y1 * stride + x1];
    return sum / area;
  };

  if (filter === 'bw') {
    // Adaptive local thresholding (removes shadows cleanly just like Google Drive B&W)
    const radius = Math.max(12, Math.round(Math.min(w, h) * 0.045));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const localMean = boxMean(x, y, radius);
        const val = gray[p];
        const diff = val - localMean;
        // Soft anti-aliased threshold around localMean - 10
        let out: number;
        if (diff < -14) out = 18;
        else if (diff > -3) out = 255;
        else out = Math.round(((diff + 14) / 11) * 237 + 18);
        const idx = p * 4;
        d[idx] = out;
        d[idx + 1] = out;
        d[idx + 2] = out;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  if (filter === 'clean' || filter === 'color') {
    // Divide out uneven shadow lighting while preserving ink/stamp colors
    const radius = Math.max(24, Math.round(Math.min(w, h) * 0.08));
    const gainBoost = filter === 'clean' ? 248 : 238;
    const contrast = filter === 'clean' ? 1.18 : 1.24;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const idx = p * 4;
        const localBg = Math.max(45, boxMean(x, y, radius));
        const normFactor = Math.min(2.4, gainBoost / localBg);
        for (let c = 0; c < 3; c++) {
          const lit = d[idx + c] * normFactor;
          const pushed = (lit - 135) * contrast + 142;
          d[idx + c] = Math.max(0, Math.min(255, pushed));
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  return canvas;
}

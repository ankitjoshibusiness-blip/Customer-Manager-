import type { DocumentQuad, NormalizedPoint } from '../services/documentScannerEngine';

export type QuadRotation = 0 | 90 | 180 | 270;

export type CropDragTarget =
  | { kind: 'corner'; index: 0 | 1 | 2 | 3 }
  | { kind: 'edge'; index: 0 | 1 | 2 | 3 };

export const MIN_QUAD_AREA = 0.012;
export const MIN_EDGE_LENGTH = 0.045;

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function cloneQuad(quad: DocumentQuad): DocumentQuad {
  return [
    { x: quad[0].x, y: quad[0].y },
    { x: quad[1].x, y: quad[1].y },
    { x: quad[2].x, y: quad[2].y },
    { x: quad[3].x, y: quad[3].y },
  ];
}

export function quadArea(q: DocumentQuad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

/**
 * Checks that all 4 cross products have the same strictly positive sign
 * (clockwise order in screen coordinates where +y points down).
 */
export function isStrictlyClockwiseConvex(q: DocumentQuad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross <= 1e-4) return false;
  }
  return true;
}

export function isValidEditableQuad(q: DocumentQuad): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    if (a.x < -1e-6 || a.x > 1 + 1e-6 || a.y < -1e-6 || a.y > 1 + 1e-6) {
      return false;
    }
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_EDGE_LENGTH) {
      return false;
    }
  }
  if (quadArea(q) < MIN_QUAD_AREA) return false;
  return isStrictlyClockwiseConvex(q);
}

/**
 * Moves a single corner smoothly toward `target`, binary-searching along the path
 * if the raw target would invert or collapse the quadrilateral.
 */
export function moveQuadCorner(
  quad: DocumentQuad,
  cornerIndex: 0 | 1 | 2 | 3,
  target: NormalizedPoint
): DocumentQuad {
  const clamped: NormalizedPoint = {
    x: clamp01(target.x),
    y: clamp01(target.y),
  };

  const direct = cloneQuad(quad);
  direct[cornerIndex] = clamped;
  if (isValidEditableQuad(direct)) {
    return direct;
  }

  // Binary-search along segment from current corner to desired target so the handle glides
  // smoothly right up to the convex boundary instead of snapping or freezing.
  const start = quad[cornerIndex];
  let lo = 0;
  let hi = 1;
  let best = cloneQuad(quad);

  for (let iter = 0; iter < 12; iter++) {
    const mid = (lo + hi) * 0.5;
    const candidate = cloneQuad(quad);
    candidate[cornerIndex] = {
      x: clamp01(start.x + (clamped.x - start.x) * mid),
      y: clamp01(start.y + (clamped.y - start.y) * mid),
    };
    if (isValidEditableQuad(candidate)) {
      best = candidate;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return best;
}

/**
 * Moves an edge (pair of adjacent vertices) smoothly by (dx, dy) in normalized space,
 * projecting onto the edge's normal when possible and preserving convexity & [0,1] bounds.
 */
export function moveQuadEdge(
  baseQuad: DocumentQuad,
  edgeIndex: 0 | 1 | 2 | 3,
  dx: number,
  dy: number
): DocumentQuad {
  const iA = edgeIndex;
  const iB = ((edgeIndex + 1) % 4) as 0 | 1 | 2 | 3;
  const a = baseQuad[iA];
  const b = baseQuad[iB];

  // Clamp delta so both endpoints stay inside [0, 1] without distorting edge angle
  let clampedDx = dx;
  let clampedDy = dy;

  const minDx = Math.max(-a.x, -b.x);
  const maxDx = Math.min(1 - a.x, 1 - b.x);
  const minDy = Math.max(-a.y, -b.y);
  const maxDy = Math.min(1 - a.y, 1 - b.y);

  clampedDx = Math.max(minDx, Math.min(maxDx, clampedDx));
  clampedDy = Math.max(minDy, Math.min(maxDy, clampedDy));

  const tryScale = (t: number): DocumentQuad => {
    const cand = cloneQuad(baseQuad);
    cand[iA] = { x: clamp01(a.x + clampedDx * t), y: clamp01(a.y + clampedDy * t) };
    cand[iB] = { x: clamp01(b.x + clampedDx * t), y: clamp01(b.y + clampedDy * t) };
    return cand;
  };

  const direct = tryScale(1);
  if (isValidEditableQuad(direct)) {
    return direct;
  }

  let lo = 0;
  let hi = 1;
  let best = cloneQuad(baseQuad);
  for (let iter = 0; iter < 12; iter++) {
    const mid = (lo + hi) * 0.5;
    const cand = tryScale(mid);
    if (isValidEditableQuad(cand)) {
      best = cand;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

export function getEdgeMidpoint(quad: DocumentQuad, edgeIndex: 0 | 1 | 2 | 3): NormalizedPoint {
  const a = quad[edgeIndex];
  const b = quad[(edgeIndex + 1) % 4];
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  };
}

/**
 * Rotate a normalized point (0..1, 0..1) clockwise by 0/90/180/270 degrees.
 */
export function rotateNormalizedPoint(pt: NormalizedPoint, rotation: QuadRotation): NormalizedPoint {
  switch (rotation) {
    case 90:
      return { x: 1 - pt.y, y: pt.x };
    case 180:
      return { x: 1 - pt.x, y: 1 - pt.y };
    case 270:
      return { x: pt.y, y: 1 - pt.x };
    default:
      return { x: pt.x, y: pt.y };
  }
}

/**
 * Inverse-rotate a normalized point back to unrotated source image coordinates.
 */
export function unrotateNormalizedPoint(pt: NormalizedPoint, rotation: QuadRotation): NormalizedPoint {
  switch (rotation) {
    case 90:
      return { x: pt.y, y: 1 - pt.x };
    case 180:
      return { x: 1 - pt.x, y: 1 - pt.y };
    case 270:
      return { x: 1 - pt.y, y: pt.x };
    default:
      return { x: pt.x, y: pt.y };
  }
}

/**
 * Maps a source-image quad into displayed rotated coordinates (preserving TL, TR, BR, BL order).
 */
export function rotateQuadForDisplay(quad: DocumentQuad, rotation: QuadRotation): DocumentQuad {
  const pts = quad.map((p) => rotateNormalizedPoint(p, rotation));
  const shift = rotation === 90 ? 3 : rotation === 180 ? 2 : rotation === 270 ? 1 : 0;
  return [
    pts[shift % 4],
    pts[(shift + 1) % 4],
    pts[(shift + 2) % 4],
    pts[(shift + 3) % 4],
  ];
}

/**
 * Maps a displayed rotated quad back into unrotated source-image coordinates
 * (preserving source TL, TR, BR, BL vertex order).
 */
export function unrotateQuadFromDisplay(displayQuad: DocumentQuad, rotation: QuadRotation): DocumentQuad {
  const shift = rotation === 90 ? 1 : rotation === 180 ? 2 : rotation === 270 ? 3 : 0;
  const pts = displayQuad.map((p) => unrotateNormalizedPoint(p, rotation));
  return [
    pts[shift % 4],
    pts[(shift + 1) % 4],
    pts[(shift + 2) % 4],
    pts[(shift + 3) % 4],
  ];
}

/**
 * Finds the closest corner or edge midpoint handle within a pixel hit radius.
 * Corners always get priority over edge midpoints when overlapping.
 */
export function findNearestCropHandle(
  pointerPx: { x: number; y: number },
  quad: DocumentQuad,
  stageW: number,
  stageH: number,
  cornerRadiusPx = 38,
  edgeRadiusPx = 28
): CropDragTarget | null {
  let bestCornerIdx: (0 | 1 | 2 | 3) | null = null;
  let bestCornerDist = cornerRadiusPx;

  for (let i = 0; i < 4; i++) {
    const cx = quad[i].x * stageW;
    const cy = quad[i].y * stageH;
    const dist = Math.hypot(pointerPx.x - cx, pointerPx.y - cy);
    if (dist <= bestCornerDist) {
      bestCornerDist = dist;
      bestCornerIdx = i as 0 | 1 | 2 | 3;
    }
  }
  if (bestCornerIdx !== null) {
    return { kind: 'corner', index: bestCornerIdx };
  }

  let bestEdgeIdx: (0 | 1 | 2 | 3) | null = null;
  let bestEdgeDist = edgeRadiusPx;

  for (let i = 0; i < 4; i++) {
    const mid = getEdgeMidpoint(quad, i as 0 | 1 | 2 | 3);
    const mx = mid.x * stageW;
    const my = mid.y * stageH;
    const dist = Math.hypot(pointerPx.x - mx, pointerPx.y - my);
    if (dist <= bestEdgeDist) {
      bestEdgeDist = dist;
      bestEdgeIdx = i as 0 | 1 | 2 | 3;
    }
  }
  if (bestEdgeIdx !== null) {
    return { kind: 'edge', index: bestEdgeIdx };
  }

  return null;
}

/**
 * True when a quad is an axis-aligned rectangle (TL.y==TR.y, BL.y==BR.y, TL.x==BL.x, TR.x==BR.x).
 */
export function isAxisAlignedRectQuad(quad: DocumentQuad, eps = 1e-3): boolean {
  const [tl, tr, br, bl] = quad;
  return (
    Math.abs(tl.y - tr.y) <= eps &&
    Math.abs(bl.y - br.y) <= eps &&
    Math.abs(tl.x - bl.x) <= eps &&
    Math.abs(tr.x - br.x) <= eps &&
    tr.x > tl.x + eps &&
    bl.y > tl.y + eps
  );
}

/**
 * Computes the exact letterboxed rectangle of content inside a container (`object-contain`).
 */
export function computeContainedRect(
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number
): { x: number; y: number; width: number; height: number } {
  if (containerW <= 0 || containerH <= 0 || contentW <= 0 || contentH <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const contentRatio = contentW / contentH;
  const boxRatio = containerW / containerH;
  if (contentRatio > boxRatio) {
    const width = containerW;
    const height = containerW / contentRatio;
    return { x: 0, y: (containerH - height) / 2, width, height };
  }
  const height = containerH;
  const width = containerH * contentRatio;
  return { x: (containerW - width) / 2, y: 0, width, height };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentQuad } from '../services/documentScannerEngine';
import {
  computeContainedRect,
  findNearestCropHandle,
  isAxisAlignedRectQuad,
  isStrictlyClockwiseConvex,
  isValidEditableQuad,
  moveQuadCorner,
  moveQuadEdge,
  rotateQuadForDisplay,
  unrotateQuadFromDisplay,
  type QuadRotation,
} from './scannerQuad';

const UNIT_QUAD: DocumentQuad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];

test('isValidEditableQuad accepts normal convex quad and rejects bowtie/collapsed quads', () => {
  assert.equal(isValidEditableQuad(UNIT_QUAD), true);

  // Self-intersecting bowtie (TL moved past TR)
  const bowtie: DocumentQuad = [
    { x: 0.95, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  assert.equal(isStrictlyClockwiseConvex(bowtie), false);
  assert.equal(isValidEditableQuad(bowtie), false);

  // Collapsed sliver
  const sliver: DocumentQuad = [
    { x: 0.1, y: 0.1 },
    { x: 0.11, y: 0.1 },
    { x: 0.11, y: 0.11 },
    { x: 0.1, y: 0.11 },
  ];
  assert.equal(isValidEditableQuad(sliver), false);
});

test('moveQuadCorner moves freely within valid bounds and clamps smoothly without inverting', () => {
  const moved = moveQuadCorner(UNIT_QUAD, 0, { x: 0.2, y: 0.25 });
  assert.equal(moved[0].x, 0.2);
  assert.equal(moved[0].y, 0.25);
  assert.equal(isValidEditableQuad(moved), true);

  // Attempt to drag Top-Left past Bottom-Right (would create invalid bowtie)
  const clamped = moveQuadCorner(UNIT_QUAD, 0, { x: 0.98, y: 0.98 });
  assert.equal(isValidEditableQuad(clamped), true);
  assert.ok(clamped[0].x < clamped[1].x, 'TL must remain strictly left of TR');
  assert.ok(clamped[0].y < clamped[3].y, 'TL must remain strictly above BL');
  // Should glide forward from 0.1 toward boundary rather than freezing at 0.1
  assert.ok(clamped[0].x > 0.35 && clamped[0].y > 0.35);
});

test('moveQuadEdge translates both endpoints smoothly while clamping to [0,1] and staying convex', () => {
  // Move top edge down by 0.2
  const shifted = moveQuadEdge(UNIT_QUAD, 0, 0, 0.2);
  assert.ok(Math.abs(shifted[0].y - 0.3) < 1e-6);
  assert.ok(Math.abs(shifted[1].y - 0.3) < 1e-6);
  assert.equal(isValidEditableQuad(shifted), true);

  // Attempt to drag top edge past bottom edge
  const clamped = moveQuadEdge(UNIT_QUAD, 0, 0, 0.95);
  assert.equal(isValidEditableQuad(clamped), true);
  assert.ok(clamped[0].y < clamped[3].y, 'Top edge must stay above bottom edge');

  // Attempt to drag left edge past x=0
  const leftClamped = moveQuadEdge(UNIT_QUAD, 3, -0.5, 0);
  assert.equal(leftClamped[0].x, 0);
  assert.equal(leftClamped[3].x, 0);
  assert.equal(isValidEditableQuad(leftClamped), true);
});

test('rotateQuadForDisplay and unrotateQuadFromDisplay round-trip accurately for all rotations', () => {
  const asymmetric: DocumentQuad = [
    { x: 0.12, y: 0.18 },
    { x: 0.85, y: 0.14 },
    { x: 0.91, y: 0.86 },
    { x: 0.08, y: 0.82 },
  ];

  const rotations: QuadRotation[] = [0, 90, 180, 270];
  for (const rot of rotations) {
    const displayed = rotateQuadForDisplay(asymmetric, rot);
    assert.equal(isValidEditableQuad(displayed), true, `displayed quad at ${rot}° must stay valid`);
    const restored = unrotateQuadFromDisplay(displayed, rot);
    for (let i = 0; i < 4; i++) {
      assert.ok(
        Math.abs(restored[i].x - asymmetric[i].x) < 1e-6,
        `x mismatch at rot=${rot}, idx=${i}`
      );
      assert.ok(
        Math.abs(restored[i].y - asymmetric[i].y) < 1e-6,
        `y mismatch at rot=${rot}, idx=${i}`
      );
    }
  }
});

test('findNearestCropHandle prioritizes corners over edges and respects radius', () => {
  // Stage 400x400: TL is at (40, 40), Top edge midpoint is at (200, 40)
  const hitCorner = findNearestCropHandle({ x: 52, y: 48 }, UNIT_QUAD, 400, 400);
  assert.deepEqual(hitCorner, { kind: 'corner', index: 0 });

  const hitEdge = findNearestCropHandle({ x: 205, y: 45 }, UNIT_QUAD, 400, 400);
  assert.deepEqual(hitEdge, { kind: 'edge', index: 0 });

  const miss = findNearestCropHandle({ x: 200, y: 200 }, UNIT_QUAD, 400, 400);
  assert.equal(miss, null);
});

test('isAxisAlignedRectQuad identifies rectangular vs perspective quads', () => {
  assert.equal(isAxisAlignedRectQuad(UNIT_QUAD), true);
  assert.equal(
    isAxisAlignedRectQuad([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]),
    true
  );
  assert.equal(
    isAxisAlignedRectQuad([
      { x: 0.15, y: 0.1 },
      { x: 0.88, y: 0.14 },
      { x: 0.92, y: 0.9 },
      { x: 0.08, y: 0.88 },
    ]),
    false
  );
});

test('computeContainedRect centers content accurately', () => {
  const landscapeInSquare = computeContainedRect(400, 400, 800, 400);
  assert.deepEqual(landscapeInSquare, { x: 0, y: 100, width: 400, height: 200 });

  const portraitInSquare = computeContainedRect(400, 400, 400, 800);
  assert.deepEqual(portraitInSquare, { x: 100, y: 0, width: 200, height: 400 });
});

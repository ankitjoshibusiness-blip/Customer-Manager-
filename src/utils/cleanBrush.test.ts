import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_CAPTURE_COOLDOWN_MS,
  AUTO_CAPTURE_HOLD_MS,
  createInitialAutoCaptureState,
  sampleLocalPaperColor,
  stepAutoCaptureState,
} from './cleanBrush';

test('sampleLocalPaperColor picks clean surrounding paper tone and ignores dark smudges', () => {
  const w = 100;
  const h = 100;
  const data = new Uint8ClampedArray(w * h * 4);

  // Fill warm white paper (244, 240, 232) everywhere
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 244;
    data[i + 1] = 240;
    data[i + 2] = 232;
    data[i + 3] = 255;
  }

  // Paint a dark smudge right at center (50, 50) radius 12
  for (let y = 38; y <= 62; y++) {
    for (let x = 38; x <= 62; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = 30;
      data[idx + 1] = 30;
      data[idx + 2] = 30;
    }
  }

  const sampled = sampleLocalPaperColor(data, w, h, 0.5, 0.5, 22);
  assert.equal(sampled, 'rgb(244, 240, 232)');
});

test('AutoCaptureTracker progresses smoothly when steady, triggers once, and enters cooldown', () => {
  let state = createInitialAutoCaptureState();

  // Not detected initially
  let res = stepAutoCaptureState(state, 1000, {
    detected: false,
    autoEnabled: true,
    movement: 1,
    scanKind: 'document',
  });
  assert.equal(res.shouldCapture, false);
  assert.equal(res.progress, 0);
  state = res.nextState;

  // Detected, moving -> starts timer
  res = stepAutoCaptureState(state, 2000, {
    detected: true,
    autoEnabled: true,
    movement: 0.08,
    scanKind: 'document',
  });
  assert.equal(res.shouldCapture, false);
  assert.equal(res.statusText, 'Hold still…');
  state = res.nextState;

  // Steady halfway through hold window
  res = stepAutoCaptureState(state, 2000 + Math.round(AUTO_CAPTURE_HOLD_MS * 0.5), {
    detected: true,
    autoEnabled: true,
    movement: 0.01,
    scanKind: 'document',
  });
  assert.equal(res.shouldCapture, false);
  assert.ok(res.progress >= 0.45 && res.progress <= 0.55);
  state = res.nextState;

  // Reaches hold threshold -> triggers capture & sets cooldown
  res = stepAutoCaptureState(state, 2000 + AUTO_CAPTURE_HOLD_MS + 10, {
    detected: true,
    autoEnabled: true,
    movement: 0.005,
    scanKind: 'document',
  });
  assert.equal(res.shouldCapture, true);
  assert.equal(res.progress, 1);
  state = res.nextState;

  // Immediately after capture -> cooldown suppresses re-capture
  res = stepAutoCaptureState(state, 2000 + AUTO_CAPTURE_HOLD_MS + 300, {
    detected: true,
    autoEnabled: true,
    movement: 0.001,
    scanKind: 'document',
  });
  assert.equal(res.shouldCapture, false);
  assert.equal(res.progress, 0);
  state = res.nextState;

  // After cooldown expires -> ready to track again
  res = stepAutoCaptureState(
    state,
    2000 + AUTO_CAPTURE_HOLD_MS + AUTO_CAPTURE_COOLDOWN_MS + 100,
    {
      detected: true,
      autoEnabled: true,
      movement: 0.005,
      scanKind: 'photo',
    }
  );
  assert.equal(res.shouldCapture, false);
  assert.ok(res.nextState.steadySince !== null);
});

test('AutoCaptureTracker never auto-captures in manual mode', () => {
  const state = createInitialAutoCaptureState();
  const res = stepAutoCaptureState(state, 5000, {
    detected: true,
    autoEnabled: false,
    movement: 0,
    scanKind: 'photo',
  });
  assert.equal(res.shouldCapture, false);
  assert.equal(res.progress, 0);
  assert.match(res.statusText, /Tap shutter/i);
});

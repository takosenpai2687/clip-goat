'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isClippedFile,
  buildClipName,
  uniquePath,
  planSegments,
  validateSegments,
} = require('../shared');

test('isClippedFile looks only at the _clip_ marker in the file name', () => {
  assert.equal(isClippedFile('Game_20261122_1430_clip_112.5s-115.8s.mp4'), true);
  assert.equal(isClippedFile('C:\\_clip_\\Game_20261122_1430.mp4'), false);
  assert.equal(isClippedFile('Game clip.mp4'), false);
});

test('buildClipName follows the template and trims decimals', () => {
  assert.equal(
    buildClipName('D:\\v\\Game_20261122_1430.mp4', [{ start: 112.5, end: 115.8 }]),
    'Game_20261122_1430_clip_112.5s-115.8s.mp4',
  );
  assert.equal(
    buildClipName('a.b.mkv', [{ start: 0, end: 3.004 }, { start: 10, end: 12.256 }]),
    'a.b_clip_0s-12.26s_2parts.mp4',
  );
});

test('uniquePath appends a counter instead of overwriting', () => {
  const taken = new Set(['x_clip_1s-2s.mp4', 'x_clip_1s-2s_2.mp4']);
  assert.equal(uniquePath('x_clip_1s-2s.mp4', (p) => taken.has(p)), 'x_clip_1s-2s_3.mp4');
  assert.equal(uniquePath('free.mp4', () => false), 'free.mp4');
});

test('planSegments: auto copies only when every start sits on a keyframe', () => {
  const kfs = [0, 2, 4, 6];
  assert.deepEqual(planSegments([{ start: 4.004, end: 5 }], kfs, 'auto', 60), {
    mode: 'copy',
    segments: [{ start: 4, end: 5 }],
  });
  assert.equal(planSegments([{ start: 4.5, end: 5 }], kfs, 'auto', 60).mode, 'encode');
  assert.equal(planSegments([{ start: 2, end: 3 }, { start: 4.5, end: 5 }], kfs, 'auto', 60).mode, 'encode');
});

test('planSegments: copy snaps starts back to the previous keyframe', () => {
  const kfs = [0, 2, 4, 6];
  assert.deepEqual(planSegments([{ start: 5.9, end: 7 }], kfs, 'copy', 60).segments, [{ start: 4, end: 7 }]);
  assert.equal(planSegments([{ start: 5, end: 7 }], [], 'copy', 60).mode, 'encode');
  assert.equal(planSegments([{ start: 4, end: 5 }], kfs, 'encode', 60).mode, 'encode');
});

test('validateSegments rejects bad ranges and clamps the end to the duration', () => {
  assert.deepEqual(validateSegments([{ start: 115, end: 130 }], 120), [{ start: 115, end: 120 }]);
  assert.throws(() => validateSegments([{ start: 5, end: 5 }], 120), /greater than start/);
  assert.throws(() => validateSegments([{ start: 121, end: 125 }], 120), /past the end/);
  assert.throws(() => validateSegments([], 120), /At least one/);
});

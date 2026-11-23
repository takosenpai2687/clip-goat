import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isClippedFile, buildClipName, uniquePath, planSegments, validateSegments, encodeOrigin, parseOrigin, lineage } from '../shared';

test('isClippedFile looks only at the _clip_ marker in the file name', () => {
  assert.equal(isClippedFile('Game_20261122_1430_clip_112.5s-115.8s.mp4'), true);
  assert.equal(isClippedFile(path.join('videos', '_clip_', 'Game_20261122_1430.mp4')), false);
  assert.equal(isClippedFile('Game clip.mp4'), false);
});

test('buildClipName ends with the total length of the clip', () => {
  assert.equal(buildClipName(path.join('videos', 'Game_20261122_1430.mp4'), [{ start: 112.5, end: 115.8 }]), 'Game_20261122_1430_clip_3.3s.mp4');
  assert.equal(
    buildClipName('a.b.mkv', [
      { start: 0, end: 3.004 },
      { start: 10, end: 12.256 },
    ]),
    'a.b_clip_5.26s.mp4',
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
  assert.equal(
    planSegments(
      [
        { start: 2, end: 3 },
        { start: 4.5, end: 5 },
      ],
      kfs,
      'auto',
      60,
    ).mode,
    'encode',
  );
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

test('lineage: a clip cut from a clip points back to the original video', () => {
  const origin = parseOrigin(
    encodeOrigin({
      source: 'Game.mp4',
      segments: [
        { start: 10, end: 14 },
        { start: 30, end: 36 },
      ],
    }),
  );
  assert.deepEqual(lineage(origin, 'Game_clip_10s-36s_2parts.mp4', [{ start: 1, end: 3 }]), {
    source: 'Game.mp4',
    segments: [{ start: 11, end: 13 }],
  });
  assert.deepEqual(lineage(origin, 'x.mp4', [{ start: 3, end: 6 }]).segments, [
    { start: 13, end: 14 },
    { start: 30, end: 32 },
  ]);
  assert.deepEqual(lineage(null, path.join('videos', 'Game.mp4'), [{ start: 1, end: 2 }]), { source: 'Game.mp4', segments: [{ start: 1, end: 2 }] });
  assert.equal(parseOrigin('some other comment'), null);
});

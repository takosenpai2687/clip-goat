import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { isClippedFile, buildClipName, uniquePath, planSegments, validateSegments, encodeOrigin, parseOrigin, lineage, clip, probe, ffmpegPath, makePreviewProxy, type AudioMode } from '../shared';

function toneAmplitudes(file: string): number[] {
  const pcm = execFileSync(ffmpegPath(), ['-v', 'error', '-i', file, '-t', '0.5', '-f', 'f32le', '-ar', '48000', '-ac', '1', 'pipe:1']);
  const end = Math.min(24000, pcm.length / 4);
  assert.ok(end > 4800, `Not enough audio samples in ${file}`);
  return [440, 880].map((frequency) => {
    let real = 0;
    let imaginary = 0;
    for (let i = 4800; i < end; i++) {
      const sample = pcm.readFloatLE(i * 4);
      real += sample * Math.cos(2 * Math.PI * frequency * i / 48000);
      imaginary += sample * Math.sin(2 * Math.PI * frequency * i / 48000);
    }
    return Math.hypot(real, imaginary) * 2 / (end - 4800);
  });
}

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

test('audio clips preserve all tracks, join ranges and can be cut again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-goat-audio-'));
  try {
    const input = path.join(dir, 'song.m4a');
    execFileSync(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=6', '-map', '0:a', '-map', '1:a', '-c:a', 'aac', input]);
    const result = await clip({ input, segments: [{ start: 0.5, end: 1.5 }, { start: 3, end: 5 }] });
    const info = await probe(result.output);
    assert.equal(path.basename(result.output), 'song_clip_3s.m4a');
    assert.equal(result.mode, 'copy');
    assert.equal(info.video, null);
    assert.equal(info.audio.length, 2);
    assert.ok(Math.abs(info.duration - 3) < 0.15, `Expected 3 seconds, got ${info.duration}`);
    const recut = await clip({ input: result.output, segments: [{ start: 0.25, end: 0.75 }], mode: 'encode' });
    assert.equal(path.basename(recut.output), 'song_clip_0.5s.m4a');
    assert.deepEqual((await probe(recut.output)).origin, { source: 'song.m4a', segments: [{ start: 0.75, end: 1.25 }] });
    assert.equal((await probe(recut.output)).audio.length, 2);
    const joined = await clip({
      input,
      segments: Array.from({ length: 12 }, (_, i) => ({ start: i * 0.4, end: i * 0.4 + 0.25 })),
      mode: 'encode',
    });
    const joinedInfo = await probe(joined.output);
    assert.ok(Math.abs(joinedInfo.duration - 3) < 0.05, `Expected 3 seconds, got ${joinedInfo.duration}`);
    assert.equal(joinedInfo.audio.length, 2);
    const selected = await clip({ input, segments: [{ start: 0, end: 2 }], audio: { mode: 'left', track: 1 } });
    const selectedInfo = await probe(selected.output);
    assert.equal(selectedInfo.audio.length, 1);
    assert.equal(selectedInfo.audio[0].channels, 1);
    const selectedTones = toneAmplitudes(selected.output);
    assert.ok(selectedTones[1] > 0.05 && selectedTones[0] < 0.005, 'Export must use track 2 (880 Hz), not track 1');
    const selectedCopy = await clip({ input, segments: [{ start: 0, end: 2 }], audio: { mode: 'original', track: 1 } });
    assert.equal(selectedCopy.mode, 'copy');
    assert.equal((await probe(selectedCopy.output)).audio.length, 1);
    const preview = path.join(dir, 'selected-preview.mp4');
    await makePreviewProxy({ input, output: preview, level: 'transcode', audioOnly: true, audioTrack: 1, duration: 6 });
    assert.equal((await probe(preview)).audio.length, 1);
    const previewTones = toneAmplitudes(preview);
    assert.ok(previewTones[1] > 0.05 && previewTones[0] < 0.005, 'Preview must use the same selected track as export');
    await assert.rejects(clip({ input, segments: [{ start: 0, end: 1 }], audio: { mode: 'right', track: 0 } }), { code: 'BAD_AUDIO' });
    await assert.rejects(clip({ input, segments: [{ start: 0, end: 1 }], audio: { mode: 'original', track: 2 } }), { code: 'BAD_AUDIO' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('channel modes write mono with the intended signal, including joined ranges', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-goat-channels-'));
  try {
    const input = path.join(dir, 'stereo.wav');
    execFileSync(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i',
      'aevalsrc=0.3*sin(2*PI*440*t)|0.1*sin(2*PI*880*t):s=48000:d=3', input]);
    for (const mode of ['mono', 'left', 'right'] satisfies AudioMode[]) {
      const result = await clip({ input, segments: [{ start: 0.25, end: 0.75 }, { start: 1.25, end: 2.25 }], audio: { mode } });
      assert.equal(result.mode, 'encode');
      assert.ok(Math.abs(result.duration - 1.5) < 0.05);
      assert.equal((await probe(result.output)).audio[0].channels, 1);
      const tones = toneAmplitudes(result.output);
      const expected = mode === 'mono' ? [0.15, 0.05] : mode === 'left' ? [0.3, 0] : [0, 0.1];
      tones.forEach((amplitude, i) => assert.ok(Math.abs(amplitude - expected[i]) < 0.015, `${mode}: ${i} amplitude ${amplitude}`));
    }
    const video = path.join(dir, 'video.mp4');
    execFileSync(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=1',
      '-i', input, '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', video]);
    const processed = await clip({ input: video, segments: [{ start: 0, end: 1 }], audio: { mode: 'right' } });
    const videoHash = (file: string) => execFileSync(ffmpegPath(), ['-v', 'error', '-i', file, '-map', '0:v:0',
      '-c', 'copy', '-f', 'hash', '-hash', 'md5', 'pipe:1'], { encoding: 'utf8' });
    assert.equal(videoHash(processed.output), videoHash(video), 'Channel processing must not re-encode copyable video');
    assert.equal((await probe(processed.output)).audio[0].channels, 1);
    const processedTones = toneAmplitudes(processed.output);
    assert.ok(processedTones[1] > 0.05 && processedTones[0] < 0.005, 'Copied video must still get the requested audio effect');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('audio copy with excessive seek preroll falls back to the original format and can build a preview', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-goat-audio-'));
  try {
    const input = path.join(dir, 'recording.ogg');
    execFileSync(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=4', '-ac', '2', '-c:a', 'libvorbis', input]);
    const result = await clip({ input, segments: [{ start: 0.5, end: 2.5 }] });
    const info = await probe(result.output);
    assert.equal(result.fellBack, true);
    assert.equal(result.mode, 'encode');
    assert.equal(info.video, null);
    assert.equal(path.extname(result.output), '.ogg');
    assert.equal(info.audio[0].codec, 'vorbis');
    assert.equal(info.audio[0].channels, 2);
    assert.ok(Math.abs(info.duration - 2) < 0.1);
    const preview = path.join(dir, 'preview.mp4');
    await makePreviewProxy({ input, output: preview, level: 'transcode', audioOnly: true, duration: 4 });
    const previewInfo = await probe(preview);
    assert.equal(previewInfo.video, null);
    assert.equal(previewInfo.audio[0].codec, 'aac');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('audio exports retain the input format when copying, encoding and processing channels', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-goat-formats-'));
  try {
    const formats = [
      ['mp3', 'libmp3lame', 'mp3'], ['m4a', 'aac', 'aac'], ['aac', 'aac', 'aac'],
      ['wav', 'pcm_s24le', 'pcm_s24le'], ['flac', 'flac', 'flac'], ['ogg', 'libvorbis', 'vorbis'],
      ['opus', 'libopus', 'opus'], ['aiff', 'pcm_s24be', 'pcm_s24be'], ['aif', 'pcm_s24be', 'pcm_s24be'],
      ['wma', 'wmav2', 'wmav2'],
    ];
    for (const [ext, encoder, codec] of formats) {
      const input = path.join(dir, `input.${ext}`);
      execFileSync(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i',
        'aevalsrc=0.3*sin(2*PI*440*t)|0.1*sin(2*PI*880*t):s=48000:d=3', '-c:a', encoder, input]);
      const result = await clip({
        input, segments: [{ start: 0.25, end: 0.75 }, { start: 1.25, end: 2.25 }], audio: { mode: 'right' },
      });
      const info = await probe(result.output);
      assert.equal(path.extname(result.output), `.${ext}`);
      assert.equal(info.audio[0].codec, codec, ext);
      assert.equal(info.audio[0].channels, 1, ext);
      assert.equal(info.origin?.source, `input.${ext}`, `${ext}: source metadata`);
      const tones = toneAmplitudes(result.output);
      assert.ok(tones[1] > 0.05 && tones[0] < 0.01, `${ext}: output must contain the right channel`);
      if (ext === 'aac' || ext === 'ogg') {
        const recut = await clip({ input: result.output, segments: [{ start: 0.1, end: 0.5 }] });
        assert.equal(path.extname(recut.output), `.${ext}`);
        assert.equal((await probe(recut.output)).origin?.source, `input.${ext}`);
      }
    }
    const mp3 = path.join(dir, 'input.mp3');
    const copied = await clip({ input: mp3, segments: [{ start: 0, end: 2 }] });
    assert.equal(path.extname(copied.output), '.mp3');
    assert.equal((await probe(copied.output)).audio[0].codec, 'mp3');
    assert.equal(copied.mode, 'copy');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('video channel processing keeps audio in sync and preserves the usual video export strategy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-goat-video-audio-'));
  try {
    const input = path.join(dir, 'sync.mp4');
    execFileSync(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i',
      "color=black:s=160x90:r=30:d=4,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,1.5,2.0)'",
      '-f', 'lavfi', '-i',
      'aevalsrc=if(between(t\\,1.5\\,2.0)\\,0.3*sin(2*PI*220*t)\\,0)|if(between(t\\,1.5\\,2.0)\\,0.3*sin(2*PI*440*t)\\,0):s=48000:d=4',
      '-f', 'lavfi', '-i',
      'aevalsrc=if(between(t\\,1.5\\,2.0)\\,0.3*sin(2*PI*660*t)\\,0)|if(between(t\\,1.5\\,2.0)\\,0.3*sin(2*PI*880*t)\\,0):s=48000:d=4',
      '-map', '0:v', '-map', '1:a', '-map', '2:a',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', input]);
    const frame = (file: string, time: number) => execFileSync(ffmpegPath(), [
      '-v', 'error', '-i', file, '-ss', String(time), '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1',
    ])[0];
    const volume = (file: string, time: number) => {
      const pcm = execFileSync(ffmpegPath(), ['-v', 'error', '-i', file, '-ss', String(time), '-t', '0.1', '-ac', '1', '-f', 'f32le', 'pipe:1']);
      let sum = 0;
      for (let i = 0; i < pcm.length; i += 4) sum += pcm.readFloatLE(i) ** 2;
      return Math.sqrt(sum / (pcm.length / 4));
    };
    const tone = (file: string, time: number, frequency: number) => {
      const pcm = execFileSync(ffmpegPath(), ['-v', 'error', '-i', file, '-ss', String(time), '-t', '0.1',
        '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
      let real = 0;
      let imaginary = 0;
      for (let i = 0; i < pcm.length / 4; i++) {
        real += pcm.readFloatLE(i * 4) * Math.cos(2 * Math.PI * frequency * i / 48000);
        imaginary += pcm.readFloatLE(i * 4) * Math.sin(2 * Math.PI * frequency * i / 48000);
      }
      return Math.hypot(real, imaginary) * 2 / (pcm.length / 4);
    };
    const videoHash = (file: string) => execFileSync(ffmpegPath(), ['-v', 'error', '-i', file, '-map', '0:v:0',
      '-c', 'copy', '-f', 'hash', '-hash', 'md5', 'pipe:1'], { encoding: 'utf8' });
    for (const [start, expectedMode] of [[1, 'copy'], [1.2, 'encode']] as const) {
      const result = await clip({ input, segments: [{ start, end: 3 }], audio: { mode: 'right', track: 1 } });
      const before = 1.5 - start - 0.15;
      const during = 1.5 - start + 0.15;
      assert.equal(path.extname(result.output), '.mp4');
      assert.equal(result.mode, 'encode');
      assert.equal((await probe(result.output)).audio[0].channels, 1);
      assert.ok(frame(result.output, before) < 40 && frame(result.output, during) > 200, expectedMode);
      assert.ok(volume(result.output, before) < 0.01 && volume(result.output, during) > 0.1, expectedMode);
      assert.ok(tone(result.output, during, 880) > 0.2 && tone(result.output, during, 440) < 0.02, 'must use the right channel of track 2');
      const plain = await clip({ input, segments: [{ start, end: 3 }] });
      assert.equal(plain.mode, expectedMode);
      assert.equal(videoHash(result.output), videoHash(plain.output), `${expectedMode}: audio processing changed video`);
    }
    const segments = [{ start: 0, end: 1 }, { start: 1, end: 3 }];
    const joined = await clip({ input, segments, audio: { mode: 'right', track: 1 } });
    assert.ok(frame(joined.output, 1.35) < 40 && frame(joined.output, 1.65) > 200);
    assert.ok(volume(joined.output, 1.35) < 0.01 && volume(joined.output, 1.65) > 0.1);
    assert.ok(tone(joined.output, 1.65, 880) > 0.2 && tone(joined.output, 1.65, 440) < 0.02);
    const joinedPlain = await clip({ input, segments });
    assert.equal(joinedPlain.mode, 'copy');
    assert.equal(videoHash(joined.output), videoHash(joinedPlain.output), 'Joining with audio processing changed video');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

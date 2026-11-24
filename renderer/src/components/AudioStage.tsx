import { useEffect, useId, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronDown, Headphones, Music2 } from 'lucide-react';
import { AUDIO_MODES, channelGains, supportsAudioMode } from '../../../shared/audio';
import type { AudioSettings, MediaDoc, Theme } from '../../../shared/types';
import { useAudioPreview } from '../lib/useAudioPreview';
import { useT } from '../lib/i18n';

interface AudioStageProps {
  doc: MediaDoc;
  media: HTMLMediaElement | null;
  settings: AudioSettings;
  playing: boolean;
  ready: boolean;
  locked: boolean;
  visible: boolean;
  theme: Theme;
  onChange: (settings: AudioSettings) => void;
  onToggle: () => void;
}

export default function AudioStage({ doc, media, settings, playing, ready, locked, visible, theme, onChange, onToggle }: AudioStageProps) {
  const t = useT();
  const id = useId();
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const snapshot = useRef({ media, samples: [new Float32Array(512), new Float32Array(512)], hasSignal: false });
  const [error, setError] = useState('');
  const tracks = settings.track === undefined ? doc.info.audio : [doc.info.audio[settings.track]];
  const channels = tracks[0].channels;
  const graph = useAudioPreview(media, settings.mode, channels, (err) => {
    setError(`${t.audioPreviewError}: ${err instanceof Error ? err.message : String(err)}`);
  });
  const names = { original: t.audioOriginal, mono: t.audioMono, left: t.audioLeft, right: t.audioRight };
  const hints = { original: t.audioOriginalHint, mono: t.audioMonoHint, left: t.audioLeftHint, right: t.audioRightHint };
  const sources = { original: 'L  R', mono: 'L+R', left: 'L', right: 'R' };
  const scopeNote = channels > 2
    ? settings.track === undefined && doc.info.audio.length > 1 ? `${t.audioAllTracksHint} · ${t.audioSurroundScope}` : t.audioSurroundScope
    : settings.track === undefined && doc.info.audio.length > 1
      ? settings.mode === 'original' ? t.audioAllTracksHint : t.audioAllTracksProcessed
      : settings.mode === 'original' ? '' : t.audioProcessedScope;

  useEffect(() => {
    const el = canvas.current;
    if (!el || !visible) return;
    const context = el.getContext('2d');
    if (!context) return;
    if (snapshot.current.media !== media) {
      snapshot.current = { media, samples: [new Float32Array(512), new Float32Array(512)], hasSignal: false };
    }
    let frame = 0;
    let previous = -Infinity;
    const frozen = snapshot.current;
    const gains = channelGains(settings.mode, channels);
    const styles = getComputedStyle(el);
    const accent = styles.getPropertyValue('--accent').trim();
    const muted = styles.getPropertyValue('--faint').trim();
    const draw = (stamp: number) => {
      if (stamp - previous >= (reduced ? 250 : 1000 / 30)) {
        previous = stamp;
        const width = el.clientWidth;
        const height = el.clientHeight;
        context.clearRect(0, 0, el.width, el.height);
        let peak = 0;
        frozen.samples.forEach((data, ear) => {
          if (playing && ready && graph.current) {
            graph.current.inputs[ear].getFloatTimeDomainData(data);
            frozen.hasSignal = true;
          }
          for (const sample of data) peak = Math.max(peak, Math.abs(sample));
        });
        const scale = peak > 0 ? Math.min(3, 0.9 / peak) : 1;
        for (let ear = 0; ear < 2; ear++) {
          const [a, b] = [gains[ear * 2], gains[ear * 2 + 1]];
          const left = ear * (width / 2 + 16);
          const span = width / 2 - 16;
          const middle = height / 2;
          context.strokeStyle = muted;
          context.globalAlpha = 0.22;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(left, middle);
          context.lineTo(left + span, middle);
          context.stroke();
          context.globalAlpha = 1;
          context.lineJoin = 'round';
          context.lineCap = 'round';
          context.beginPath();
          for (let i = 0; i < frozen.samples[0].length; i++) {
            const x = left + i / (frozen.samples[0].length - 1) * span;
            const value = frozen.samples[0][i] * a + frozen.samples[1][i] * b;
            const y = middle - value * scale * height * 0.42;
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.strokeStyle = accent;
          context.lineWidth = 7;
          context.globalAlpha = frozen.hasSignal ? 0.10 : 0.04;
          context.shadowColor = accent;
          context.shadowBlur = frozen.hasSignal ? 18 : 0;
          context.stroke();
          context.shadowBlur = 0;
          context.globalAlpha = frozen.hasSignal ? 0.85 : 0.5;
          context.lineWidth = 1.5;
          context.stroke();
          if (frozen.hasSignal && playing && ready && !reduced) {
            const pulse = ((stamp / 2500 + ear * 0.35) % 1) * 1.4 - 0.2;
            const gradient = context.createLinearGradient(left, 0, left + span, 0);
            const start = Math.max(0, pulse - 0.13);
            const end = Math.min(1, pulse + 0.13);
            if (start < end) {
              gradient.addColorStop(0, 'transparent');
              gradient.addColorStop(start, 'transparent');
              gradient.addColorStop(Math.max(0, Math.min(1, pulse)), '#ffffff');
              gradient.addColorStop(end, 'transparent');
              gradient.addColorStop(1, 'transparent');
              context.strokeStyle = gradient;
              context.lineWidth = 2.5;
              context.globalAlpha = 0.85;
              context.shadowColor = accent;
              context.shadowBlur = 12;
              context.stroke();
              context.shadowBlur = 0;
            }
          }
        }
        context.globalAlpha = 1;
      }
      if (playing && ready) frame = requestAnimationFrame(draw);
    };
    const resize = () => {
      const scale = window.devicePixelRatio || 1;
      el.width = Math.round(el.clientWidth * scale);
      el.height = Math.round(el.clientHeight * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      previous = -Infinity;
      if (!playing || !ready) draw(0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    if (playing && ready) frame = requestAnimationFrame(draw);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [graph, media, playing, ready, reduced, theme, settings.mode, channels, visible]);

  return (
    <div className={`audio-stage${visible ? '' : ' is-hidden'}`} inert={locked || !visible} aria-hidden={!visible}>
      <header className="audio-heading">
        <div className="audio-file">
          <Music2 size={18} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <p className="audio-filename" title={doc.name}>{doc.name}</p>
            <p className="audio-meta">{doc.info.audio[settings.track ?? 0].codec.toUpperCase()} · {t.audioChannels(channels)}</p>
          </div>
        </div>
        {doc.info.audio.length > 1 && (
          <label className="audio-track">
            <span className="sr-only">{t.audioTrack}</span>
            <select value={settings.track ?? 'all'} onChange={(event) => onChange({ ...settings, track: event.target.value === 'all' ? undefined : Number(event.target.value) })}>
              <option value="all">{t.audioAllTracks}</option>
              {doc.info.audio.map((track, i) => <option key={i} value={i}>{t.audioTrackName(i + 1)} · {t.audioChannels(track.channels)}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
        )}
      </header>

      <button type="button" className="audio-signal" disabled={!ready} onClick={onToggle}
        aria-label={`${playing ? t.pause : t.play} · ${t.audioSignal}`} title={playing ? t.pause : t.play}>
        <span className="audio-ear-labels">
          {[t.audioEarLeft, t.audioEarRight].map((label, i) => (
            <span key={i}>
              <span className="audio-ear" aria-label={label}>{i === 0 ? 'L' : 'R'}</span>
            </span>
          ))}
        </span>
        <canvas ref={canvas} aria-hidden="true" />
      </button>

      <div className="audio-settings">
        <div className="audio-modes" role="group" aria-label={t.audioMode}>
          {AUDIO_MODES.map((mode) => {
            const disabled = tracks.some((track) => !supportsAudioMode(mode, track.channels));
            return (
              <button key={mode} type="button" className={settings.mode === mode ? 'is-selected' : ''} aria-pressed={settings.mode === mode}
                aria-label={names[mode]} disabled={disabled} title={disabled ? `${names[mode]} · ${t.audioUnsupported}` : `${names[mode]} · ${hints[mode]}`} onClick={() => onChange({ ...settings, mode })}>
                {settings.mode === mode && <motion.span className="audio-mode-active" layoutId={`audio-mode-${id}`} transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                <span className="audio-mode-icon" aria-hidden="true">
                  <Headphones size={25} strokeWidth={1.6} />
                  <span>{sources[mode]}</span>
                </span>
                <span className="audio-mode-name">{names[mode]}</span>
              </button>
            );
          })}
        </div>
        <p className="audio-scope-note" title={scopeNote}>{scopeNote}</p>
        {error && <p className="audio-preview-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

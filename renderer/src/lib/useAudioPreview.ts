import { useEffect, useRef } from 'react';
import { channelGains } from '../../../shared/audio';
import type { AudioMode } from '../../../shared/types';

interface AudioGraph {
  media: HTMLMediaElement;
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  input: GainNode;
  passthrough: GainNode;
  splitter: ChannelSplitterNode;
  merger: ChannelMergerNode;
  gains: GainNode[];
  inputs: [AnalyserNode, AnalyserNode];
  analysers: [AnalyserNode, AnalyserNode];
  dispose?: number;
}

export function useAudioPreview(media: HTMLMediaElement | null, mode: AudioMode, channels: number, onError: (err: unknown) => void) {
  const graph = useRef<AudioGraph | null>(null);
  const report = useRef(onError);
  report.current = onError;

  useEffect(() => {
    if (!media) return;
    let current = graph.current;
    let pending: AudioContext | null = null;
    try {
      if (!current || current.media !== media) {
        const context = new AudioContext();
        pending = context;
        const source = context.createMediaElementSource(media);
        const input = context.createGain();
        const passthrough = context.createGain();
        passthrough.gain.value = 0;
        input.channelCount = 2;
        input.channelCountMode = 'explicit';
        input.channelInterpretation = 'speakers';
        const splitter = context.createChannelSplitter(2);
        const merger = context.createChannelMerger(2);
        const inputs: [AnalyserNode, AnalyserNode] = [context.createAnalyser(), context.createAnalyser()];
        const analysers: [AnalyserNode, AnalyserNode] = [context.createAnalyser(), context.createAnalyser()];
        [...inputs, ...analysers].forEach((analyser) => { analyser.fftSize = 512; });
        inputs.forEach((analyser, i) => splitter.connect(analyser, i));
        const gains = Array.from({ length: 4 }, (_, i) => {
          const gain = context.createGain();
          gain.gain.value = 0;
          inputs[i % 2].connect(gain);
          gain.connect(analysers[i < 2 ? 0 : 1]);
          return gain;
        });
        source.connect(input);
        source.connect(passthrough);
        passthrough.connect(context.destination);
        input.connect(splitter);
        analysers.forEach((analyser, i) => analyser.connect(merger, 0, i));
        merger.connect(context.destination);
        current = { media, context, source, input, passthrough, splitter, merger, gains, inputs, analysers };
        graph.current = current;
        pending = null;
      }
      clearTimeout(current.dispose);
    } catch (err) {
      if (pending) void pending.close().catch((closeError) => console.error('Cannot close audio preview:', closeError));
      media.pause();
      report.current(err);
      return;
    }

    const active = current;
    const resume = () => {
      if (active.context.state === 'suspended') active.context.resume().catch((err) => {
        media.pause();
        report.current(err);
      });
    };
    media.addEventListener('play', resume);
    if (!media.paused) resume();
    return () => {
      media.removeEventListener('play', resume);
      // StrictMode remounts effects without replacing the element; it can only have one source node.
      active.dispose = window.setTimeout(() => {
        active.source.disconnect();
        active.input.disconnect();
        active.passthrough.disconnect();
        active.splitter.disconnect();
        active.gains.forEach((gain) => gain.disconnect());
        active.inputs.forEach((analyser) => analyser.disconnect());
        active.analysers.forEach((analyser) => analyser.disconnect());
        active.merger.disconnect();
        void active.context.close().catch((err) => console.error('Cannot close audio preview:', err));
        if (graph.current === active) graph.current = null;
      }, 0);
    };
  }, [media]);

  useEffect(() => {
    const current = graph.current;
    if (!current || current.media !== media) return;
    const surround = mode === 'original' && channels > 2;
    current.passthrough.gain.cancelScheduledValues(current.context.currentTime);
    current.passthrough.gain.setTargetAtTime(surround ? 1 : 0, current.context.currentTime, 0.015);
    channelGains(mode, channels).forEach((value, i) => {
      const gain = current.gains[i].gain;
      gain.cancelScheduledValues(current.context.currentTime);
      gain.setTargetAtTime(surround ? 0 : value, current.context.currentTime, 0.015);
    });
  }, [media, mode, channels]);

  return graph;
}

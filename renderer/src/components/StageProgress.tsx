import { memo, useState, type PointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useT } from '../lib/i18n';
import { formatTime } from '../lib/format';

interface StageProgressProps {
  visible: boolean;
  time: number;
  duration: number;
  onSeek: (time: number) => void;
}

// A thin bar along the bottom edge of the picture. It always spans the whole video,
// whatever the zoom of the timeline below, and can be dragged to seek.
function StageProgress({ visible, time, duration, onSeek }: StageProgressProps) {
  const t = useT();
  const [dragging, setDragging] = useState(false);

  const seekTo = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onSeek(Math.min(ratio * duration, Math.max(0, duration - 0.01)));
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    seekTo(event);
  };

  return (
    <AnimatePresence>
      {(visible || dragging) && duration > 0 && (
        <motion.div
          key="progress"
          className={`stage-progress${dragging ? ' is-dragging' : ''}`}
          style={{ '--at': `${Math.min(100, (time / duration) * 100)}%` }}
          role="slider"
          tabIndex={-1}
          aria-label={t.seekBar}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={formatTime(time)}
          onPointerDown={onDown}
          onPointerMove={(event) => dragging && seekTo(event)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <div className="stage-progress-track">
            <div className="stage-progress-fill" />
          </div>
          <div className="stage-progress-thumb" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default memo(StageProgress);

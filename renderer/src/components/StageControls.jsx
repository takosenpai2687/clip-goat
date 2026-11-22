import { memo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pause, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from 'lucide-react';
import Menu from './Menu';
import { useT } from '../lib/i18n';

export const SKIP_CHOICES = [5, 10, 15, 30, 60];
export const RATE_CHOICES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.16 } };

// Controls that float over the picture while the pointer is on it:
// play/pause and skip in the middle, volume and speed in the bottom-left corner.
function StageControls({ visible, playing, skip, onToggle, onSkip, onSkipChange, volume, muted, onVolume, onMute, rate, onRate }) {
  const t = useT();
  const [menu, setMenu] = useState(null);
  const silent = muted || volume === 0;

  const openSkipMenu = (event) => {
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: SKIP_CHOICES.map((n) => ({ label: t.skipSeconds(n), checked: n === skip, onSelect: () => onSkipChange(n) })),
    });
  };

  const openRateMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.top - 20 - RATE_CHOICES.length * 34,
      items: RATE_CHOICES.map((n) => ({ label: `${n}×`, checked: n === rate, onSelect: () => onRate(n) })),
    });
  };

  const side = (dir) => (
    <button
      type="button"
      className="stage-button is-side"
      onClick={() => onSkip(dir)}
      onContextMenu={openSkipMenu}
      aria-label={dir < 0 ? t.rewind(skip) : t.forward(skip)}
      title={`${dir < 0 ? t.rewind(skip) : t.forward(skip)}\n${t.skipHint}`}
    >
      {dir < 0 ? <RotateCcw size={34} strokeWidth={1.5} /> : <RotateCw size={34} strokeWidth={1.5} />}
      <span className="skip-amount num">{skip}</span>
    </button>
  );

  return (
    <>
      <AnimatePresence>
        {(visible || menu) && (
          <motion.div
            key="controls"
            className="stage-controls"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            {side(-1)}
            <button type="button" className="stage-button is-main" onClick={onToggle} aria-label={playing ? t.pause : t.play} title={playing ? t.pause : t.play}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={playing ? 'pause' : 'play'}
                  className="button-icon"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.1 }}
                >
                  {playing ? <Pause size={30} strokeWidth={1.5} /> : <Play size={30} strokeWidth={1.5} />}
                </motion.span>
              </AnimatePresence>
            </button>
            {side(1)}
          </motion.div>
        )}

        {(visible || menu) && (
          <motion.div key="corner" className="stage-corner" {...fade}>
            <button
              type="button"
              className={`corner-button is-rate num${rate !== 1 ? ' is-changed' : ''}`}
              onClick={openRateMenu}
              aria-label={t.speed}
              title={t.speedTip}
            >
              {rate}×
            </button>
            <div className="volume">
              <button type="button" className="corner-button" onClick={onMute} aria-label={silent ? t.unmute : t.mute} title={silent ? t.unmute : t.mute}>
                {silent ? (
                  <VolumeX size={16} strokeWidth={1.5} />
                ) : volume < 0.5 ? (
                  <Volume1 size={16} strokeWidth={1.5} />
                ) : (
                  <Volume2 size={16} strokeWidth={1.5} />
                )}
              </button>
              <input
                className="volume-slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                style={{ '--fill': `${(muted ? 0 : volume) * 100}%` }}
                aria-label={t.volume}
                title={`${t.volume} ${Math.round((muted ? 0 : volume) * 100)}%`}
                onChange={(event) => onVolume(Number(event.target.value))}
                onPointerUp={(event) => event.currentTarget.blur()}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{menu && <Menu key="menu" {...menu} onClose={() => setMenu(null)} />}</AnimatePresence>
    </>
  );
}

export default memo(StageControls);

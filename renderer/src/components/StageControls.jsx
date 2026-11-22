import { memo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import Menu from './Menu';
import { useT } from '../lib/i18n';

export const SKIP_CHOICES = [5, 10, 15, 30, 60];

// Play/pause and skip buttons that float over the picture while the pointer is on it.
function StageControls({ visible, playing, skip, onToggle, onSkip, onSkipChange }) {
  const t = useT();
  const [menu, setMenu] = useState(null);

  const openMenu = (event) => {
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: SKIP_CHOICES.map((n) => ({ label: t.skipSeconds(n), checked: n === skip, onSelect: () => onSkipChange(n) })),
    });
  };

  const side = (dir) => (
    <button
      type="button"
      className="stage-button is-side"
      onClick={() => onSkip(dir)}
      onContextMenu={openMenu}
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
      </AnimatePresence>
      <AnimatePresence>{menu && <Menu key="menu" {...menu} onClose={() => setMenu(null)} />}</AnimatePresence>
    </>
  );
}

export default memo(StageControls);

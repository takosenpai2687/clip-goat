import { memo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, CornerDownLeft, Crosshair, FolderInput, Trash2, X, Zap } from 'lucide-react';
import Menu from './Menu';
import { formatLength, formatTime } from '../lib/format';
import { useT } from '../lib/i18n';

const swap = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.16 },
};

const baseName = (dir) => (dir || '').split(/[\\/]/).filter(Boolean).pop() || '';

function ExportBar({ segments, length, plan, canSnap, onSnap, dest, onDest, onChooseDest, state, onExport, onCancel, onShow, onDismiss, onDeleteSource }) {
  const t = useT();
  const [menu, setMenu] = useState(null);
  const figure = formatLength(length);
  const first = segments[0];
  const last = segments[segments.length - 1];
  const running = state.status === 'running';
  const idle = state.status !== 'done' && !running;

  const openDestMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.top - 8 - 40 * (dest ? 3 : 2),
      items: [
        { label: t.besideSource, checked: !dest, onSelect: () => onDest(null) },
        ...(dest ? [{ label: baseName(dest), checked: true, onSelect: () => onDest(dest) }] : []),
        { label: t.chooseFolder, onSelect: onChooseDest },
      ],
    });
  };

  return (
    <div className="export-bar">
      <div className="clip-length">
        <p className="figure num">
          {figure.value}
          {figure.unit && <span className="unit">{t.seconds}</span>}
        </p>
        <p className="figure-note num">
          {segments.length > 1 ? t.ranges(segments.length) : `${formatTime(first.start)} – ${formatTime(last.end)}`}
        </p>
      </div>

      <div className="export-status" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {state.status === 'error' ? (
            <motion.p key="error" className="status-line is-error" {...swap}>
              {state.message}
            </motion.p>
          ) : state.status === 'done' ? (
            <motion.p key="done" className="status-line" {...swap}>
              <span className="out-name is-done" title={state.result.output}>
                <Check size={14} strokeWidth={2} aria-hidden="true" />
                <span>{state.result.output.split(/[\\/]/).pop()}</span>
              </span>
              <span className="status-sub">{state.result.fellBack ? t.fellBack : t.askDelete}</span>
            </motion.p>
          ) : (
            <motion.p key="idle" className="status-line" {...swap}>
              <span className="out-name" title={plan.name}>
                {plan.name}
              </span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {idle && (
        <button type="button" className="chip" onClick={openDestMenu} title={`${t.exportTo}: ${plan.dir || ''}`} aria-label={t.exportTo}>
          <FolderInput size={14} strokeWidth={1.5} />
          <span className="chip-text">{baseName(plan.dir) || t.besideSource}</span>
        </button>
      )}

      {idle && (
        <button
          type="button"
          className={`chip${plan.mode === 'copy' ? ' is-instant' : ''}`}
          onClick={plan.mode === 'encode' && canSnap ? onSnap : undefined}
          disabled={plan.mode === 'copy' || !canSnap}
          title={plan.mode === 'copy' ? t.instantTip : t.exactTip}
        >
          {plan.mode === 'copy' ? <Zap size={14} strokeWidth={1.5} /> : <Crosshair size={14} strokeWidth={1.5} />}
          {plan.mode === 'copy' ? t.instant : t.exact}
        </button>
      )}

      <motion.div layout className="export-action" transition={{ type: 'spring', stiffness: 520, damping: 40 }}>
        <AnimatePresence mode="wait" initial={false}>
          {running ? (
            <motion.div key="running" className="progress" {...swap}>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(state.percent)}
                aria-label={t.exporting}
              >
                <motion.div
                  className="progress-fill"
                  animate={{ scaleX: Math.max(0.02, state.percent / 100) }}
                  transition={{ ease: 'easeOut', duration: 0.25 }}
                />
                <span className="progress-label num">
                  {state.mode === 'encode' ? t.encoding : t.exporting} {Math.round(state.percent)}%
                </span>
              </div>
              <button type="button" className="icon-button" onClick={onCancel} aria-label={t.cancel} title={`${t.cancel} (Esc)`}>
                <X size={16} strokeWidth={1.5} />
              </button>
            </motion.div>
          ) : state.status === 'done' ? (
            <motion.div key="done" className="done" {...swap}>
              <button type="button" className="ghost-button" onClick={onShow}>
                {t.showInFolder}
              </button>
              <button type="button" className="ghost-button" onClick={onDismiss} title="Esc">
                {t.keepSource}
              </button>
              <motion.button
                type="button"
                className="danger-button"
                onClick={onDeleteSource}
                title={t.deleteSourceTip}
                whileTap={{ scale: 0.97 }}
                initial={{ scale: 0.92 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 520, damping: 20 }}
              >
                <Trash2 size={16} strokeWidth={1.75} />
                {t.deleteSource}
              </motion.button>
            </motion.div>
          ) : (
            <motion.button
              key="idle"
              type="button"
              className="primary-button"
              onClick={onExport}
              title={t.exportTip}
              whileHover="hover"
              whileTap={{ scale: 0.97 }}
              {...swap}
            >
              {state.status === 'error' ? t.retry : t.export}
              <motion.span
                className="button-icon is-hint"
                variants={{ hover: { x: -2, y: 2 } }}
                transition={{ type: 'spring', stiffness: 500, damping: 18 }}
              >
                <CornerDownLeft size={14} strokeWidth={2} />
              </motion.span>
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>{menu && <Menu key="menu" {...menu} onClose={() => setMenu(null)} />}</AnimatePresence>
    </div>
  );
}

export default memo(ExportBar);

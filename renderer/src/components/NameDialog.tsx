import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useT } from '../lib/i18n';

const BAD_NAME = /[\\/:*?"<>|]/;

// Asks for the clip's file name before exporting. Only the name is editable; the extension is fixed.
interface NameDialogProps {
  stem: string;
  ext: string;
  dir: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export default function NameDialog({ stem, ext, dir, onConfirm, onCancel }: NameDialogProps) {
  const t = useT();
  const [value, setValue] = useState(stem);
  const input = useRef<HTMLInputElement>(null);
  const name = value.trim();
  const invalid = !name || BAD_NAME.test(name) || name.endsWith('.');

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!invalid) onConfirm(name);
  };

  return (
    <motion.div
      className="dialog-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      onPointerDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <motion.form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-dialog-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onCancel();
          if (event.key === 'Enter' && event.repeat) event.preventDefault();
        }}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      >
        <h2 id="name-dialog-title">{t.nameTitle}</h2>
        <label className={`name-field${invalid ? ' is-invalid' : ''}`}>
          <input
            ref={input}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            aria-label={t.nameLabel}
            aria-describedby="name-dialog-note"
          />
          <span className="name-ext">{ext}</span>
        </label>
        <p id="name-dialog-note" className={`dialog-note${invalid ? ' is-error' : ''}`}>
          {invalid ? t.errBadName : name.includes('_clip_') ? t.nameSavedTo(dir) : t.nameNoMarker}
        </p>
        <div className="dialog-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            {t.cancel}
          </button>
          <button type="submit" className="primary-button" disabled={invalid}>
            {t.export}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}

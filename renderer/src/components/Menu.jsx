import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';

// A small floating menu at a screen position. Items: { label, onSelect, confirm?, danger?, checked? }.
export default function Menu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [armed, setArmed] = useState(null);

  useLayoutEffect(() => {
    const rect = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <motion.div
      ref={ref}
      className="menu"
      role="menu"
      style={pos}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.12 }}
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`menu-item${item.danger ? ' is-danger' : ''}${item.checked ? ' is-checked' : ''}`}
          onClick={() => {
            if (item.confirm && armed !== i) {
              setArmed(i);
              return;
            }
            onClose();
            item.onSelect();
          }}
        >
          {armed === i ? item.confirm : item.label}
        </button>
      ))}
    </motion.div>,
    document.body,
  );
}

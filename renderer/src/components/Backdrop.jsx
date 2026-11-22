import { useEffect, useRef } from 'react';

// Slow drifting colour fields plus one large glow that trails the pointer. Sits behind the glass panels.
export default function Backdrop({ quiet }) {
  const glow = useRef(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const target = { x: window.innerWidth * 0.6, y: window.innerHeight * 0.4 };
    const current = { ...target };
    let raf = 0;

    const step = () => {
      current.x += (target.x - current.x) * 0.08;
      current.y += (target.y - current.y) * 0.08;
      glow.current.style.transform = `translate3d(${current.x}px, ${current.y}px, 0)`;
      // Stop the loop once the glow has caught up; the next pointer move restarts it.
      raf = Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.5 ? requestAnimationFrame(step) : 0;
    };
    const onMove = (event) => {
      target.x = event.clientX;
      target.y = event.clientY;
      if (!raf) raf = requestAnimationFrame(step);
    };

    step();
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className={`backdrop${quiet ? ' is-quiet' : ''}`} aria-hidden="true">
      <div className="blob blob-a" />
      <div className="blob blob-b" />
      <div className="blob blob-c" />
      <div ref={glow} className="glow" />
    </div>
  );
}

import { memo } from 'react';
import { FilePlus, Moon, PanelLeft, Sun } from 'lucide-react';
import { useT } from '../lib/i18n';

function Mark() {
  return (
    <svg className="mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="0" y="6" width="18" height="6" rx="1.5" fill="currentColor" opacity="0.28" />
      <rect x="5" y="6" width="8" height="6" fill="var(--accent)" />
      <rect x="3" y="2" width="2.5" height="14" rx="1.25" fill="var(--accent)" />
      <rect x="12.5" y="2" width="2.5" height="14" rx="1.25" fill="var(--accent)" />
    </svg>
  );
}

function TitleBar({ fileName, theme, onTheme, onLang, onSidebar, sidebarOpen, onOpenFile, platform }) {
  const t = useT();
  return (
    <header className={`titlebar platform-${platform}`}>
      <div className="titlebar-left">
        <button
          type="button"
          className="icon-button"
          onClick={onSidebar}
          aria-label={t.toggleSidebar}
          aria-pressed={sidebarOpen}
          title={t.toggleSidebar}
        >
          <PanelLeft size={16} strokeWidth={1.5} />
        </button>
        <Mark />
        <span className="brand">Clip Goat</span>
      </div>

      <h1 className={`doc-title${fileName ? '' : ' sr-only'}`} title={fileName || undefined}>
        {fileName || 'Clip Goat'}
      </h1>

      <div className="titlebar-right">
        <button type="button" className="icon-button" onClick={onOpenFile} aria-label={t.openVideo} title={`${t.openVideo} (Ctrl+O)`}>
          <FilePlus size={16} strokeWidth={1.5} />
        </button>
        <button type="button" className="icon-button text-button" onClick={onLang} aria-label={t.toggleLang} title={t.toggleLang}>
          {t.langLabel}
        </button>
        <button type="button" className="icon-button" onClick={onTheme} aria-label={t.toggleTheme} title={t.toggleTheme}>
          {theme === 'dark' ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
        </button>
      </div>
    </header>
  );
}

export default memo(TitleBar);

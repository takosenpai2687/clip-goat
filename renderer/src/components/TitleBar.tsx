import { memo } from 'react';
import { Download, FilePlus, Moon, PanelLeft, Sun } from 'lucide-react';
import { useT } from '../lib/i18n';
import type { Theme } from '../../../shared/types';
import icon from '../assets/icon.webp';

interface TitleBarProps {
  fileName: string;
  theme: Theme;
  onTheme: () => void;
  onLang: () => void;
  onSidebar: () => void;
  sidebarOpen: boolean;
  onOpenFile: () => void;
  onCheckUpdate: () => void;
  platform: string;
}

function TitleBar({ fileName, theme, onTheme, onLang, onSidebar, sidebarOpen, onOpenFile, onCheckUpdate, platform }: TitleBarProps) {
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
        <img className="mark" src={icon} width="22" height="22" alt="" />
        <span className="brand">Clip Goat</span>
      </div>

      <h1 className={`doc-title${fileName ? '' : ' sr-only'}`} title={fileName || undefined}>
        {fileName || 'Clip Goat'}
      </h1>

      <div className="titlebar-right">
        <button type="button" className="icon-button" onClick={onOpenFile} aria-label={t.openVideo} title={`${t.openVideo} (Ctrl+O)`}>
          <FilePlus size={16} strokeWidth={1.5} />
        </button>
        <button type="button" className="icon-button" onClick={onCheckUpdate} aria-label={t.checkUpdate} title={t.checkUpdate}>
          <Download size={16} strokeWidth={1.5} />
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

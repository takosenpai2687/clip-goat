import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Ellipsis, FolderPlus, Scissors, Search, X } from 'lucide-react';
import Menu, { type MenuItem, type MenuState } from './Menu';
import { formatDay, formatSize } from '../lib/format';
import { useT, type Lang } from '../lib/i18n';
import type { LibraryDir, LibraryFile } from '../../../shared/types';

export type Filter = 'all' | 'originals' | 'clips';

interface DirRow {
  type: 'dir';
  node: LibraryDir;
  depth: number;
  isRoot: boolean;
  /** Videos under this folder that pass the current filter. */
  count: number;
  open: boolean;
}

interface FileRow {
  type: 'file';
  file: LibraryFile;
  /** Listed under another video of the same source, joined to it by a branch line. */
  child: boolean;
  last?: boolean;
  depth: number;
  shown: string;
}

type Row = DirRow | FileRow;

interface GroupedFile {
  file: LibraryFile;
  child: boolean;
  last?: boolean;
}

const FILTERS: Filter[] = ['all', 'originals', 'clips'];
const DRAG_TYPE = 'application/x-clipgoat-path';

// Turns the folder trees into the list of rows currently on screen.
// While filtering or searching, folders with no match are hidden and matching folders open themselves.
function flatten(trees: LibraryDir[], expanded: Set<string>, filter: Filter, query: string): Row[] {
  const q = query.trim().toLowerCase();
  const narrowed = filter !== 'all' || q !== '';
  const matches = (f: LibraryFile): boolean => (filter === 'all' || (filter === 'clips') === f.clipped) && (!q || f.name.toLowerCase().includes(q));
  const rows: Row[] = [];

  const visit = (node: LibraryDir, depth: number, isRoot: boolean, ancestors: string[] = []): number => {
    const names = [node.name, ...ancestors];
    const files = node.files.filter(matches);
    const row: DirRow = { type: 'dir', node, depth, isRoot, count: files.length, open: q ? true : expanded.has(node.path) };
    const at = rows.push(row) - 1;
    const childStart = rows.length;
    for (const dir of node.dirs) row.count += visit(dir, depth + 1, false, names);
    if (row.open) {
      for (const { file, child, last } of grouped(files)) {
        rows.push({ type: 'file', file, child, last, depth: depth + (child ? 2 : 1), shown: file.clipped ? file.name : shortName(file.name, names) });
      }
    } else {
      rows.length = childStart;
    }
    if (!isRoot && narrowed && row.count === 0) rows.length = at;
    return row.count;
  };

  for (const tree of trees) visit(tree, 0, true);
  return rows;
}

// "Game 2026.11.22.mp4" inside a "Game" folder is shown as "2026.11.22.mp4": the folder already says the rest.
function shortName(name: string, ancestors: string[]): string {
  for (const folder of ancestors) {
    if (name.length > folder.length + 1 && name.toLowerCase().startsWith(folder.toLowerCase()) && /[\s_-]/.test(name[folder.length])) {
      return name.slice(folder.length).replace(/^[\s_-]+/, '');
    }
  }
  return name;
}

// Long names keep both ends: the start says what it is, the end usually holds the time.
function MidName({ text, className }: { text: string; className?: string }) {
  const cut = text.length > 18 ? text.length - 12 : text.length;
  return (
    <span className={`mid ${className || ''}`}>
      <span className="mid-head">{text.slice(0, cut)}</span>
      <span className="mid-tail">{text.slice(cut)}</span>
    </span>
  );
}

// Puts each clip right under the original it was cut from. When the original is gone, its clips stay
// together with the first one as the head of the group. Groups are ordered by the original's name, so
// clips keep their place in the folder when their original is deleted.
function grouped(files: LibraryFile[]): GroupedFile[] {
  const stem = (f: LibraryFile): string => f.name.slice(0, f.name.lastIndexOf('.')).toLowerCase();
  const byHead = new Map<string, LibraryFile[]>();
  for (const f of files) {
    if (!f.clipped) continue;
    const key = f.label.head.toLowerCase();
    const list = byHead.get(key);
    if (list) list.push(f);
    else byHead.set(key, [f]);
  }
  const groups: { key: string; rows: GroupedFile[] }[] = [];
  for (const f of files) {
    if (f.clipped) continue;
    const clips = byHead.get(stem(f)) || [];
    groups.push({
      key: stem(f),
      rows: [{ file: f, child: false }, ...clips.map((clip, i) => ({ file: clip, child: true, last: i === clips.length - 1 }))],
    });
    byHead.delete(stem(f));
  }
  for (const [key, clips] of byHead) {
    groups.push({
      key,
      rows: clips.map((clip, i) => ({ file: clip, child: i > 0, last: i === clips.length - 1 })),
    });
  }
  return groups
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }))
    .flatMap((group) => group.rows);
}

function tally(trees: LibraryDir[]): { originals: number; clips: number } {
  let originals = 0;
  let clips = 0;
  const walk = (node: LibraryDir): void => {
    for (const f of node.files) {
      if (f.clipped) clips++;
      else originals++;
    }
    node.dirs.forEach(walk);
  };
  trees.forEach(walk);
  return { originals, clips };
}

interface LibraryProps {
  trees: LibraryDir[];
  expanded: Set<string>;
  onToggle: (dir: string) => void;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  currentPath: string | null;
  destPath: string | null;
  onOpen: (filePath: string) => void;
  onAddRoot: () => void;
  onRemoveRoot: (dir: string) => void;
  onHideDir: (dir: string) => void;
  onMove: (src: string, destDir: string) => void;
  onRename: (filePath: string, stem: string) => void;
  onTrash: (filePath: string) => void;
  onShow: (target: string) => void;
  onSetDest: (dir: string) => void;
  notice: string;
  lang: Lang;
}

function Library({
  trees,
  expanded,
  onToggle,
  filter,
  onFilter,
  currentPath,
  destPath,
  onOpen,
  onAddRoot,
  onRemoveRoot,
  onHideDir,
  onMove,
  onRename,
  onTrash,
  onShow,
  onSetDest,
  notice,
  lang,
}: LibraryProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const currentRow = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => flatten(trees, expanded, filter, query), [trees, expanded, filter, query]);
  const counts = useMemo(() => tally(trees), [trees]);
  const labels: Record<Filter, string> = { all: t.filterAll, originals: t.filterOriginals, clips: t.filterClips };
  const currentShown = rows.some((r) => r.type === 'file' && r.file.path === currentPath);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentRow.current) currentRow.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(timer);
  }, [currentPath, currentShown]);

  const openMenu = (event: MouseEvent<HTMLElement>, items: MenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const fromButton = event.type === 'click';
    setMenu({ x: fromButton ? rect.left : event.clientX, y: fromButton ? rect.bottom + 4 : event.clientY, items });
  };

  const fileItems = (file: LibraryFile): MenuItem[] => [
    { label: t.rename, onSelect: () => setEditing(file.path) },
    { label: t.reveal, onSelect: () => onShow(file.path) },
    { label: t.trash, confirm: t.trashConfirm, danger: true, onSelect: () => onTrash(file.path) },
  ];
  const dirItems = (row: DirRow): MenuItem[] => [
    { label: t.exportHere, checked: destPath === row.node.path, onSelect: () => onSetDest(row.node.path) },
    { label: t.reveal, onSelect: () => onShow(row.node.path) },
    { label: t.removeRoot, onSelect: () => (row.isRoot ? onRemoveRoot(row.node.path) : onHideDir(row.node.path)) },
  ];

  const commitRename = (file: LibraryFile, value: string) => {
    setEditing(null);
    const stem = value.trim();
    const ext = file.name.slice(file.name.lastIndexOf('.'));
    if (stem && stem + ext !== file.name) onRename(file.path, stem);
  };

  const dragOver = (event: DragEvent, dir: string) => {
    if (!Array.from(event.dataTransfer.types).includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTarget !== dir) setDropTarget(dir);
  };
  const drop = (event: DragEvent, dir: string) => {
    const src = event.dataTransfer.getData(DRAG_TYPE);
    setDropTarget(null);
    if (!src) return;
    event.preventDefault();
    onMove(src, dir);
  };

  return (
    <aside className="sidebar glass">
      <div className="sidebar-head">
        <h2 className="sidebar-title">{t.library}</h2>
        <button type="button" className="icon-button" onClick={onAddRoot} aria-label={t.addFolder} title={t.addFolder}>
          <FolderPlus size={16} strokeWidth={1.5} />
        </button>
      </div>

      <label className="search">
        <Search size={14} strokeWidth={1.5} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} aria-label={t.search} spellCheck={false} />
        {query && (
          <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label={t.clearSearch}>
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
      </label>

      <div className="segmented" role="radiogroup" aria-label={t.filterLabel}>
        {FILTERS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={filter === id} className={filter === id ? 'is-on' : ''} onClick={() => onFilter(id)}>
            {filter === id && (
              <motion.span layoutId="filter-pill" className="segmented-pill" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />
            )}
            <span>{labels[id]}</span>
          </button>
        ))}
      </div>

      <div className="tree" role="tree" onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setDropTarget(null)}>
        {trees.length === 0 && <p className="empty-note">{t.emptyLibrary}</p>}

        {rows.map((row) => {
          const indent = { paddingLeft: 8 + row.depth * 14 };
          if (row.type === 'dir') {
            const { node } = row;
            return (
              <div key={node.path} className="tree-group">
                <button
                  type="button"
                  role="treeitem"
                  aria-expanded={row.open}
                  className={`tree-row is-dir${row.isRoot ? ' is-root' : ''}${dropTarget === node.path ? ' is-drop' : ''}${destPath === node.path ? ' is-dest' : ''}`}
                  style={indent}
                  title={node.path}
                  onClick={() => onToggle(node.path)}
                  onContextMenu={(event) => openMenu(event, dirItems(row))}
                  onDragOver={(event) => dragOver(event, node.path)}
                  onDrop={(event) => drop(event, node.path)}
                >
                  <ChevronRight className={`chevron${row.open ? ' is-open' : ''}`} size={14} strokeWidth={1.5} aria-hidden="true" />
                  <span className="tree-name">{node.name}</span>
                  <span className="tree-count num">{row.count}</span>
                </button>
                {row.isRoot && row.open && row.count === 0 && (
                  <p className="empty-note" style={{ paddingLeft: 30 }}>
                    {node.missing ? t.missingRoot : filter !== 'all' || query ? t.noMatch : t.emptyRoot}
                  </p>
                )}
              </div>
            );
          }

          const { file } = row;
          const clipCount = file.clips ?? 0;
          const current = file.path === currentPath;
          if (editing === file.path) {
            return (
              <div key={file.path} className="tree-row is-editing" style={indent}>
                <span className="tree-icon" />
                <input
                  className="rename-input"
                  defaultValue={file.name.slice(0, file.name.lastIndexOf('.'))}
                  autoFocus
                  spellCheck={false}
                  aria-label={t.rename}
                  onFocus={(event) => event.target.select()}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') commitRename(file, event.currentTarget.value);
                    if (event.key === 'Escape') setEditing(null);
                  }}
                />
              </div>
            );
          }
          return (
            <div
              key={file.path}
              ref={current ? currentRow : undefined}
              className={`tree-row is-file${file.clipped ? ' is-clip' : ''}${clipCount > 0 ? ' is-done' : ''}${current ? ' is-current' : ''}`}
              style={indent}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, file.path);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDropTarget(null)}
              onContextMenu={(event) => openMenu(event, fileItems(file))}
            >
              {row.child && (
                <svg className="link" width="14" height="31" viewBox="0 0 14 31" style={{ left: indent.paddingLeft - 14 }} aria-hidden="true">
                  <path d={row.last ? 'M7 0 V9 Q7 15.5 13 15.5' : 'M7 0 V31 M7 9 Q7 15.5 13 15.5'} />
                </svg>
              )}
              <button
                type="button"
                role="treeitem"
                aria-current={current ? 'true' : undefined}
                className="tree-open"
                title={`${file.name}\n${formatSize(file.size)} · ${formatDay(file.mtime, t, lang)}`}
                onClick={() => onOpen(file.path)}
              >
                <span className="tree-icon">
                  {file.clipped && <Scissors size={14} strokeWidth={1.5} aria-label={t.clipTag} />}
                </span>
                <MidName text={row.shown} className="file-head" />
              </button>
              {clipCount > 0 && (
                <span className="clip-badge num" title={t.clipCount(clipCount)} aria-label={t.clipCount(clipCount)}>
                  <Scissors size={12} strokeWidth={2} aria-hidden="true" />
                  {clipCount}
                </span>
              )}
              <button type="button" className="row-more" aria-label={t.more} title={t.more} onClick={(event) => openMenu(event, fileItems(file))}>
                <Ellipsis size={16} strokeWidth={1.5} />
              </button>
            </div>
          );
        })}
      </div>

      <p className={`sidebar-foot num${notice ? ' is-notice' : ''}`} aria-live="polite">
        {notice || (trees.length > 0 ? t.counts(counts.originals, counts.clips) : '')}
      </p>

      <AnimatePresence>{menu && <Menu key="menu" {...menu} onClose={() => setMenu(null)} />}</AnimatePresence>
    </aside>
  );
}

export default memo(Library);

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Ellipsis, FolderPlus, Scissors, Search, X } from 'lucide-react';
import Menu from './Menu';
import { formatDay, formatSize } from '../lib/format';
import { useT } from '../lib/i18n';

const FILTERS = ['all', 'originals', 'clips'];
const DRAG_TYPE = 'application/x-clipgoat-path';

// Turns the folder trees into the list of rows currently on screen.
// While filtering or searching, folders with no match are hidden and matching folders open themselves.
function flatten(trees, expanded, filter, query) {
  const q = query.trim().toLowerCase();
  const narrowed = filter !== 'all' || q !== '';
  const matches = (f) => (filter === 'all' || (filter === 'clips') === f.clipped) && (!q || f.name.toLowerCase().includes(q));
  const rows = [];

  const visit = (node, depth, isRoot, ancestors = []) => {
    const names = [node.name, ...ancestors];
    const files = node.files.filter(matches);
    const row = { type: 'dir', node, depth, isRoot, count: files.length, open: q ? true : expanded.has(node.path) };
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
function shortName(name, ancestors) {
  for (const folder of ancestors) {
    if (name.length > folder.length + 1 && name.toLowerCase().startsWith(folder.toLowerCase()) && /[\s_-]/.test(name[folder.length])) {
      return name.slice(folder.length).replace(/^[\s_-]+/, '');
    }
  }
  return name;
}

// Long names keep both ends: the start says what it is, the end usually holds the time.
function MidName({ text, className }) {
  const cut = text.length > 18 ? text.length - 12 : text.length;
  return (
    <span className={`mid ${className || ''}`}>
      <span className="mid-head">{text.slice(0, cut)}</span>
      <span className="mid-tail">{text.slice(cut)}</span>
    </span>
  );
}

// Puts each clip right under the original it was cut from. When the original is gone, its clips stay
// together with the first one as the head of the group. Groups are ordered newest first, so clips never
// sink to the bottom of the folder when their original is deleted.
function grouped(files) {
  const stem = (f) => f.name.slice(0, f.name.lastIndexOf('.')).toLowerCase();
  const byHead = new Map();
  for (const f of files) {
    if (!f.clipped) continue;
    const key = f.label.head.toLowerCase();
    if (!byHead.has(key)) byHead.set(key, []);
    byHead.get(key).push(f);
  }
  const groups = [];
  for (const f of files) {
    if (f.clipped) continue;
    const clips = byHead.get(stem(f)) || [];
    groups.push({
      at: f.mtime,
      rows: [{ file: f, child: false }, ...clips.map((clip, i) => ({ file: clip, child: true, last: i === clips.length - 1 }))],
    });
    byHead.delete(stem(f));
  }
  for (const clips of byHead.values()) {
    groups.push({
      at: Math.max(...clips.map((clip) => clip.mtime)),
      rows: clips.map((clip, i) => ({ file: clip, child: i > 0, last: i === clips.length - 1 })),
    });
  }
  return groups.sort((a, b) => b.at - a.at).flatMap((group) => group.rows);
}

function tally(trees) {
  let originals = 0;
  let clips = 0;
  const walk = (node) => {
    for (const f of node.files) f.clipped ? clips++ : originals++;
    node.dirs.forEach(walk);
  };
  trees.forEach(walk);
  return { originals, clips };
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
  onMove,
  onRename,
  onTrash,
  onShow,
  onSetDest,
  notice,
  lang,
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(null);
  const [editing, setEditing] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const currentRow = useRef(null);

  const rows = useMemo(() => flatten(trees, expanded, filter, query), [trees, expanded, filter, query]);
  const counts = useMemo(() => tally(trees), [trees]);
  const labels = { all: t.filterAll, originals: t.filterOriginals, clips: t.filterClips };
  const currentShown = rows.some((r) => r.type === 'file' && r.file.path === currentPath);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentRow.current) currentRow.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(timer);
  }, [currentPath, currentShown]);

  const openMenu = (event, items) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const fromButton = event.type === 'click';
    setMenu({ x: fromButton ? rect.left : event.clientX, y: fromButton ? rect.bottom + 4 : event.clientY, items });
  };

  const fileItems = (file) => [
    { label: t.rename, onSelect: () => setEditing(file.path) },
    { label: t.reveal, onSelect: () => onShow(file.path) },
    { label: t.trash, confirm: t.trashConfirm, danger: true, onSelect: () => onTrash(file.path) },
  ];
  const dirItems = (row) => [
    { label: t.exportHere, checked: destPath === row.node.path, onSelect: () => onSetDest(row.node.path) },
    { label: t.reveal, onSelect: () => onShow(row.node.path) },
    ...(row.isRoot ? [{ label: t.removeRoot, onSelect: () => onRemoveRoot(row.node.path) }] : []),
  ];

  const commitRename = (file, value) => {
    setEditing(null);
    const stem = value.trim();
    const ext = file.name.slice(file.name.lastIndexOf('.'));
    if (stem && stem + ext !== file.name) onRename(file.path, stem);
  };

  const dragOver = (event, dir) => {
    if (!Array.from(event.dataTransfer.types).includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTarget !== dir) setDropTarget(dir);
  };
  const drop = (event, dir) => {
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

      <div className="tree" role="tree" onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget) && setDropTarget(null)}>
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
                    if (event.key === 'Enter') commitRename(file, event.target.value);
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
              className={`tree-row is-file${file.clipped ? ' is-clip' : ''}${file.clips > 0 ? ' is-done' : ''}${current ? ' is-current' : ''}`}
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
              {file.clips > 0 && (
                <span className="clip-badge num" title={t.clipCount(file.clips)} aria-label={t.clipCount(file.clips)}>
                  <Scissors size={12} strokeWidth={2} aria-hidden="true" />
                  {file.clips}
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

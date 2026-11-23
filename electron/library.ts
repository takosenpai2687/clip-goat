import fs from 'node:fs';
import path from 'node:path';
import * as shared from '../shared';
import type { LibraryDir, LibraryFile } from '../shared';

const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);
const MAX_DEPTH = 8;
const MAX_ENTRIES = 60000;
const BAD_NAME = /[\\/:*?"<>|]/;

function fail(message: string, code: string): never {
  throw Object.assign(new Error(message), { code });
}

const byName = (a: LibraryDir, b: LibraryDir): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

// Returns a folder node, or null when the folder holds no video anywhere below it.
async function scanDir(dir: string, depth: number, budget: { left: number }, hidden: Set<string>): Promise<LibraryDir | null> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files: LibraryFile[] = [];
  const dirs: LibraryDir[] = [];
  for (const entry of entries) {
    if (budget.left-- <= 0) break;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth >= MAX_DEPTH || SKIP_DIRS.has(entry.name) || hidden.has(full.toLowerCase())) continue;
      const child = await scanDir(full, depth + 1, budget, hidden);
      if (child) dirs.push(child);
    } else if (entry.isFile() && shared.isVideoFile(entry.name)) {
      try {
        const stat = await fs.promises.stat(full);
        files.push({
          name: entry.name,
          path: full,
          size: stat.size,
          mtime: stat.mtimeMs,
          clipped: shared.isClippedFile(entry.name),
          label: shared.splitClipName(entry.name),
        });
      } catch {}
    }
  }
  if (!files.length && !dirs.length && depth > 0) return null;
  dirs.sort(byName);
  files.sort((a, b) => b.mtime - a.mtime);
  return {
    path: dir,
    name: path.basename(dir) || dir,
    dirs,
    files,
    total: files.length + dirs.reduce((sum, d) => sum + d.total, 0),
  };
}

function eachFile(node: LibraryDir, fn: (file: LibraryFile) => void): void {
  node.files.forEach(fn);
  node.dirs.forEach((d) => eachFile(d, fn));
}

// One tree per root. Folders in hiddenDirs were removed from the library by the user and are skipped.
// Each original gets clips: how many clips anywhere in the library were cut from it.
export async function scanLibrary(roots: string[], hiddenDirs: string[] = []): Promise<LibraryDir[]> {
  const budget = { left: MAX_ENTRIES };
  const hidden = new Set(hiddenDirs.map((dir) => dir.toLowerCase()));
  const trees: LibraryDir[] = [];
  for (const root of roots) {
    const node = await scanDir(root, 0, budget, hidden);
    trees.push(node || { path: root, name: path.basename(root) || root, dirs: [], files: [], total: 0, missing: true });
  }
  const clippedFrom = new Map<string, number>();
  for (const tree of trees) {
    eachFile(tree, (f) => {
      if (!f.clipped) return;
      const key = f.label.head.toLowerCase();
      clippedFrom.set(key, (clippedFrom.get(key) || 0) + 1);
    });
  }
  for (const tree of trees) {
    eachFile(tree, (f) => {
      if (!f.clipped) f.clips = clippedFrom.get(path.basename(f.name, path.extname(f.name)).toLowerCase()) || 0;
    });
  }
  return trees;
}

export function assertVideo(filePath: string): void {
  if (!shared.isVideoFile(filePath) || !fs.existsSync(filePath)) fail('Not a video file.', 'NOT_FOUND');
}

export async function moveFile(src: string, destDir: string): Promise<string> {
  assertVideo(src);
  if (!fs.statSync(destDir).isDirectory()) throw new Error('Destination is not a folder.');
  if (path.resolve(path.dirname(src)) === path.resolve(destDir)) return src;
  const target = shared.uniquePath(path.join(destDir, path.basename(src)));
  try {
    await fs.promises.rename(src, target);
  } catch (err) {
    if (shared.errorCode(err) !== 'EXDEV') throw err;
    await fs.promises.copyFile(src, target);
    await fs.promises.unlink(src);
  }
  return target;
}

export async function renameFile(src: string, stem: string): Promise<string> {
  assertVideo(src);
  const clean = String(stem).trim();
  if (!clean || BAD_NAME.test(clean) || clean.endsWith('.')) fail('That name is not allowed.', 'BAD_NAME');
  const target = path.join(path.dirname(src), clean + path.extname(src));
  if (target === src) return src;
  if (fs.existsSync(target) && target.toLowerCase() !== src.toLowerCase()) fail('A file with that name already exists.', 'EXISTS');
  await fs.promises.rename(src, target);
  return target;
}

interface BinEntry {
  index: string;
  data: string;
  deletedAt: bigint;
}

// Reads one Recycle Bin index file ($I...) and returns the path the item was deleted from.
function readBinIndex(file: string): { from: string; deletedAt: bigint } | null {
  try {
    const buf = fs.readFileSync(file);
    const version = buf.readBigInt64LE(0);
    const raw = version === 2n ? buf.toString('utf16le', 28, 28 + buf.readUInt32LE(24) * 2) : buf.toString('utf16le', 24, 24 + 520);
    return { from: raw.replace(/\0.*$/s, ''), deletedAt: buf.readBigInt64LE(16) };
  } catch {
    return null;
  }
}

function findInBin(original: string): BinEntry | null {
  const bin = path.join(path.parse(original).root, '$Recycle.Bin');
  const ext = path.extname(original).toLowerCase();
  let best: BinEntry | null = null;
  let users: string[] = [];
  try {
    users = fs.readdirSync(bin);
  } catch {}
  for (const user of users) {
    let names: string[];
    try {
      names = fs.readdirSync(path.join(bin, user));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith('$I') || path.extname(name).toLowerCase() !== ext) continue;
      const index = path.join(bin, user, name);
      const info = readBinIndex(index);
      if (!info || info.from.toLowerCase() !== original.toLowerCase()) continue;
      if (!best || info.deletedAt > best.deletedAt) best = { index, data: path.join(bin, user, '$R' + name.slice(2)), deletedAt: info.deletedAt };
    }
  }
  return best;
}

// Puts a file that was sent to the Recycle Bin back where it was.
// Windows keeps each deleted file as a pair: $I<id> (where it came from) and $R<id> (the data).
export async function restoreFile(original: string): Promise<string> {
  if (!shared.isVideoFile(original)) fail('Not a video file.', 'NOT_FOUND');
  if (process.platform !== 'win32') fail('Undo delete is only available on Windows.', 'RESTORE_FAILED');
  if (fs.existsSync(original)) fail('A file with that name already exists.', 'EXISTS');

  const found = findInBin(original);
  if (!found || !fs.existsSync(found.data)) fail('The file is no longer in the Recycle Bin.', 'RESTORE_FAILED');
  await fs.promises.mkdir(path.dirname(original), { recursive: true });
  await fs.promises.rename(found.data, original);
  await fs.promises.unlink(found.index).catch(() => {});
  return original;
}

export interface LibraryWatcher {
  set(roots: string[]): void;
  close(): void;
}

// Watches every root recursively and reports changes once things settle.
export function createWatcher(onChange: () => void): LibraryWatcher {
  let watchers: fs.FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  return {
    set(roots) {
      watchers.forEach((w) => w.close());
      watchers = [];
      for (const root of roots) {
        try {
          const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
            if (filename && String(filename).endsWith('.part')) return;
            clearTimeout(timer);
            timer = setTimeout(onChange, 600);
          });
          watcher.on('error', () => {});
          watchers.push(watcher);
        } catch {}
      }
    },
    close() {
      clearTimeout(timer);
      watchers.forEach((w) => w.close());
      watchers = [];
    },
  };
}

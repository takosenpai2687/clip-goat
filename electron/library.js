'use strict';

const fs = require('node:fs');
const path = require('node:path');
const shared = require('../shared');

const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);
const MAX_DEPTH = 8;
const MAX_ENTRIES = 60000;
const BAD_NAME = /[\\/:*?"<>|]/;

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

// Returns a folder node, or null when the folder holds no video anywhere below it.
async function scanDir(dir, depth, budget, hidden) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = [];
  const dirs = [];
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

function eachFile(node, fn) {
  node.files.forEach(fn);
  node.dirs.forEach((d) => eachFile(d, fn));
}

// One tree per root. Folders in `hidden` were removed from the library by the user and are skipped.
// One tree per root. Each original gets clips: how many clips anywhere in the library were cut from it.
async function scanLibrary(roots, hiddenDirs = []) {
  const budget = { left: MAX_ENTRIES };
  const hidden = new Set(hiddenDirs.map((dir) => dir.toLowerCase()));
  const trees = [];
  for (const root of roots) {
    const node = await scanDir(root, 0, budget, hidden);
    trees.push(node || { path: root, name: path.basename(root) || root, dirs: [], files: [], total: 0, missing: true });
  }
  const clippedFrom = new Map();
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

function assertVideo(filePath) {
  if (!shared.isVideoFile(filePath) || !fs.existsSync(filePath)) {
    throw Object.assign(new Error('Not a video file.'), { code: 'NOT_FOUND' });
  }
}

async function moveFile(src, destDir) {
  assertVideo(src);
  if (!fs.statSync(destDir).isDirectory()) throw new Error('Destination is not a folder.');
  if (path.resolve(path.dirname(src)) === path.resolve(destDir)) return src;
  const target = shared.uniquePath(path.join(destDir, path.basename(src)));
  try {
    await fs.promises.rename(src, target);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.promises.copyFile(src, target);
    await fs.promises.unlink(src);
  }
  return target;
}

async function renameFile(src, stem) {
  assertVideo(src);
  const clean = String(stem).trim();
  if (!clean || BAD_NAME.test(clean) || clean.endsWith('.')) {
    throw Object.assign(new Error('That name is not allowed.'), { code: 'BAD_NAME' });
  }
  const target = path.join(path.dirname(src), clean + path.extname(src));
  if (target === src) return src;
  if (fs.existsSync(target) && target.toLowerCase() !== src.toLowerCase()) {
    throw Object.assign(new Error('A file with that name already exists.'), { code: 'EXISTS' });
  }
  await fs.promises.rename(src, target);
  return target;
}

// Reads one Recycle Bin index file ($I...) and returns the path the item was deleted from.
function readBinIndex(file) {
  try {
    const buf = fs.readFileSync(file);
    const version = buf.readBigInt64LE(0);
    const raw = version === 2n ? buf.toString('utf16le', 28, 28 + buf.readUInt32LE(24) * 2) : buf.toString('utf16le', 24, 24 + 520);
    return { from: raw.replace(/\0.*$/s, ''), deletedAt: buf.readBigInt64LE(16) };
  } catch {
    return null;
  }
}

// Puts a file that was sent to the Recycle Bin back where it was.
// Windows keeps each deleted file as a pair: $I<id> (where it came from) and $R<id> (the data).
async function restoreFile(original) {
  if (!shared.isVideoFile(original)) throw Object.assign(new Error('Not a video file.'), { code: 'NOT_FOUND' });
  if (process.platform !== 'win32') throw Object.assign(new Error('Undo delete is only available on Windows.'), { code: 'RESTORE_FAILED' });
  if (fs.existsSync(original)) throw Object.assign(new Error('A file with that name already exists.'), { code: 'EXISTS' });

  const bin = path.join(path.parse(original).root, '$Recycle.Bin');
  const ext = path.extname(original).toLowerCase();
  let best = null;
  let users = [];
  try {
    users = fs.readdirSync(bin);
  } catch {}
  for (const user of users) {
    let names;
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
  if (!best || !fs.existsSync(best.data)) {
    throw Object.assign(new Error('The file is no longer in the Recycle Bin.'), { code: 'RESTORE_FAILED' });
  }
  await fs.promises.mkdir(path.dirname(original), { recursive: true });
  await fs.promises.rename(best.data, original);
  await fs.promises.unlink(best.index).catch(() => {});
  return original;
}

// Watches every root recursively and reports changes once things settle.
function createWatcher(onChange) {
  let watchers = [];
  let timer = null;
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

module.exports = { scanLibrary, moveFile, renameFile, restoreFile, assertVideo, createWatcher };

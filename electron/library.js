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
async function scanDir(dir, depth, budget) {
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
      if (depth >= MAX_DEPTH || SKIP_DIRS.has(entry.name)) continue;
      const child = await scanDir(full, depth + 1, budget);
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

// One tree per root. Originals that already have a clip anywhere in the library get done: true.
async function scanLibrary(roots) {
  const budget = { left: MAX_ENTRIES };
  const trees = [];
  for (const root of roots) {
    const node = await scanDir(root, 0, budget);
    trees.push(node || { path: root, name: path.basename(root) || root, dirs: [], files: [], total: 0, missing: true });
  }
  const clippedFrom = new Set();
  for (const tree of trees) {
    eachFile(tree, (f) => {
      if (f.clipped) clippedFrom.add(f.label.head.toLowerCase());
    });
  }
  for (const tree of trees) {
    eachFile(tree, (f) => {
      if (!f.clipped) f.done = clippedFrom.has(path.basename(f.name, path.extname(f.name)).toLowerCase());
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

module.exports = { scanLibrary, moveFile, renameFile, assertVideo, createWatcher };

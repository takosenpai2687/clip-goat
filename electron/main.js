'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, protocol } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const shared = require('../shared');
const library = require('./library');

const DEV_URL = process.env.CLIP_GOAT_DEV_URL;
const PREVIEW_DIR = path.join(os.tmpdir(), 'clip-goat-preview');
const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' };
// The caption-button strip is transparent so the app's own backdrop shows through it.
const TITLEBAR = {
  dark: { color: '#00000000', symbolColor: '#c8ccd2', background: '#05070b' },
  light: { color: '#00000000', symbolColor: '#4a4f57', background: '#eef1f5' },
};

let win = null;
let exportJob = null;
let proxyJob = null;
const keyframeCache = new Map();

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

function mediaUrl(filePath) {
  return `media://local/${encodeURIComponent(filePath)}`;
}

// Streams local video with Range support so <video> can seek without loading the file into memory.
async function serveMedia(request) {
  const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1));
  const inPreviewDir = path.dirname(filePath) === PREVIEW_DIR;
  if (!inPreviewDir && !shared.isVideoFile(filePath)) return new Response('Forbidden', { status: 403 });

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const headers = {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  };
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
    } else {
      start = Math.max(0, stat.size - Number(range[2]));
    }
    if (start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = String(end - start + 1);

  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => {});
  return new Response(Readable.toWeb(stream), { status, headers });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Every handler answers { ok, data } or { ok: false, error } so error codes survive IPC.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: { code: err.code || 'ERROR', message: err.message, detail: err.detail } };
    }
  });
}

const watcher = library.createWatcher(() => send('library:changed'));

async function getKeyframes(filePath, startTime) {
  const stat = await fs.promises.stat(filePath);
  const cached = keyframeCache.get(filePath);
  if (cached && cached.mtime === stat.mtimeMs) return cached.times;
  const times = await shared.keyframes(filePath, { startTime });
  keyframeCache.set(filePath, { mtime: stat.mtimeMs, times });
  return times;
}

function cachedKeyframes(filePath) {
  const cached = keyframeCache.get(filePath);
  return cached ? cached.times : null;
}

function initialFile(argv) {
  return argv.slice(1).find((arg) => !arg.startsWith('-') && shared.isVideoFile(arg) && fs.existsSync(arg)) || null;
}

function registerIpc() {
  handle('dialog:openFile', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: shared.VIDEO_EXTS.map((e) => e.slice(1)) }],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  handle('dialog:openFolder', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  handle('library:scan', async (roots) => {
    const trees = await library.scanLibrary(roots);
    watcher.set(roots.filter((root) => fs.existsSync(root)));
    return trees;
  });

  handle('library:defaultRoot', () => app.getPath('videos'));
  handle('fs:move', (src, destDir) => library.moveFile(src, destDir));
  handle('fs:rename', (src, stem) => library.renameFile(src, stem));
  handle('fs:trash', async (filePath) => {
    library.assertVideo(filePath);
    await shell.trashItem(filePath);
  });

  handle('media:probe', async (filePath) => {
    const info = await shared.probe(filePath);
    return { path: filePath, name: path.basename(filePath), dir: path.dirname(filePath), url: mediaUrl(filePath), info };
  });

  handle('media:keyframes', (filePath, startTime) => getKeyframes(filePath, startTime));

  handle('media:proxy', async (filePath, level, duration) => {
    if (proxyJob) proxyJob.abort();
    const controller = new AbortController();
    proxyJob = controller;
    const stat = await fs.promises.stat(filePath);
    const hash = crypto.createHash('sha1').update(`${filePath}|${stat.mtimeMs}|${level}`).digest('hex').slice(0, 16);
    const output = path.join(PREVIEW_DIR, `${hash}.mp4`);
    try {
      if (!fs.existsSync(output)) {
        fs.mkdirSync(PREVIEW_DIR, { recursive: true });
        const tmp = `${output}.part`;
        await shared.makePreviewProxy({
          input: filePath,
          output: tmp,
          level,
          duration,
          signal: controller.signal,
          onProgress: ({ percent }) => send('media:proxy-progress', { path: filePath, percent }),
        });
        fs.renameSync(tmp, output);
      }
      return mediaUrl(output);
    } finally {
      if (proxyJob === controller) proxyJob = null;
    }
  });

  handle('media:proxy-cancel', () => {
    if (proxyJob) proxyJob.abort();
  });

  // Same decision the export will make, so the UI can show "instant / exact" and the file name up front.
  handle('export:plan', (input, segments, fps, outputDir) => {
    const plan = shared.planSegments(segments, cachedKeyframes(input), 'auto', fps);
    const dir = outputDir || path.dirname(input);
    const output = shared.uniquePath(path.join(dir, shared.buildClipName(input, plan.segments)));
    return { mode: plan.mode, name: path.basename(output), dir };
  });

  handle('export:start', async ({ input, segments, outputDir }) => {
    if (exportJob) throw Object.assign(new Error('An export is already running.'), { code: 'BUSY' });
    exportJob = new AbortController();
    try {
      return await shared.clip({
        input,
        segments,
        outputDir: outputDir || undefined,
        mode: 'auto',
        keyframes: cachedKeyframes(input) || undefined,
        signal: exportJob.signal,
        onProgress: (p) => send('export:progress', p),
      });
    } finally {
      exportJob = null;
    }
  });

  handle('export:cancel', () => {
    if (exportJob) exportJob.abort();
  });

  handle('shell:show', (filePath) => shell.showItemInFolder(filePath));

  handle('window:theme', (theme) => {
    const colors = TITLEBAR[theme] || TITLEBAR.dark;
    if (!win || win.isDestroyed()) return;
    win.setBackgroundColor(colors.background);
    if (process.platform !== 'darwin') {
      win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 44 });
    }
  });

  handle('app:initialFile', () => initialFile(process.argv));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Clip Goat',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: TITLEBAR.dark.background,
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'darwin' ? undefined : { color: TITLEBAR.dark.color, symbolColor: TITLEBAR.dark.symbolColor, height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (DEV_URL) {
    win.loadURL(DEV_URL);
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'));
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const file = initialFile(argv);
    if (file) send('app:open-file', file);
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle('media', serveMedia);
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (exportJob) exportJob.abort();
    if (proxyJob) proxyJob.abort();
    watcher.close();
    fs.rmSync(PREVIEW_DIR, { recursive: true, force: true });
    app.quit();
  });
}

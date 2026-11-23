import { app, BrowserWindow, Menu, ipcMain, dialog, shell, protocol } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import * as shared from '../shared';
import type { ApiEvents, ExportJob, ExportPlan, MediaDoc, Origin, ProxyLevel, Segment, Theme } from '../shared';
import * as workspace from './workspace';
import { createUpdater } from './updater';

// Compiled to dist/electron, so the project root sits two folders up.
const ROOT = path.join(__dirname, '..', '..');
const DEV_URL = process.env.CLIP_GOAT_DEV_URL;
const PREVIEW_DIR = path.join(os.tmpdir(), 'clip-goat-preview');
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};
// The caption-button strip is transparent so the app's own backdrop shows through it.
const TITLEBAR: Record<Theme, { color: string; symbolColor: string; background: string }> = {
  dark: { color: '#00000000', symbolColor: '#c8ccd2', background: '#05070b' },
  light: { color: '#00000000', symbolColor: '#4a4f57', background: '#eef1f5' },
};

let win: BrowserWindow | null = null;
let exportJob: AbortController | null = null;
let proxyJob: AbortController | null = null;
const keyframeCache = new Map<string, { mtime: number; times: number[] }>();
const origins = new Map<string, Origin | null>();

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

function mediaUrl(filePath: string): string {
  return `media://local/${encodeURIComponent(filePath)}`;
}

// Streams local video with Range support so <video> can seek without loading the file into memory.
async function serveMedia(request: Request): Promise<Response> {
  const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1));
  const inPreviewDir = path.dirname(filePath) === PREVIEW_DIR;
  if (!inPreviewDir && !shared.isVideoFile(filePath)) return new Response('Forbidden', { status: 403 });

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const headers: Record<string, string> = {
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
  return new Response(Readable.toWeb(stream) as unknown as BodyInit, { status, headers });
}

function send<K extends keyof ApiEvents>(channel: K, payload?: ApiEvents[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function fail(message: string, code: string): never {
  throw Object.assign(new Error(message), { code });
}

// Every handler answers { ok, data } or { ok: false, error } so error codes survive IPC.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return {
        ok: false,
        error: { code: shared.errorCode(err) || 'ERROR', message: shared.errorMessage(err), detail: (err as shared.ClipError).detail },
      };
    }
  });
}

const watcher = workspace.createWatcher(() => send('workspace:changed'));
const updater = createUpdater((percent) => send('update:progress', { percent }));

async function getKeyframes(filePath: string, startTime: number): Promise<number[]> {
  const stat = await fs.promises.stat(filePath);
  const cached = keyframeCache.get(filePath);
  if (cached && cached.mtime === stat.mtimeMs) return cached.times;
  const times = await shared.keyframes(filePath, { startTime });
  keyframeCache.set(filePath, { mtime: stat.mtimeMs, times });
  return times;
}

function cachedKeyframes(filePath: string): number[] | null {
  const cached = keyframeCache.get(filePath);
  return cached ? cached.times : null;
}

function initialFile(argv: string[]): string | null {
  return argv.slice(1).find((arg) => !arg.startsWith('-') && shared.isVideoFile(arg) && fs.existsSync(arg)) || null;
}

function registerIpc(): void {
  handle('dialog:openFile', async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: shared.VIDEO_EXTS.map((e) => e.slice(1)) }],
    };
    const res = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    return res.canceled ? null : res.filePaths[0];
  });

  handle('dialog:openFolder', async () => {
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] };
    const res = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    return res.canceled ? null : res.filePaths[0];
  });

  handle('workspace:scan', async (roots: string[], hidden?: string[]) => {
    const trees = await workspace.scanWorkspace(roots, hidden || []);
    watcher.set(roots.filter((root) => fs.existsSync(root)));
    return trees;
  });

  handle('workspace:defaultRoot', () => app.getPath('videos'));
  handle('fs:move', (src: string, destDir: string) => workspace.moveFile(src, destDir));
  handle('fs:rename', (src: string, stem: string) => workspace.renameFile(src, stem));
  handle('fs:restore', (filePath: string) => workspace.restoreFile(filePath));
  handle('fs:trash', async (filePath: string) => {
    workspace.assertVideo(filePath);
    await shell.trashItem(filePath);
  });

  handle('media:probe', async (filePath: string): Promise<MediaDoc> => {
    const info = await shared.probe(filePath);
    origins.set(filePath, info.origin);
    return { path: filePath, name: path.basename(filePath), dir: path.dirname(filePath), url: mediaUrl(filePath), info };
  });

  handle('media:keyframes', (filePath: string, startTime: number) => getKeyframes(filePath, startTime));

  handle('media:proxy', async (filePath: string, level: ProxyLevel, duration: number) => {
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
  handle('export:plan', (input: string, segments: Segment[], fps: number, outputDir: string | null): ExportPlan => {
    const plan = shared.planSegments(segments, cachedKeyframes(input), 'auto', fps);
    const dir = outputDir || path.dirname(input);
    const origin = shared.lineage(origins.get(input), input, plan.segments);
    const output = shared.uniquePath(path.join(dir, shared.buildClipName(origin.source, origin.segments)));
    return { mode: plan.mode, name: path.basename(output), dir };
  });

  handle('export:start', async ({ input, segments, outputDir, name }: ExportJob) => {
    // A name chosen in the dialog keeps the .mp4 extension and never replaces an existing file.
    let output: string | undefined;
    if (name) {
      if (/[\\/:*?"<>|]/.test(name) || name.endsWith('.')) fail('That name is not allowed.', 'BAD_NAME');
      output = shared.uniquePath(path.join(outputDir || path.dirname(input), `${name}.mp4`));
    }
    if (exportJob) fail('An export is already running.', 'BUSY');
    const job = new AbortController();
    exportJob = job;
    try {
      return await shared.clip({
        input,
        segments,
        output,
        outputDir: outputDir || undefined,
        mode: 'auto',
        keyframes: cachedKeyframes(input) || undefined,
        signal: job.signal,
        onProgress: (p) => send('export:progress', p),
      });
    } finally {
      exportJob = null;
    }
  });

  handle('export:cancel', () => {
    if (exportJob) exportJob.abort();
  });

  handle('shell:show', (filePath: string) => shell.showItemInFolder(filePath));

  handle('window:theme', (theme: Theme) => {
    const colors = TITLEBAR[theme] || TITLEBAR.dark;
    if (!win || win.isDestroyed()) return;
    win.setBackgroundColor(colors.background);
    if (process.platform !== 'darwin') {
      win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: 44 });
    }
  });

  handle('app:initialFile', () => initialFile(process.argv));

  handle('update:check', () => updater.check());
  handle('update:download', () => updater.download());
  handle('update:install', () => updater.install());
}

function createWindow(): void {
  const created = new BrowserWindow({
    width: 1320,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Clip Goat',
    icon: path.join(ROOT, 'assets', 'icon.png'),
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
  win = created;

  created.once('ready-to-show', () => created.show());
  created.on('closed', () => {
    win = null;
  });
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-navigate', (event) => event.preventDefault());

  if (DEV_URL) {
    void created.loadURL(DEV_URL);
    created.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') created.webContents.toggleDevTools();
    });
  } else {
    void created.loadFile(path.join(ROOT, 'renderer', 'dist', 'index.html'));
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

  void app.whenReady().then(() => {
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

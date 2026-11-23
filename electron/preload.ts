import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { ApiEvents, ClipGoatApi } from '../shared/types';

const EVENTS: (keyof ApiEvents)[] = ['export:progress', 'media:proxy-progress', 'library:changed', 'app:open-file', 'update:progress'];

interface Reply<T> {
  ok: boolean;
  data: T;
  error: { code: string; message: string; detail?: string };
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Reply<T>;
  if (res.ok) return res.data;
  throw Object.assign(new Error(res.error.message), res.error);
}

const api: ClipGoatApi = {
  platform: process.platform,
  pathForFile: (file) => webUtils.getPathForFile(file),
  openFile: () => call('dialog:openFile'),
  openFolder: () => call('dialog:openFolder'),
  scan: (roots, hidden) => call('library:scan', roots, hidden),
  defaultRoot: () => call('library:defaultRoot'),
  moveFile: (src, destDir) => call('fs:move', src, destDir),
  renameFile: (src, stem) => call('fs:rename', src, stem),
  trashFile: (filePath) => call('fs:trash', filePath),
  restoreFile: (filePath) => call('fs:restore', filePath),
  probe: (filePath) => call('media:probe', filePath),
  keyframes: (filePath, startTime) => call('media:keyframes', filePath, startTime),
  proxy: (filePath, level, duration) => call('media:proxy', filePath, level, duration),
  cancelProxy: () => call('media:proxy-cancel'),
  plan: (input, segments, fps, outputDir) => call('export:plan', input, segments, fps, outputDir),
  exportClip: (job) => call('export:start', job),
  cancelExport: () => call('export:cancel'),
  showInFolder: (filePath) => call('shell:show', filePath),
  setTheme: (theme) => call('window:theme', theme),
  initialFile: () => call('app:initialFile'),
  checkUpdate: () => call('update:check'),
  downloadUpdate: () => call('update:download'),
  installUpdate: () => call('update:install'),
  on(channel, listener) {
    if (!EVENTS.includes(channel)) return () => {};
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('clipgoat', api);

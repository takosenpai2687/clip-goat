'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = ['export:progress', 'media:proxy-progress', 'library:changed', 'app:open-file'];

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res.ok) return res.data;
  throw Object.assign(new Error(res.error.message), res.error);
}

contextBridge.exposeInMainWorld('clipgoat', {
  platform: process.platform,
  pathForFile: (file) => webUtils.getPathForFile(file),
  openFile: () => call('dialog:openFile'),
  openFolder: () => call('dialog:openFolder'),
  scan: (roots) => call('library:scan', roots),
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
  on(channel, listener) {
    if (!EVENTS.includes(channel)) return () => {};
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});

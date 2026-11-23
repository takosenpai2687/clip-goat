import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from '../shared';

function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split(/[.-]/).map(Number);
  const b = current.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

function fail(err: unknown): never {
  throw Object.assign(new Error(err instanceof Error ? err.message : String(err)), { code: 'UPDATE_FAILED' });
}

export interface Updater {
  check(): Promise<UpdateInfo>;
  download(): Promise<void>;
  install(): void;
}

// Updates come from the project's GitHub releases (see "publish" in package.json).
// Nothing is downloaded until the user asks for it.
export function createUpdater(onProgress: (percent: number) => void): Updater {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('download-progress', (progress) => onProgress(progress.percent));
  // Failures are reported through the rejected promises below.
  autoUpdater.on('error', () => {});

  return {
    async check() {
      const current = app.getVersion();
      // A build run from source has no installer to replace, and only the Windows installer is published.
      if (!app.isPackaged || process.platform !== 'win32') return { status: 'unsupported', current, version: current };
      try {
        const result = await autoUpdater.checkForUpdates();
        const version = result?.updateInfo.version ?? current;
        return { status: isNewer(version, current) ? 'available' : 'none', current, version };
      } catch (err) {
        return fail(err);
      }
    },
    async download() {
      try {
        await autoUpdater.downloadUpdate();
      } catch (err) {
        fail(err);
      }
    },
    install() {
      // Silent install, then start the new version.
      autoUpdater.quitAndInstall(true, true);
    },
  };
}

export interface Segment {
  start: number;
  end: number;
}

/** How the caller wants a clip made. */
export type ClipMode = 'auto' | 'copy' | 'encode';
/** How a clip was (or will be) made. */
export type ExportMode = 'copy' | 'encode';

/** Where a clip came from: the original video's file name and ranges on its timeline. */
export interface Origin {
  source: string;
  segments: Segment[];
}

export interface VideoInfo {
  duration: number;
  startTime: number;
  size: number;
  format: string;
  origin: Origin | null;
  video: { codec: string; width: number; height: number; fps: number; pixFmt: string; bitrate: number };
  audio: { codec: string; channels: number }[];
}

export interface ClipProgress {
  percent: number;
  mode: ExportMode;
}

export interface ClipResult {
  output: string;
  mode: ExportMode;
  fellBack: boolean;
  segments: Segment[];
  source: string;
  duration: number;
  size: number;
}

export interface ClipLabel {
  head: string;
  tail: string;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
  clipped: boolean;
  label: ClipLabel;
  /** Originals only: how many clips in the workspace were cut from this video. */
  clips?: number;
}

export interface WorkspaceDir {
  path: string;
  name: string;
  dirs: WorkspaceDir[];
  files: WorkspaceFile[];
  total: number;
  missing?: boolean;
}

export interface MediaDoc {
  path: string;
  name: string;
  dir: string;
  url: string;
  info: VideoInfo;
}

export interface ExportPlan {
  mode: ExportMode;
  name: string;
  dir: string;
}

export interface ExportJob {
  input: string;
  segments: Segment[];
  outputDir?: string | null;
  name?: string;
}

export type ProxyLevel = 'remux' | 'transcode';
export type Theme = 'dark' | 'light';

export interface UpdateInfo {
  /** available: a newer version exists; none: already current; unsupported: not an installed build. */
  status: 'available' | 'none' | 'unsupported';
  current: string;
  version: string;
}

/** Events the main process pushes to the page, with their payloads. */
export interface ApiEvents {
  'export:progress': ClipProgress;
  'media:proxy-progress': { path: string; percent: number };
  'workspace:changed': undefined;
  'app:open-file': string;
  'update:progress': { percent: number };
}

/** The API the preload script exposes to the page as window.clipgoat. */
export interface ClipGoatApi {
  platform: string;
  pathForFile(file: File): string;
  openFile(): Promise<string | null>;
  openFolder(): Promise<string | null>;
  scan(roots: string[], hidden: string[]): Promise<WorkspaceDir[]>;
  defaultRoot(): Promise<string>;
  moveFile(src: string, destDir: string): Promise<string>;
  renameFile(src: string, stem: string): Promise<string>;
  trashFile(filePath: string): Promise<void>;
  restoreFile(filePath: string): Promise<string>;
  probe(filePath: string): Promise<MediaDoc>;
  keyframes(filePath: string, startTime: number): Promise<number[]>;
  proxy(filePath: string, level: ProxyLevel, duration: number): Promise<string>;
  cancelProxy(): Promise<void>;
  plan(input: string, segments: Segment[], fps: number, outputDir: string | null): Promise<ExportPlan>;
  exportClip(job: ExportJob): Promise<ClipResult>;
  cancelExport(): Promise<void>;
  showInFolder(filePath: string): Promise<void>;
  setTheme(theme: Theme): Promise<void>;
  initialFile(): Promise<string | null>;
  checkUpdate(): Promise<UpdateInfo>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  on<K extends keyof ApiEvents>(channel: K, listener: (payload: ApiEvents[K]) => void): () => void;
}

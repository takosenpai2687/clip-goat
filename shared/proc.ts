import { spawn } from 'node:child_process';

export class ClipError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'ClipError';
    this.code = code;
    this.detail = detail;
  }
}

/** Reads the code off anything that was thrown. */
export function errorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface RunOptions {
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Spawns a binary; resolves with exit code and captured output. Rejects only on spawn failure or abort.
export function run(bin: string, args: string[], { signal, onStdoutLine }: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new ClipError('ABORTED', 'Cancelled'));
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let pending = '';
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      child.kill();
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (!onStdoutLine) {
        stdout += chunk;
        return;
      }
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) onStdoutLine(line);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new ClipError('SPAWN_FAILED', `Cannot run ${bin}: ${err.message}`));
    });
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (aborted) return reject(new ClipError('ABORTED', 'Cancelled'));
      if (onStdoutLine && pending) onStdoutLine(pending);
      resolve({ code, stdout, stderr });
    });
  });
}

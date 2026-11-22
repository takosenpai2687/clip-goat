'use strict';

const { spawn } = require('node:child_process');

class ClipError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ClipError';
    this.code = code;
    this.detail = detail;
  }
}

// Spawns a binary; resolves with exit code and captured output. Rejects only on spawn failure or abort.
function run(bin, args, { signal, onStdoutLine } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new ClipError('ABORTED', 'Cancelled'));
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new ClipError('SPAWN_FAILED', `Cannot run ${bin}: ${err.message}`));
    }

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
    child.stdout.on('data', (chunk) => {
      if (!onStdoutLine) {
        stdout += chunk;
        return;
      }
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) onStdoutLine(line);
    });
    child.stderr.on('data', (chunk) => {
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

module.exports = { ClipError, run };

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import process from 'node:process';
import path from 'node:path'; // Imported path module

const require = createRequire(import.meta.url);

const projectRoot = process.cwd();
const host = '127.0.0.1';
const port = 5173;
const devUrl = `http://${host}:${port}/`;

// Manually construct the path to bypass Node's strict "exports" restrictions
const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const electronExecutable = require('electron');

let viteProcess = null;
let electronProcess = null;
let shuttingDown = false;

function startChild(executable, args, options = {}) {
  return spawn(executable, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    windowsHide: false,
    ...options
  });
}

function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();

        if (
          response.statusCode &&
          response.statusCode >= 200 &&
          response.statusCode < 500
        ) {
          resolve();
          return;
        }

        retry();
      });

      request.setTimeout(1000);

      request.on('timeout', () => {
        request.destroy();
        retry();
      });

      request.on('error', retry);
    };

    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            `Vite did not become available at ${url} within ${timeoutMs} ms.`
          )
        );
        return;
      }

      setTimeout(attempt, 250);
    };

    attempt();
  });
}

function terminateChild(child) {
  if (!child || child.killed) return;

  if (process.platform === 'win32' && child.pid) {
    const killer = spawn(
      'taskkill.exe',
      ['/pid', String(child.pid), '/t', '/f'],
      {
        stdio: 'ignore',
        shell: false,
        windowsHide: true
      }
    );

    killer.unref();
    return;
  }

  child.kill('SIGTERM');
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  terminateChild(electronProcess);
  terminateChild(viteProcess);

  setTimeout(() => process.exit(exitCode), 500);
}

async function main() {
  console.log(`Starting Vite at ${devUrl}`);

  viteProcess = startChild(process.execPath, [
    viteCli,
    '--host',
    host,
    '--port',
    String(port),
    '--strictPort'
  ]);

  viteProcess.on('error', (error) => {
    console.error('Failed to start Vite:', error);
    shutdown(1);
  });

  viteProcess.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`Vite exited unexpectedly with code ${code}.`);
      shutdown(code ?? 1);
    }
  });

  console.log(`Waiting for Vite at ${devUrl}`);
  await waitForServer(devUrl);

  console.log('Vite is ready. Starting Electron.');

  electronProcess = startChild(
    electronExecutable,
    ['.'],
    {
      env: {
        ...process.env,
        NVIEWER_DEV_URL: devUrl,
        ELECTRON_ENABLE_LOGGING: '1'
      }
    }
  );

  electronProcess.on('error', (error) => {
    console.error('Failed to start Electron:', error);
    shutdown(1);
  });

  electronProcess.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`Electron exited with code ${code}.`);
      shutdown(code ?? 0);
    }
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

process.on('uncaughtException', (error) => {
  console.error('Development launcher error:', error);
  shutdown(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Development launcher rejection:', reason);
  shutdown(1);
});

main().catch((error) => {
  console.error('Unable to start development mode:', error);
  shutdown(1);
});
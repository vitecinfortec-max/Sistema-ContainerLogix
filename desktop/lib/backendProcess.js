const { spawn, execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pythonExe, backendDir, runtimeAppDir, runtimeBackendDir } = require('./paths');

const EXCLUDED_DIR_NAMES = new Set(['venv', '.venv', 'tests', 'scripts', '__pycache__']);
const EXCLUDED_FILE_NAMES = new Set(['.env', 'requirements.txt', 'requirements-desktop.txt']);

function shouldCopy(srcPath) {
  const base = path.basename(srcPath);
  if (EXCLUDED_DIR_NAMES.has(base) || EXCLUDED_FILE_NAMES.has(base)) return false;
  if (base.endsWith('.pyc')) return false;
  return true;
}

// Copia o código do backend (somente leitura, dentro dos resources empacotados em
// produção; direto do repositório em dev) para uma pasta gravável em userData antes
// de cada start, mantendo 'backend' e 'uploads' como pastas irmãs — é o mesmo layout
// que server.py já espera (UPLOADS_DIR = ROOT_DIR.parent / 'uploads'), sem precisar
// alterar o server.py. Exclui venv/tests/scripts/__pycache__/.env (não fazem parte
// do runtime e, em dev, venv sozinho já inviabilizaria copiar a cada start).
function syncBackendToRuntimeDir() {
  fs.mkdirSync(runtimeAppDir(), { recursive: true });
  fs.rmSync(runtimeBackendDir(), { recursive: true, force: true });
  fs.cpSync(backendDir(), runtimeBackendDir(), { recursive: true, filter: shouldCopy });
}

function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/' }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timeout esperando o backend responder em 127.0.0.1:${port}`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

function startBackend(config) {
  syncBackendToRuntimeDir();

  const env = {
    ...process.env,
    MONGO_URL: `mongodb://127.0.0.1:${config.mongoPort}`,
    DB_NAME: 'containerlogix',
    CORS_ORIGINS: `http://127.0.0.1:${config.staticPort}`,
    JWT_SECRET_KEY: config.jwtSecret,
  };

  const child = spawn(
    pythonExe(),
    ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(config.backendPort)],
    { cwd: runtimeBackendDir(), env, stdio: 'ignore' }
  );
  return child;
}

// No Windows, o PID que o Node devolve para o processo spawnado nem sempre é o
// PID "folha" de verdade (observado com python.exe: o child.pid some rápido e o
// processo real segue vivo com outro PID, filho dele). Por isso o taskkill /T
// (mata a árvore inteira) roda sempre no final, não só quando exitCode continua
// null — rodar num processo que já morreu é inofensivo (erro é só ignorado).
function stopProcess(child) {
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f']);
      } catch (e) {
        // já não havia nada rodando para matar
      }
      resolve();
    };
    if (child.exitCode !== null || child.killed) {
      finish();
      return;
    }
    child.once('exit', finish);
    child.kill();
    setTimeout(finish, 5000);
  });
}

module.exports = { startBackend, stopProcess, waitForHealth };

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { mongodExe, mongodumpExe, mongorestoreExe, mongoDataDir, uploadsDir } = require('./paths');

const BACKUPS_SUBDIR = 'ContainerLogix-Backups';

function waitForPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Timeout esperando o MongoDB local responder em ${host}:${port}`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

function startMongod(config) {
  fs.mkdirSync(mongoDataDir(), { recursive: true });
  const child = spawn(
    mongodExe(),
    ['--dbpath', mongoDataDir(), '--port', String(config.mongoPort), '--bind_ip', '127.0.0.1', '--quiet'],
    { stdio: 'ignore' }
  );
  return child;
}

// No Windows o PID que o Node devolve nem sempre é o PID "folha" de verdade (o
// processo real pode seguir vivo com outro PID, filho dele). Por isso o taskkill
// /T (mata a árvore inteira) roda sempre no final, não só quando exitCode
// continua null — rodar num processo que já morreu é inofensivo.
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

function isMongoDataEmpty() {
  const dir = mongoDataDir();
  if (!fs.existsSync(dir)) return true;
  return fs.readdirSync(dir).length === 0;
}

function findLatestBackup(driveBackupFolder) {
  const backupsRoot = path.join(driveBackupFolder, BACKUPS_SUBDIR);
  if (!fs.existsSync(backupsRoot)) return null;
  const entries = fs
    .readdirSync(backupsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('backup-'))
    .map((e) => e.name)
    .sort();
  if (entries.length === 0) return null;
  return path.join(backupsRoot, entries[entries.length - 1]);
}

// Restaura o backup mais recente do Drive para o banco/uploads locais. Só deve ser
// chamado com o mongod já no ar e antes do backend subir. Uma falha aqui (backup
// corrompido, pasta do Drive temporariamente inacessível, etc.) não pode travar o
// primeiro boot do app — nesse caso seguimos com o banco vazio e devolvemos o erro
// para quem chamou decidir se avisa o usuário.
function restoreFromDriveIfNeeded(config) {
  if (!isMongoDataEmpty()) return { restored: false };

  let latest;
  try {
    latest = findLatestBackup(config.driveBackupFolder);
  } catch (err) {
    return { restored: false, error: err };
  }
  if (!latest) return { restored: false };

  try {
    const archivePath = path.join(latest, 'dump.archive.gz');
    if (fs.existsSync(archivePath)) {
      execFileSync(mongorestoreExe(), [
        '--host', '127.0.0.1',
        '--port', String(config.mongoPort),
        '--archive=' + archivePath,
        '--gzip',
        '--drop',
      ]);
    }

    const backupUploadsDir = path.join(latest, 'uploads');
    if (fs.existsSync(backupUploadsDir)) {
      fs.mkdirSync(uploadsDir(), { recursive: true });
      fs.cpSync(backupUploadsDir, uploadsDir(), { recursive: true });
    }

    return { restored: true, from: latest };
  } catch (err) {
    return { restored: false, error: err };
  }
}

// Restaura um backup específico escolhido pelo usuário (via menu), substituindo
// todo o conteúdo atual do banco/uploads locais. Diferente de restoreFromDriveIfNeeded,
// pode ser chamada com o mongod já no ar e dados existentes — por isso é sempre uma
// ação explícita e destrutiva (--drop), nunca automática.
function restoreFromBackupDir(config, backupDir) {
  const archivePath = path.join(backupDir, 'dump.archive.gz');
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Arquivo de backup não encontrado em: ${archivePath}`);
  }

  execFileSync(mongorestoreExe(), [
    '--host', '127.0.0.1',
    '--port', String(config.mongoPort),
    '--archive=' + archivePath,
    '--gzip',
    '--drop',
  ]);

  const backupUploadsDir = path.join(backupDir, 'uploads');
  if (fs.existsSync(backupUploadsDir)) {
    fs.rmSync(uploadsDir(), { recursive: true, force: true });
    fs.mkdirSync(uploadsDir(), { recursive: true });
    fs.cpSync(backupUploadsDir, uploadsDir(), { recursive: true });
  }
}

function timestampForBackup() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pruneOldBackups(driveBackupFolder, keep) {
  const backupsRoot = path.join(driveBackupFolder, BACKUPS_SUBDIR);
  if (!fs.existsSync(backupsRoot)) return;
  const entries = fs
    .readdirSync(backupsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('backup-'))
    .map((e) => e.name)
    .sort();
  const toRemove = entries.slice(0, Math.max(0, entries.length - keep));
  for (const name of toRemove) {
    fs.rmSync(path.join(backupsRoot, name), { recursive: true, force: true });
  }
}

// Faz mongodump + cópia da pasta de uploads para dentro da pasta do Google Drive.
// O próprio Google Drive Desktop cuida da sincronização entre máquinas.
function runBackup(config) {
  const backupsRoot = path.join(config.driveBackupFolder, BACKUPS_SUBDIR);
  const backupDir = path.join(backupsRoot, `backup-${timestampForBackup()}`);
  fs.mkdirSync(backupDir, { recursive: true });

  execFileSync(mongodumpExe(), [
    '--host', '127.0.0.1',
    '--port', String(config.mongoPort),
    '--archive=' + path.join(backupDir, 'dump.archive.gz'),
    '--gzip',
  ]);

  if (fs.existsSync(uploadsDir())) {
    fs.cpSync(uploadsDir(), path.join(backupDir, 'uploads'), { recursive: true });
  }

  pruneOldBackups(config.driveBackupFolder, config.backupsToKeep);
  return backupDir;
}

module.exports = {
  startMongod,
  stopProcess,
  waitForPort,
  isMongoDataEmpty,
  restoreFromDriveIfNeeded,
  restoreFromBackupDir,
  runBackup,
};

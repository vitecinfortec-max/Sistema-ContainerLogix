const { dialog } = require('electron');
const fs = require('fs');
const crypto = require('crypto');
const { configPath } = require('./paths');

const DEFAULTS = {
  mongoPort: 27019,
  backendPort: 8000,
  staticPort: 3000,
  backupIntervalMinutes: 20,
  backupsToKeep: 5,
};

function loadConfig() {
  const file = configPath();
  if (fs.existsSync(file)) {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf-8')) };
  }
  return null;
}

function saveConfig(config) {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8');
}

// Executado uma única vez, na primeira abertura em cada máquina: pede a pasta do
// Google Drive que será usada como backup e gera a chave JWT local.
async function ensureConfig(parentWindow) {
  let config = loadConfig();
  if (config) return config;

  const result = await dialog.showOpenDialog(parentWindow, {
    title: 'Selecione a pasta do Google Drive para backup do ContainerLogix',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Usar esta pasta',
  });

  if (result.canceled || result.filePaths.length === 0) {
    throw new Error('É necessário escolher uma pasta do Google Drive para continuar.');
  }

  config = {
    ...DEFAULTS,
    driveBackupFolder: result.filePaths[0],
    jwtSecret: crypto.randomBytes(32).toString('hex'),
  };
  saveConfig(config);
  return config;
}

// Deixa o usuário trocar a pasta de backup depois (ex: reorganizou o Drive, trocou
// de conta). Não mexe em jwtSecret nem nas portas — só no destino do backup.
async function changeDriveFolder(parentWindow, currentConfig) {
  const result = await dialog.showOpenDialog(parentWindow, {
    title: 'Selecione a nova pasta do Google Drive para backup do ContainerLogix',
    defaultPath: currentConfig.driveBackupFolder,
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Usar esta pasta',
  });

  if (result.canceled || result.filePaths.length === 0) return currentConfig;

  const updated = { ...currentConfig, driveBackupFolder: result.filePaths[0] };
  saveConfig(updated);
  return updated;
}

module.exports = { loadConfig, saveConfig, ensureConfig, changeDriveFolder, DEFAULTS };

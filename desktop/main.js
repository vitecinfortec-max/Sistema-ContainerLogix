const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { ensureConfig, changeDriveFolder } = require('./lib/config');
const mongo = require('./lib/mongoProcess');
const backend = require('./lib/backendProcess');
const { startStaticServer } = require('./lib/staticServer');

const ICON_PATH = path.join(__dirname, 'icon.ico');

let mainWindow;
let mongodChild = null;
let backendChild = null;
let staticServer = null;
let backupTimer = null;
let appConfig = null;
let shuttingDown = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'ContainerLogix - Sistema de Movimentação de Contêineres',
    icon: ICON_PATH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#ffffff',
    show: false,
  });

  // A janela só aparece quando o login (URL real) estiver pronto pra exibir —
  // sem tela de "Iniciando..." no meio do caminho.
  mainWindow.once('ready-to-show', () => mainWindow.show());

  buildMenu();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function buildMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Recarregar',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload(),
        },
        {
          label: 'Tela Cheia',
          accelerator: 'F11',
          click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()),
        },
        { type: 'separator' },
        {
          label: 'Fazer Backup Agora',
          click: () => runBackupNow(),
        },
        {
          label: 'Abrir Pasta de Backups',
          click: () => openBackupsFolder(),
        },
        {
          label: 'Trocar Pasta de Backup do Google Drive...',
          click: () => changeBackupFolder(),
        },
        { type: 'separator' },
        {
          label: 'Sair',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Desfazer', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Refazer', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Recortar', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copiar', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Colar', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Selecionar Tudo', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 1),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 1),
        },
        {
          label: 'Zoom Padrão',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow.webContents.setZoomLevel(0),
        },
        { type: 'separator' },
        {
          label: 'Ferramentas do Desenvolvedor',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Sobre',
          click: () => showAboutWindow(),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAboutWindow() {
  const aboutWindow = new BrowserWindow({
    width: 400,
    height: 300,
    parent: mainWindow,
    modal: true,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    icon: ICON_PATH,
  });

  aboutWindow.loadURL(
    `data:text/html,` +
      encodeURIComponent(`
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 40px;
                background: linear-gradient(135deg, #3B9BA8 0%, #FF8A3D 100%); color: white; }
              h1 { margin: 20px 0; }
              p { margin: 10px 0; }
            </style>
          </head>
          <body>
            <h1>ContainerLogix</h1>
            <p><strong>Sistema de Movimentação de Contêineres</strong></p>
            <p>Versão 1.0.0 — Desktop (offline)</p>
            <br>
            <p>J.A Logística</p>
            <p style="font-size: 12px;">© 2026 Todos os direitos reservados</p>
          </body>
        </html>
      `)
  );

  aboutWindow.once('ready-to-show', () => aboutWindow.show());
}

async function runBackupNow() {
  if (!appConfig) return;
  try {
    await mongo.runBackup(appConfig);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Backup concluído',
      message: 'Backup salvo na pasta do Google Drive configurada.',
    });
  } catch (err) {
    dialog.showErrorBox('Falha no backup', String(err.message || err));
  }
}

function openBackupsFolder() {
  if (!appConfig) return;
  const backupsRoot = path.join(appConfig.driveBackupFolder, 'ContainerLogix-Backups');
  fs.mkdirSync(backupsRoot, { recursive: true });
  shell.openPath(backupsRoot);
}

async function changeBackupFolder() {
  if (!appConfig) return;
  appConfig = await changeDriveFolder(mainWindow, appConfig);
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Pasta de backup atualizada',
    message: `Novos backups serão salvos em:\n${appConfig.driveBackupFolder}`,
  });
}

async function bootServices() {
  appConfig = await ensureConfig(mainWindow);

  mongodChild = mongo.startMongod(appConfig);
  await mongo.waitForPort(appConfig.mongoPort, '127.0.0.1', 60000);

  const restoreResult = mongo.restoreFromDriveIfNeeded(appConfig);

  backendChild = backend.startBackend(appConfig);
  await backend.waitForHealth(appConfig.backendPort, 60000);

  staticServer = await startStaticServer(appConfig.staticPort);

  backupTimer = setInterval(() => {
    mongo.runBackup(appConfig).catch((err) => console.error('Backup periódico falhou:', err));
  }, appConfig.backupIntervalMinutes * 60 * 1000);

  // O frontend registra um Service Worker de PWA (pensado pra versão em nuvem, num
  // navegador de verdade). Aqui dentro do Electron isso só serve pra prender a UI
  // numa versão antiga em cache entre atualizações do app — limpa antes de carregar.
  await mainWindow.webContents.session.clearStorageData({
    storages: ['serviceworkers', 'cachestorage'],
  });

  mainWindow.loadURL(`http://127.0.0.1:${appConfig.staticPort}`);

  // Um backup corrompido/inacessível não pode travar o boot (o app já segue com
  // banco vazio) — mas o usuário precisa saber que a continuidade falhou desta vez.
  if (restoreResult.error) {
    dialog.showErrorBox(
      'Não foi possível restaurar o backup anterior',
      `O ContainerLogix vai iniciar com um banco novo. Detalhe do erro:\n${restoreResult.error.message || restoreResult.error}`
    );
  }
}

async function shutdownServices() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (backupTimer) clearInterval(backupTimer);

  if (appConfig) {
    try {
      await mongo.runBackup(appConfig);
    } catch (err) {
      console.error('Backup final falhou:', err);
    }
  }

  if (staticServer) {
    await new Promise((resolve) => staticServer.close(resolve));
  }
  await backend.stopProcess(backendChild);
  await mongo.stopProcess(mongodChild);
}

app.whenReady().then(async () => {
  createWindow();
  try {
    await bootServices();
  } catch (err) {
    console.error('Falha ao iniciar o ContainerLogix:', err);
    dialog.showErrorBox('Erro ao iniciar o ContainerLogix', String(err.message || err));
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  await shutdownServices();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (!shuttingDown) {
    event.preventDefault();
    await shutdownServices();
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
    bootServices().catch((err) => dialog.showErrorBox('Erro ao iniciar o ContainerLogix', String(err.message || err)));
  }
});

process.on('uncaughtException', (error) => {
  console.error('Erro não tratado:', error);
});

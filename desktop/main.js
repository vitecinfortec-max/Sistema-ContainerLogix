const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// URL da aplicação web
const APP_URL = 'https://container-mvmt-sys.preview.emergentagent.com';

let mainWindow;

function createWindow() {
  // Criar a janela do navegador
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'ContainerLogix - Sistema de Movimentação de Contêineres',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#ffffff',
    show: false
  });

  // Carregar a aplicação web
  mainWindow.loadURL(APP_URL);

  // Mostrar janela quando estiver pronta
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Criar menu personalizado
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Recarregar',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow.reload();
          }
        },
        {
          label: 'Tela Cheia',
          accelerator: 'F11',
          click: () => {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        },
        { type: 'separator' },
        {
          label: 'Sair',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
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
        { label: 'Selecionar Tudo', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: 'Visualizar',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(currentZoom + 1);
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(currentZoom - 1);
          }
        },
        {
          label: 'Zoom Padrão',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            mainWindow.webContents.setZoomLevel(0);
          }
        },
        { type: 'separator' },
        {
          label: 'Ferramentas do Desenvolvedor',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Sobre',
          click: () => {
            const aboutWindow = new BrowserWindow({
              width: 400,
              height: 300,
              parent: mainWindow,
              modal: true,
              show: false,
              resizable: false,
              minimizable: false,
              maximizable: false
            });

            aboutWindow.loadURL(`data:text/html,
              <html>
                <head>
                  <style>
                    body {
                      font-family: Arial, sans-serif;
                      text-align: center;
                      padding: 40px;
                      background: linear-gradient(135deg, #3B9BA8 0%, #FF8A3D 100%);
                      color: white;
                    }
                    h1 { margin: 20px 0; }
                    p { margin: 10px 0; }
                  </style>
                </head>
                <body>
                  <h1>ContainerLogix</h1>
                  <p><strong>Sistema de Movimentação de Contêineres</strong></p>
                  <p>Versão 1.0.0</p>
                  <br>
                  <p>J.A Logística</p>
                  <p>Logística e Armazenagem</p>
                  <br>
                  <p style="font-size: 12px;">© 2026 Todos os direitos reservados</p>
                </body>
              </html>
            `);

            aboutWindow.once('ready-to-show', () => {
              aboutWindow.show();
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Eventos da janela
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevenir links externos de abrir em nova janela
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Permitir apenas links do mesmo domínio
    if (url.startsWith(APP_URL)) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });
}

// Quando o Electron terminar a inicialização
app.whenReady().then(createWindow);

// Quit quando todas as janelas forem fechadas
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Tratamento de erros
process.on('uncaughtException', (error) => {
  console.error('Erro não tratado:', error);
});

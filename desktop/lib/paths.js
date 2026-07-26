const { app } = require('electron');
const path = require('path');

// Em produção os binários/recursos ficam em process.resourcesPath (extraResources
// do electron-builder). Em desenvolvimento usamos a pasta desktop/resources direto.
function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources');
}

function pythonExe() {
  return path.join(resourcesRoot(), 'python-runtime', 'python.exe');
}

function mongodExe() {
  return path.join(resourcesRoot(), 'mongo-bin', 'mongod.exe');
}

function mongodumpExe() {
  return path.join(resourcesRoot(), 'mongo-bin', 'mongodump.exe');
}

function mongorestoreExe() {
  return path.join(resourcesRoot(), 'mongo-bin', 'mongorestore.exe');
}

// backend/ e frontend/build só existem dentro de resourcesRoot() depois de
// empacotado (electron-builder copia via extraResources). Em desenvolvimento
// (yarn start) apontamos direto para o código-fonte do repositório, para não
// depender de uma cópia manual em desktop/resources.
function backendDir() {
  return app.isPackaged
    ? path.join(resourcesRoot(), 'backend')
    : path.join(__dirname, '..', '..', 'backend');
}

function frontendBuildDir() {
  return app.isPackaged
    ? path.join(resourcesRoot(), 'frontend-build')
    : path.join(__dirname, '..', '..', 'frontend', 'build');
}

// Dados do usuário: sempre em userData (gravável), nunca dentro dos resources
// empacotados (que costumam ficar em Program Files, somente leitura).
function userDataDir() {
  return app.getPath('userData');
}

// server.py calcula UPLOADS_DIR = ROOT_DIR.parent / 'uploads' (sem ler nenhuma env
// var para isso). Para não mexer nessa lógica, copiamos o backend para dentro de
// userData em cada start e mantemos 'backend' e 'uploads' como pastas irmãs aqui,
// exatamente como no layout original do repositório.
function runtimeAppDir() {
  return path.join(userDataDir(), 'app');
}

function runtimeBackendDir() {
  return path.join(runtimeAppDir(), 'backend');
}

function mongoDataDir() {
  return path.join(userDataDir(), 'mongo-data');
}

function uploadsDir() {
  return path.join(runtimeAppDir(), 'uploads');
}

function configPath() {
  return path.join(userDataDir(), 'config.json');
}

module.exports = {
  resourcesRoot,
  pythonExe,
  mongodExe,
  mongodumpExe,
  mongorestoreExe,
  backendDir,
  frontendBuildDir,
  userDataDir,
  runtimeAppDir,
  runtimeBackendDir,
  mongoDataDir,
  uploadsDir,
  configPath,
};

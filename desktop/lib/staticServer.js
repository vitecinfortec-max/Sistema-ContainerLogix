// Servidor estático mínimo para o build do React (evita o problema clássico de
// caminhos absolutos '/static/...' quebrando ao carregar via file:// no Electron).
// Equivalente local ao "serve -s build -l 3000" usado em scripts_servico/start_frontend.bat.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { frontendBuildDir } = require('./paths');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function startStaticServer(port) {
  const root = frontendBuildDir();
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(root, urlPath);

    // Impede escapar da pasta do build via '..'
    if (!filePath.startsWith(root)) {
      filePath = root;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // fallback de SPA: qualquer rota desconhecida cai no index.html
        filePath = path.join(root, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startStaticServer };

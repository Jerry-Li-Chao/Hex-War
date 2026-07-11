const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

http.createServer((request, response) => {
  const requested = decodeURIComponent(request.url.split('?')[0]);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  });
}).listen(4173, '127.0.0.1', () => {
  console.log('Cellularis preview: http://127.0.0.1:4173');
});

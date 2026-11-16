const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const INDEX = path.join(__dirname, 'public', 'index.html');

fs.mkdirSync(DATA_DIR, { recursive: true });

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/state' && req.method === 'GET') {
    if (!fs.existsSync(STATE_FILE)) return send(res, 404, '{}');
    return send(res, 200, fs.readFileSync(STATE_FILE));
  }

  if (url === '/api/state' && req.method === 'PUT') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data || !Array.isArray(data.groups)) throw new Error('bad state');
        const tmp = STATE_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, STATE_FILE);
        send(res, 200, '{"ok":true}');
      } catch (e) {
        send(res, 400, '{"error":"invalid state"}');
      }
    });
    return;
  }

  if (url === '/healthz') return send(res, 200, 'ok', 'text/plain');

  if (req.method === 'GET') return send(res, 200, fs.readFileSync(INDEX), 'text/html; charset=utf-8');

  send(res, 405, '{"error":"method not allowed"}');
}).listen(PORT, () => console.log(`Listening on ${PORT}, data in ${DATA_DIR}`));

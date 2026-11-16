const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
const INDEX = path.join(__dirname, 'public', 'index.html');
const ANSWERS = path.join(__dirname, 'public', 'answers.html');

fs.mkdirSync(DATA_DIR, { recursive: true });

// Initial list, embedded in index.html — used until the supplier saves anything.
function initialState() {
  const m = fs.readFileSync(INDEX, 'utf8').match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/);
  return m ? m[1] : '{}';
}
function currentState() {
  return fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf8') : initialState();
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

// Optional password for the answers page (set ADMIN_PASSWORD on Railway).
function adminOk(req, res) {
  if (!ADMIN_PASSWORD) return true;
  const h = req.headers.authorization || '';
  const pass = h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':') : '';
  if (pass === ADMIN_PASSWORD) return true;
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Dominus Build", charset="UTF-8"' });
  res.end('Потрібен пароль');
  return false;
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/state' && req.method === 'GET') return send(res, 200, currentState());

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
        fs.appendFileSync(HISTORY_FILE, JSON.stringify({ ts: new Date().toISOString(), state: data }) + '\n');
        send(res, 200, '{"ok":true}');
      } catch (e) {
        send(res, 400, '{"error":"invalid state"}');
      }
    });
    return;
  }

  if (url === '/api/history' && req.method === 'GET') {
    if (!adminOk(req, res)) return;
    const lines = fs.existsSync(HISTORY_FILE) ? fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean) : [];
    return send(res, 200, JSON.stringify({ initial: JSON.parse(initialState()), saves: lines.map(l => JSON.parse(l)) }));
  }

  if (url === '/healthz') return send(res, 200, 'ok', 'text/plain');

  if ((url === '/answers' || url === '/answers/') && req.method === 'GET') {
    if (!adminOk(req, res)) return;
    return send(res, 200, fs.readFileSync(ANSWERS), 'text/html; charset=utf-8');
  }

  if (req.method === 'GET') return send(res, 200, fs.readFileSync(INDEX), 'text/html; charset=utf-8');

  send(res, 405, '{"error":"method not allowed"}');
}).listen(PORT, () => console.log(`Listening on ${PORT}, data in ${DATA_DIR}`));

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const RESP_DIR = path.join(DATA_DIR, 'responses');
const INDEX = path.join(__dirname, 'public', 'index.html');
const ANSWERS = path.join(__dirname, 'public', 'answers.html');
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_SAVES = 3000;

fs.mkdirSync(RESP_DIR, { recursive: true });

// Blank list embedded in index.html — every visitor starts from it.
function initialState() {
  const m = fs.readFileSync(INDEX, 'utf8').match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/);
  return JSON.parse(m ? m[1] : '{}');
}

const respFile = id => path.join(RESP_DIR, id + '.json');
function readResp(id) {
  try { return JSON.parse(fs.readFileSync(respFile(id), 'utf8')); } catch { return null; }
}
function writeResp(r) {
  const tmp = respFile(r.id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(r));
  fs.renameSync(tmp, respFile(r.id));
}
function allResps() {
  return fs.readdirSync(RESP_DIR).filter(f => f.endsWith('.json')).map(f => readResp(f.slice(0, -5))).filter(Boolean)
    .sort((a, b) => a.created.localeCompare(b.created));
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
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

function readBody(req, cb) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
  req.on('end', () => cb(body));
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const m = url.match(/^\/api\/responses\/([^/]+)$/);

  // Supplier autosave: one file per visit.
  if (m && req.method === 'PUT') {
    const id = m[1];
    if (!ID_RE.test(id)) return send(res, 400, { error: 'bad id' });
    return readBody(req, body => {
      try {
        const state = JSON.parse(body);
        if (!state || !Array.isArray(state.groups)) throw new Error('bad state');
        const now = new Date().toISOString();
        const r = readResp(id) || { id, created: now, saves: [] };
        r.updated = now;
        r.saves.push({ ts: now, state });
        if (r.saves.length > MAX_SAVES) r.saves.splice(0, r.saves.length - MAX_SAVES);
        writeResp(r);
        send(res, 200, { ok: true });
      } catch (e) { send(res, 400, { error: 'invalid state' }); }
    });
  }

  if (url === '/api/responses' && req.method === 'GET') {
    if (!adminOk(req, res)) return;
    return send(res, 200, {
      responses: allResps().map(r => ({ id: r.id, created: r.created, updated: r.updated, state: r.saves[r.saves.length - 1].state })),
    });
  }

  if (m && req.method === 'GET') {
    if (!adminOk(req, res)) return;
    const r = ID_RE.test(m[1]) && readResp(m[1]);
    if (!r) return send(res, 404, { error: 'not found' });
    return send(res, 200, { ...r, initial: initialState() });
  }

  if (m && req.method === 'DELETE') {
    if (!adminOk(req, res)) return;
    if (!ID_RE.test(m[1])) return send(res, 400, { error: 'bad id' });
    try { fs.unlinkSync(respFile(m[1])); } catch {}
    return send(res, 200, { ok: true });
  }

  if (url === '/healthz') return send(res, 200, 'ok', 'text/plain');

  if ((url === '/answers' || url === '/answers/') && req.method === 'GET') {
    if (!adminOk(req, res)) return;
    return send(res, 200, fs.readFileSync(ANSWERS), 'text/html; charset=utf-8');
  }

  if (req.method === 'GET') return send(res, 200, fs.readFileSync(INDEX), 'text/html; charset=utf-8');

  send(res, 405, { error: 'method not allowed' });
}).listen(PORT, () => console.log(`Listening on ${PORT}, data in ${DATA_DIR}`));

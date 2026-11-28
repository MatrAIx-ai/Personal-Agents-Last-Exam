// apps/personal-records/scripts/run-gui.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PersonalRecordsApp } = require('../src/index.cjs');

const DB_PATH = path.join(__dirname, '../.records.db');
const BLOB_DIR = path.join(__dirname, '../.records_blobs');

const app = new PersonalRecordsApp({ dbPath: DB_PATH, blobDir: BLOB_DIR });

// Ensure SQLite WAL mode for instant multi-process visibility
app.db.exec('PRAGMA journal_mode = WAL;');

// Seed benchmark fixtures into acc_demo_user so they appear in the GUI
const truth = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/truth.json'), 'utf-8'));
truth.account_id = 'acc_demo_user'; 
app.seed(truth);

console.log(`\n[+] Database loaded from: ${DB_PATH}`);
console.log(`[+] Seeded benchmark documents into 'acc_demo_user'.`);

const GUI_DIR = path.join(__dirname, '../gui');
const PORT = 3000;

const server = http.createServer(async (req, res) => {
  // 1. Tool execution API bridge
  if (req.method === 'GET' && req.url.startsWith('/api/snapshot')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const accountId = url.searchParams.get('account_id') || 'acc_demo_user';
    const snap = app.snapshot(accountId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(snap));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/tools/call') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { name, params, context } = JSON.parse(body);
        const result = await app.callTool(name, params, context);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, code: err.code }));
      }
    });
    return;
  }

  // 2. Static GUI files
  let reqPath = req.url === '/' ? 'index.html' : req.url;
  let filePath = path.join(GUI_DIR, reqPath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript'
  };

  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
  res.end(fs.readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` Personal Records Web Host running!`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
/* Statischer Dev-Server fuer NöMap. Ohne Abhaengigkeiten.
 *
 * Warum nicht `python3 -m http.server`: dessen __main__-Block ruft beim Start
 * os.getcwd() auf, um den Default fuer --directory zu setzen. Wird der Prozess
 * aus einem Verzeichnis gestartet, das er nicht lesen darf, stirbt er dort mit
 * PermissionError — noch bevor irgendein Argument ausgewertet wird.
 *
 * Dieser Server leitet seinen Wurzelpfad aus __dirname ab und ist damit vom
 * Arbeitsverzeichnis vollstaendig unabhaengig.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8123;

/* Korrekte MIME-Typen sind hier nicht optional: der Browser verweigert
 * <script type="module">, wenn der Typ kein JavaScript-MIME ist. */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('bad request');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.resolve(ROOT, '.' + pathname);

  /* Pfadausbruch verhindern — ..%2f darf nicht aus ROOT herausfuehren. */
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('forbidden');
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('not found: ' + pathname);
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store', // Dev: immer frisch
    });
    res.end(buf);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} ist belegt. Anderen Prozess beenden oder PORT setzen.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`noemap -> http://localhost:${PORT}  (root: ${ROOT})`);
});

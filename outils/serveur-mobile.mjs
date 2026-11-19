// Serveur local de l'app mobile (sans Vercel) : fichiers statiques + fonctions api/*.js.
// Usage : node outils/serveur-mobile.mjs [port]   (defaut 4300). Mode demo : aucune cle lue ici.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RACINE = path.resolve(import.meta.dirname, '..', 'mobile');
const PORT = Number(process.argv[2] || 4300);
process.env.CAPTURE_DEMO = '1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

async function fichier(p) {
  for (const c of [p, p + '.html', path.join(p, 'index.html')]) {
    try { if ((await stat(c)).isFile()) return c; } catch {}
  }
  return null;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.writeHead(302, { Location: '/capture' + u.search }); return res.end(); }
  if (u.pathname === '/rbooks') { res.writeHead(301, { Location: '/nbooks' }); return res.end(); }
  if (u.pathname.startsWith('/api/') && !u.pathname.includes('_')) {
    const mod = await import(pathToFileURL(path.join(RACINE, u.pathname + '.js')).href).catch(() => null);
    if (!mod) { res.writeHead(404); return res.end(); }
    let corps = '';
    for await (const c of req) corps += c;
    req.body = corps ? (() => { try { return JSON.parse(corps); } catch { return corps; } })() : undefined;
    res.status = (s) => { res.statusCode = s; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    return mod.default(req, res);
  }
  const p = path.join(RACINE, decodeURIComponent(u.pathname));
  if (!p.startsWith(RACINE)) { res.writeHead(403); return res.end(); }
  const f = await fichier(p);
  if (!f || path.basename(f).startsWith('.')) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
}).listen(PORT, () => console.log('NCapture mobile : http://localhost:' + PORT + '/capture'));

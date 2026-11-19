// Stockage partagé de la démo (téléphone -> ordinateur).
// Ordre : Vercel Blob (BLOB_READ_WRITE_TOKEN), Upstash Redis REST (KV_REST_API_URL/TOKEN), sinon mémoire (non fiable).
// NCapture (NEKHEVI), démo NBooks, AGPL-3.0.
const PREFIX = 'demo-factures/';
const ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KV_KEY = 'rbooks-demo:factures';

export function mode() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'blob';
  if (KV_URL && KV_TOKEN) return 'kv';
  return 'memoire';
}

async function kv(cmd) {
  const r = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error('kv ' + (j.error || r.status));
  return j.result;
}

const mem = () => (globalThis.__rbooksDemo ||= []);

export async function lister() {
  const m = mode();
  if (m === 'kv') return ((await kv(['LRANGE', KV_KEY, '0', '199'])) || []).map((s) => JSON.parse(s));
  if (m === 'memoire') return [...mem()];
  const b = await import('@vercel/blob');
  const { blobs } = await b.list({ prefix: PREFIX, limit: 200 });
  const out = await Promise.all(blobs.map(async (x) => {
    try {
      if (ACCESS === 'public') return await (await fetch(x.url, { cache: 'no-store' })).json();
      const g = await b.get(x.pathname, { access: 'private' });
      return g && g.stream ? JSON.parse(await new Response(g.stream).text()) : null;
    } catch { return null; }
  }));
  return out.filter(Boolean).sort((a, b2) => String(b2.recu).localeCompare(String(a.recu)));
}

export async function ajouter(f) {
  const m = mode();
  if (m === 'kv') { await kv(['LPUSH', KV_KEY, JSON.stringify(f)]); await kv(['LTRIM', KV_KEY, '0', '199']); return; }
  if (m === 'memoire') { mem().unshift(f); return; }
  const b = await import('@vercel/blob');
  await b.put(`${PREFIX}${f.id}.json`, JSON.stringify(f), { access: ACCESS, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
}

export async function vider() {
  const m = mode();
  if (m === 'kv') { await kv(['DEL', KV_KEY]); return; }
  if (m === 'memoire') { mem().length = 0; return; }
  const b = await import('@vercel/blob');
  const { blobs } = await b.list({ prefix: PREFIX, limit: 1000 });
  if (blobs.length) await b.del(blobs.map((x) => x.url));
}

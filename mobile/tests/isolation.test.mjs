// Isolation multi-clients de NCapture, contre une pile Supabase LOCALE seulement (supabase start).
// Variables (par leur nom) : NEKHEVI_SUPABASE_URL, NEKHEVI_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (locale).
// Tout est fictif et créé ici (comptes @exemple.test, orgs « test-ncapture-* »), puis supprimé.
// Lancer : node --test tests/   (depuis le dossier mobile)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

import factures from '../api/factures.js';
import documents from '../api/documents.js';
import lire from '../api/lire.js';
import moi from '../api/moi.js';
import sessionApi from '../api/session.js';

const URL_SB = process.env.NEKHEVI_SUPABASE_URL;
const ANON = process.env.NEKHEVI_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SB || !ANON || !SERVICE) throw new Error('Variables de la pile locale manquantes');
if (!['127.0.0.1', 'localhost'].includes(new URL(URL_SB).hostname)) throw new Error('Ces tests ne roulent que sur la pile locale.');
delete process.env.ANTHROPIC_API_KEY; // aucune lecture IA réelle pendant les tests
delete process.env.NCAPTURE_CODE_REPLI;

const RUN = Date.now().toString(36);
const MDP = `Essai-${RUN}-Zz9!`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL_SB, SERVICE, opts);
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const userIds = [], orgIds = [];

/** Appelle un gestionnaire Vercel avec une fausse requête ; renvoie { status, body, cookies, location }. */
function appel(h, { method = 'GET', url = '/api/x', headers = {}, body } = {}) {
  return new Promise((ok, ko) => {
    const res = {
      statusCode: 200, h: {},
      setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; },
      status(s) { this.statusCode = s; return this; },
      json(o) { ok({ status: this.statusCode, body: o, cookies: [].concat(this.h['set-cookie'] || []), location: this.h.location }); return this; },
      end() { ok({ status: this.statusCode, body: null, cookies: [].concat(this.h['set-cookie'] || []), location: this.h.location }); return this; },
    };
    const u = new URL(url, 'http://localhost');
    const req = { method, url, headers: { host: 'localhost', ...headers }, body, query: Object.fromEntries(u.searchParams) };
    Promise.resolve(h(req, res)).catch(ko);
  });
}

async function personne(label) {
  const email = `ncapture.${label}.${RUN}@exemple.test`;
  const { data, error } = await service.auth.admin.createUser({ email, password: MDP, email_confirm: true });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  userIds.push(data.user.id);
  const db = createClient(URL_SB, ANON, opts);
  const s = await db.auth.signInWithPassword({ email, password: MDP });
  if (s.error) throw new Error(`signIn ${label}: ${s.error.message}`);
  const cookie = `nc_at=${encodeURIComponent(s.data.session.access_token)}; nc_rt=${encodeURIComponent(s.data.session.refresh_token)}`;
  return { id: data.user.id, email, db, cookie };
}

async function org(label, membres) {
  const { data, error } = await service.from('organizations').insert({ name: `Test NCapture ${label}`, slug: `test-ncapture-${label}-${RUN}`, brand_accent: '#2266AA' }).select('id').single();
  if (error) throw new Error(`org ${label}: ${error.message}`);
  orgIds.push(data.id);
  for (const [p, role] of membres) {
    const r = await service.from('members').insert({ org_id: data.id, user_id: p.id, role });
    if (r.error) throw new Error(`member: ${r.error.message}`);
  }
  return data.id;
}

const H = (p, orgId, extra = {}) => ({ cookie: p.cookie, 'x-ncapture': '1', ...(orgId ? { 'x-ncapture-org': orgId } : {}), ...extra });

let ownerA, memberA, viewerA, ownerB, multi, A, B, docA, docB;

before(async () => {
  [ownerA, memberA, viewerA, ownerB, multi] = await Promise.all(['ownera', 'membera', 'viewera', 'ownerb', 'multi'].map(personne));
  A = await org('a', [[ownerA, 'owner'], [memberA, 'member'], [viewerA, 'viewer'], [multi, 'admin']]);
  B = await org('b', [[ownerB, 'owner'], [multi, 'member']]);
  const ra = await appel(documents, { method: 'POST', headers: H(memberA, A), body: { cle: 'a1', r: { fournisseur: 'Quincaillerie Fictive A', date: '2026-11-20', sous_total: 100, tps: 5, tvq: 9.98, total: 114.98 }, image: IMG, thumb: IMG } });
  assert.equal(ra.status, 201, JSON.stringify(ra.body));
  docA = ra.body.document.id;
  const rb = await appel(documents, { method: 'POST', headers: H(ownerB, B), body: { cle: 'b1', r: { fournisseur: 'Restaurant Fictif B', total: 50 }, image: IMG, thumb: IMG } });
  assert.equal(rb.status, 201, JSON.stringify(rb.body));
  docB = rb.body.document.id;
});

after(async () => {
  for (const id of orgIds) {
    const { data } = await service.from('ncapture_documents').select('photos').eq('org_id', id);
    const chemins = (data || []).flatMap((d) => d.photos || []);
    if (chemins.length) await service.storage.from('ncapture').remove(chemins);
    await service.from('organizations').delete().eq('id', id);
  }
  for (const id of userIds) await service.auth.admin.deleteUser(id);
});

test('sans session : 401 partout, aucune facture', async () => {
  for (const [h, m] of [[factures, 'GET'], [factures, 'POST'], [factures, 'DELETE'], [documents, 'GET'], [documents, 'POST'], [moi, 'GET']]) {
    const r = await appel(h, { method: m, headers: { 'x-ncapture': '1', 'x-ncapture-org': A }, body: {} });
    assert.equal(r.status, 401, `${m} ${h.name}`);
    assert.ok(!r.body?.factures && !r.body?.documents);
  }
  const l = await appel(lire, { method: 'POST', headers: { 'x-ncapture': '1', 'x-ncapture-org': A }, body: { image: IMG } });
  assert.equal(l.status, 401);
});

test('ancien code seul (repli désactivé par défaut) : toujours 401', async () => {
  process.env.CAPTURE_CODE = 'code-essai';
  const r = await appel(factures, { headers: { 'x-capture-code': 'code-essai' } });
  assert.equal(r.status, 401);
  delete process.env.CAPTURE_CODE;
});

test('jeton invalide : 401', async () => {
  const r = await appel(documents, { headers: { cookie: 'nc_at=faux; nc_rt=faux', 'x-ncapture-org': A } });
  assert.equal(r.status, 401);
});

test('écriture sans en-tête x-ncapture (CSRF) : 403', async () => {
  const r = await appel(documents, { method: 'POST', headers: { cookie: memberA.cookie, 'x-ncapture-org': A }, body: { r: { fournisseur: 'x' } } });
  assert.equal(r.status, 403);
});

test('org A voit ses factures, jamais celles de B', async () => {
  const r = await appel(documents, { headers: H(ownerA, A) });
  assert.equal(r.status, 200);
  const ids = r.body.documents.map((d) => d.id);
  assert.ok(ids.includes(docA));
  assert.ok(!ids.includes(docB));
  assert.ok(r.body.documents.every((d) => !JSON.stringify(d).includes('Fictif B')));
});

test("usager de A ne peut ni lister, ni lire, ni modifier, ni supprimer, ni télécharger dans B (en-tête org B)", async () => {
  for (const [m, url, body] of [['GET', '/api/documents'], ['POST', '/api/documents', { r: { fournisseur: 'intrus' } }],
    ['PATCH', `/api/documents?id=${docB}`, { r: { total: 1 } }], ['DELETE', `/api/documents?id=${docB}`], ['GET', `/api/documents?id=${docB}&n=1`]]) {
    const r = await appel(documents, { method: m, url, headers: H(ownerA, B), body });
    assert.equal(r.status, 404, `${m} ${url}`);
  }
  assert.equal((await appel(factures, { headers: H(ownerA, B) })).status, 404);
  assert.equal((await appel(lire, { method: 'POST', headers: H(ownerA, B), body: { image: IMG } })).status, 404);
});

test("usager de A avec SON org mais l'id d'une facture de B : rien", async () => {
  const p = await appel(documents, { method: 'PATCH', url: `/api/documents?id=${docB}`, headers: H(ownerA, A), body: { r: { total: 1 } } });
  assert.equal(p.status, 404);
  const d = await appel(documents, { method: 'DELETE', url: `/api/documents?id=${docB}`, headers: H(ownerA, A) });
  assert.equal(d.status, 404);
  const g = await appel(documents, { url: `/api/documents?id=${docB}&n=1`, headers: H(ownerA, A) });
  assert.equal(g.status, 404);
  const f = await appel(factures, { method: 'POST', headers: H(ownerA, A), body: { id: docB } });
  assert.equal(f.status, 404);
  const { data } = await service.from('ncapture_documents').select('total').eq('id', docB).single();
  assert.equal(Number(data.total), 50);
});

test('base et Storage en direct (jeton de A) : B reste invisible et intouchable', async () => {
  const s = await ownerA.db.from('ncapture_documents').select('id').eq('id', docB);
  assert.equal(s.data.length, 0);
  const u = await ownerA.db.from('ncapture_documents').update({ total: 1 }).eq('id', docB).select('id');
  assert.equal(u.data?.length ?? 0, 0);
  const del = await ownerA.db.from('ncapture_documents').delete().eq('id', docB).select('id');
  assert.equal(del.data?.length ?? 0, 0);
  const i = await ownerA.db.from('ncapture_documents').insert({ org_id: B, created_by: ownerA.id, fournisseur: 'intrus' });
  assert.ok(i.error);
  const { data: b } = await service.from('ncapture_documents').select('photos').eq('id', docB).single();
  assert.ok(b.photos.length >= 1);
  const dl = await ownerA.db.storage.from('ncapture').download(b.photos[0]);
  assert.ok(dl.error, 'téléchargement refusé');
  const sg = await ownerA.db.storage.from('ncapture').createSignedUrl(b.photos[0], 60);
  assert.ok(sg.error, 'lien signé refusé');
  const up = await ownerA.db.storage.from('ncapture').upload(`${B}/${docB}/intrus.png`, Buffer.from('x'), { contentType: 'image/png' });
  assert.ok(up.error, 'téléversement refusé');
  const ls = await ownerA.db.storage.from('ncapture').list(`${B}/${docB}`);
  assert.equal((ls.data || []).length, 0);
  // et la photo de A, elle, se télécharge
  const { data: a } = await service.from('ncapture_documents').select('photos').eq('id', docA).single();
  const okA = await ownerA.db.storage.from('ncapture').download(a.photos[0]);
  assert.ok(!okA.error);
});

test("une facture ne change jamais d'org (garde-fou en base)", async () => {
  const r = await multi.db.from('ncapture_documents').update({ org_id: B }).eq('id', docA).select('id');
  assert.ok(r.error);
});

test('rôles : lecteur lit mais ne capture pas ; membre ne supprime pas ; owner supprime', async () => {
  assert.equal((await appel(documents, { headers: H(viewerA, A) })).status, 200);
  assert.equal((await appel(documents, { method: 'POST', headers: H(viewerA, A), body: { r: { fournisseur: 'x' } } })).status, 403);
  assert.equal((await appel(lire, { method: 'POST', headers: H(viewerA, A), body: { image: IMG } })).status, 403);
  assert.equal((await appel(documents, { method: 'PATCH', url: `/api/documents?id=${docA}`, headers: H(viewerA, A), body: { r: { total: 2 } } })).status, 403);
  const tmp = await appel(documents, { method: 'POST', headers: H(memberA, A), body: { r: { fournisseur: 'Temp' }, thumb: IMG } });
  assert.equal(tmp.status, 201);
  assert.equal((await appel(documents, { method: 'DELETE', url: `/api/documents?id=${tmp.body.document.id}`, headers: H(memberA, A) })).status, 403);
  assert.equal((await appel(documents, { method: 'DELETE', url: `/api/documents?id=${tmp.body.document.id}`, headers: H(ownerA, A) })).status, 200);
});

test('cycle : corriger, approuver, envoyer à NBooks (boîte de A seulement), journal', async () => {
  const p = await appel(documents, { method: 'PATCH', url: `/api/documents?id=${docA}`, headers: H(memberA, A), body: { r: { fournisseur: 'Quincaillerie Fictive A', total: 114.98 }, etat: 'approuvee' } });
  assert.equal(p.status, 200);
  assert.equal(p.body.document.etat, 'approuvee');
  const e = await appel(factures, { method: 'POST', headers: H(memberA, A), body: { id: docA } });
  assert.equal(e.status, 201);
  assert.match(e.body.facture.no, /^FF-\d+$/);
  const la = await appel(factures, { headers: H(ownerA, A) });
  assert.ok(la.body.factures.some((f) => f.id === docA));
  const lb = await appel(factures, { headers: H(ownerB, B) });
  assert.ok(!lb.body.factures.some((f) => f.id === docA));
  const { data: j } = await service.from('audit_events').select('action').eq('org_id', A).eq('entity', 'ncapture_documents').eq('entity_id', docA);
  assert.ok(j.some((x) => x.action === 'insert') && j.some((x) => x.action === 'update'));
});

test('sélecteur : seulement si NCAPTURE_SELECTEUR_ORG=1 et plus d’une org', async () => {
  delete process.env.NCAPTURE_SELECTEUR_ORG;
  let r = await appel(moi, { headers: { cookie: multi.cookie } });
  assert.equal(r.status, 200); assert.equal(r.body.orgs.length, 2); assert.equal(r.body.selecteur, false);
  process.env.NCAPTURE_SELECTEUR_ORG = '1';
  r = await appel(moi, { headers: { cookie: multi.cookie } });
  assert.equal(r.body.selecteur, true);
  assert.deepEqual(r.body.orgs.map((o) => o.couleur), ['#2266AA', '#2266AA']);
  r = await appel(moi, { headers: { cookie: ownerA.cookie } });
  assert.equal(r.body.orgs.length, 1); assert.equal(r.body.selecteur, false);
  delete process.env.NCAPTURE_SELECTEUR_ORG;
});

test('multi-org : la même personne voit A dans A et B dans B, jamais mélangées', async () => {
  const a = await appel(documents, { headers: H(multi, A) });
  const b = await appel(documents, { headers: H(multi, B) });
  assert.ok(a.body.documents.every((d) => d.id !== docB));
  assert.ok(b.body.documents.every((d) => d.id !== docA));
  assert.ok(b.body.documents.some((d) => d.id === docB));
});

test("usage IA : noté dans l'org de la personne, refusé pour une autre org", async () => {
  const ok = await memberA.db.rpc('ncapture_log_ai_usage', { p_org_id: A, p_model_id: 'claude-sonnet-5-5', p_input_tokens: 1000, p_output_tokens: 200, p_status: 'ok' });
  assert.ok(!ok.error, ok.error?.message);
  const ko = await memberA.db.rpc('ncapture_log_ai_usage', { p_org_id: B, p_model_id: 'claude-sonnet-5-5', p_input_tokens: 1, p_output_tokens: 1, p_status: 'ok' });
  assert.ok(ko.error);
  const { data } = await service.from('ai_usage').select('feature, org_id, cost_usd').eq('id', ok.data).single();
  assert.equal(data.feature, 'ncapture.lire'); assert.equal(data.org_id, A); assert.ok(Number(data.cost_usd) > 0);
});

test('connexion par jeton à usage unique (bouton « Ouvrir NCapture ») : une seule fois', async () => {
  const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email: memberA.email });
  assert.ok(!error, error?.message);
  const th = data.properties.hashed_token;
  const r1 = await appel(sessionApi, { method: 'POST', headers: { 'x-ncapture': '1' }, body: { token_hash: th } });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.ok(r1.cookies.some((c) => c.startsWith('nc_at=') && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c)));
  const r2 = await appel(sessionApi, { method: 'POST', headers: { 'x-ncapture': '1' }, body: { token_hash: th } });
  assert.equal(r2.status, 401);
  const cookie = r1.cookies.map((c) => c.split(';')[0]).join('; ');
  const m = await appel(moi, { headers: { cookie } });
  assert.equal(m.status, 200); assert.equal(m.body.courriel, memberA.email);
});

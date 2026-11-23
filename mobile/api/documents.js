// /api/documents — factures capturées de l'organisation active (en-tête x-ncapture-org).
// GET           : liste (sans les rejetées ni les archivées), miniatures en liens signés de 10 min.
// GET ?id=&n=   : redirige vers la photo n (lien signé court).
// POST          : crée une facture lue (+ photo et miniature dans le bucket privé « ncapture »).
// PATCH ?id=    : corrige, approuve, rejette, archive, ajoute une 2e photo, marque l'export QuickBooks.
// DELETE ?id=   : suppression définitive (owner/admin seulement, la RLS le garantit).
// Toutes les lectures et écritures passent par le jeton de l'usager : la RLS isole les orgs.
// NCapture (NEKHEVI), AGPL-3.0.
import { randomUUID } from 'node:crypto';
import { exigerOrg, corps, estUuid } from './_nekhevi.js';

const BUCKET = 'ncapture';
const COLS = 'id, org_id, statut, cle, fournisseur, date_facture, numero, no_tps, no_tvq, sous_total, tps, tvq, pourboire, total, categorie, cti_rti, champs, alertes, photos, nbooks_statut, nbooks_ref, nbooks_envoye_at, quickbooks_exporte_at, created_at, updated_at';
const ETATS = { a_verifier: 'verifier', approuvee: 'approuvee', rejetee: 'rejetee', archivee: 'archivee' };
const STATUTS = { verifier: 'a_verifier', approuvee: 'approuvee', rejetee: 'rejetee', archivee: 'archivee' };
const INCERTAINS = ['fournisseur', 'date', 'numero', 'no_tps', 'no_tvq', 'sous_total', 'tps', 'tvq', 'pourboire', 'total'];

const txt = (x, max) => String(x ?? '').trim().slice(0, max);
const mnt = (x) => { const v = Math.round((Number(String(x ?? '').replace(',', '.')) || 0) * 100) / 100; return Math.abs(v) < 1e9 ? v : 0; };
const dte = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) && !Number.isNaN(Date.parse(x)) ? x : null);
const imgData = (s, max) => {
  const m = typeof s === 'string' && s.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > max) return null;
  return { type: m[1], buf: Buffer.from(m[2], 'base64'), ext: m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg' };
};

/** Champs modifiables, nettoyés. Seules les clés présentes dans b sont gardées. */
function champsPermis(b) {
  const r = b.r && typeof b.r === 'object' ? b.r : b;
  const o = {};
  if ('fournisseur' in r) o.fournisseur = txt(r.fournisseur, 200);
  if ('date' in r) o.date_facture = dte(r.date);
  if ('numero' in r) o.numero = txt(r.numero, 60);
  if ('no_tps' in r) o.no_tps = txt(r.no_tps, 30);
  if ('no_tvq' in r) o.no_tvq = txt(r.no_tvq, 30);
  for (const k of ['sous_total', 'tps', 'tvq', 'pourboire', 'total']) if (k in r) o[k] = mnt(r[k]);
  if ('categorie' in b) o.categorie = txt(b.categorie, 80);
  if ('cti_rti' in b) o.cti_rti = Math.min(1, Math.max(0, Number(b.cti_rti) || 0));
  if (Array.isArray(b.alertes)) o.alertes = b.alertes.slice(0, 20).map((a) => txt(a, 200));
  if ('articles' in r || 'confiance' in r || 'champs_incertains' in r || 'mode' in b || 'modele' in b) {
    o.champs = {
      articles: Array.isArray(r.articles) ? r.articles.slice(0, 60).map((a) => txt(a, 160)) : [],
      confiance: Math.min(1, Math.max(0, Number(r.confiance) || 0)),
      incertains: Array.isArray(r.champs_incertains) ? r.champs_incertains.filter((k) => INCERTAINS.includes(k)).slice(0, 10) : [],
      mode: txt(b.mode, 20), modele: txt(b.modele, 60),
    };
  }
  return o;
}

async function lienSignes(sb, chemins) {
  if (!chemins.length) return {};
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(chemins, 600);
  const out = {};
  (data || []).forEach((x) => { if (x.signedUrl && !x.error) out[x.path] = x.signedUrl; });
  return out;
}

function versClient(d, liens) {
  const c = d.champs || {};
  const mini = (d.photos || []).filter((p) => /\/miniature-\d+\.\w+$/.test(p));
  return {
    id: d.id, etat: ETATS[d.statut] || 'verifier', ajout: d.created_at, cle: d.cle,
    r: { fournisseur: d.fournisseur, date: d.date_facture || '', numero: d.numero, no_tps: d.no_tps, no_tvq: d.no_tvq,
      sous_total: Number(d.sous_total), tps: Number(d.tps), tvq: Number(d.tvq), pourboire: Number(d.pourboire), total: Number(d.total),
      articles: c.articles || [], confiance: c.confiance ?? null, champs_incertains: c.incertains || [] },
    cat: d.categorie || '', cti: Number(d.cti_rti), alertes: d.alertes || [], mode: c.mode || '', modele: c.modele || '',
    thumb: mini[0] ? liens[mini[0]] || '' : '', photos: mini.slice(1).map((p) => liens[p] || '').filter(Boolean),
    nbPhotos: (d.photos || []).filter((p) => /\/photo-\d+\.\w+$/.test(p)).length,
    envoye: d.nbooks_statut === 'envoye' ? 'Dans NBooks · ' + (d.nbooks_ref || '') : '', nbooks: d.nbooks_statut,
    exporte: d.quickbooks_exporte_at || '',
  };
}

async function televerser(sb, orgId, id, n, image, miniature) {
  const ajout = [];
  for (const [nom, f] of [['photo', image], ['miniature', miniature]]) {
    if (!f) continue;
    const chemin = `${orgId}/${id}/${nom}-${n}.${f.ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(chemin, f.buf, { contentType: f.type, upsert: false });
    if (error) throw new Error('televersement ' + error.message);
    ajout.push(chemin);
  }
  return ajout;
}

export default async function handler(req, res) {
  const ctx = await exigerOrg(req, res);
  if (!ctx) return;
  const { sb, orgId } = ctx;
  const id = req.query?.id ?? new URL(req.url, 'http://x').searchParams.get('id');
  if (id != null && !estUuid(id)) return res.status(400).json({ error: 'id' });

  try {
    if (req.method === 'GET' && id) {
      const n = Math.max(1, Math.min(6, Number(new URL(req.url, 'http://x').searchParams.get('n')) || 1));
      const { data: d } = await sb.from('ncapture_documents').select('photos').eq('org_id', orgId).eq('id', id).maybeSingle();
      const p = (d?.photos || []).find((x) => x.endsWith(`/photo-${n}.jpg`) || new RegExp(`/photo-${n}\\.\\w+$`).test(x));
      if (!p) return res.status(404).json({ error: 'photo' });
      const l = await lienSignes(sb, [p]);
      if (!l[p]) return res.status(404).json({ error: 'photo' });
      res.statusCode = 302; res.setHeader('Location', l[p]); return res.end();
    }

    if (req.method === 'GET') {
      const { data, error } = await sb.from('ncapture_documents').select(COLS)
        .eq('org_id', orgId).in('statut', ['a_verifier', 'approuvee']).order('created_at', { ascending: false }).limit(300);
      if (error) throw new Error(error.message);
      const minis = data.flatMap((d) => (d.photos || []).filter((p) => /\/miniature-\d+\.\w+$/.test(p)));
      const liens = await lienSignes(sb, minis);
      return res.status(200).json({ documents: data.map((d) => versClient(d, liens)) });
    }

    const b = corps(req);
    if (req.method === 'POST') {
      if (!b) return res.status(400).json({ error: 'json' });
      const cle = b.cle ? txt(b.cle, 64) : null;
      if (cle) {
        const { data: ex } = await sb.from('ncapture_documents').select(COLS).eq('org_id', orgId).eq('cle', cle).maybeSingle();
        if (ex) return res.status(200).json({ doublon: true, document: versClient(ex, await lienSignes(sb, ex.photos || [])) });
      }
      const image = imgData(b.image, 6_000_000), miniature = imgData(b.thumb, 400_000);
      const nouvel = randomUUID();
      const ligne = { ...champsPermis(b), id: nouvel, org_id: orgId, created_by: ctx.user.id, cle, statut: 'a_verifier' };
      const { error } = await sb.from('ncapture_documents').insert(ligne);
      if (error) return res.status(error.code === '42501' ? 403 : 400).json({ error: 'creation' });
      let photos = [];
      try { photos = await televerser(sb, orgId, nouvel, 1, image, miniature); } catch (e) { console.error('documents', e.message); }
      const { data: d, error: e2 } = await sb.from('ncapture_documents').update({ photos }).eq('org_id', orgId).eq('id', nouvel).select(COLS).single();
      if (e2) throw new Error(e2.message);
      return res.status(201).json({ document: versClient(d, await lienSignes(sb, photos)) });
    }

    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id' });
      if (!b) return res.status(400).json({ error: 'json' });
      const { data: avant } = await sb.from('ncapture_documents').select('photos, statut').eq('org_id', orgId).eq('id', id).maybeSingle();
      if (!avant) return res.status(404).json({ error: 'document' });
      const maj = champsPermis(b);
      // Export QuickBooks (CSV) : horodaté, seulement sur une facture approuvée.
      if (b.exporte === true) {
        if (avant.statut !== 'approuvee') return res.status(409).json({ error: 'non_approuvee' });
        maj.quickbooks_exporte_at = new Date().toISOString();
      }
      if (b.etat) {
        if (!STATUTS[b.etat]) return res.status(400).json({ error: 'etat' });
        maj.statut = STATUTS[b.etat];
      }
      const image = imgData(b.image, 6_000_000), miniature = imgData(b.thumb, 400_000);
      if (image || miniature) {
        if (avant.statut === 'approuvee') return res.status(409).json({ error: 'approuvee' });
        const n = (avant.photos || []).filter((p) => /\/photo-\d+\.\w+$/.test(p)).length + 1;
        if (n > 3) return res.status(409).json({ error: 'photos' });
        maj.photos = [...(avant.photos || []), ...(await televerser(sb, orgId, id, n, image, miniature))];
      }
      if (!Object.keys(maj).length) return res.status(400).json({ error: 'vide' });
      const { data: d, error } = await sb.from('ncapture_documents').update(maj).eq('org_id', orgId).eq('id', id).select(COLS).maybeSingle();
      if (error) return res.status(error.code === '42501' ? 403 : 400).json({ error: 'maj' });
      if (!d) return res.status(403).json({ error: 'role' });
      return res.status(200).json({ document: versClient(d, await lienSignes(sb, (d.photos || []).filter((p) => p.includes('/miniature-')))) });
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id' });
      if (!['owner', 'admin'].includes(ctx.role)) return res.status(403).json({ error: 'role' });
      const { data: avant } = await sb.from('ncapture_documents').select('photos').eq('org_id', orgId).eq('id', id).maybeSingle();
      if (!avant) return res.status(404).json({ error: 'document' });
      // Les fichiers d'abord : la règle du bucket exige que le document existe encore.
      if (avant.photos?.length) await sb.storage.from(BUCKET).remove(avant.photos);
      const { data: d, error } = await sb.from('ncapture_documents').delete().eq('org_id', orgId).eq('id', id).select('id').maybeSingle();
      if (error) return res.status(400).json({ error: 'suppression' });
      if (!d) return res.status(403).json({ error: 'role' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    console.error('documents', e.message);
    return res.status(500).json({ error: 'documents' });
  }
}

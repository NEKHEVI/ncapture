// /api/factures — boîte de réception NBooks de l'organisation active (factures approuvées envoyées).
// GET    : liste des factures envoyées à NBooks par l'org (en-tête x-ncapture-org).
// POST   : { id } envoie une facture approuvée à NBooks (numéro FF-2001, FF-2002… par org).
// DELETE : retire toutes les factures de la boîte NBooks de l'org (owner/admin ; les factures restent).
// SÉCURITÉ : session NEKHEVI + appartenance à l'org pour TOUTES les méthodes. Aucune facture sans authentification.
// Repli désactivé par défaut : avec NCAPTURE_CODE_REPLI=1, l'ancien code d'accès donne la démo en mémoire.
// NCapture (NEKHEVI), démo NBooks, AGPL-3.0.
import { timingSafeEqual } from 'node:crypto';
import { lister, ajouter, vider, mode } from './_store.js';
import { exigerOrg, codeRepliValide, corps, estUuid } from './_nekhevi.js';

const n = (x) => Math.round((Number(x) || 0) * 100) / 100;
const t = (x, max = 120) => String(x ?? '').slice(0, max);

/** Compare le code reçu au code attendu sans fuite de temps. Faux si l'un des deux manque. */
export function codeValide(recu, attendu) {
  if (!attendu || typeof recu !== 'string' || !recu) return false;
  const a = Buffer.from(recu), b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function repli(req, res) {
  if (req.method === 'GET') return res.status(200).json({ stockage: mode(), factures: await lister() });
  if (req.method === 'DELETE') { await vider(); return res.status(200).json({ ok: true }); }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, DELETE'); return res.status(405).json({ error: 'method' }); }
  const b = corps(req) || {};
  const existantes = await lister();
  if (existantes.length >= 200) return res.status(429).json({ error: 'plein' });
  if (b.cle && existantes.some((e) => e.cle === b.cle)) return res.status(200).json({ ok: true, doublon: true, facture: existantes.find((e) => e.cle === b.cle) });
  const thumb = typeof b.thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(b.thumb) && b.thumb.length < 250000 ? b.thumb : '';
  const f = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), no: 'FF-' + String(2001 + existantes.length), cle: t(b.cle, 40),
    recu: new Date().toISOString(), source: 'Capture', fournisseur: t(b.fournisseur) || 'Fournisseur à préciser', date: t(b.date, 10), numero: t(b.numero, 40),
    no_tps: t(b.no_tps, 20), no_tvq: t(b.no_tvq, 20), sous_total: n(b.sous_total), tps: n(b.tps), tvq: n(b.tvq), pourboire: n(b.pourboire), total: n(b.total),
    categorie: t(b.categorie, 60) || '5900 À classer', cti_rti: Math.min(1, Math.max(0, Number(b.cti_rti ?? 1))),
    alertes: Array.isArray(b.alertes) ? b.alertes.slice(0, 8).map((a) => t(a, 160)) : [], vendeur: t(b.vendeur, 60), thumb,
  };
  await ajouter(f);
  return res.status(201).json({ ok: true, facture: { ...f, thumb: undefined } });
}

function versNbooks(d, liens) {
  const mini = (d.photos || []).find((p) => p.includes('/miniature-'));
  return {
    id: d.id, no: d.nbooks_ref || '', recu: d.nbooks_envoye_at, source: 'Capture', fournisseur: d.fournisseur || 'Fournisseur à préciser',
    date: d.date_facture || '', numero: d.numero, no_tps: d.no_tps, no_tvq: d.no_tvq, sous_total: Number(d.sous_total), tps: Number(d.tps),
    tvq: Number(d.tvq), pourboire: Number(d.pourboire), total: Number(d.total), categorie: d.categorie || '5900 À classer',
    cti_rti: Number(d.cti_rti), alertes: d.alertes || [], thumb: mini ? liens[mini] || '' : '',
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (codeRepliValide(req)) return await repli(req, res);
    const ctx = await exigerOrg(req, res);
    if (!ctx) return;
    const { sb, orgId } = ctx;

    if (req.method === 'GET') {
      const { data, error } = await sb.from('ncapture_documents')
        .select('id, fournisseur, date_facture, numero, no_tps, no_tvq, sous_total, tps, tvq, pourboire, total, categorie, cti_rti, alertes, photos, nbooks_ref, nbooks_envoye_at')
        .eq('org_id', orgId).eq('nbooks_statut', 'envoye').order('nbooks_envoye_at', { ascending: false }).limit(300);
      if (error) throw new Error(error.message);
      const minis = data.map((d) => (d.photos || []).find((p) => p.includes('/miniature-'))).filter(Boolean);
      let liens = {};
      if (minis.length) {
        const { data: s } = await sb.storage.from('ncapture').createSignedUrls(minis, 600);
        (s || []).forEach((x) => { if (x.signedUrl) liens[x.path] = x.signedUrl; });
      }
      return res.status(200).json({ stockage: 'nekhevi', factures: data.map((d) => versNbooks(d, liens)) });
    }

    if (req.method === 'POST') {
      const b = corps(req);
      if (!b || !estUuid(b.id)) return res.status(400).json({ error: 'id' });
      const { data: d } = await sb.from('ncapture_documents').select('id, statut, nbooks_statut, nbooks_ref').eq('org_id', orgId).eq('id', b.id).maybeSingle();
      if (!d) return res.status(404).json({ error: 'document' });
      if (d.statut !== 'approuvee') return res.status(409).json({ error: 'non_approuvee' });
      if (d.nbooks_statut === 'envoye') return res.status(200).json({ ok: true, doublon: true, facture: { id: d.id, no: d.nbooks_ref } });
      const { count } = await sb.from('ncapture_documents').select('id', { count: 'exact', head: true }).eq('org_id', orgId).not('nbooks_ref', 'is', null);
      const no = 'FF-' + String(2001 + (count || 0));
      const { data: m, error } = await sb.from('ncapture_documents')
        .update({ nbooks_statut: 'envoye', nbooks_ref: no, nbooks_envoye_at: new Date().toISOString() })
        .eq('org_id', orgId).eq('id', b.id).select('id, nbooks_ref').maybeSingle();
      if (error || !m) return res.status(403).json({ error: 'envoi' });
      return res.status(201).json({ ok: true, facture: { id: m.id, no: m.nbooks_ref } });
    }

    if (req.method === 'DELETE') {
      if (!['owner', 'admin'].includes(ctx.role)) return res.status(403).json({ error: 'role' });
      const { error } = await sb.from('ncapture_documents').update({ nbooks_statut: 'non_envoye', nbooks_envoye_at: null })
        .eq('org_id', orgId).eq('nbooks_statut', 'envoye');
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    console.error('factures', e.message);
    return res.status(500).json({ error: 'stockage' });
  }
}

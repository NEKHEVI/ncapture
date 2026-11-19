// /api/factures — factures fournisseurs envoyées par la capture, lues par la page RBooks.
// GET : liste ; POST : ajoute ; DELETE : remet la démo à zéro. Code d'accès CAPTURE_CODE si défini (POST/DELETE).
// RBooks démo — AGPL-3.0.
import { lister, ajouter, vider, mode } from './_store.js';

const n = (x) => Math.round((Number(x) || 0) * 100) / 100;
const t = (x, max = 120) => String(x ?? '').slice(0, max);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return res.status(200).json({ stockage: mode(), factures: await lister() });
    const code = process.env.CAPTURE_CODE;
    if (code && req.headers['x-capture-code'] !== code) return res.status(401).json({ error: 'code' });
    if (req.method === 'DELETE') { await vider(); return res.status(200).json({ ok: true }); }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, DELETE'); return res.status(405).json({ error: 'method' }); }

    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b);
    const existantes = await lister();
    if (existantes.length >= 200) return res.status(429).json({ error: 'plein' });
    if (b?.cle && existantes.some((e) => e.cle === b.cle)) return res.status(200).json({ ok: true, doublon: true, facture: existantes.find((e) => e.cle === b.cle) });
    const thumb = typeof b?.thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(b.thumb) && b.thumb.length < 250000 ? b.thumb : '';
    const no = 'FF-' + String(2001 + existantes.length);
    const f = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), no, cle: t(b?.cle, 40), recu: new Date().toISOString(), source: 'Capture',
      fournisseur: t(b?.fournisseur) || 'Fournisseur à préciser', date: t(b?.date, 10), numero: t(b?.numero, 40),
      no_tps: t(b?.no_tps, 20), no_tvq: t(b?.no_tvq, 20), sous_total: n(b?.sous_total), tps: n(b?.tps), tvq: n(b?.tvq),
      pourboire: n(b?.pourboire), total: n(b?.total), categorie: t(b?.categorie, 60) || '5900 À classer',
      cti_rti: Math.min(1, Math.max(0, Number(b?.cti_rti ?? 1))), alertes: Array.isArray(b?.alertes) ? b.alertes.slice(0, 8).map((a) => t(a, 160)) : [],
      vendeur: t(b?.vendeur, 60), thumb,
    };
    await ajouter(f);
    return res.status(201).json({ ok: true, facture: { ...f, thumb: undefined } });
  } catch (e) {
    console.error('factures', e.message);
    return res.status(500).json({ error: 'stockage' });
  }
}

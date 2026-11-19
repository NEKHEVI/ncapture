// POST /api/lire — lit une photo de facture avec l'IA (Claude) et renvoie les champs.
// Variables : ANTHROPIC_API_KEY (sinon mode démo), CAPTURE_CODE (code d'accès exigé si défini),
// CAPTURE_DEMO=1 force le mode démo.
// NCapture (NEKHEVI), AGPL-3.0.

// La clé est nettoyée (espaces, retours de ligne, guillemets collés par erreur dans Vercel).
const CLE = () => String(process.env.ANTHROPIC_API_KEY || '').trim().replace(/^["']+|["']+$/g, '');
const MODEL_RAPIDE = process.env.CAPTURE_MODEL_FAST || 'claude-haiku-5-5';
const MODEL_PRECIS = process.env.CAPTURE_MODEL_PRECISE || 'claude-sonnet-5-5';

const EXEMPLES = [
  { fournisseur: 'Petro-Canada', date: '2026-11-10', numero: '483920', no_tps: '123456789RT0001', no_tvq: '1234567890TQ0001',
    sous_total: 60.88, tps: 3.04, tvq: 6.07, pourboire: 0, total: 69.99, articles: ['Essence ordinaire 41,2 L'], confiance: 0.96 },
  { fournisseur: 'RONA Saint-Hubert', date: '2026-11-08', numero: 'R-77120', no_tps: '897654321RT0001', no_tvq: '1098765432TQ0001',
    sous_total: 285.19, tps: 14.26, tvq: 28.44, pourboire: 0, total: 327.89, articles: ['Vis à bois 2 1/2 po', 'Contreplaqué 3/4', 'Ruban à mesurer'], confiance: 0.93 },
  { fournisseur: 'Bistro Le Rouge-Gorge', date: '2026-11-06', numero: 'T12-0447', no_tps: '', no_tvq: '',
    sous_total: 118.00, tps: 5.90, tvq: 11.77, pourboire: 11.45, total: 147.12, articles: ['Table 12 — 2 couverts', 'Pourboire'], confiance: 0.88 },
];

const CONSIGNE = `Tu lis une photo de facture ou de reçu québécois. Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"fournisseur": string, "date": "AAAA-MM-JJ" ou "", "numero": string, "no_tps": string, "no_tvq": string,
 "sous_total": number, "tps": number, "tvq": number, "pourboire": number, "total": number,
 "articles": [string], "confiance": number entre 0 et 1}
Règles de lecture (c'est de la comptabilité : exactitude avant tout) :
- Le fournisseur est le nom du commerce IMPRIMÉ sur la facture (en-tête, logo, bas de facture). Recopie-le tel quel. Ne le déduis jamais des montants, du type d'achat ou d'une facture « typique ». S'il est illisible, mets "" et une confiance ≤ 0.5.
- Lis chaque montant sur la photo ; n'en calcule aucun. Les articles sont recopiés tels qu'imprimés.
Règles : montants en dollars avec 2 décimales (point décimal) ; 0 si absent ; no_tps = numéro TPS/TVH (finit par RT0001) ; no_tvq = numéro TVQ (finit par TQ0001) ; "" si absent. Ne devine pas : baisse la confiance si un montant est illisible.`;

const c = (x) => Math.round((Number(x) || 0) * 100);

function balance(r) {
  return Math.abs(c(r.sous_total) + c(r.tps) + c(r.tvq) + c(r.pourboire) - c(r.total)) <= 3;
}

async function lire(model, mediaType, data) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': CLE(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: CONSIGNE },
      ] }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ia ${r.status} ${j?.error?.message || ''}`);
  const txt = (j.content || []).map((b) => b.text || '').join('');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('reponse illisible');
  return JSON.parse(m[0]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method' }); }
  const code = process.env.CAPTURE_CODE;
  if (code && req.headers['x-capture-code'] !== code) return res.status(401).json({ error: 'code' });

  let b = req.body;
  try { if (typeof b === 'string') b = JSON.parse(b); } catch { return res.status(400).json({ error: 'json' }); }
  const img = String(b?.image || '');
  const m = img.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'image' });
  if (m[2].length > 4_000_000) return res.status(413).json({ error: 'taille' });

  // Le bouton « Exemples » (reçus dessinés par l'app) reçoit sa lecture type.
  if (b?.demo === true) {
    const i = Math.abs(Number(b?.index) || 0) % EXEMPLES.length;
    return res.status(200).json({ mode: 'demo', modele: 'exemple', resultat: EXEMPLES[i] });
  }
  // Sans IA, une vraie photo n'est PAS lue : on ne renvoie jamais un faux fournisseur.
  if (!process.env.ANTHROPIC_API_KEY || process.env.CAPTURE_DEMO === '1') {
    return res.status(200).json({ mode: 'non-lu', modele: 'aucun', resultat: {
      fournisseur: '', date: '', numero: '', no_tps: '', no_tvq: '', sous_total: 0, tps: 0, tvq: 0, pourboire: 0, total: 0, articles: [], confiance: 0 } });
  }

  try {
    let r = await lire(MODEL_RAPIDE, m[1], m[2]);
    let modele = MODEL_RAPIDE;
    if ((Number(r.confiance) || 0) < 0.8 || !balance(r)) {
      try { const r2 = await lire(MODEL_PRECIS, m[1], m[2]); r = r2; modele = MODEL_PRECIS; } catch { /* on garde la 1re lecture */ }
    }
    return res.status(200).json({ mode: 'ia', modele, resultat: r });
  } catch (e) {
    console.error('lecture echouee', e.message);
    return res.status(502).json({ error: 'lecture' });
  }
}

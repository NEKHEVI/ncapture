// POST /api/lire — lit une photo de facture avec l'IA (Claude) et renvoie les champs.
// Accès : session NEKHEVI + appartenance à l'org active (en-tête x-ncapture-org), rôle owner/admin/member.
// Repli désactivé par défaut : NCAPTURE_CODE_REPLI=1 permet l'ancien code d'accès CAPTURE_CODE (sans journal d'usage).
// Variables : ANTHROPIC_API_KEY (sinon mode démo), CAPTURE_DEMO=1 force le mode démo.
// Chaque appel IA est noté dans ai_usage de l'org (fonction ncapture_log_ai_usage) ; le budget IA de l'org est respecté.
// NCapture (NEKHEVI), AGPL-3.0.
import { exigerOrg, codeRepliValide } from './_nekhevi.js';
import { CONSIGNE, normaliser, relire, fusionner } from './_lecture.js';

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
    sous_total: 118.00, tps: 5.90, tvq: 11.77, pourboire: 11.45, total: 147.12, articles: ['Table 12 — 2 couverts', 'Pourboire'], champs_incertains: ['pourboire'], confiance: 0.88 },
];

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
  if (!r.ok) throw Object.assign(new Error(`ia ${r.status} ${j?.error?.message || ''}`), { usage: j.usage });
  const txt = (j.content || []).map((b) => b.text || '').join('');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw Object.assign(new Error('reponse illisible'), { usage: j.usage });
  return { resultat: normaliser(JSON.parse(m[0])), usage: j.usage || {} };
}

// Note l'appel dans ai_usage de l'org (jamais bloquant : une erreur de journal ne casse pas la lecture).
async function noter(ctx, model, usage, statut, debut, secours) {
  if (!ctx) return;
  try {
    await ctx.sb.rpc('ncapture_log_ai_usage', {
      p_org_id: ctx.orgId, p_model_id: model,
      p_input_tokens: (usage?.input_tokens || 0) + (usage?.cache_read_input_tokens || 0) + (usage?.cache_creation_input_tokens || 0),
      p_output_tokens: usage?.output_tokens || 0, p_status: statut, p_latency_ms: Date.now() - debut, p_fallback: Boolean(secours),
    });
  } catch (e) { console.error('ai_usage', e.message); }
}

// Budget IA mensuel de l'org (ai_budget_status) : vrai s'il reste de la marge ou si l'info manque.
async function budgetOk(ctx) {
  if (!ctx) return true;
  try {
    const { data } = await ctx.sb.rpc('ai_budget_status', { p_org_id: ctx.orgId });
    const b = Array.isArray(data) ? data[0] : data;
    return !b || Number(b.spent_usd) < Number(b.budget_usd);
  } catch { return true; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method' }); }
  res.setHeader('Cache-Control', 'no-store');
  let ctx = null;
  if (!codeRepliValide(req)) {
    ctx = await exigerOrg(req, res, { roles: ['owner', 'admin', 'member'] });
    if (!ctx) return;
  }

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
      fournisseur: '', date: '', numero: '', no_tps: '', no_tvq: '', sous_total: 0, tps: 0, tvq: 0, pourboire: 0, total: 0, articles: [], champs_incertains: [], confiance: 0 } });
  }

  if (!(await budgetOk(ctx))) return res.status(402).json({ error: 'budget' });

  try {
    let debut = Date.now(), r, modele = MODEL_RAPIDE;
    try {
      const l1 = await lire(MODEL_RAPIDE, m[1], m[2]);
      r = l1.resultat; await noter(ctx, MODEL_RAPIDE, l1.usage, 'ok', debut, false);
    } catch (e) { await noter(ctx, MODEL_RAPIDE, e.usage, 'error', debut, false); throw e; }
    if (relire(r)) {
      debut = Date.now();
      try {
        const l2 = await lire(MODEL_PRECIS, m[1], m[2]); r = fusionner(r, l2.resultat); modele = MODEL_PRECIS;
        await noter(ctx, MODEL_PRECIS, l2.usage, 'ok', debut, true);
      } catch (e) { await noter(ctx, MODEL_PRECIS, e.usage, 'error', debut, true); /* on garde la 1re lecture */ }
    }
    return res.status(200).json({ mode: 'ia', modele, resultat: r });
  } catch (e) {
    console.error('lecture echouee', e.message);
    return res.status(502).json({ error: 'lecture' });
  }
}

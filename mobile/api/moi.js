// GET /api/moi — l'usager connecté et SES organisations (lues par la RLS).
// selecteur : vrai seulement si NCAPTURE_SELECTEUR_ORG=1 ET l'usager appartient à plus d'une org.
// NCapture (NEKHEVI), AGPL-3.0.
import { session, organisations, supabaseEnv, selecteurActif } from './_nekhevi.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method' }); }
  if (!supabaseEnv()) return res.status(503).json({ error: 'config' });
  const s = await session(req, res);
  if (!s) return res.status(401).json({ error: 'session' });
  if (s.mfaRequise) return res.status(401).json({ error: 'mfa' });
  try {
    const orgs = await organisations(s.sb, s.user.id);
    return res.status(200).json({
      courriel: s.user.email,
      orgs: orgs.map(({ id, nom, couleur, role }) => ({ id, nom, couleur, role })),
      selecteur: selecteurActif() && orgs.length > 1,
    });
  } catch (e) {
    console.error('moi', e.message);
    return res.status(500).json({ error: 'orgs' });
  }
}

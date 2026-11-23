// /api/session — connexion à NCapture avec le compte NEKHEVI.
// GET    : état ({ connecte, mfa, courriel }).
// POST   : { token_hash } jeton à usage unique remis par app.nekhevi.com (bouton « Ouvrir NCapture »),
//          ou { code } code à 6 chiffres de la double authentification.
// DELETE : déconnexion.
// Les jetons de session sont posés en témoins HttpOnly ; rien n'est renvoyé au JavaScript.
// NCapture (NEKHEVI), AGPL-3.0.
import { createClient } from '@supabase/supabase-js';
import { session, poserSession, effacerSession, clientAnonyme, supabaseEnv, ecritureSure, corps, appUrl, repliActif } from './_nekhevi.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!supabaseEnv()) return res.status(503).json({ error: 'config' });
  if (!ecritureSure(req)) return res.status(403).json({ error: 'csrf' });

  if (req.method === 'GET') {
    const s = await session(req, res);
    return res.status(200).json({ connecte: Boolean(s), mfa: Boolean(s?.mfaRequise), courriel: s && !s.mfaRequise ? s.user.email : null, app: appUrl(), repli: repliActif() });
  }

  if (req.method === 'DELETE') {
    const s = await session(req, res);
    if (s) {
      try {
        const c = createClient(supabaseEnv().url, supabaseEnv().anon, { auth: { persistSession: false, autoRefreshToken: false } });
        await c.auth.setSession({ access_token: s.at, refresh_token: s.rt });
        await c.auth.signOut({ scope: 'local' });
      } catch { /* la session expire d'elle-même */ }
    }
    effacerSession(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, DELETE'); return res.status(405).json({ error: 'method' }); }
  const b = corps(req);
  if (!b) return res.status(400).json({ error: 'json' });

  // 1) Jeton à usage unique venu de app.nekhevi.com
  if (typeof b.token_hash === 'string') {
    const th = b.token_hash.trim();
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(th)) return res.status(400).json({ error: 'jeton' });
    const anon = clientAnonyme();
    let r = await anon.auth.verifyOtp({ token_hash: th, type: 'email' });
    if (r.error) r = await anon.auth.verifyOtp({ token_hash: th, type: 'magiclink' });
    if (r.error || !r.data?.session) { effacerSession(res); return res.status(401).json({ error: 'jeton' }); }
    poserSession(res, r.data.session);
    const aMfa = (r.data.user?.factors || []).some((f) => f.status === 'verified');
    return res.status(200).json({ ok: true, mfa: aMfa });
  }

  // 2) Double authentification (TOTP) sur la session en cours
  if (typeof b.code === 'string') {
    const code = b.code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'code' });
    const s = await session(req, res);
    if (!s) return res.status(401).json({ error: 'session' });
    const c = createClient(supabaseEnv().url, supabaseEnv().anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: e1 } = await c.auth.setSession({ access_token: s.at, refresh_token: s.rt });
    if (e1) return res.status(401).json({ error: 'session' });
    const { data: f } = await c.auth.mfa.listFactors();
    const totp = (f?.totp || []).find((x) => x.status === 'verified');
    if (!totp) return res.status(400).json({ error: 'facteur' });
    const { data, error } = await c.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
    if (error || !data?.access_token) return res.status(401).json({ error: 'code' });
    poserSession(res, data);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'requete' });
}

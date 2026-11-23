import { supabaseEnv, appUrl, repliActif } from './_nekhevi.js';
// GET /api/config — mode de lecture (démo ou IA) et mode de connexion. Aucun secret renvoyé.
// auth : « nekhevi » (compte NEKHEVI, par défaut) ou « aucune » (Supabase non configuré).
// code : vrai seulement si l'ancien code d'accès est permis en repli (NCAPTURE_CODE_REPLI=1).
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    mode: !process.env.ANTHROPIC_API_KEY || process.env.CAPTURE_DEMO === '1' ? 'demo' : 'ia',
    auth: supabaseEnv() ? 'nekhevi' : 'aucune',
    app: appUrl(),
    code: repliActif(),
    nbooks: 'connecte',
    stockage: supabaseEnv() ? 'nekhevi' : 'aucun',
  });
}

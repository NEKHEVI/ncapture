import { mode as stockage } from './_store.js';
// GET /api/config — indique le mode (démo ou IA) et si un code d'accès est exigé. Aucun secret renvoyé.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    mode: !process.env.ANTHROPIC_API_KEY || process.env.CAPTURE_DEMO === '1' ? 'demo' : 'ia',
    code: Boolean(process.env.CAPTURE_CODE),
    rbooks: 'connecte',
    stockage: stockage(),
  });
}

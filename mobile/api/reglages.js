// /api/reglages — réglages NCapture de l'organisation active (en-tête x-ncapture-org).
// GET   : { destination: 'nbooks' | 'quickbooks', envoi_direct } (tout membre).
// PATCH : { destination } (owner/admin seulement ; la RLS de ncapture_org_settings le garantit aussi).
// Aucun secret ici : un jeton QuickBooks vit dans le connecteur de l'org (app.nekhevi.com).
// NCapture (NEKHEVI), AGPL-3.0.
import { exigerOrg, corps } from './_nekhevi.js';
import { envoiQboActif } from './_quickbooks.js';

const DESTINATIONS = ['nbooks', 'quickbooks'];

export default async function handler(req, res) {
  const ctx = await exigerOrg(req, res);
  if (!ctx) return;
  const { sb, orgId } = ctx;
  try {
    if (req.method === 'GET') {
      const { data } = await sb.from('ncapture_org_settings').select('destination').eq('org_id', orgId).maybeSingle();
      const destination = DESTINATIONS.includes(data?.destination) ? data.destination : 'nbooks';
      return res.status(200).json({ destination, envoi_direct: destination === 'quickbooks' && envoiQboActif(), modifiable: ['owner', 'admin'].includes(ctx.role) });
    }
    if (req.method === 'PATCH') {
      if (!['owner', 'admin'].includes(ctx.role)) return res.status(403).json({ error: 'role' });
      const b = corps(req);
      if (!b || !DESTINATIONS.includes(b.destination)) return res.status(400).json({ error: 'destination' });
      const { error } = await sb.from('ncapture_org_settings').upsert({ org_id: orgId, destination: b.destination }, { onConflict: 'org_id' });
      if (error) return res.status(error.code === '42501' ? 403 : 400).json({ error: 'reglages' });
      return res.status(200).json({ destination: b.destination, envoi_direct: b.destination === 'quickbooks' && envoiQboActif() });
    }
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    console.error('reglages', e.message);
    return res.status(500).json({ error: 'reglages' });
  }
}

// POST /api/quickbooks { id } — envoi direct d'une facture approuvée à QuickBooks Online.
// DÉSACTIVÉ par défaut (NCAPTURE_QBO_ENVOI absent) : répond 503 « qbo_desactive » et rien ne part.
// Même activé, l'envoi attend le pont avec le connecteur QuickBooks de l'app (clés Intuit de production) :
// répond alors 501 « qbo_connecteur ». Le corps de la facture est prêt (factureQbo, testé).
// NCapture (NEKHEVI), AGPL-3.0.
import { exigerOrg, corps, estUuid } from './_nekhevi.js';
import { envoiQboActif } from './_quickbooks.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method' }); }
  const ctx = await exigerOrg(req, res, { roles: ['owner', 'admin', 'member'] });
  if (!ctx) return;
  if (!envoiQboActif()) return res.status(503).json({ error: 'qbo_desactive' });
  const b = corps(req);
  if (!b || !estUuid(b.id)) return res.status(400).json({ error: 'id' });
  const { data: d } = await ctx.sb.from('ncapture_documents').select('id, statut').eq('org_id', ctx.orgId).eq('id', b.id).maybeSingle();
  if (!d) return res.status(404).json({ error: 'document' });
  if (d.statut !== 'approuvee') return res.status(409).json({ error: 'non_approuvee' });
  return res.status(501).json({ error: 'qbo_connecteur' });
}

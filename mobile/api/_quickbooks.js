// Envoi direct à QuickBooks Online (API Accounting v3, objet Bill) : PRÊT mais DÉSACTIVÉ.
// Interrupteur : NCAPTURE_QBO_ENVOI=1 (absent par défaut). Tant que l'app Intuit de production n'est pas
// approuvée, la destination QuickBooks passe par l'export CSV (ncapture-regles.js, csvQuickBooks).
// Le jeton OAuth vient du connecteur QuickBooks de l'org dans app.nekhevi.com (connection_secrets) :
// NCapture n'a ni clé Intuit ni clé de service ; le pont avec l'app sera branché avec les clés de production.
// NCapture (NEKHEVI), AGPL-3.0.

export const envoiQboActif = () => process.env.NCAPTURE_QBO_ENVOI === '1';

const c = (x) => Math.round((Number(x) || 0) * 100);
const d2 = (n) => Math.round(n) / 100;

/**
 * Corps d'une facture fournisseur QuickBooks (Bill) pour un document NCapture approuvé.
 * refs : { fournisseurId, compteId, codeTaxeId, codeHorsChampId } (identifiants QuickBooks de l'org).
 * Le pourboire est une ligne séparée hors champ des taxes ; les taxes sont « hors prix » (TaxExcluded)
 * et le montant de taxe lu sur la facture est imposé (TxnTaxDetail.TotalTax).
 */
export function factureQbo(doc, refs) {
  const sub = c(doc.sous_total), tps = c(doc.tps), tvq = c(doc.tvq), pb = c(doc.pourboire), tot = c(doc.total);
  const base = sub > 0 ? sub : Math.max(0, tot - tps - tvq - pb);
  const lignes = [{
    DetailType: 'AccountBasedExpenseLineDetail', Amount: d2(base), Description: String(doc.categorie || '').slice(0, 200),
    AccountBasedExpenseLineDetail: { AccountRef: { value: refs.compteId }, TaxCodeRef: { value: refs.codeTaxeId } },
  }];
  if (pb > 0) lignes.push({
    DetailType: 'AccountBasedExpenseLineDetail', Amount: d2(pb), Description: 'Pourboire',
    AccountBasedExpenseLineDetail: { AccountRef: { value: refs.compteId }, TaxCodeRef: { value: refs.codeHorsChampId } },
  });
  const corps = {
    VendorRef: { value: refs.fournisseurId }, TxnDate: doc.date_facture || undefined, DueDate: doc.date_facture || undefined,
    DocNumber: String(doc.numero || '').slice(0, 21) || undefined, GlobalTaxCalculation: 'TaxExcluded', Line: lignes,
    TxnTaxDetail: { TotalTax: d2(tps + tvq) },
    PrivateNote: `NCapture · TPS ${d2(tps).toFixed(2)} · TVQ ${d2(tvq).toFixed(2)}${pb ? ` · Pourboire ${d2(pb).toFixed(2)}` : ''} · Total payé ${d2(tot).toFixed(2)}`,
  };
  return JSON.parse(JSON.stringify(corps));
}

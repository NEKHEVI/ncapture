// Lecture d'une facture : consigne donnée à l'IA et nettoyage de sa réponse (fonctions pures, testées).
// Principe (demande du 23 nov.) : toujours proposer la meilleure lecture de chaque champ, même partielle,
// et marquer les champs incertains au lieu de les vider. Interdit : inventer un fournisseur absent de la photo.
// Règles fiscales inchangées (TPS 5 %, TVQ 9,975 %, CTI/RTI, repas 50 %). Les numéros de taxe sont facultatifs.
// NCapture (NEKHEVI), AGPL-3.0.

export const CHAMPS = ['fournisseur', 'date', 'numero', 'no_tps', 'no_tvq', 'sous_total', 'tps', 'tvq', 'pourboire', 'total'];
const MONTANTS = ['sous_total', 'tps', 'tvq', 'pourboire', 'total'];

export const CONSIGNE = `Tu lis une photo de facture ou de reçu québécois. Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"fournisseur": string, "date": "AAAA-MM-JJ" ou "", "numero": string, "no_tps": string, "no_tvq": string,
 "sous_total": number, "tps": number, "tvq": number, "pourboire": number, "total": number,
 "articles": [string], "champs_incertains": [string], "confiance": number entre 0 et 1}
Principe : propose TOUJOURS ta meilleure lecture de chaque champ, même partielle ou incertaine. Une personne vérifie et approuve chaque facture ensuite. Ne laisse un champ vide (ou 0) que si rien n'est lisible sur la photo et que rien ne se déduit de la facture.
Quand une lecture est incertaine (flou, pli, écriture à la main, chiffre douteux, valeur déduite), garde ta meilleure lecture ET mets le nom du champ dans "champs_incertains" (noms permis : fournisseur, date, numero, no_tps, no_tvq, sous_total, tps, tvq, pourboire, total).
Fournisseur : le nom du commerce tel qu'il apparaît sur la photo (en-tête, logo, bas de facture, reçu de carte). S'il n'est que partiellement lisible, recopie la partie lisible et marque "fournisseur" incertain. N'invente JAMAIS un nom qui n'apparaît nulle part sur la photo (ne le déduis pas du type d'achat ni d'une facture « typique ») : dans ce cas seulement, mets "".
Restaurants : sépare toujours sous_total (nourriture et boissons, avant taxes), tps, tvq, pourboire et total (total payé). Le pourboire est souvent écrit à la main (« Pourboire », « Pourb. », « Tip », « Gratuity ») sur la copie du commerçant ou sur le reçu du terminal : lis-le aussi quand il est manuscrit. Si la photo montre la facture ET le reçu de carte, le pourboire vient du reçu de carte et total = total de la facture + pourboire.
Déductions permises (marque alors le champ incertain) : le total payé quand le sous-total, les taxes et le pourboire sont clairs ; un montant manquant quand les autres et le total sont clairs.
Numéros de taxe : no_tps = numéro TPS/TVH (finit souvent par RT0001), no_tvq = numéro TVQ (finit souvent par TQ0001). Facultatifs : "" s'ils ne sont pas sur la photo, sans baisser la confiance.
Format : montants en dollars avec 2 décimales (point décimal), 0 si absent ; date AAAA-MM-JJ ; articles recopiés tels qu'imprimés (au plus 20).
confiance : ta confiance globale dans la lecture (baisse-la si des montants sont incertains).`;

const c = (x) => Math.round((Number(x) || 0) * 100);
export const somme = (r) => c(r.sous_total) + c(r.tps) + c(r.tvq) + c(r.pourboire);
export const balance = (r) => Math.abs(somme(r) - c(r.total)) <= 3;
const nombre = (x) => { const v = Math.round((Number(String(x ?? '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0) * 100) / 100; return Number.isFinite(v) && Math.abs(v) < 1e9 ? v : 0; };
const texte = (x, max) => String(x ?? '').trim().slice(0, max);

/** Nettoie la réponse de l'IA. Ne vide jamais un champ lu ; ajoute au besoin une déduction marquée incertaine. */
export function normaliser(brut) {
  const b = brut && typeof brut === 'object' ? brut : {};
  const r = {
    fournisseur: texte(b.fournisseur, 200), date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : '',
    numero: texte(b.numero, 60), no_tps: texte(b.no_tps, 30), no_tvq: texte(b.no_tvq, 30),
    articles: Array.isArray(b.articles) ? b.articles.slice(0, 20).map((a) => texte(a, 160)).filter(Boolean) : [],
    confiance: Math.min(1, Math.max(0, Number(b.confiance) || 0)),
  };
  for (const k of MONTANTS) r[k] = nombre(b[k]);
  const inc = new Set((Array.isArray(b.champs_incertains) ? b.champs_incertains : []).filter((k) => CHAMPS.includes(k)));
  // Total payé absent mais le reste est lisible : on le déduit (marqué incertain, la personne confirme).
  if (r.total === 0 && somme(r) > 0) { r.total = somme(r) / 100; inc.add('total'); }
  // Un champ vide n'est pas « incertain » : il est à saisir.
  r.champs_incertains = [...inc].filter((k) => (MONTANTS.includes(k) ? r[k] !== 0 : r[k] !== ''));
  return r;
}

/** Faut-il une seconde lecture avec le modèle précis ? */
export function relire(r) {
  return (Number(r.confiance) || 0) < 0.8 || !balance(r) || !r.fournisseur
    || (r.champs_incertains || []).some((k) => MONTANTS.includes(k) || k === 'fournisseur');
}

/** Garde la meilleure des deux lectures : la seconde, sauf si elle perd un champ que la première avait. */
export function fusionner(r1, r2) {
  const r = { ...r2 };
  for (const k of CHAMPS) {
    const vide2 = MONTANTS.includes(k) ? r2[k] === 0 : r2[k] === '';
    const vide1 = MONTANTS.includes(k) ? r1[k] === 0 : r1[k] === '';
    if (vide2 && !vide1 && !(MONTANTS.includes(k) && balance(r2))) {
      r[k] = r1[k];
      r.champs_incertains = [...new Set([...(r.champs_incertains || []), k])];
    }
  }
  if (!r.articles?.length) r.articles = r1.articles || [];
  return r;
}

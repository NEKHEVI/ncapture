// Ajouts du 23 nov. (demande client) : restaurants (pourboire séparé, manuscrit), numéros de taxe facultatifs,
// lecture permissive (champs incertains, jamais de fournisseur inventé), export QuickBooks Online.
// Fonctions pures, aucune base ni IA. Cas 100 % fictifs. Lancer : node --test tests/lecture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CONSIGNE, normaliser, relire, fusionner } from '../api/_lecture.js';
import { factureQbo, envoiQboActif } from '../api/_quickbooks.js';

const ctx = { self: {} };
vm.runInNewContext(readFileSync(new URL('../ncapture-regles.js', import.meta.url), 'utf8'), ctx);
// Les résultats viennent d'un autre contexte JS : copie JSON pour les comparer (deepStrictEqual).
const NCR = Object.fromEntries(Object.entries(ctx.self.NCR).map(([k, v]) =>
  [k, typeof v === 'function' ? (...a) => JSON.parse(JSON.stringify(v(...a))) : JSON.parse(JSON.stringify(v))]));
const cents = (x) => Math.round(Number(x) * 100);

// Cas 1 : restaurant, pourboire écrit à la main sur le reçu du terminal (lecture IA fictive).
const RESTO = { fournisseur: 'Bistro Fictif du Plateau', date: '2026-11-21', numero: 'T7-0193', no_tps: '', no_tvq: '',
  sous_total: '86.50', tps: 4.33, tvq: '8,63', pourboire: '15.00', total: 114.46, articles: ['2 couverts', 'Pourb. 15,00 (manuscrit)'],
  champs_incertains: ['pourboire'], confiance: 0.84 };

test('consigne : lecture permissive, champs incertains, fournisseur jamais inventé, pourboire manuscrit', () => {
  assert.match(CONSIGNE, /TOUJOURS ta meilleure lecture/);
  assert.match(CONSIGNE, /champs_incertains/);
  assert.match(CONSIGNE, /N'invente JAMAIS un nom/);
  assert.match(CONSIGNE, /écrit à la main/);
  assert.match(CONSIGNE, /reçu de carte, et total = total de la facture \+ pourboire|pourboire vient du reçu de carte/);
  assert.match(CONSIGNE, /Facultatifs/);
  assert.doesNotMatch(CONSIGNE, /Ne devine pas/);
});

test('restaurant avec pourboire manuscrit : 5 montants séparés, balance, pourboire à confirmer', () => {
  const r = normaliser(RESTO);
  assert.deepEqual([r.sous_total, r.tps, r.tvq, r.pourboire, r.total], [86.5, 4.33, 8.63, 15, 114.46]);
  assert.deepEqual(r.champs_incertains, ['pourboire']);
  assert.equal(NCR.balance(r), true);
  const a = NCR.verifier(r);
  assert.ok(!a.some((x) => /balance/.test(x)), a.join(' | '));
  assert.ok(a.includes('À confirmer : pourboire'));
  assert.equal(relire(r), true, 'pourboire incertain : seconde lecture avec le modèle précis');
});

test('restaurant : total payé absent mais le reste lisible, il est déduit et marqué à confirmer', () => {
  const r = normaliser({ ...RESTO, total: 0, champs_incertains: [] });
  assert.equal(r.total, 114.46);
  assert.deepEqual(r.champs_incertains, ['total']);
});

test('somme qui ne balance pas : les champs sont gardés, le problème est signalé', () => {
  const r = normaliser({ ...RESTO, total: 120 });
  assert.equal(r.total, 120); assert.equal(r.pourboire, 15);
  assert.ok(NCR.verifier(r).some((x) => /ne balance pas \(114,46 \$ calculé\)/.test(x)));
});

test('facture sans numéros de taxe : aucune alerte, champs vides gardés', () => {
  const r = normaliser({ fournisseur: 'Quincaillerie Fictive', date: '2026-11-20', sous_total: 100, tps: 5, tvq: 9.98, total: 114.98, confiance: 0.95 });
  assert.equal(r.no_tps, ''); assert.equal(r.no_tvq, '');
  assert.deepEqual(NCR.verifier(r), []);
  assert.equal(relire(r), false);
});

test('fournisseur partiellement lisible : lecture partielle gardée et surlignée, jamais remplacée', () => {
  const r = normaliser({ fournisseur: 'Resto ...ier', date: '2026-11-19', sous_total: 20, tps: 1, tvq: 2, total: 23, champs_incertains: ['fournisseur'], confiance: 0.7 });
  assert.equal(r.fournisseur, 'Resto ...ier');
  assert.deepEqual(r.champs_incertains, ['fournisseur']);
  assert.ok(NCR.verifier(r).includes('À confirmer : fournisseur'));
  assert.equal(relire(r), true);
});

test('fournisseur absent de la photo : reste vide (rien d’inventé), même dans l’export', () => {
  const r = normaliser({ fournisseur: '', sous_total: 10, tps: 0.5, tvq: 1, total: 11.5, champs_incertains: ['fournisseur'] });
  assert.equal(r.fournisseur, ''); assert.deepEqual(r.champs_incertains, []);
  const l = NCR.lignesQuickBooks({ id: 'abc12345-x', r, cat: '5900 À classer' });
  assert.equal(l[0].Supplier, 'Fournisseur à préciser');
});

test('seconde lecture : garde un champ que la première avait et que la seconde a perdu', () => {
  const r1 = normaliser(RESTO);
  const r2 = normaliser({ ...RESTO, pourboire: 0, fournisseur: '', champs_incertains: [] });
  const r = fusionner(r1, r2);
  assert.equal(r.pourboire, 15); assert.equal(r.fournisseur, 'Bistro Fictif du Plateau');
  assert.ok(r.champs_incertains.includes('pourboire') && r.champs_incertains.includes('fournisseur'));
});

test('règles fiscales inchangées : TPS 5 %, TVQ 9,975 %, pourboire > 25 %', () => {
  const a = NCR.verifier({ date: '2026-11-01', sous_total: 100, tps: 7, tvq: 12, pourboire: 30, total: 149 });
  assert.ok(a.includes('TPS différente de 5 %')); assert.ok(a.includes('TVQ différente de 9,975 %')); assert.ok(a.includes('Pourboire de plus de 25 %'));
  assert.ok(!a.some((x) => /taxe :|nos de taxe/i.test(x)));
});

test('export QuickBooks Online : en-têtes officiels, pourboire sur sa ligne hors taxes, totaux exacts', () => {
  const it = { id: '3f2a9c10-0000-4000-8000-000000000001', r: normaliser(RESTO), cat: '5200 Repas & représentation' };
  const l = NCR.lignesQuickBooks(it);
  assert.equal(l.length, 2);
  assert.deepEqual(l.map((x) => x['Line Description']), ['2 couverts / Pourb. 15,00 (manuscrit)', 'Pourboire']);
  assert.equal(l[0]['Line Amount'], '86.50'); assert.equal(l[0]['Line Tax Code'], 'GST/QST QC - 9.975'); assert.equal(l[0]['Line Tax Amount'], '12.96');
  assert.equal(l[1]['Line Amount'], '15.00'); assert.equal(l[1]['Line Tax Code'], 'Out of Scope'); assert.equal(l[1]['Line Tax Amount'], '0.00');
  assert.equal(l[0].Account, 'Repas & représentation');
  assert.equal(l[0]['Bill Date'], '21/11/2026'); assert.equal(l[0]['Bill no.'], 'T7-0193');
  assert.match(l[0].Memo, /TPS 4,33 \$ · TVQ 8,63 \$ · Pourboire 15,00 \$ · Total payé 114,46 \$/);
  const somme = l.reduce((s, x) => s + cents(x['Line Amount']) + cents(x['Line Tax Amount']), 0);
  assert.equal(somme, 11446);
  const csv = NCR.csvQuickBooks([it, { id: 'zz', r: { fournisseur: 'Café, Fictif', date: '2026-11-02', sous_total: 4, tps: 0.2, tvq: 0.4, total: 4.6 }, cat: '' }]);
  const lignes = csv.split('\r\n');
  assert.equal(lignes[0], 'Bill no.,Supplier,Bill Date,Due Date,Memo,Account,Line Description,Line Amount,Line Tax Code,Line Tax Amount');
  for (const h of ['Bill no.', 'Supplier', 'Bill Date', 'Due Date', 'Account', 'Line Amount', 'Line Tax Code']) assert.ok(NCR.ENTETES_QBO.includes(h), h);
  assert.equal(lignes.length, 5); // en-tête + 2 + 1 + fin de fichier
  assert.match(lignes[3], /^NC-ZZ,"Café, Fictif",02\/11\/2026,02\/11\/2026,/);
  assert.equal(csv.charCodeAt(0), 'B'.charCodeAt(0), 'pas de BOM');
});

test('envoi API QuickBooks : désactivé par défaut ; corps de facture prêt (pourboire hors taxes)', () => {
  delete process.env.NCAPTURE_QBO_ENVOI;
  assert.equal(envoiQboActif(), false);
  const b = factureQbo({ date_facture: '2026-11-21', numero: 'T7-0193', categorie: '5200 Repas & représentation', sous_total: 86.5, tps: 4.33, tvq: 8.63, pourboire: 15, total: 114.46 },
    { fournisseurId: '58', compteId: '13', codeTaxeId: '9', codeHorsChampId: '20' });
  assert.equal(b.Line.length, 2);
  assert.equal(b.Line[0].Amount, 86.5); assert.equal(b.Line[1].Amount, 15);
  assert.equal(b.Line[1].AccountBasedExpenseLineDetail.TaxCodeRef.value, '20');
  assert.equal(b.TxnTaxDetail.TotalTax, 12.96); assert.equal(b.GlobalTaxCalculation, 'TaxExcluded');
  assert.equal(b.VendorRef.value, '58'); assert.equal(b.DocNumber, 'T7-0193');
});

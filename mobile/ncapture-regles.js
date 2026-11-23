/* NCapture : règles de vérification et export QuickBooks Online (partagées navigateur et tests).
   Règles fiscales inchangées : TPS 5 %, TVQ 9,975 %, CTI/RTI, repas 50 %.
   Les numéros de taxe du fournisseur sont facultatifs : gardés s'ils sont lus, jamais signalés s'ils manquent.
   NCapture (NEKHEVI), AGPL-3.0. */
(function (g, f) { if (typeof module === "object" && module.exports) module.exports = f(); else g.NCR = f(); })(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MONTANTS = ["sous_total", "tps", "tvq", "pourboire", "total"];
  var CHAMPS = ["fournisseur", "date", "numero", "no_tps", "no_tvq"].concat(MONTANTS);
  var NOMS = { fournisseur: "fournisseur", date: "date", numero: "no de facture", no_tps: "no TPS", no_tvq: "no TVQ",
    sous_total: "sous-total", tps: "TPS", tvq: "TVQ", pourboire: "pourboire", total: "total payé" };
  var cents = function (x) { return Math.round((Number(x) || 0) * 100); };
  var fr = function (c) { return (c / 100).toFixed(2).replace(".", ",") + " $"; };

  /** Champs marqués incertains par la lecture (liste filtrée, sans doublon). */
  function incertains(r) {
    var l = r && Array.isArray(r.champs_incertains) ? r.champs_incertains : [];
    return l.filter(function (k, i) { return CHAMPS.indexOf(k) >= 0 && l.indexOf(k) === i; });
  }

  /** Somme des montants d'une facture (sous-total + TPS + TVQ + pourboire), en cents. */
  function somme(r) { return cents(r.sous_total) + cents(r.tps) + cents(r.tvq) + cents(r.pourboire); }
  function balance(r) { return Math.abs(somme(r) - cents(r.total)) <= 3; }

  /** Points à vérifier. Ne vide jamais un champ : signale seulement. */
  function verifier(r) {
    r = r || {};
    var a = [], sub = cents(r.sous_total), tps = cents(r.tps), tvq = cents(r.tvq), pb = cents(r.pourboire), s = somme(r);
    if (!balance(r)) a.push("Le total ne balance pas (" + fr(s) + " calculé)");
    if (sub > 0 && tps > 0 && Math.abs(tps - Math.round(sub * 0.05)) > 2) a.push("TPS différente de 5 %");
    if (sub > 0 && tvq > 0 && Math.abs(tvq - Math.round(sub * 0.09975)) > 2) a.push("TVQ différente de 9,975 %");
    if (sub > 0 && pb > sub * 0.25) a.push("Pourboire de plus de 25 %");
    if (!r.date) a.push("Date illisible");
    var inc = incertains(r);
    if (inc.length) a.push("À confirmer : " + inc.map(function (k) { return NOMS[k]; }).join(", "));
    else if (r.confiance != null && r.confiance !== "" && Number(r.confiance) < 0.8) a.push("Lecture incertaine : comparez avec la photo");
    return a;
  }

  /* ---------------- Export QuickBooks Online (import de factures fournisseurs, Canada) ----------------
     Format officiel Intuit, « Import your bills in QuickBooks Online » (en-CA) : colonnes obligatoires
     Bill no., Supplier, Bill Date, Due Date, Account, Line Amount, Line Tax Code ; une ligne de CSV par
     ligne de facture, la même facture répétée sur chaque ligne. Line Tax Amount (facultatif) remplace le
     calcul de QuickBooks (écarts d'arrondi). Le pourboire est une ligne séparée, hors champ des taxes.
     La TPS et la TVQ restent séparées dans le mémo (QuickBooks n'a qu'un montant de taxe par ligne). */
  var ENTETES = ["Bill no.", "Supplier", "Bill Date", "Due Date", "Memo", "Account", "Line Description", "Line Amount", "Line Tax Code", "Line Tax Amount"];
  var CODES = { tpsTvq: "GST/QST QC - 9.975", tps: "GST", exempt: "Exempt", horsChamp: "Out of Scope" };

  function dateQbo(d) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || "")); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  function compte(cat) { var c = String(cat || "").replace(/^\d{3,5}\s+/, "").trim(); return c || "À classer"; }
  function montant(c) { return (c / 100).toFixed(2); }
  function q(v) { v = String(v == null ? "" : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  /** Lignes QuickBooks d'une facture approuvée : { item: {id,r,cat} } -> tableau de lignes (objets). */
  function lignesQuickBooks(it) {
    var r = it.r || {}, sub = cents(r.sous_total), tps = cents(r.tps), tvq = cents(r.tvq), pb = cents(r.pourboire), tot = cents(r.total);
    var no = String(r.numero || "").trim() || ("NC-" + String(it.id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase());
    var four = String(r.fournisseur || "").trim() || "Fournisseur à préciser";
    var d = dateQbo(r.date), cpt = compte(it.cat);
    var memo = "NCapture · TPS " + fr(tps) + " · TVQ " + fr(tvq) + (pb ? " · Pourboire " + fr(pb) : "") + " · Total payé " + fr(tot) +
      (r.no_tps ? " · No TPS " + r.no_tps : "") + (r.no_tvq ? " · No TVQ " + r.no_tvq : "");
    var code = tps > 0 && tvq > 0 ? CODES.tpsTvq : tps > 0 ? CODES.tps : CODES.exempt;
    // Achat sans sous-total lisible : la ligne principale prend le total payé moins taxes et pourboire.
    var base = sub > 0 ? sub : Math.max(0, tot - tps - tvq - pb);
    var out = [{ "Bill no.": no, "Supplier": four, "Bill Date": d, "Due Date": d, "Memo": memo, "Account": cpt,
      "Line Description": (r.articles && r.articles.length ? r.articles.slice(0, 3).join(" / ") : cpt).slice(0, 200),
      "Line Amount": montant(base), "Line Tax Code": code, "Line Tax Amount": montant(tps + tvq) }];
    if (pb > 0) out.push({ "Bill no.": no, "Supplier": four, "Bill Date": d, "Due Date": d, "Memo": memo, "Account": cpt,
      "Line Description": "Pourboire", "Line Amount": montant(pb), "Line Tax Code": CODES.horsChamp, "Line Tax Amount": "0.00" });
    return out;
  }

  /** CSV complet (virgules, point décimal, UTF-8 sans BOM, fins de ligne CRLF). */
  function csvQuickBooks(items) {
    var L = [];
    (items || []).forEach(function (it) { L = L.concat(lignesQuickBooks(it)); });
    return [ENTETES.join(",")].concat(L.map(function (o) { return ENTETES.map(function (k) { return q(o[k]); }).join(","); })).join("\r\n") + "\r\n";
  }

  return { MONTANTS: MONTANTS, CHAMPS: CHAMPS, NOMS: NOMS, incertains: incertains, somme: somme, balance: balance, verifier: verifier,
    ENTETES_QBO: ENTETES, CODES_QBO: CODES, lignesQuickBooks: lignesQuickBooks, csvQuickBooks: csvQuickBooks, compteQbo: compte, dateQbo: dateQbo };
});

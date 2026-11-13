"""Répartition TPS/TVQ d'une facture capturée : part réclamable (CTI/RTI) et part en dépense.

Fonctions pures (Decimal, aucun accès réseau), testées dans tests/test_taxes.py.

Règles :
- La part réclamable de la TPS et de la TVQ = montant imprimé x ratio de la catégorie
  (data/categories.json, champ `cti_rti` : repas 5200 = 0,5 ; la plupart = 1 ; santé = 0).
- Sans numéro de TPS ET de TVQ du fournisseur : rien n'est réclamé, tout va en dépense.
- Taxes estimées (non imprimées sur le reçu) : rien n'est réclamé et les taxes ne sont pas ventilées.
- La part non réclamée des taxes reste une dépense (même article que la catégorie).
- Le total des lignes est TOUJOURS égal au total du reçu, au cent près : l'écart éventuel
  (arrondi du commerçant) est absorbé par la ligne « Sous-total » (dépense).

Chaque ligne : {"libelle": str, "montant": Decimal, "cible": "depense" | "tps" | "tvq"}.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

CENT = Decimal("0.01")
CATEGORIES = Path(__file__).resolve().parent.parent / "data" / "categories.json"


def _d(v) -> Decimal:
    if v in ("", None):
        return Decimal("0")
    return Decimal(str(v))


def _cent(v: Decimal) -> Decimal:
    return v.quantize(CENT, rounding=ROUND_HALF_UP)


def ratio_categorie(code: str, chemin: Path | None = None) -> Decimal:
    """Part de TPS/TVQ réclamable pour une catégorie (champ cti_rti)."""
    try:
        cats = json.loads((chemin or CATEGORIES).read_text(encoding="utf-8"))["categories"]
    except (OSError, ValueError, KeyError):
        return Decimal("0")
    for c in cats:
        if str(c.get("code")) == str(code):
            return Decimal(str(c.get("cti_rti", 0)))
    return Decimal("0")


@dataclass
class Repartition:
    lignes: list[dict] = field(default_factory=list)
    cti: Decimal = Decimal("0")
    rti: Decimal = Decimal("0")
    note: str = ""

    @property
    def total(self) -> Decimal:
        return sum((l["montant"] for l in self.lignes), Decimal("0"))


def repartir(r: dict, ratio: Decimal | None = None) -> Repartition:
    """Ventile un résultat évalué (voir Engine.evaluer) en lignes de facture fournisseur."""
    total = _cent(_d(r.get("total")))
    estimees = bool(r.get("taxes_estimees"))
    tps = Decimal("0") if estimees else _cent(_d(r.get("tps")))
    tvq = Decimal("0") if estimees else _cent(_d(r.get("tvq")))
    pourboire = _cent(_d(r.get("pourboire")))
    if ratio is None:
        ratio = ratio_categorie(r.get("categorie_code", ""))
    numeros = bool(str(r.get("no_tps") or "").strip()) and bool(str(r.get("no_tvq") or "").strip())

    raisons = []
    if not numeros:
        raisons.append("pas de numéro de TPS ou de TVQ du fournisseur")
    if estimees:
        raisons.append("taxes estimées, non imprimées sur le reçu")
    if ratio <= 0:
        raisons.append("catégorie sans CTI/RTI")
    reclamable = not raisons

    cti = _cent(tps * ratio) if reclamable else Decimal("0")
    rti = _cent(tvq * ratio) if reclamable else Decimal("0")
    tps_nr, tvq_nr = tps - cti, tvq - rti

    rep = Repartition(cti=cti, rti=rti)
    # Le sous-total absorbe l'écart : le total des lignes égale toujours le reçu.
    sous = total - tps - tvq - pourboire
    rep.lignes.append({"libelle": "Sous-total", "montant": sous, "cible": "depense"})
    pct = f"{(ratio * 100).normalize():f} %"
    if tps_nr:
        rep.lignes.append({"libelle": "TPS non récupérable" + (f" (part de {pct} réclamée)" if cti else ""),
                           "montant": tps_nr, "cible": "depense"})
    if tvq_nr:
        rep.lignes.append({"libelle": "TVQ non récupérable" + (f" (part de {pct} réclamée)" if rti else ""),
                           "montant": tvq_nr, "cible": "depense"})
    if pourboire:
        rep.lignes.append({"libelle": "Pourboire", "montant": pourboire, "cible": "depense"})
    if cti:
        rep.lignes.append({"libelle": "TPS récupérable (CTI)", "montant": cti, "cible": "tps"})
    if rti:
        rep.lignes.append({"libelle": "TVQ récupérable (RTI)", "montant": rti, "cible": "tvq"})
    rep.lignes = [l for l in rep.lignes if l["montant"] != 0] or [
        {"libelle": "Total", "montant": total, "cible": "depense"}]

    if reclamable:
        rep.note = f"CTI {cti} $ et RTI {rti} $ imputés aux comptes de taxes à recevoir (ratio {pct})."
    else:
        rep.note = "Aucune taxe réclamée (" + "; ".join(raisons) + ") : tout est en dépense."
    return rep
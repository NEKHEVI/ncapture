"""Exports : transactions.csv et transactions.xlsx (une feuille par mois + feuille Taxes)."""
from __future__ import annotations

import csv
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .engine import EMPLOYE, Engine

# (clé du résultat, titre de colonne, numérique ?)
COLONNES = [
    ("id", "id", False), ("statut", "statut", False), ("date", "date", False),
    ("marchand", "marchand", False), ("no_tps", "no_tps", False), ("no_tvq", "no_tvq", False),
    ("categorie_code", "compte", False), ("categorie", "categorie", False),
    ("description", "description", False),
    ("sous_total", "sous_total", True), ("tps", "tps", True), ("tvq", "tvq", True),
    ("pourboire", "pourboire", True), ("total", "total", True),
    ("cti", "cti_tps", True), ("rti", "rti_tvq", True), ("net", "depense_nette", True),
    ("deductible", "montant_deductible", True),
    ("mode_paiement", "mode_paiement", False), ("no_facture", "no_facture", False),
    ("moteur", "moteur", False), ("alertes", "alertes", False), ("fichiers", "fichiers", False),
]
STATUT_LIBELLE = {"A_VERIFIER": "A_VERIFIER", "APPROUVE": "APPROUVE", "ENVOYE": "ENVOYE_RBOOKS"}


def lignes(eng: Engine) -> list[dict]:
    """Résultats évalués, triés par date, avec statut et alertes en texte."""
    res = eng.evaluer_tous()
    out = []
    for doc_id, r in res.items():
        d = eng.doc(doc_id)
        r = dict(r)
        r["statut"] = STATUT_LIBELLE.get(d["statut"], d["statut"])
        r["alertes"] = " | ".join(r["alertes"])
        out.append(r)
    return out


def _num(v: str) -> Decimal | None:
    return Decimal(v) if v not in ("", None) else None


def ecrire_csv(eng: Engine, chemin: Path, excel_fr: bool = False) -> Path:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    with open(chemin, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";" if excel_fr else ",")
        w.writerow([c[1] for c in COLONNES])
        for r in lignes(eng):
            ligne = []
            for cle, _, num in COLONNES:
                v = r.get(cle, "")
                if excel_fr and num and v != "":
                    v = str(v).replace(".", ",")
                ligne.append(v)
            w.writerow(ligne)
    return chemin


def ecrire_xlsx(eng: Engine, chemin: Path) -> Path:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    rows = lignes(eng)
    par_mois: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        par_mois[r["date"][:7] if r["date"] else "Sans date"].append(r)

    wb = Workbook()
    wb.remove(wb.active)
    entete_fill = PatternFill("solid", fgColor="1F3A5F")
    fmt_montant = '#,##0.00'

    def feuille(titre: str, entetes: list[str], donnees: list[list], num_cols: set[int], somme_cols: set[int]):
        ws = wb.create_sheet(titre[:31])
        ws.append(entetes)
        for c in ws[1]:
            c.font, c.fill = Font(bold=True, color="FFFFFF"), entete_fill
            c.alignment = Alignment(vertical="center", wrap_text=True)
        for d in donnees:
            ws.append(d)
        n = len(donnees)
        for ligne in ws.iter_rows(min_row=2, max_row=n + 1):
            for c in ligne:
                if c.column in num_cols:
                    c.number_format = fmt_montant
        if n:
            tot = ["TOTAL"] + [""] * (len(entetes) - 1)
            ws.append(tot)
            for col in somme_cols:
                L = get_column_letter(col)
                c = ws.cell(row=n + 2, column=col, value=f"=SUM({L}2:{L}{n + 1})")
                c.number_format, c.font = fmt_montant, Font(bold=True)
            ws.cell(row=n + 2, column=1).font = Font(bold=True)
        for i, e in enumerate(entetes, 1):
            ws.column_dimensions[get_column_letter(i)].width = 44 if e in ("alertes", "description", "fichiers") else (
                28 if e == "marchand" else 14)
        ws.freeze_panes = "A2"
        return ws

    entetes = [c[1] for c in COLONNES]
    num_idx = {i for i, c in enumerate(COLONNES, 1) if c[2]}
    for mois in sorted(par_mois):
        donnees = [[(_num(r.get(cle, "")) if num else r.get(cle, "")) for cle, _, num in COLONNES]
                   for r in par_mois[mois]]
        donnees = [[float(x) if isinstance(x, Decimal) else x for x in d] for d in donnees]
        feuille(mois, entetes, donnees, num_idx, num_idx)
    if not par_mois:
        feuille("Transactions", entetes, [], num_idx, set())

    # Feuille Taxes : TPS / TVQ payées, CTI / RTI récupérables, par mois
    taxes = []
    for mois in sorted(par_mois):
        z = Decimal("0")
        s = {k: sum((_num(r[k]) or z for r in par_mois[mois]), z) for k in ("tps", "tvq", "cti", "rti", "total")}
        estimees = sum(1 for r in par_mois[mois] if "Taxes non détaillées" in r["alertes"])
        taxes.append([mois, len(par_mois[mois]), float(s["total"]), float(s["tps"]), float(s["tvq"]),
                      float(s["cti"]), float(s["rti"]), float(s["tps"] + s["tvq"] - s["cti"] - s["rti"]), estimees])
    ws = feuille("Taxes", ["mois", "nb_factures", "total_paye", "tps_payee", "tvq_payee", "cti_recuperable",
                           "rti_recuperable", "taxes_non_recuperables", "factures_taxes_estimees"],
                 taxes, {3, 4, 5, 6, 7, 8}, {2, 3, 4, 5, 6, 7, 8, 9})
    ws.append([])
    ws.append([f"TPS 5 % et TVQ 9,975 %. CTI/RTI refusés sans nos de taxe du fournisseur (30 $ et plus). "
               f"Employé : {EMPLOYE}."])
    wb.save(chemin)
    return chemin

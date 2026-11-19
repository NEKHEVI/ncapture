"""Tests de la validation des montants (Decimal, TPS/TVQ, doublons, règles).

Rejoue les lectures déjà en cache des factures de test : aucun appel IA.
Référence : 5 transactions, total 680,85 $, toutes équilibrées.
"""
import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from rbcapture import exports  # noqa: E402
from rbcapture.engine import Engine  # noqa: E402
from rbcapture.pipeline import depenses as dp  # noqa: E402


@pytest.fixture()
def eng(tmp_path):
    e = Engine(tmp_path)
    e.charger_demo()
    return e


# --- R1 : lecture des nombres ------------------------------------------------
@pytest.mark.parametrize("brut,attendu", [
    ("1 234,56 $", "1234.56"), ("1,234.56", "1234.56"), ("12,5", "12.50"),
    (12.345, "12.35"), (None, None), ("", None), ("abc", None), ("-3,10", "-3.10"),
])
def test_lecture_nombres(brut, attendu):
    assert dp.D(brut) == (Decimal(attendu) if attendu else None)


# --- R3 : cohérence sous-total + taxes + pourboire = total -------------------
def test_calcul_equilibre_rialto():
    ok, msg = dp.verifier_calcul({"sous_total": 26.45, "tps": 1.32, "tvq": 2.64, "total": 30.41})
    assert ok and msg is None


def test_calcul_avec_pourboire():
    # RONA / restaurant : 147,12 $ dont 21,80 $ de pourboire
    ok, _ = dp.verifier_calcul({"sous_total": 100.0, "tps": 5.0, "tvq": 9.98, "pourboire": 10.0, "total": 124.98})
    assert ok


def test_calcul_desequilibre_detecte():
    ok, msg = dp.verifier_calcul({"sous_total": 26.45, "tps": 1.32, "tvq": 2.64, "total": 31.41})
    assert not ok and "incohérent" in msg


def test_tolerance_3_cents():
    assert dp.verifier_calcul({"sous_total": 10.0, "tps": 0.5, "tvq": 1.0, "total": 11.52})[0]
    assert not dp.verifier_calcul({"sous_total": 10.0, "tps": 0.5, "tvq": 1.0, "total": 11.54})[0]


def test_total_illisible():
    ok, msg = dp.verifier_calcul({"sous_total": 10.0, "tps": 0.5})
    assert not ok and msg == "Total illisible"


# --- Factures de test : 680,85 $ équilibré -----------------------------------
def test_factures_de_test_total_680_85(eng):
    res = eng.evaluer_tous()
    assert len(res) == 5
    assert sum(Decimal(r["total"]) for r in res.values()) == Decimal("680.85")
    assert all(r["equilibre"] for r in res.values())


def test_doublons_ignores(eng):
    statuts = [d["statut"] for d in eng.etat["docs"]]
    assert statuts.count("DOUBLON") == 4   # 10 photos : 4 copies identiques
    assert statuts.count("A_VERIFIER") == 5  # 6 lectures, dont 2 morceaux fusionnés (RONA)


def test_rona_fusionne_en_un_recu(eng):
    rona = [r for r in eng.evaluer_tous().values() if r["marchand"].startswith("RONA")]
    assert len(rona) == 1
    assert rona[0]["total"] == "327.89" and rona[0]["no_autorisation"] == "189658"
    assert any("2 photos" in i for i in rona[0]["infos"])


def test_marchand_deduit_du_no_tps(eng):
    r = [r for r in eng.evaluer_tous().values() if r["total"] == "95.43"][0]
    assert r["marchand"].startswith("Le Rialto")


def test_taxes_non_detaillees_estimees_sans_cti(eng):
    r = [r for r in eng.evaluer_tous().values() if r["total"] == "147.12"][0]
    assert r["taxes_estimees"]
    assert r["cti"] == "0.00" and r["rti"] == "0.00"  # pas de nos de taxe : CTI/RTI refusés
    assert any("Pas de no de TPS" in a for a in r["alertes"])
    # R7 : base = (147,12 - 21,80) / 1,14975
    base = ((Decimal("147.12") - Decimal("21.80")) / Decimal("1.14975")).quantize(Decimal("0.01"))
    assert Decimal(r["sous_total"]) == base


def test_repas_cti_50_pour_cent(eng):
    r = [r for r in eng.evaluer_tous().values() if r["total"] == "30.41"][0]
    assert r["categorie_code"] == "5200"
    assert r["cti"] == "0.66" and r["rti"] == "1.32"   # 50 % de 1,32 et de 2,64
    assert r["net"] == "28.43"
    assert r["deductible"] == "14.22"                  # 50 % déductible


# --- Correction à la main -----------------------------------------------------
def test_correction_total_declenche_alerte_puis_se_corrige(eng):
    doc = [d for d in eng.etat["docs"] if d["data"].get("total") == 30.41][0]
    eng.corriger(doc["id"], {"total": "35,00"})
    assert not eng.evaluer_tous()[doc["id"]]["equilibre"]
    eng.corriger(doc["id"], {"total": "30,41"})
    assert eng.evaluer_tous()[doc["id"]]["equilibre"]


def test_doublon_de_transaction(eng):
    d = [d for d in eng.etat["docs"] if d["data"].get("total") == 30.41][0]
    autre = [x for x in eng.etat["docs"] if x["data"].get("total") == 95.43][0]
    eng.corriger(autre["id"], {"sous_total": "26.45", "tps": "1.32", "tvq": "2.64", "total": "30.41"})
    alertes = eng.evaluer_tous()[autre["id"]]["alertes"] + eng.evaluer_tous()[d["id"]]["alertes"]
    assert any("Doublon probable" in a for a in alertes)


# --- Approbation + exports ------------------------------------------------------
def test_exports_csv_et_xlsx(eng, tmp_path):
    for d in list(eng.etat["docs"]):
        if d["statut"] == "A_VERIFIER":
            eng.approuver(d["id"])
    csv_p = exports.ecrire_csv(eng, tmp_path / "t.csv")
    lignes = csv_p.read_text(encoding="utf-8-sig").splitlines()
    assert len(lignes) == 6 and "APPROUVE" in lignes[1]
    from openpyxl import load_workbook
    wb = load_workbook(exports.ecrire_xlsx(eng, tmp_path / "t.xlsx"))
    assert {"2025-09", "2025-11", "2026-06", "Taxes"} <= set(wb.sheetnames)
    ws = wb["2026-06"]
    assert ws.max_row == 1 + 3 + 1  # entête + 3 factures + total
    taxes = wb["Taxes"]
    assert [c.value for c in taxes[1]][:5] == ["mois", "nb_factures", "total_paye", "tps_payee", "tvq_payee"]

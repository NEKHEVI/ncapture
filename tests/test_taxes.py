"""Répartition CTI/RTI : cas normal, repas à 50 %, sans numéros, taxes estimées, total toujours égal au reçu."""
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from rbcapture import taxes  # noqa: E402

D = Decimal


def recu(**kw):
    base = {"categorie_code": "5410", "no_tps": "123456789RT0001", "no_tvq": "1234567890TQ0001",
            "sous_total": "100.00", "tps": "5.00", "tvq": "9.98", "pourboire": "", "total": "114.98",
            "taxes_estimees": False}
    base.update(kw)
    return base


def par_cible(rep):
    out = {}
    for l in rep.lignes:
        out[l["cible"]] = out.get(l["cible"], D("0")) + l["montant"]
    return out


def test_ratio_des_categories():
    assert taxes.ratio_categorie("5200") == D("0.5")
    assert taxes.ratio_categorie("5410") == D("1.0")
    assert taxes.ratio_categorie("5800") == D("0")
    assert taxes.ratio_categorie("9999") == D("0")


def test_cas_normal_tout_reclame():
    rep = taxes.repartir(recu())
    c = par_cible(rep)
    assert (rep.cti, rep.rti) == (D("5.00"), D("9.98"))
    assert c == {"depense": D("100.00"), "tps": D("5.00"), "tvq": D("9.98")}
    assert rep.total == D("114.98")
    assert "imputés" in rep.note


def test_repas_50_pour_cent():
    # Restaurant : 80 $ + TPS 4,00 + TVQ 7,98 = 91,98 ; 50 % réclamable, le reste en dépense.
    rep = taxes.repartir(recu(categorie_code="5200", sous_total="80.00", tps="4.00", tvq="7.98", total="91.98"))
    c = par_cible(rep)
    assert (rep.cti, rep.rti) == (D("2.00"), D("3.99"))
    assert c["tps"] == D("2.00") and c["tvq"] == D("3.99")
    assert c["depense"] == D("80.00") + D("2.00") + D("3.99")
    assert rep.total == D("91.98")


def test_repas_arrondi_demi_vers_le_haut():
    rep = taxes.repartir(recu(categorie_code="5200", sous_total="10.00", tps="0.50", tvq="1.00", total="11.50"))
    assert rep.cti == D("0.25") and rep.rti == D("0.50")  # 0,50 x 0,5 ; 1,00 x 0,5
    rep = taxes.repartir(recu(categorie_code="5200", sous_total="9.99", tps="0.50", tvq="0.99", total="11.48"))
    assert rep.rti == D("0.50")  # 0,495 -> 0,50 (demi vers le haut)
    assert rep.total == D("11.48")


def test_repas_avec_pourboire():
    rep = taxes.repartir(recu(categorie_code="5200", sous_total="80.00", tps="4.00", tvq="7.98",
                              pourboire="12.00", total="103.98"))
    assert rep.total == D("103.98")
    assert any(l["libelle"] == "Pourboire" and l["montant"] == D("12.00") for l in rep.lignes)
    assert rep.cti == D("2.00")  # le pourboire n'est jamais taxé


def test_sans_numero_de_tps_rien_reclame():
    rep = taxes.repartir(recu(no_tps=""))
    assert (rep.cti, rep.rti) == (D("0"), D("0"))
    assert set(par_cible(rep)) == {"depense"}
    assert rep.total == D("114.98")
    assert "TPS ou de TVQ" in rep.note


def test_sans_numero_de_tvq_rien_reclame():
    rep = taxes.repartir(recu(no_tvq=None))
    assert set(par_cible(rep)) == {"depense"} and rep.total == D("114.98")


def test_repas_sans_numeros_tout_en_depense():
    rep = taxes.repartir(recu(categorie_code="5200", no_tps="", no_tvq=""))
    assert set(par_cible(rep)) == {"depense"} and rep.total == D("114.98")


def test_categorie_sans_cti_rti():
    rep = taxes.repartir(recu(categorie_code="5800"))
    assert set(par_cible(rep)) == {"depense"} and rep.total == D("114.98")


def test_taxes_estimees_non_reclamees_et_non_ventilees():
    rep = taxes.repartir(recu(taxes_estimees=True))
    assert [l["cible"] for l in rep.lignes] == ["depense"] and rep.total == D("114.98")


def test_ecart_du_commercant_absorbe_pour_egaler_le_recu():
    # Le total imprimé (115,00) ne concorde pas avec la somme des lignes (114,98) : écart de 0,02 $.
    rep = taxes.repartir(recu(total="115.00"))
    assert rep.total == D("115.00")
    assert rep.cti == D("5.00") and rep.rti == D("9.98")


def test_total_seulement():
    rep = taxes.repartir(recu(sous_total="", tps="", tvq="", total="50.00"))
    assert rep.total == D("50.00") and set(par_cible(rep)) == {"depense"}


def test_total_toujours_egal_au_recu_balayage():
    for cat in ("5200", "5410", "5800", "5100"):
        for no in ("", "X"):
            for tot in ("0.01", "10.00", "114.98", "327.89", "1999.99"):
                rep = taxes.repartir(recu(categorie_code=cat, no_tps=no, no_tvq=no, total=tot,
                                          sous_total="", tps="0.50", tvq="1.00"))
                assert rep.total == D(tot), (cat, no, tot)
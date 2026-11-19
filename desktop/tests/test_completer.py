"""« Reprendre une photo pour compléter » : la 2e photo remplit seulement les champs vides.

Aucun appel IA : les lectures des deux photos sont posées dans le cache.
"""
import io
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from rbcapture.engine import Engine  # noqa: E402
from rbcapture.pipeline import depenses as dp  # noqa: E402


def _photo(tmp_path, nom, couleur, data, eng):
    buf = io.BytesIO()
    Image.new("RGB", (120, 180), couleur).save(buf, "JPEG")
    b = buf.getvalue()
    p = tmp_path / nom
    p.write_bytes(b)
    (eng.cache / f"{dp.sha256(p)}.json").write_text(json.dumps({"data": data}), encoding="utf-8")
    return b


def test_deuxieme_photo_remplit_seulement_les_vides(tmp_path):
    eng = Engine(tmp_path / "app")
    b1 = _photo(tmp_path, "a.jpg", (250, 250, 250), {
        "est_recu": True, "confiance": 0.9, "marchand": "Quincaillerie Lue", "date": None, "no_tps": None,
        "sous_total": "50.00", "tps": "2.50", "tvq": "4.99", "total": "57.49",
        "articles": [{"description": "Vis", "montant": "50.00"}]}, eng)
    b2 = _photo(tmp_path, "b.jpg", (200, 30, 30), {
        "est_recu": True, "confiance": 0.95, "marchand": "Autre nom", "date": "2026-11-10",
        "no_tps": "123456789RT0001", "no_tvq": "1234567890TQ0001", "total": "99.99", "no_facture": "",
        "articles": [{"description": "Vis", "montant": "50.00"}, {"description": "Colle", "montant": "0"}]}, eng)

    doc_id = eng.ingerer("a.jpg", b1)["id"]
    eng.corriger(doc_id, {"marchand": "Saisi à la main", "no_facture": "F-12"})
    res = eng.completer(doc_id, "b.jpg", b2)

    assert res["ok"] and set(res["ajoutes"]) == {"date", "no_tps", "no_tvq"}
    r = eng.evaluer_tous()[doc_id]
    assert r["marchand"] == "Saisi à la main"       # saisi à la main : gardé
    assert r["no_facture"] == "F-12"
    assert r["total"] == "57.49"                     # montant déjà lu : gardé
    assert r["date"] == "2026-11-10" and r["no_tps"] == "123456789RT0001"
    d = eng.doc(doc_id)
    assert len(d["parts"]) == 2                      # 2e photo jointe (vignette)
    assert [a["description"] for a in d["data"]["articles"]] == ["Vis", "Colle"]  # sans doublon
    assert "Date illisible" not in r["alertes"] and "Pas de no de TPS du fournisseur" not in r["alertes"]


def test_meme_photo_ou_facture_approuvee_ne_change_rien(tmp_path):
    eng = Engine(tmp_path / "app")
    b1 = _photo(tmp_path, "a.jpg", (250, 250, 250), {
        "est_recu": True, "marchand": "X", "date": "2026-11-01", "sous_total": "10.00", "tps": "0.50",
        "tvq": "1.00", "total": "11.50"}, eng)
    doc_id = eng.ingerer("a.jpg", b1)["id"]
    assert not eng.completer(doc_id, "a.jpg", b1)["ok"]
    eng.approuver(doc_id)
    b2 = _photo(tmp_path, "b.jpg", (10, 10, 10), {"est_recu": True, "no_tps": "123456789RT0001"}, eng)
    res = eng.completer(doc_id, "b.jpg", b2)
    assert not res["ok"] and len(eng.doc(doc_id)["parts"]) == 1

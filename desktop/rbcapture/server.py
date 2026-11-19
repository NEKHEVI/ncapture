"""Application web locale (FastAPI) - port 4100, pensée pour le téléphone."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import exports, rbooks
from .engine import RACINE, Engine, mode_lecture

PORT = int(os.environ.get("CAPTURE_PORT", "4100"))
MAX_OCTETS = 25 * 1024 * 1024
STATIC = Path(__file__).resolve().parent / "static"

app = FastAPI(title="NCapture", docs_url=None, redoc_url=None)
# Habillage commun NCapture (copié depuis shared/ par outils/synchroniser.ps1) et icônes.
app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")
eng = Engine()


def _envoyer(doc_id: str) -> str | None:
    """Crée la facture fournisseur dans NBooks. Retourne un message d'erreur ou None."""
    with eng.verrou:
        d = eng.doc(doc_id)
        if d["statut"] not in ("APPROUVE",):
            return "Facture non approuvée"
        if not rbooks.serveur_pret():
            d["erreur_envoi"] = "Serveur NBooks pas prêt (SERVEUR-PRET.txt absent). Envoi en attente."
            eng.sauver()
            return d["erreur_envoi"]
        r = eng.evaluer_tous()[doc_id]
        try:
            c = rbooks.Client()
            c.connexion()
            photos = [RACINE / p["fichier"] for p in d["parts"]]
            d["bill_id"] = c.facture_fournisseur(r, doc_id, photos)
            d["statut"], d["erreur_envoi"] = "ENVOYE", ""
        except rbooks.RBooksErreur as e:
            d["erreur_envoi"] = str(e)
        except Exception as e:  # jamais de détail brut (peut contenir des en-têtes)
            d["erreur_envoi"] = f"Erreur inattendue ({type(e).__name__})"
        eng.sauver()
        return d["erreur_envoi"] or None


def _vue(d: dict, res: dict) -> dict:
    return {"id": d["id"], "statut": d["statut"], "mois": d["mois"], "message": d.get("message", ""),
            "photos": [f"/photo/{d['id']}/{i}" for i in range(len(d["parts"]))],
            "fichiers": [Path(p["fichier"]).name for p in d["parts"]],
            "moteur": d.get("moteur", ""), "bill_id": d.get("bill_id"), "erreur_envoi": d.get("erreur_envoi", ""),
            "doublon_de": d.get("doublon_de"), "corrections": d.get("corrections", {}),
            "r": res.get(d["id"])}


@app.get("/", response_class=HTMLResponse)
def accueil():
    return (STATIC / "index.html").read_text(encoding="utf-8")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(STATIC / "assets" / "favicon.ico")


@app.get("/manifest.webmanifest", include_in_schema=False)
def manifeste():
    return FileResponse(STATIC / "assets" / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/api/status")
def status():
    pret, url = rbooks.serveur_pret(), rbooks.url_base()
    return {"mode": mode_lecture(), "nbooks_pret": pret, "nbooks_url": url, "rbooks_pret": pret, "rbooks_url": url,
            "categories": [{"code": c["code"], "nom": c["nom"]} for c in eng.cats]}


@app.get("/api/docs")
def docs():
    res = eng.evaluer_tous()
    return [_vue(d, res) for d in reversed(eng.etat["docs"])]


@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    sorties = []
    for f in files:
        contenu = await f.read()
        if len(contenu) > MAX_OCTETS:
            sorties.append({"fichier": f.filename, "action": "refuse", "message": "Fichier trop gros (25 Mo max)"})
            continue
        if not contenu:
            continue
        sorties.append({"fichier": f.filename, **eng.ingerer(f.filename or "photo.jpg", contenu)})
    return sorties


@app.post("/api/demo-load")
def demo_load():
    return eng.charger_demo()


@app.post("/api/reset")
def reset():
    eng.reinitialiser()
    return {"ok": True}


@app.post("/api/docs/{doc_id}/correct")
def corriger(doc_id: str, champs: dict = Body(...)):
    try:
        eng.corriger(doc_id, champs)
    except KeyError:
        raise HTTPException(404)
    return {"ok": True}


@app.post("/api/docs/{doc_id}/approve")
def approuver(doc_id: str):
    try:
        eng.approuver(doc_id)
    except KeyError:
        raise HTTPException(404)
    erreur = _envoyer(doc_id)
    return {"ok": True, "envoi": erreur}


@app.post("/api/docs/{doc_id}/reject")
def rejeter(doc_id: str):
    try:
        eng.rejeter(doc_id)
    except KeyError:
        raise HTTPException(404)
    return {"ok": True}


@app.post("/api/docs/{doc_id}/send")
def envoyer(doc_id: str):
    try:
        eng.doc(doc_id)
    except KeyError:
        raise HTTPException(404)
    erreur = _envoyer(doc_id)
    return {"ok": erreur is None, "erreur": erreur}


@app.post("/api/send-approved")
def envoyer_tous():
    ids = [d["id"] for d in eng.etat["docs"] if d["statut"] == "APPROUVE"]
    return {"envoyes": sum(1 for i in ids if _envoyer(i) is None), "total": len(ids)}


@app.get("/photo/{doc_id}/{n}")
def photo(doc_id: str, n: int):
    try:
        p = RACINE / eng.doc(doc_id)["parts"][n]["fichier"]
    except (KeyError, IndexError):
        raise HTTPException(404)
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/export/transactions.csv")
def export_csv(excel_fr: bool = False):
    p = exports.ecrire_csv(eng, RACINE / "export" / "transactions.csv", excel_fr)
    return FileResponse(p, media_type="text/csv; charset=utf-8", filename="transactions.csv")


@app.get("/export/transactions.xlsx")
def export_xlsx():
    p = exports.ecrire_xlsx(eng, RACINE / "export" / "transactions.xlsx")
    return FileResponse(p, filename="transactions.xlsx",
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def main():
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()

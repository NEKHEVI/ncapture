"""Moteur de capture : inbox -> lecture (cache ou IA) -> validation -> état.

Réutilise telles quelles les fonctions du pipeline Python testé
(rbcapture/pipeline/depenses.py : copie de QUICKBOOK-FACTURE TEST/depenses).
Aucun appel IA payant sans ANTHROPIC_API_KEY ; la clé n'est jamais copiée,
journalisée ni affichée (elle reste dans l'environnement du processus).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import uuid
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from .pipeline import depenses as dp

RACINE = Path(__file__).resolve().parent.parent
EMPLOYE = "Démo"
STATUTS_EXPORT = ("A_VERIFIER", "APPROUVE", "ENVOYE")
CHAMPS_CORRIGEABLES = ["marchand", "date", "no_tps", "no_tvq", "sous_total", "tps", "tvq",
                       "pourboire", "total", "no_facture"]


class LectureImpossible(Exception):
    pass


def mode_lecture() -> str:
    """'reel' si une clé API est définie dans l'environnement, sinon 'demo' (cache)."""
    return "reel" if os.environ.get("ANTHROPIC_API_KEY") else "demo"


class Engine:
    def __init__(self, racine: Path | None = None):
        self.racine = Path(racine) if racine else RACINE
        self.data = self.racine / "data"
        self.inbox = self.racine / "inbox"
        self.cache = self.data / "cache"
        self.etat_fichier = self.data / "etat.json"
        self.verrou = threading.RLock()
        for d in (self.data, self.inbox, self.cache):
            d.mkdir(parents=True, exist_ok=True)
        for nom in ("categories.json", "marchands.json"):
            cible, src = self.data / nom, RACINE / "data" / nom
            if not cible.exists() and src.exists():
                shutil.copy(src, cible)
        if self.cache != RACINE / "data" / "cache" and not any(self.cache.glob("*.json")):
            for f in (RACINE / "data" / "cache").glob("*.json"):
                shutil.copy(f, self.cache / f.name)
        self.conf = json.loads((self.data / "categories.json").read_text(encoding="utf-8"))
        self.cats = self.conf["categories"]
        self.etat = self._charger()

    # ------------------------------------------------------------ état -----
    def _charger(self) -> dict:
        if self.etat_fichier.exists():
            return json.loads(self.etat_fichier.read_text(encoding="utf-8"))
        return {"docs": [], "suivant": 1}

    def sauver(self) -> None:
        tmp = self.etat_fichier.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.etat, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.etat_fichier)

    def registre(self) -> dict:
        return dp.charger_registre(self.data / "marchands.json")

    def doc(self, doc_id: str) -> dict:
        for d in self.etat["docs"]:
            if d["id"] == doc_id:
                return d
        raise KeyError(doc_id)

    def reinitialiser(self) -> None:
        with self.verrou:
            self.etat = {"docs": [], "suivant": 1}
            self.sauver()

    # --------------------------------------------------------- ingestion -----
    def ingerer(self, nom: str, contenu: bytes, mois: str | None = None) -> dict:
        """Range le fichier dans inbox/<AAAA-MM>/ puis lit/valide. Retourne un résumé."""
        with self.verrou:
            mois = mois or date.today().strftime("%Y-%m")
            propre = re.sub(r"[^\w.\-() ]", "_", Path(nom).name)[:80] or "photo.jpg"
            dossier = self.inbox / mois
            dossier.mkdir(parents=True, exist_ok=True)
            chemin = dossier / propre
            if chemin.exists() and chemin.read_bytes() != contenu:
                chemin = dossier / f"{uuid.uuid4().hex[:6]}_{propre}"
            chemin.write_bytes(contenu)
            sha = dp.sha256(chemin)
            rel = str(chemin.relative_to(self.racine)).replace("\\", "/")
            part = {"fichier": rel, "sha": sha}

            doc = {"id": f"D{self.etat['suivant']:04d}", "mois": mois,
                   "cree": datetime.now().isoformat(timespec="seconds"),
                   "parts": [part], "statut": "A_VERIFIER", "data": {}, "moteur": "", "corrections": {},
                   "message": "", "bill_id": None, "erreur_envoi": ""}

            for d in self.etat["docs"]:
                if any(p["sha"] == sha for p in d["parts"]):
                    return self._ajouter(doc, "DOUBLON", f"Fichier identique à {d['id']}", d["id"])

            try:
                img = dp.charger_image(chemin)
            except Exception as e:  # HEIC sans pillow-heif, fichier corrompu...
                return self._ajouter(doc, "NON_LU", f"Image illisible ({type(e).__name__})")
            h = dp.dhash(img)
            part["dhash"] = h
            for d in self.etat["docs"]:
                for p in d["parts"]:
                    if "dhash" in p and bin(p["dhash"] ^ h).count("1") <= 6:
                        return self._ajouter(doc, "DOUBLON",
                                             f"Même photo que {d['id']} (recadrée/recompressée)", d["id"])

            try:
                data, moteur = self._lire(img, sha)
            except LectureImpossible as e:
                return self._ajouter(doc, "NON_LU", str(e))
            if data.get("est_recu") is False:
                return self._ajouter(doc, "NON_LU", "Ce n'est pas un reçu")
            part["data"] = data

            cle = dp.cle_fusion(data)
            if cle:
                for d in self.etat["docs"]:
                    if d["statut"] == "A_VERIFIER" and any(
                            dp.cle_fusion(p.get("data", {})) == cle for p in d["parts"]):
                        d["parts"].append(part)
                        d["data"] = dp.fusionner([(p["data"],) for p in d["parts"]])
                        self.sauver()
                        return {"id": d["id"], "action": "fusionne",
                                "message": f"Fusionné avec {d['id']} (même no d'autorisation)"}
            doc["data"], doc["moteur"] = data, moteur
            return self._ajouter(doc, "A_VERIFIER", "")

    def _ajouter(self, doc, statut, message, doublon_de=None) -> dict:
        doc["statut"], doc["message"], doc["doublon_de"] = statut, message, doublon_de
        self.etat["docs"].append(doc)
        self.etat["suivant"] += 1
        self.sauver()
        return {"id": doc["id"], "action": statut.lower(), "message": message}

    def _lire(self, img, sha: str) -> tuple[dict, str]:
        f = self.cache / f"{sha}.json"
        if f.exists():
            c = json.loads(f.read_text(encoding="utf-8"))
            return c["data"], "cache"
        cle = os.environ.get("ANTHROPIC_API_KEY")
        if not cle:
            raise LectureImpossible("Mode démo (cache) : cette photo n'a jamais été lue. "
                                    "Corrigez-la à la main ou relancez avec ANTHROPIC_API_KEY.")
        try:
            data, moteur = dp.extraire(img, sha, self.cache, "claude", cle)
        except SystemExit as e:
            raise LectureImpossible(str(e))
        except Exception as e:
            # Jamais le détail de l'erreur : seulement son type (pas de fuite d'en-têtes).
            raise LectureImpossible(f"Lecture IA impossible ({type(e).__name__})")
        return data, moteur

    def charger_demo(self) -> list[dict]:
        out = []
        for p in sorted((RACINE / "demo-photos").glob("*.jp*g")):
            out.append(self.ingerer(p.name, p.read_bytes()))
        return out

    # -------------------------------------------------------- évaluation -----
    def evaluer_tous(self) -> dict[str, dict]:
        reg = self.registre()
        par_tps = {dp.norm_taxe(d["data"].get("no_tps")): d["data"].get("marchand")
                   for d in self.etat["docs"]
                   if d["data"].get("marchand") and dp.norm_taxe(d["data"].get("no_tps"))}
        par_tps.update({k: v["marchand"] for k, v in reg.items() if v.get("marchand")})
        res, vus = {}, {}
        docs = [d for d in self.etat["docs"] if d["statut"] in STATUTS_EXPORT]
        docs.sort(key=lambda d: (evaluer_date(d) or "9999", d["id"]))
        for d in docs:
            r = evaluer(d, self.cats, reg, par_tps)
            k = (r["date"], r["total"], dp.norm_taxe(r["no_autorisation"]) or r["marchand"])
            if k in vus and k[0] and k[1]:
                r["alertes"].append(f"Doublon probable de {vus[k]}")
            vus.setdefault(k, d["id"])
            res[d["id"]] = r
        return res

    # ----------------------------------------------------------- actions -----
    def corriger(self, doc_id: str, champs: dict) -> None:
        with self.verrou:
            d = self.doc(doc_id)
            corr = d.setdefault("corrections", {})
            for k, v in champs.items():
                if k in CHAMPS_CORRIGEABLES or k == "categorie":
                    corr[k] = v.strip() if isinstance(v, str) else v
            if d["statut"] == "NON_LU":  # saisie manuelle d'une photo non lue
                d["statut"], d["moteur"] = "A_VERIFIER", "saisie manuelle"
                d["data"] = d["data"] or {"est_recu": True, "fragment": "complet", "confiance": 1.0}
            if d["statut"] == "APPROUVE":
                d["statut"] = "A_VERIFIER"  # une correction demande une nouvelle approbation
            self.sauver()

    def approuver(self, doc_id: str) -> None:
        with self.verrou:
            d = self.doc(doc_id)
            if d["statut"] != "A_VERIFIER":
                return
            d["statut"] = "APPROUVE"
            r = self.evaluer_tous().get(doc_id)
            n = r["no_tps"] if r else None
            reg = self.registre()
            if r and n and r["marchand"] and n not in reg:  # apprentissage, comme marchands.json
                reg[n] = {"marchand": r["marchand"], "categorie": r["categorie_code"]}
                (self.data / "marchands.json").write_text(
                    json.dumps(reg, ensure_ascii=False, indent=2), encoding="utf-8")
            self.sauver()

    def rejeter(self, doc_id: str) -> None:
        with self.verrou:
            self.doc(doc_id)["statut"] = "REJETE"
            self.sauver()


def evaluer_date(doc: dict) -> str:
    return (doc.get("corrections") or {}).get("date") or doc["data"].get("date") or ""


# ---------------------------------------------------------------------------
def evaluer(doc: dict, cats: list[dict], registre: dict, par_tps: dict) -> dict:
    """Applique les règles du pipeline (R1-R13) à un document. Sans effet de bord."""
    data = dict(doc["data"])
    corr = doc.get("corrections") or {}
    for k, v in corr.items():
        if k != "categorie":
            data[k] = None if v in ("", None) else v
    fichiers = [p["fichier"] for p in doc["parts"]]
    t = dp.Transaction(employe=EMPLOYE, fichiers=fichiers, shas=[p["sha"] for p in doc["parts"]],
                       data=data, moteur=doc.get("moteur", ""))
    if len(doc["parts"]) > 1:
        t.infos.append(f"Reçu reconstitué à partir de {len(doc['parts'])} photos")
    n = dp.norm_taxe(data.get("no_tps"))
    if not data.get("marchand") and n in par_tps:
        t.data["marchand"] = par_tps[n]
        t.infos.append("Marchand déduit du no TPS (en-tête illisible)")
    if corr:
        t.infos.append("Corrigé à la main : " + ", ".join(sorted(corr)))

    ok, msg = dp.verifier_calcul(t.data)
    if not ok:
        t.alertes.append(msg)
    if not t.data.get("date"):
        t.alertes.append("Date illisible")
    elif _date_future(str(t.data["date"])):
        t.alertes.append("Date invalide ou dans le futur")
    if not corr and (t.data.get("confiance") or 0) < 0.7:
        t.alertes.append(f"Confiance de lecture faible ({t.data.get('confiance')})")
    par_code = {c["code"]: c for c in cats}
    if corr.get("categorie") in par_code:
        t.categorie, t.categorie_source = par_code[corr["categorie"]], "corrigée"
    else:
        dp.categoriser(t, cats, registre)
    if t.categorie.get("alerte"):
        t.alertes.append(t.categorie["alerte"])
    m = dp.calculer(t)
    zz = dp.z
    ratio = (zz(m["tps"]) / zz(m["sous_total"])) if zz(m["sous_total"]) else Decimal("0")
    if ratio > Decimal("0.0505"):
        t.alertes.append(f"TPS = {ratio:.2%} du sous-total (> 5 %)")
    if m["pourboire"] and m["total"] and m["pourboire"] > (m["total"] - m["pourboire"]) * Decimal("0.25"):
        t.alertes.append("Pourboire > 25 %")
    if not dp.norm_taxe(t.data.get("no_tps")):
        t.alertes.append("Pas de no de TPS du fournisseur")
    if not dp.norm_taxe(t.data.get("no_tvq")):
        t.alertes.append("Pas de no de TVQ du fournisseur")
    return {
        "id": doc["id"], "date": str(t.data.get("date") or ""), "marchand": t.data.get("marchand") or "",
        "no_tps": dp.norm_taxe(t.data.get("no_tps")) or "", "no_tvq": dp.norm_taxe(t.data.get("no_tvq")) or "",
        "no_autorisation": t.data.get("no_autorisation") or "", "no_facture": t.data.get("no_facture") or "",
        "categorie_code": t.categorie["code"], "categorie": t.categorie["nom"],
        "source_categorie": t.categorie_source,
        "description": "; ".join(f"{a.get('description')} {a.get('montant')}" for a in t.data.get("articles") or []),
        "sous_total": dp.fmt(m["sous_total"]), "tps": dp.fmt(m["tps"]), "tvq": dp.fmt(m["tvq"]),
        "pourboire": dp.fmt(m["pourboire"]), "total": dp.fmt(m["total"]),
        "cti": dp.fmt(m["cti"]), "rti": dp.fmt(m["rti"]), "net": dp.fmt(m["net"]),
        "deductible": dp.fmt(m["deductible"]),
        "taxes_estimees": m["taxes_estimees"], "equilibre": ok,
        "mode_paiement": t.data.get("mode_paiement") or "", "carte_4": t.data.get("carte_4") or "",
        "confiance": t.data.get("confiance"), "moteur": doc.get("moteur", ""),
        "alertes": list(dict.fromkeys(t.alertes)), "infos": list(dict.fromkeys(t.infos)),
        "notes": t.data.get("notes") or "", "fichiers": " + ".join(fichiers),
    }


def _date_future(s: str) -> bool:
    try:
        return date.fromisoformat(s) > date.today()
    except ValueError:
        return True

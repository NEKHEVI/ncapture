#!/usr/bin/env python3
"""
depenses.py — Pipeline comptes de dépenses (RAWLF)

  photos de factures  →  prétraitement + doublons (OpenCV/Pillow)
                      →  lecture (Claude Vision, cache local)
                      →  fusion des factures en plusieurs photos
                      →  validation TPS/TVQ + alertes
                      →  catégories / comptes de dépenses
                      →  CSV (transactions, par employé, QuickBooks, écritures)
                      →  trimestres + estimés

Structure attendue de l'inbox :
  inbox/
    Marie-Tremblay/   *.jpg *.jpeg *.png *.heic(*) *.webp
    Jean-Roy/
    photo.jpg          ← fichiers à la racine = --employe-defaut

Usage :
  python depenses.py --inbox "C:\\chemin\\inbox" --sortie "C:\\chemin\\sortie"
  Variables : ANTHROPIC_API_KEY (obligatoire pour les nouvelles factures)
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

ICI = Path(__file__).resolve().parent
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
TPS, TVQ = Decimal("0.05"), Decimal("0.09975")
CENT = Decimal("0.01")
TOLERANCE = Decimal("0.03")

MODELE_RAPIDE = "claude-haiku-5-5"
MODELE_PRECIS = "claude-sonnet-5-5"

# ─────────────────────────────── utilitaires ────────────────────────────────

def D(v) -> Decimal | None:
    """Convertit '1 234,56 $', '1,234.56', 12.3 → Decimal ; None si vide."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float, Decimal)):
        return Decimal(str(v)).quantize(CENT, ROUND_HALF_UP)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(",", "") if s.rfind(".") > s.rfind(",") else s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return Decimal(s).quantize(CENT, ROUND_HALF_UP)
    except Exception:
        return None


def z(v: Decimal | None) -> Decimal:
    return v if v is not None else Decimal("0")


def fmt(v: Decimal | None) -> str:
    return "" if v is None else f"{v:.2f}"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def norm_taxe(s: str | None) -> str | None:
    if not s:
        return None
    s = re.sub(r"[^0-9A-Z]", "", s.upper())
    return s or None


def trimestre(d: date, debut_exercice: int = 1) -> str:
    """Trimestre fiscal. debut_exercice = mois de début (1 = année civile)."""
    m = (d.month - debut_exercice) % 12
    annee = d.year if d.month >= debut_exercice else d.year - 1
    if debut_exercice != 1:
        annee += 1  # exercice nommé par l'année de fin (convention courante)
    return f"{annee}-T{m // 3 + 1}"


def trimestre_suivant(t: str) -> str:
    a, q = int(t[:4]), int(t[-1])
    return f"{a + 1}-T1" if q == 4 else f"{a}-T{q + 1}"


def plage_trimestres(debut: str, fin: str) -> list[str]:
    out, t = [debut], debut
    while t != fin:
        t = trimestre_suivant(t)
        out.append(t)
    return out

# ─────────────────────────────── images ─────────────────────────────────────

def charger_image(p: Path):
    from PIL import Image, ImageOps
    try:
        if p.suffix.lower() in {".heic", ".heif"}:
            import pillow_heif  # pip install pillow-heif
            pillow_heif.register_heif_opener()
    except ImportError:
        pass
    img = Image.open(p)
    img = ImageOps.exif_transpose(img)  # photos de cellulaire tournées
    return img.convert("RGB")


def dhash(img, taille: int = 16) -> int:
    """Empreinte perceptuelle : 2 photos de la même facture ≈ même hash."""
    g = img.convert("L").resize((taille + 1, taille))
    px = list(g.tobytes())
    bits = 0
    for y in range(taille):
        for x in range(taille):
            bits = (bits << 1) | (px[y * (taille + 1) + x] > px[y * (taille + 1) + x + 1])
    return bits


def preparer_pour_vision(img, cote_max: int = 1568) -> bytes:
    """Réduit + rehausse le contraste (CLAHE) sans binariser : les modèles vision
    lisent mieux une photo naturelle bien contrastée qu'un noir/blanc agressif."""
    import numpy as np
    try:
        import cv2
        a = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2LAB)
        l, aa, bb = cv2.split(a)
        l = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l)
        a = cv2.cvtColor(cv2.merge((l, aa, bb)), cv2.COLOR_LAB2RGB)
        from PIL import Image
        img = Image.fromarray(a)
    except ImportError:
        pass
    img = img.copy()
    img.thumbnail((cote_max, cote_max))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()

# ─────────────────────────────── extraction ─────────────────────────────────

PROMPT = """Tu lis la photo d'une facture ou d'un reçu (souvent au Québec, souvent froissé, coupé ou flou).
Réponds UNIQUEMENT avec un objet JSON, sans texte autour, avec ces clés :

{
 "est_recu": true/false,
 "fragment": "complet" | "haut" | "milieu" | "bas",   // la photo ne montre qu'une partie du reçu ?
 "marchand": str|null,          // nom commercial lisible (null si l'en-tête est coupé)
 "adresse": str|null, "telephone": str|null,
 "no_tps": str|null,            // ex. 123456789RT0001
 "no_tvq": str|null,            // ex. 1234567890TQ0001
 "date": "AAAA-MM-JJ"|null,     // ATTENTION 06/12/26 : déduis MM/JJ vs JJ/MM du contexte (autres dates, mois écrits)
 "heure": "HH:MM"|null,
 "devise": "CAD",
 "articles": [{"description": str, "quantite": num|null, "montant": num}],
 "sous_total": num|null,        // avant taxes et pourboire
 "tps": num|null, "tvq": num|null, "tvh": num|null,
 "montant_avant_pourboire": num|null,  // taxes incluses, si le reçu le montre séparément
 "pourboire": num|null,         // pourboire RÉELLEMENT payé (ignorer les « exemples de pourboire »)
 "total": num|null,             // montant réellement payé, pourboire inclus
 "mode_paiement": "debit"|"credit"|"comptant"|"autre"|null,
 "carte_4": str|null,           // 4 derniers chiffres seulement
 "no_autorisation": str|null, "no_facture": str|null,
 "categorie_suggeree": str|null, // ex. repas, carburant, matériel, santé, transport...
 "confiance": 0.0-1.0,          // ta confiance globale sur les montants
 "notes": str|null              // ce qui est illisible / ambigu
}
Le « marchand » est le nom du commerce IMPRIMÉ sur le reçu (en-tête, logo, bas de page) : recopie-le tel quel. Ne le déduis JAMAIS des montants, du type d'achat ou d'un reçu « typique ». S'il est illisible ou coupé, mets null et une confiance <= 0.5.
Lis chaque montant sur la photo ; n'en calcule aucun.
N'invente jamais un montant illisible : mets null et explique dans notes."""


def appel_claude(jpeg: bytes, modele: str, cle: str) -> dict:
    corps = {
        "model": modele,
        "max_tokens": 2000,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                             "data": base64.b64encode(jpeg).decode()}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(corps).encode(),
        headers={"x-api-key": cle, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        rep = json.load(r)
    texte = "".join(b.get("text", "") for b in rep.get("content", []))
    m = re.search(r"\{.*\}", texte, re.S)
    if not m:
        raise ValueError(f"Réponse non JSON : {texte[:200]}")
    return json.loads(m.group(0))


def appel_tesseract(img) -> dict:
    """Secours hors-ligne. Peu fiable sur photos froissées → toujours « à vérifier »."""
    import pytesseract
    txt = pytesseract.image_to_string(img, config="--psm 4")
    montants = [D(x) for x in re.findall(r"\d{1,5}[.,]\d{2}", txt)]
    total = max((m for m in montants if m), default=None)
    dt = re.search(r"(20\d\d)[-/](\d\d)[-/](\d\d)", txt)
    return {"est_recu": True, "fragment": "complet", "marchand": None, "total": float(total) if total else None,
            "date": f"{dt.group(1)}-{dt.group(2)}-{dt.group(3)}" if dt else None,
            "confiance": 0.2, "notes": "Extraction Tesseract (secours) — à valider manuellement."}


def extraire(img, sha: str, cache: Path, moteur: str, cle: str | None) -> tuple[dict, str]:
    f = cache / f"{sha}.json"
    if f.exists():
        c = json.loads(f.read_text(encoding="utf-8"))
        return c["data"], c.get("moteur", "cache")
    if moteur == "claude":
        if not cle:
            raise SystemExit("ANTHROPIC_API_KEY manquante (ou utilisez --moteur tesseract).")
        jpeg = preparer_pour_vision(img)
        data, utilise = appel_claude(jpeg, MODELE_RAPIDE, cle), MODELE_RAPIDE
        if (data.get("confiance") or 0) < 0.8 or not verifier_calcul(data)[0]:
            data, utilise = appel_claude(jpeg, MODELE_PRECIS, cle), MODELE_PRECIS  # escalade
    else:
        data, utilise = appel_tesseract(img), "tesseract"
    cache.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"moteur": utilise, "data": data}, ensure_ascii=False, indent=2), encoding="utf-8")
    return data, utilise

# ─────────────────────────────── validation ─────────────────────────────────

def verifier_calcul(d: dict) -> tuple[bool, str | None]:
    st, tps, tvq, tvh = D(d.get("sous_total")), D(d.get("tps")), D(d.get("tvq")), D(d.get("tvh"))
    pb, tot, avp = D(d.get("pourboire")), D(d.get("total")), D(d.get("montant_avant_pourboire"))
    if tot is None:
        return False, "Total illisible"
    if st is not None and (tps is not None or tvq is not None or tvh is not None):
        attendu = st + z(tps) + z(tvq) + z(tvh) + z(pb)
        if abs(attendu - tot) > TOLERANCE:
            return False, f"Calcul incohérent : {st}+taxes+pourboire = {attendu} ≠ total {tot}"
    if avp is not None and pb is not None and abs(avp + pb - tot) > TOLERANCE:
        return False, f"Montant {avp} + pourboire {pb} ≠ total {tot}"
    return True, None


@dataclass
class Transaction:
    employe: str
    fichiers: list[str]
    shas: list[str]
    data: dict
    moteur: str
    alertes: list[str] = field(default_factory=list)   # → statut A_VERIFIER
    infos: list[str] = field(default_factory=list)     # traçabilité, pas bloquant
    categorie: dict | None = None
    categorie_source: str = ""

    # champs calculés
    def get(self, k):
        return self.data.get(k)


def fusionner(groupe: list[tuple[dict, str, str, str]]) -> dict:
    """Fusionne plusieurs photos du même reçu (haut/milieu/bas)."""
    ordre = {"haut": 0, "complet": 1, "milieu": 2, "bas": 3}
    groupe = sorted(groupe, key=lambda g: ordre.get(g[0].get("fragment") or "complet", 1))
    out: dict = {}
    for d, *_ in groupe:
        for k, v in d.items():
            if k == "articles":
                out.setdefault("articles", [])
                out["articles"] += [a for a in (v or []) if a not in out["articles"]]
            elif k == "notes":
                if v:
                    out["notes"] = (out.get("notes") + " | " if out.get("notes") else "") + v
            elif out.get(k) in (None, "", []):
                out[k] = v
    out["confiance"] = min((g[0].get("confiance") or 0) for g in groupe)
    out["fragment"] = "fusionné" if len(groupe) > 1 else groupe[0][0].get("fragment")
    return out


def cle_fusion(d: dict) -> str | None:
    auth = re.sub(r"\W", "", str(d.get("no_autorisation") or ""))
    return f"auth:{auth}" if len(auth) >= 4 else None


def charger_registre(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def categoriser(t: Transaction, cats: list[dict], registre: dict) -> None:
    par_code = {c["code"]: c for c in cats}
    tps_no = norm_taxe(t.get("no_tps"))
    # 1) règle apprise (marchands.json) — comme les « règles bancaires » de QuickBooks
    regle = registre.get(tps_no or "") or registre.get((t.get("marchand") or "").lower())
    if regle and regle.get("categorie") in par_code:
        t.categorie, t.categorie_source = par_code[regle["categorie"]], "règle marchand"
        return
    # 2) mots-clés sur marchand + articles + suggestion du modèle
    # Le nom du commerce décide d'abord ; les articles et la suggestion du modèle ne sont qu'un indice.
    textes = [(t.get("marchand") or "").lower(),
              " ".join([t.get("marchand") or "", t.get("categorie_suggeree") or "",
                        *[a.get("description", "") for a in t.get("articles") or []]]).lower()]
    scores = []
    for texte in textes:
        for i, c in enumerate(cats):
            n = sum(1 for m in c.get("motifs", []) if re.search(m, texte, re.I))
            if n:
                scores.append((n, -i, c))
        if scores:
            break
    if scores:
        t.categorie, t.categorie_source = max(scores, key=lambda s: (s[0], s[1]))[2], "mots-clés"
    else:
        t.categorie, t.categorie_source = par_code["5900"], "aucune"
        t.alertes.append("Catégorie inconnue → À classer")


def calculer(t: Transaction) -> dict:
    """Montants comptables d'une transaction."""
    d, c = t.data, t.categorie
    tot, pb = D(d.get("total")), z(D(d.get("pourboire")))
    st, tps, tvq = D(d.get("sous_total")), D(d.get("tps")), D(d.get("tvq"))
    tvh = D(d.get("tvh"))
    estimees = False
    if tot is not None and tps is None and tvq is None and tvh is None and c["cti_rti"] > 0:
        # reçu de terminal sans détail : on retrouve les taxes QC à partir du total
        base = ((tot - pb) / (1 + TPS + TVQ)).quantize(CENT, ROUND_HALF_UP)
        tps, tvq = (base * TPS).quantize(CENT, ROUND_HALF_UP), (base * TVQ).quantize(CENT, ROUND_HALF_UP)
        st, estimees = base, True
        t.alertes.append("Taxes non détaillées : TPS/TVQ estimées à partir du total")
    if st is None and tot is not None:
        st = tot - pb - z(tps) - z(tvq) - z(tvh)
    # CTI/RTI : il faut les nos de taxe du fournisseur dès 30 $ (règle ARC/RQ)
    reclamable = c["cti_rti"] > 0 and (norm_taxe(d.get("no_tps")) or z(tot) < 30) and not estimees
    if c["cti_rti"] > 0 and not reclamable and z(tot) >= 30:
        t.alertes.append("Pas de nos TPS/TVQ du fournisseur → CTI/RTI non réclamables. Demander la facture détaillée.")
    ratio = Decimal(str(c["cti_rti"])) if reclamable else Decimal("0")
    cti = (z(tps) + z(tvh)) * ratio
    rti = z(tvq) * ratio
    cti, rti = cti.quantize(CENT, ROUND_HALF_UP), rti.quantize(CENT, ROUND_HALF_UP)
    net = z(tot) - cti - rti
    deductible = (net * Decimal(str(c["deductible"]))).quantize(CENT, ROUND_HALF_UP)
    return {"sous_total": st, "tps": tps, "tvq": tvq, "tvh": tvh, "pourboire": D(d.get("pourboire")),
            "total": tot, "cti": cti, "rti": rti, "net": net, "deductible": deductible,
            "taxes_estimees": estimees}

# ─────────────────────────────── estimés ────────────────────────────────────

def estimer(serie: list[Decimal], n: int) -> tuple[list[Decimal], str, str]:
    """Prévision trimestrielle simple et explicable.
    ≥ 8 trim. : saisonnier (même trimestre l'an dernier × tendance annuelle)
    2–7 trim. : moyenne mobile pondérée des 4 derniers (récent = plus de poids)
    1 trim.   : reconduction"""
    k = len(serie)
    if k >= 8:
        a1, a0 = sum(serie[-4:]), sum(serie[-8:-4])
        tendance = (a1 / a0) if a0 else Decimal("1")
        tendance = min(max(tendance, Decimal("0.5")), Decimal("2"))
        prev = [(serie[-4 + (i % 4)] * tendance).quantize(CENT) for i in range(n)]
        return prev, "saisonnier × tendance", "bonne"
    if k >= 2:
        derniers = serie[-4:]
        poids = [Decimal(p) for p in (1, 2, 3, 4)[-len(derniers):]]
        moy = (sum(v * p for v, p in zip(derniers, poids)) / sum(poids)).quantize(CENT)
        return [moy] * n, "moyenne mobile pondérée", "moyenne" if k >= 4 else "faible"
    return [serie[-1]] * n if serie else [Decimal("0")] * n, "reconduction", "faible"

# ─────────────────────────────── écriture CSV ───────────────────────────────

def ecrire_csv(p: Path, entetes: list[str], lignes: list[list], excel_fr: bool) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    sep = ";" if excel_fr else ","
    with open(p, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=sep)
        w.writerow(entetes)
        for l in lignes:
            w.writerow([(str(x).replace(".", ",") if excel_fr and isinstance(x, str) and re.fullmatch(r"-?\d+\.\d\d", x) else x) for x in l])

# ─────────────────────────────── pipeline ───────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Factures → CSV → comptes de dépenses → trimestres")
    ap.add_argument("--inbox", required=True, type=Path)
    ap.add_argument("--sortie", type=Path, default=ICI / "sortie")
    ap.add_argument("--cache", type=Path, default=ICI / "cache")
    ap.add_argument("--categories", type=Path, default=ICI / "categories.json")
    ap.add_argument("--marchands", type=Path, default=ICI / "marchands.json")
    ap.add_argument("--employe-defaut", default="Non-assigne")
    ap.add_argument("--moteur", choices=["claude", "tesseract"], default="claude")
    ap.add_argument("--debut-exercice", type=int, default=1, help="Mois de début d'exercice (1 = janvier)")
    ap.add_argument("--trimestres-estimes", type=int, default=4)
    ap.add_argument("--excel-fr", action="store_true", help="CSV ; et virgule décimale (Excel FR)")
    args = ap.parse_args()

    conf = json.loads(args.categories.read_text(encoding="utf-8"))
    cats, comptes = conf["categories"], conf["comptes_bilan"]
    registre = charger_registre(args.marchands)
    cle = os.environ.get("ANTHROPIC_API_KEY")
    exclus = {args.sortie.resolve(), args.cache.resolve(), ICI}

    # 1) inventaire + doublons ---------------------------------------------------
    fichiers: list[tuple[Path, str]] = []
    for p in sorted(args.inbox.rglob("*")):
        if p.suffix.lower() not in EXTENSIONS or any(e in p.resolve().parents for e in exclus):
            continue
        rel = p.relative_to(args.inbox)
        employe = rel.parts[0] if len(rel.parts) > 1 else args.employe_defaut
        fichiers.append((p, employe))

    vus_sha: dict[str, str] = {}
    vus_hash: list[tuple[int, str]] = []
    doublons: list[list[str]] = []
    uniques = []
    for p, emp in fichiers:
        s = sha256(p)
        if s in vus_sha:
            doublons.append([p.name, vus_sha[s], "fichier identique"])
            continue
        img = charger_image(p)
        h = dhash(img)
        proche = next((n for hh, n in vus_hash if bin(hh ^ h).count("1") <= 6), None)
        if proche:
            doublons.append([p.name, proche, "même photo (recadrée/recompressée)"])
            continue
        vus_sha[s] = p.name
        vus_hash.append((h, p.name))
        uniques.append((p, emp, s, img))
    print(f"{len(fichiers)} fichiers · {len(uniques)} uniques · {len(doublons)} doublons ignorés")

    # 2) extraction ----------------------------------------------------------------
    extraits = []
    for p, emp, s, img in uniques:
        data, moteur = extraire(img, s, args.cache, args.moteur, cle)
        if data.get("est_recu") is False:
            doublons.append([p.name, "", "pas un reçu"])
            continue
        extraits.append((data, p.name, s, emp, moteur))
        print(f"  ✓ {p.name[:40]:40} {data.get('marchand') or '?':28} {data.get('total')}")

    # 3) fusion des reçus photographiés en plusieurs morceaux ----------------------
    groupes: dict[str, list] = defaultdict(list)
    for i, e in enumerate(extraits):
        k = cle_fusion(e[0])
        groupes[f"{e[3]}|{k}" if k else f"seul:{i}"].append(e)

    trans: list[Transaction] = []
    for g in groupes.values():
        data = fusionner(g) if len(g) > 1 else dict(g[0][0])
        t = Transaction(employe=g[0][3], fichiers=[x[1] for x in g], shas=[x[2] for x in g],
                        data=data, moteur=g[0][4])
        if len(g) > 1:
            t.infos.append(f"Reçu reconstitué à partir de {len(g)} photos")
        trans.append(t)

    # 4) marchand retrouvé par numéro de TPS (en-tête coupé) ------------------------
    par_tps = {norm_taxe(t.get("no_tps")): t.get("marchand") for t in trans
               if t.get("marchand") and norm_taxe(t.get("no_tps"))}
    par_tps.update({k: v["marchand"] for k, v in registre.items() if v.get("marchand")})
    for t in trans:
        n = norm_taxe(t.get("no_tps"))
        if not t.get("marchand") and n in par_tps:
            t.data["marchand"] = par_tps[n]
            t.infos.append("Marchand déduit du no TPS (en-tête illisible)")

    # 5) validation + catégories + montants -----------------------------------------
    lignes_tx, rapport = [], []
    for t in trans:
        ok, msg = verifier_calcul(t.data)
        if not ok:
            t.alertes.append(msg)
        if not t.get("date"):
            t.alertes.append("Date illisible")
        if (t.get("confiance") or 0) < 0.7:
            t.alertes.append(f"Confiance de lecture faible ({t.get('confiance')})")
        categoriser(t, cats, registre)
        if t.categorie.get("alerte"):
            t.alertes.append(t.categorie["alerte"])
        m = calculer(t)
        tps_ratio = (z(m["tps"]) / z(m["sous_total"])) if z(m["sous_total"]) else Decimal("0")
        if tps_ratio > Decimal("0.0505"):
            t.alertes.append(f"TPS = {tps_ratio:.2%} du sous-total (> 5 %)")
        if m["pourboire"] and m["total"] and m["pourboire"] > (m["total"] - m["pourboire"]) * Decimal("0.25"):
            t.alertes.append("Pourboire > 25 %")
        rapport.append((t, m))

    # doublons de transaction (même reçu soumis 2 fois, photos différentes)
    vu_tx = {}
    for t, m in rapport:
        k = (t.get("date"), fmt(m["total"]), norm_taxe(t.get("no_autorisation")) or t.get("marchand"))
        if k in vu_tx and k[0] and k[1]:
            t.alertes.append(f"Doublon probable de {vu_tx[k]}")
        vu_tx.setdefault(k, ", ".join(t.fichiers))

    rapport.sort(key=lambda r: (r[0].get("date") or "9999", r[0].employe))
    for i, (t, m) in enumerate(rapport, 1):
        t.data["_id"] = f"D{i:04d}"
        dt = date.fromisoformat(t.get("date")) if t.get("date") else None
        t.data["_trimestre"] = trimestre(dt, args.debut_exercice) if dt else ""

    # 6) sorties ---------------------------------------------------------------------
    S = args.sortie
    entetes = ["id", "employe", "date", "trimestre", "marchand", "no_tps", "no_tvq", "compte", "categorie",
               "source_categorie", "description", "sous_total", "tps", "tvq", "pourboire", "total",
               "cti_tps", "rti_tvq", "depense_nette", "montant_deductible", "mode_paiement", "carte_4",
               "no_autorisation", "no_facture", "confiance", "moteur", "statut", "alertes", "infos", "notes_lecture", "fichiers"]
    for t, m in rapport:
        desc = "; ".join(f"{a.get('description')} {a.get('montant')}" for a in t.get("articles") or [])
        lignes_tx.append([t.get("_id"), t.employe, t.get("date") or "", t.get("_trimestre"), t.get("marchand") or "",
                          norm_taxe(t.get("no_tps")) or "", norm_taxe(t.get("no_tvq")) or "",
                          t.categorie["code"], t.categorie["nom"], t.categorie_source, desc,
                          fmt(m["sous_total"]), fmt(m["tps"]), fmt(m["tvq"]), fmt(m["pourboire"]), fmt(m["total"]),
                          fmt(m["cti"]), fmt(m["rti"]), fmt(m["net"]), fmt(m["deductible"]),
                          t.get("mode_paiement") or "", t.get("carte_4") or "", t.get("no_autorisation") or "",
                          t.get("no_facture") or "", t.get("confiance"), t.moteur,
                          "A_VERIFIER" if t.alertes else "OK", " | ".join(t.alertes), " | ".join(t.infos),
                          t.get("notes") or "", " + ".join(t.fichiers)])
    ecrire_csv(S / "transactions.csv", entetes, lignes_tx, args.excel_fr)
    ecrire_csv(S / "a_verifier.csv", entetes, [l for l in lignes_tx if l[26] == "A_VERIFIER"], args.excel_fr)
    ecrire_csv(S / "doublons_ignores.csv", ["fichier", "doublon_de", "raison"], doublons, args.excel_fr)

    # rapport de dépenses par employé (remboursement)
    par_emp = defaultdict(list)
    for l in lignes_tx:
        par_emp[l[1]].append(l)
    for emp, ls in par_emp.items():
        tot = sum(D(l[15]) or 0 for l in ls)
        corps = [[l[0], l[2], l[4], l[8], l[15], l[26]] for l in ls] + [["", "", "", "TOTAL À REMBOURSER", fmt(Decimal(tot)), ""]]
        ecrire_csv(S / "par_employe" / f"{emp}.csv", ["id", "date", "marchand", "categorie", "total", "statut"], corps, args.excel_fr)

    # QuickBooks : relevé 3 colonnes (Date, Description, Montant) — import « transactions bancaires »
    qb = [[date.fromisoformat(t.get("date")).strftime("%d/%m/%Y") if t.get("date") else "",
           f"{t.get('marchand') or 'Inconnu'} — {t.categorie['code']} {t.categorie['nom']} — {t.employe} ({t.get('_id')})",
           f"-{m['total']:.2f}" if m["total"] else ""] for t, m in rapport]
    ecrire_csv(S / "quickbooks_transactions.csv", ["Date", "Description", "Amount"], qb, False)

    # écritures de journal en partie double (débits = crédits)
    je = []
    for t, m in rapport:
        if not m["total"]:
            continue
        d_, ref = t.get("date") or "", t.get("_id")
        lib = f"{t.get('marchand') or 'Inconnu'} — {t.employe}"
        je.append([d_, ref, f"{t.categorie['code']} {t.categorie['nom']}", fmt(m["net"]), "", lib])
        if m["cti"]:
            je.append([d_, ref, comptes["tps_a_recevoir"], fmt(m["cti"]), "", lib])
        if m["rti"]:
            je.append([d_, ref, comptes["tvq_a_recevoir"], fmt(m["rti"]), "", lib])
        je.append([d_, ref, f"{comptes['a_rembourser']} — {t.employe}", "", fmt(m["total"]), lib])
    ecrire_csv(S / "ecritures_journal.csv", ["date", "no_piece", "compte", "debit", "credit", "libelle"], je, args.excel_fr)

    # 7) trimestres + estimés -----------------------------------------------------------
    agg = defaultdict(lambda: defaultdict(Decimal))
    nb = defaultdict(int)
    for t, m in rapport:
        q = t.get("_trimestre")
        if not q:
            continue
        cle_c = f"{t.categorie['code']} {t.categorie['nom']}"
        for k in ("total", "net", "cti", "rti", "deductible"):
            agg[(q, cle_c)][k] += z(m[k])
        nb[(q, cle_c)] += 1
    if agg:
        qs = sorted({q for q, _ in agg})
        tous_q = plage_trimestres(qs[0], qs[-1])
        cats_vues = sorted({c for _, c in agg})
        lt = []
        for q in tous_q:
            for c in cats_vues:
                a = agg.get((q, c))
                if a:
                    lt.append([q, c, nb[(q, c)], fmt(a["total"]), fmt(a["net"]), fmt(a["cti"]), fmt(a["rti"]), fmt(a["deductible"])])
            tq = [agg[(q, c)] for c in cats_vues if (q, c) in agg]
            lt.append([q, "TOTAL TRIMESTRE", sum(nb[(q, c)] for c in cats_vues),
                       *(fmt(sum((a[k] for a in tq), Decimal("0"))) for k in ("total", "net", "cti", "rti", "deductible"))])
        ecrire_csv(S / "trimestres.csv", ["trimestre", "categorie", "nb", "total_paye", "depense_nette",
                                          "cti_tps", "rti_tvq", "deductible_impot"], lt, args.excel_fr)

        futurs, q = [], tous_q[-1]
        for _ in range(args.trimestres_estimes):
            q = trimestre_suivant(q)
            futurs.append(q)
        le, tot_fut = [], defaultdict(Decimal)
        for c in cats_vues:
            serie = [agg[(q, c)]["net"] if (q, c) in agg else Decimal("0") for q in tous_q]
            prev, methode, fiab = estimer(serie, len(futurs))
            for q, v in zip(futurs, prev):
                le.append([q, c, fmt(v), methode, fiab, len(serie)])
                tot_fut[q] += v
        for q in futurs:
            le.append([q, "TOTAL ESTIMÉ", fmt(tot_fut[q]), "", "", ""])
        ecrire_csv(S / "estimes.csv", ["trimestre", "categorie", "depense_nette_estimee", "methode",
                                       "fiabilite", "trimestres_historique"], le, args.excel_fr)

    # 8) registre des marchands (s'enrichit à chaque passe ; éditable à la main) ------
    for t, m in rapport:
        n = norm_taxe(t.get("no_tps"))
        if n and t.get("marchand") and n not in registre:
            registre[n] = {"marchand": t.get("marchand"), "categorie": t.categorie["code"]}
    args.marchands.write_text(json.dumps(registre, ensure_ascii=False, indent=2), encoding="utf-8")

    nb_av = sum(1 for l in lignes_tx if l[26] == "A_VERIFIER")
    print(f"\n{len(rapport)} transactions · {nb_av} à vérifier · sorties : {S}")


if __name__ == "__main__":
    main()

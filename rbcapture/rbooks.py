"""Client de l'API RBooks : facture fournisseur (Bill) + photo en pièce jointe.

Routes (lues dans rbooks/packages/server/src/modules, lecture seule) :
  POST /auth/signin        {email, password}  -> {accessToken, organizationId, tenantId}
  GET/POST /vendors        displayName, currencyCode, ...
  GET/POST /accounts       (plan comptable)
  GET/POST /items          name, type, purchasable, costAccountId, ...
  POST /attachments        multipart champ `file` -> {data: {key}}
  POST /bills              billDate, vendorId, entries[{itemId, rate, quantity}], attachments[{key}], open
En-têtes : Authorization: Bearer <jwt> et organization-id: <id>.

Identifiants : variables RBOOKS_EMAIL / RBOOKS_PASSWORD, sinon fichier
C:\\DEV\\CODEGOD\\RAWLF\\secrets\\rbooks-demo.txt lu par programme. Jamais affichés ni journalisés.
"""
from __future__ import annotations

import os
import re
from decimal import Decimal
from pathlib import Path

import requests

PRET = Path(os.environ.get("RBOOKS_PRET", r"C:\DEV\CODEGOD\RAWLF\_tmp_rbooks\SERVEUR-PRET.txt"))
SECRETS = Path(os.environ.get("RBOOKS_SECRETS", r"C:\DEV\CODEGOD\RAWLF\secrets\rbooks-demo.txt"))


class RBooksErreur(Exception):
    """Message sûr à afficher (jamais de jeton ni de mot de passe)."""


def serveur_pret() -> bool:
    return PRET.exists()


def url_base() -> str:
    if os.environ.get("RBOOKS_URL"):
        return os.environ["RBOOKS_URL"].rstrip("/")
    if PRET.exists():
        m = re.search(r"https?://[^\s\"']+", PRET.read_text(encoding="utf-8", errors="ignore"))
        if m:
            return m.group(0).rstrip("/")
    return "http://localhost:3000"


def _identifiants() -> tuple[str, str]:
    email, mdp = os.environ.get("RBOOKS_EMAIL"), os.environ.get("RBOOKS_PASSWORD")
    if email and mdp:
        return email, mdp
    if not SECRETS.exists():
        raise RBooksErreur("Identifiants RBooks introuvables (RBOOKS_EMAIL / RBOOKS_PASSWORD ou fichier secrets).")
    lignes = [l.strip() for l in SECRETS.read_text(encoding="utf-8", errors="ignore").splitlines() if l.strip()]
    for l in lignes:
        k, sep, v = l.partition("=") if "=" in l else l.partition(":")
        if not sep:
            continue
        k, v = k.strip().lower().lstrip("#").strip(), v.strip().strip("\"'")
        if k in ("email", "courriel", "user", "username", "rbooks_email", "login") and not email:
            email = v
        elif k in ("password", "mot de passe", "motdepasse", "mdp", "pass", "rbooks_password") and not mdp:
            mdp = v
    if not (email and mdp):  # format 2 lignes : courriel puis mot de passe
        if len(lignes) >= 2 and "@" in lignes[0]:
            email, mdp = lignes[0], lignes[1]
    if not (email and mdp):
        raise RBooksErreur("Format du fichier d'identifiants non reconnu (attendu : email: ... / password: ...).")
    return email, mdp


def _liste(rep) -> list:
    """Trouve la liste d'objets dans une réponse de forme variable."""
    if isinstance(rep, list):
        return rep
    if isinstance(rep, dict):
        for k in ("data", "items", "vendors", "accounts", "results", "bills"):
            if k in rep:
                v = _liste(rep[k])
                if v or isinstance(rep[k], list):
                    return v
    return []


def _id(rep) -> int:
    if isinstance(rep, dict):
        for k in ("id",):
            if isinstance(rep.get(k), int):
                return rep[k]
        for k in ("data", "vendor", "item", "bill", "account"):
            if k in rep:
                try:
                    return _id(rep[k])
                except RBooksErreur:
                    pass
    raise RBooksErreur("Réponse RBooks sans identifiant.")


class Client:
    def __init__(self):
        self.base = url_base()
        self.s = requests.Session()
        self.prefixe = None
        self.h: dict[str, str] = {}
        self._cache: dict[str, int] = {}

    # --- HTTP ---------------------------------------------------------------
    def _req(self, methode, chemin, **kw):
        prefixes = [self.prefixe] if self.prefixe is not None else ["/api", ""]
        derniere = None
        for p in prefixes:
            try:
                r = self.s.request(methode, f"{self.base}{p}{chemin}", headers=self.h, timeout=60, **kw)
            except requests.RequestException as e:
                raise RBooksErreur(f"Serveur RBooks injoignable ({type(e).__name__}) à {self.base}")
            if r.status_code == 404 and self.prefixe is None and p == "/api":
                derniere = r
                continue
            self.prefixe = p
            if r.status_code >= 400:
                raise RBooksErreur(f"RBooks {methode} {chemin} : HTTP {r.status_code} {_resume(r)}")
            return r.json() if r.content else {}
        raise RBooksErreur(f"RBooks : route introuvable {chemin} (HTTP {derniere.status_code if derniere else '?'})")

    def connexion(self):
        email, mdp = _identifiants()
        rep = self._req("POST", "/auth/signin", json={"email": email, "password": mdp})
        tok = rep.get("accessToken") or rep.get("access_token")
        org = rep.get("organizationId") or rep.get("organization_id")
        if not tok:
            raise RBooksErreur("Connexion RBooks refusée.")
        self.h = {"Authorization": f"Bearer {tok}", "organization-id": str(org)}

    # --- ressources ---------------------------------------------------------
    def fournisseur(self, nom: str, no_tps: str = "") -> int:
        cle = f"v:{nom.lower()}"
        if cle in self._cache:
            return self._cache[cle]
        for v in _liste(self._req("GET", "/vendors", params={"page_size": 200, "pageSize": 200})):
            if str(v.get("display_name") or v.get("displayName") or "").lower() == nom.lower():
                self._cache[cle] = v["id"]
                return v["id"]
        note = f"Créé par RBooks Capture. No TPS : {no_tps}" if no_tps else "Créé par RBooks Capture."
        vid = _id(self._req("POST", "/vendors", json={"displayName": nom, "companyName": nom,
                                                      "currencyCode": "CAD", "active": True, "note": note}))
        self._cache[cle] = vid
        return vid

    def compte_depense(self, code: str, nom: str) -> int | None:
        if "comptes" not in self._cache:
            self._cache["comptes"] = _liste(self._req("GET", "/accounts"))
        comptes = self._cache["comptes"]
        for c in comptes:
            if str(c.get("code") or "") == code:
                return c["id"]
        for c in comptes:
            if nom.lower() in str(c.get("name") or "").lower():
                return c["id"]
        for pref in ("frais de bureau", "office expenses"):
            for c in comptes:
                if str(c.get("name") or "").lower() == pref:
                    return c["id"]
        for c in comptes:
            racine = c.get("account_root_type") or c.get("root_type") or c.get("rootType") or ""
            if str(racine).lower() == "expense":
                return c["id"]
        return None

    def article(self, code: str, nom: str) -> int:
        titre = f"Dépense {code} - {nom}"[:250]
        cle = f"i:{titre}"
        if cle in self._cache:
            return self._cache[cle]
        for i in _liste(self._req("GET", "/items", params={"page_size": 200, "pageSize": 200})):
            if str(i.get("name") or "").lower() == titre.lower():
                self._cache[cle] = i["id"]
                return i["id"]
        corps = {"name": titre, "type": "service", "purchasable": True, "costPrice": 0, "sellable": False,
                 "note": "Créé par RBooks Capture"}
        cid = self.compte_depense(code, nom)
        if cid:
            corps["costAccountId"] = cid
        iid = _id(self._req("POST", "/items", json=corps))
        self._cache[cle] = iid
        return iid

    def piece_jointe(self, chemin: Path) -> str:
        with open(chemin, "rb") as f:
            rep = self._req("POST", "/attachments", files={"file": (chemin.name, f, "image/jpeg")})
        cle = (rep.get("data") or {}).get("key") if isinstance(rep, dict) else None
        if not cle:
            raise RBooksErreur("Téléversement de la photo : pas de clé retournée.")
        return cle

    def facture_fournisseur(self, r: dict, doc_id: str, photos: list[Path]) -> int:
        """Crée la facture fournisseur à partir d'un résultat évalué. Retourne l'id du Bill."""
        marchand = r["marchand"] or "Fournisseur inconnu"
        vendor = self.fournisseur(marchand, r["no_tps"])
        item = self.article(r["categorie_code"], r["categorie"])
        total = Decimal(r["total"])
        lignes = [("Sous-total", r["sous_total"]), ("TPS (5 %)", r["tps"]), ("TVQ (9,975 %)", r["tvq"]),
                  ("Pourboire", r["pourboire"])]
        entrees = [(lib, Decimal(v)) for lib, v in lignes if v not in ("", None) and Decimal(v) != 0]
        ecart = total - sum((m for _, m in entrees), Decimal("0"))
        if not entrees:
            entrees = [("Total", total)]
        elif ecart != 0:  # garantit que le Bill égale le total payé
            entrees[0] = (entrees[0][0], entrees[0][1] + ecart)
        cles = [self.piece_jointe(p) for p in photos]
        date = r["date"] or None
        if not date:
            raise RBooksErreur("Date manquante : corrigez la facture avant l'envoi.")
        corps = {
            "billNumber": f"CAP-{doc_id}" + (f"-{r['no_facture']}" if r["no_facture"] else ""),
            "billDate": date, "dueDate": date, "vendorId": vendor, "open": True,
            "note": f"Capture photo {doc_id} - {r['categorie_code']} {r['categorie']}. "
                    f"CTI {r['cti']} $ / RTI {r['rti']} $ (voir tâche taxes).",
            "entries": [{"index": i + 1, "itemId": item, "rate": float(m), "quantity": 1, "description": f"{lib} - {marchand}"}
                        for i, (lib, m) in enumerate(entrees)],
            "attachments": [{"key": k} for k in cles],
        }
        return _id(self._req("POST", "/bills", json=corps))


def _resume(r) -> str:
    try:
        j = r.json()
        msg = j.get("message") or j.get("errors") or j
        return str(msg)[:300]
    except Exception:
        return r.text[:200].replace("\n", " ")

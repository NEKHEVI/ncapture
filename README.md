# RBooks Capture

Capture de factures par photo pour RBooks : **photo (ou fichier) -> lecture -> vérification -> export CSV et Excel -> facture fournisseur créée dans RBooks avec la photo jointe.**

Version démo, port **4100**, pensée pour le téléphone. Produit séparé de RAWLF ; compagnon de RBooks (base Bigcapital). Licence **AGPL-3.0** (voir `LICENSE`, `NOTICE.md`, `DISCLAIMER`).

Guide de démo : [`DEMO.md`](DEMO.md).

## Choix technique : Python + FastAPI

Le pipeline de lecture existe déjà en Python, testé sur de vraies factures (`depenses.py` : validation en `Decimal`, TPS 5 % / TVQ 9,975 %, doublons SHA-256 + dHash, fusion des reçus en morceaux, catégories et CTI/RTI). Le réutiliser tel quel (copie dans `rbcapture/pipeline/depenses.py`, non modifiée) évite de réécrire et de re-tester les règles avant une démo : fiable plutôt que complet. FastAPI, openpyxl, Pillow et OpenCV sont déjà installés sur l'ordinateur. Le portage en module TypeScript dans RBooks reste prévu (`rbooks/docs/rbooks/PLAN-CAPTURE-FACTURES.md`) ; ce dossier sert de démo et de référence de parité.

## Structure

| Fichier | Rôle |
|---|---|
| `rbcapture/server.py` | Application web (routes, port 4100) |
| `rbcapture/engine.py` | Ingestion (`inbox\<AAAA-MM>\`), doublons, lecture (cache ou IA), validation, états |
| `rbcapture/exports.py` | `transactions.csv` et `transactions.xlsx` (feuille par mois + feuille Taxes) |
| `rbcapture/rbooks.py` | Client API RBooks : connexion, fournisseur, compte, article, pièce jointe, facture fournisseur |
| `rbcapture/static/index.html` | Interface téléphone (photo, À vérifier, Corriger, Approuver, exports) |
| `rbcapture/pipeline/depenses.py` | Pipeline Python existant (copie) |
| `data/` | `categories.json`, `marchands.json`, `cache\` (lectures des factures de test), `etat.json` (local, ignoré par git) |
| `demo-photos/` | 10 photos de test (dont 4 copies identiques) |
| `inbox\<AAAA-MM>\` | Photos reçues (ignoré par git) |
| `tests/` | 23 tests (montants, règles, exports, client RBooks contre un faux serveur) |

## Lecture : démo ou réelle

- **Sans** `ANTHROPIC_API_KEY` : **mode démo (cache)**. Aucune requête réseau vers l'IA. Seules les photos déjà lues (`data\cache\<sha>.json`) sont reconnues ; une autre photo est classée « non lue » et peut être saisie à la main avec « Corriger ».
- **Avec** `ANTHROPIC_API_KEY` dans l'environnement du lancement : lecture réelle (Haiku, escalade vers Sonnet si confiance < 0,8 ou calcul incohérent), résultat mis en cache par SHA. La clé n'est jamais lue par le code de l'application, copiée, affichée ni journalisée ; les erreurs n'affichent que leur type.

## Envoi à RBooks

À l'approbation, si `C:\DEV\CODEGOD\RAWLF\_tmp_rbooks\SERVEUR-PRET.txt` existe, l'application :

1. ouvre une session (`POST /auth/signin`, identifiants lus par programme dans `C:\DEV\CODEGOD\RAWLF\secrets\rbooks-demo.txt` ou `RBOOKS_EMAIL` / `RBOOKS_PASSWORD`) ;
2. trouve ou crée le **fournisseur** (`/vendors`), l'**article** de la catégorie (`/items`, lié au compte de dépense par code `/accounts`) ;
3. téléverse la photo (`POST /attachments`) ;
4. crée la **facture fournisseur** (`POST /bills`, `open: true`, `attachments: [{ key }]`).

L'URL de RBooks vient de `RBOOKS_URL`, sinon de la première URL trouvée dans `SERVEUR-PRET.txt`, sinon `http://localhost:3000`. Le préfixe `/api` est détecté automatiquement.

Limites connues de la démo : la facture contient une ligne pour le sous-total, une pour la TPS, une pour la TVQ et une pour le pourboire, afin que le total égale le montant payé. La séparation CTI/RTI par ligne de taxe dépend de la tâche taxes de RBooks (`taxRateId`) ; les CTI/RTI calculés sont inscrits dans la note de la facture. Si le serveur n'est pas prêt, la facture reste « Approuvée » et le bouton **Envoyer à RBooks** (ou « Envoyer les approuvées ») la poste plus tard.

## Installation

```powershell
cd C:\DEV\CODEGOD\RAWLF\rbooks-capture; python -m pip install -r requirements.txt
```

## Tests

```powershell
cd C:\DEV\CODEGOD\RAWLF\rbooks-capture; python -m pytest -q
```

## Sécurité

Application de démonstration **sans authentification**, à n'exposer que sur le réseau local. Aucun secret dans le code ni dans git. Fichiers téléversés limités à 25 Mo.

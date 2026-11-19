# NCapture, app locale (ordinateur)

Capture de factures par photo pour NBooks : **photo (ou fichier) -> lecture -> vérification -> export CSV et Excel -> facture fournisseur créée dans NBooks avec la photo jointe.**

App locale, port **4100**, pensée pour le téléphone sur le même Wi-Fi. Même habillage que l'app mobile (`..\mobile\`) et que l'app NEKHEVI : 4 thèmes (Éditorial noir, Instrument, Verre et lumière, Bento audacieux), clair / sombre, mouvement réduit. Produit NEKHEVI, compagnon de NBooks (base Bigcapital). Licence **AGPL-3.0** (voir `LICENSE`, `NOTICE.md`, `DISCLAIMER`), code source : https://github.com/NEKHEVI/ncapture.

Guide de démo : [`DEMO.md`](DEMO.md).

## Choix technique : Python + FastAPI

Le pipeline de lecture existe déjà en Python, testé sur de vraies factures (`depenses.py` : validation en `Decimal`, TPS 5 % / TVQ 9,975 %, doublons SHA-256 + dHash, fusion des reçus en morceaux, catégories, CTI/RTI et repas à 50 %). Il est réutilisé tel quel (copie dans `rbcapture/pipeline/depenses.py`, non modifiée). Le nom interne du module Python (`rbcapture`) est gardé : il n'est pas visible pour l'usager.

## Structure

| Fichier | Rôle |
|---|---|
| `rbcapture/server.py` | Application web (routes, port 4100) |
| `rbcapture/engine.py` | Ingestion (`inbox\<AAAA-MM>\`), doublons, lecture (cache ou IA), validation, états, 2e photo pour compléter |
| `rbcapture/exports.py` | `transactions.csv` et `transactions.xlsx` (feuille par mois + feuille Taxes) |
| `rbcapture/rbooks.py` | Client API NBooks : connexion, fournisseur, compte, article, pièce jointe, facture fournisseur |
| `rbcapture/static/index.html` | Interface (Capturer, À vérifier, Approuvées, Exporter, Réglages) |
| `rbcapture/static/assets/` | Habillage commun `ncapture.css` / `ncapture-ui.js`, logo, icônes, licence. **Ne pas modifier ici** : source dans `..\shared\` et `..\brand\`, copie par `..\outils\synchroniser.ps1` |
| `rbcapture/pipeline/depenses.py` | Pipeline Python existant (copie) |
| `data/` | `categories.json`, `marchands.json`, `cache\` (lectures des factures de test), `etat.json` (local, ignoré par git) |
| `demo-photos/` | Photos de test (dont des copies identiques) |
| `tests/` | 39 tests (montants, règles, exports, client NBooks contre un faux serveur, 2e photo pour compléter) |

## Écrans

- **Capturer** : gros bouton de capture, viseur avec cadrage de la facture (caméra de l'appareil quand la page est en `localhost` ou en HTTPS ; sinon l'appareil photo du téléphone), Galerie, Exemples.
- **À vérifier** : file d'approbation, alertes en couleur (total qui ne balance pas, nos de taxe absents, repas, catégorie douteuse), doublons et non lues à part.
- **Fiche** : photo, fournisseur, date, no de facture, sous-total, TPS, TVQ, pourboire, total (gros champs au pouce, bouton « Utiliser » la somme si le total ne balance pas), catégorie, nos de taxe, CTI/RTI réclamables. Rejeter, Enregistrer, Approuver.
- **Reprendre une photo pour compléter** (dans la fiche) : quand la date, un montant ou un numéro manque, une 2e photo de la même facture remplit **seulement les champs vides** (texte vide, montant absent ou à 0) ; rien de ce qui a été lu ou saisi n'est remplacé ; les articles sont ajoutés sans doublon ; la 2e photo est jointe à la facture ; les alertes sont recalculées. Même règle que l'app mobile. Route : `POST /api/docs/{id}/complete`.
- **Approuvées** : envoi à NBooks (une par une ou toutes).
- **Exporter** : totaux (total, CTI + RTI, TPS, TVQ), Excel, CSV, CSV pour Excel en français.
- **Réglages** : thème, mode, mouvement réduit, état de la lecture et de NBooks, lien « Code source » et licence.

## Lecture : démo ou réelle

- **Sans** `ANTHROPIC_API_KEY` : **mode démo (cache)**. Aucune requête réseau vers l'IA. Seules les photos déjà lues (`data\cache\<sha>.json`) sont reconnues ; une autre photo est classée « non lue » et peut être saisie à la main dans la fiche.
- **Avec** `ANTHROPIC_API_KEY` dans l'environnement du lancement : lecture réelle (Haiku, escalade vers Sonnet si confiance < 0,8 ou calcul incohérent), résultat mis en cache par SHA. La clé n'est jamais copiée, affichée ni journalisée ; les erreurs n'affichent que leur type.

## Envoi à NBooks

À l'approbation, si `C:\DEV\CODEGOD\RAWLF\_tmp_rbooks\SERVEUR-PRET.txt` existe (ou le fichier donné par `NBOOKS_PRET`), l'application :

1. ouvre une session (`POST /auth/signin`, identifiants lus par programme dans `C:\DEV\CODEGOD\RAWLF\secrets\rbooks-demo.txt` ou `NBOOKS_EMAIL` / `NBOOKS_PASSWORD`) ;
2. trouve ou crée le **fournisseur** (`/vendors`), l'**article** de la catégorie (`/items`, lié au compte de dépense par code `/accounts`) ;
3. téléverse la photo (`POST /attachments`) ;
4. crée la **facture fournisseur** (`POST /bills`, `open: true`, `attachments: [{ key }]`).

L'URL de NBooks vient de `NBOOKS_URL`, sinon de la première URL trouvée dans `SERVEUR-PRET.txt`, sinon `http://localhost:3000`. Le préfixe `/api` est détecté automatiquement. Toutes les variables `NBOOKS_*` acceptent encore l'ancien nom `RBOOKS_*` en repli.

Limites connues : la facture contient une ligne pour le sous-total, une pour la TPS, une pour la TVQ et une pour le pourboire, afin que le total égale le montant payé. Les CTI/RTI calculés sont inscrits dans la note de la facture. Si le serveur n'est pas prêt, la facture reste « Approuvée » et le bouton **Envoyer à NBooks** la poste plus tard.

## Installation

```powershell
cd C:\DEV\CODEGOD\RAWLF\ncapture\desktop; python -m pip install -r requirements.txt
```

## Tests

```powershell
cd C:\DEV\CODEGOD\RAWLF\ncapture\desktop; python -m pytest -q
```

Captures des écrans (4 thèmes, clair et sombre, téléphone et ordi), sur une copie de `desktop\` lancée sans NBooks prêt : `node ..\outils\captures-desktop.mjs http://localhost:4110`.

## Sécurité

Application locale **sans authentification**, à n'exposer que sur le réseau local. Aucun secret dans le code ni dans git. Fichiers téléversés limités à 25 Mo.

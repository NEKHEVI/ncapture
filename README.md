# NCapture (NEKHEVI)

Capture de factures par photo, compagnon de NBooks : on cadre la facture, l'IA lit le fournisseur et les montants, le code vérifie la TPS et la TVQ (CTI/RTI, repas à 50 %), on corrige, on approuve, puis on exporte ou on envoie à NBooks. Ex-RBooks Capture.

Un seul dépôt, deux apps, un seul habillage :

| Dossier | App | Lancement |
|---|---|---|
| `desktop/` | App locale Python (FastAPI, port 4100), pensée pour le téléphone sur le même Wi-Fi | `desktop\lancer.ps1` ; tests : `python -m pytest` dans `desktop` |
| `mobile/` | App web téléphone (Vercel, projet `ncapture`, dossier racine `mobile`, fonctions yul1) | local : `node outils\serveur-mobile.mjs` puis http://localhost:4300/capture |
| `shared/` | Habillage commun : `ncapture.css`, `ncapture-ui.js` (4 thèmes NEKHEVI, réglages, viseur, démarrage) | copier avec `outils\synchroniser.ps1` |
| `brand/` | Logo NCapture (harfang NEKHEVI v2 + cadre de visée), icônes web | `python brand\logo.py` (police Geist à placer dans `brand\fonts`, non versionnée) |

Thèmes : mêmes noms et même logique que l'app NEKHEVI (`data-nk-theme` = `editorial`, `instrument` par défaut, `verre`, `bento` ; `data-theme` = `light`, `dark`, ou rien pour suivre le système). Choix dans Réglages, gardé sur l'appareil.

Captures d'écran : `node outils\captures-mobile.mjs` (fausse caméra : `python outils\camera-factice.py`).

Licence : AGPL-3.0 (`LICENSE`). Voir `NOTICE.md` et `DISCLAIMER`. Aucun secret dans ce dépôt : la clé IA et le code d'accès vivent seulement dans Vercel (script `ncapture-cles.ps1`, hors dépôt) ou dans l'environnement de la machine.

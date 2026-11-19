# NCapture (mobile)

App web pour téléphone (NEKHEVI) : on cadre et photographie une facture, l'IA lit le fournisseur et les montants, le code vérifie la TPS (5 %) et la TVQ (9,975 %), on corrige au pouce et on approuve, puis on exporte en Excel ou CSV et on envoie à NBooks.

- `capture/index.html` : l'app (installable sur l'écran d'accueil). Viseur avec cadrage, balayage or pendant la lecture, file d'approbation, export, réglages.
- `ncapture.css`, `ncapture-ui.js` : habillage commun avec l'app locale (copiés depuis `../shared` par `../outils/synchroniser.ps1`, ne pas les modifier ici). Quatre thèmes NEKHEVI : Éditorial noir, Instrument (défaut), Verre et lumière, Bento audacieux ; clair, sombre ou système ; mouvement réduit.
- `nbooks/index.html` : page NBooks de démonstration (factures reçues du téléphone). `/rbooks` redirige ici.
- `api/lire.js` : lecture de la photo par Claude (Haiku, puis Sonnet si la lecture est incertaine). Sans `ANTHROPIC_API_KEY`, ou avec `CAPTURE_DEMO=1`, mode démo : une vraie photo n'est pas lue (jamais de faux fournisseur), le bouton Exemples montre une lecture type.
- `api/config.js` : mode et options, sans secret. `api/factures.js` : factures envoyées à la page NBooks de démo.

Variables Vercel : `ANTHROPIC_API_KEY` (lecture réelle), `CAPTURE_CODE` (code d'accès exigé), `CAPTURE_DEMO=1` (forcer la démo), `NBOOKS_URL` (envoi réel à NBooks, à venir ; l'ancien nom `RBOOKS_URL` est lu en repli). Stockage partagé de la démo : `BLOB_READ_WRITE_TOKEN` ou `KV_REST_API_URL` / `KV_REST_API_TOKEN`, sinon mémoire.

Hébergement : projet Vercel `ncapture` (équipe NEKHEVI), dossier racine `mobile`, fonctions à Montréal (yul1). Domaine prévu : capture.nekhevi.com.

Licence AGPL-3.0 (`LICENSE.txt`), comme NBooks. Voir `../NOTICE.md` et `../DISCLAIMER`.

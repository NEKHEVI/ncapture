# RBooks Capture (mobile)

App web pour téléphone : on photographie une facture, l'IA lit le fournisseur et les montants, le code vérifie la TPS (5 %) et la TVQ (9,975 %), on corrige et on approuve, puis on exporte en Excel ou CSV et on envoie à RBooks.

- `index.html` : l'app (installable sur l'écran d'accueil).
- `api/lire.js` : lecture de la photo par Claude (Haiku, puis Sonnet si la lecture est incertaine). Sans `ANTHROPIC_API_KEY`, mode démo avec des exemples.
- `api/config.js` : mode et options, sans secret.

Variables Vercel : `ANTHROPIC_API_KEY` (lecture réelle), `CAPTURE_CODE` (code d'accès exigé), `CAPTURE_DEMO=1` (forcer la démo), `RBOOKS_URL` (envoi réel à RBooks, à venir).

État : démo. L'envoi à RBooks est simulé tant que RBooks n'est pas en ligne. Licence AGPL-3.0, comme RBooks.

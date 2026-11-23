# NCapture (mobile)

App web pour téléphone (NEKHEVI) : on cadre et photographie une facture, l'IA lit le fournisseur et les montants, le code vérifie la TPS (5 %) et la TVQ (9,975 %), on corrige au pouce et on approuve, puis on exporte en Excel ou CSV et on envoie à NBooks.

- `capture/index.html` : l'app (installable sur l'écran d'accueil). Viseur avec cadrage, balayage or pendant la lecture, file d'approbation, export, réglages.
- `ncapture.css`, `ncapture-ui.js` : habillage commun avec l'app locale (copiés depuis `../shared` par `../outils/synchroniser.ps1`, ne pas les modifier ici). Quatre thèmes NEKHEVI : Éditorial noir, Instrument (défaut), Verre et lumière, Bento audacieux ; clair, sombre ou système ; mouvement réduit.
- `nbooks/index.html` : page NBooks de démonstration (factures reçues du téléphone). `/rbooks` redirige ici.
- `api/lire.js` : lecture de la photo par Claude (Haiku, puis Sonnet si la lecture est incertaine). Sans `ANTHROPIC_API_KEY`, ou avec `CAPTURE_DEMO=1`, mode démo : une vraie photo n'est pas lue (jamais de faux fournisseur), le bouton Exemples montre une lecture type.
- `api/config.js` : mode et options, sans secret. `api/factures.js` : factures envoyées à la page NBooks de démo.

## Multi-clients (comptes NEKHEVI)

Chaque entreprise cliente a son espace étanche. NCapture s'ouvre avec le compte NEKHEVI (même projet Supabase que app.nekhevi.com) :

1. Dans app.nekhevi.com, la carte NCapture ouvre `/ncapture?org=<entreprise>`. Le serveur de l'app vérifie la session (et la double authentification), puis produit un jeton de connexion à usage unique et redirige vers `capture.nekhevi.com/capture#nc_th=…&org=…` (le fragment n'est jamais envoyé aux serveurs).
2. `api/session.js` échange ce jeton contre une session Supabase, gardée dans des témoins HttpOnly + Secure + SameSite=Lax (le JavaScript de la page ne voit aucun jeton). Si l'usager a la double authentification, NCapture demande le code à 6 chiffres.
3. Chaque route à données (`api/documents.js`, `api/factures.js`, `api/lire.js`) exige la session, l'en-tête `x-ncapture-org` d'une org dont l'usager est membre, et l'en-tête `x-ncapture: 1` pour toute écriture (protection CSRF). Les requêtes partent avec le jeton de l'usager : la RLS de Supabase isole les orgs. Aucune clé de service ici.
4. Factures : table `ncapture_documents` ; photos : bucket privé `ncapture`, chemins `<org>/<document>/…`, liens signés de 10 minutes ; usage IA noté par org dans `ai_usage` (fonction `ncapture_log_ai_usage`), budget IA de l'org respecté. La migration vit dans l'app NEKHEVI (`supabase/migrations/20261123000100_ncapture.sql`).
5. Sélecteur d'entreprise : seulement si `NCAPTURE_SELECTEUR_ORG=1` ET l'usager appartient à plus d'une org.

Variables : `NEKHEVI_SUPABASE_URL`, `NEKHEVI_SUPABASE_ANON_KEY` (clé publique anon), `NCAPTURE_APP_URL` (défaut https://app.nekhevi.com), `NCAPTURE_SELECTEUR_ORG`, `NCAPTURE_CODE_REPLI` (1 = l'ancien code d'accès reste permis en dépannage ; désactivé par défaut). Sans les variables Supabase, toutes les routes à données répondent 503 ou 401 : aucune facture n'est jamais servie sans authentification.

Tests d'isolation (pile Supabase locale) : `npm test` avec `NEKHEVI_SUPABASE_URL`, `NEKHEVI_SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` de la pile locale (refus si l'URL n'est pas locale).

## Ancien mode (dépannage)

Variables Vercel : `ANTHROPIC_API_KEY` (lecture réelle), `CAPTURE_CODE` (code d'accès, utilisé seulement si `NCAPTURE_CODE_REPLI=1`), `CAPTURE_DEMO=1` (forcer la démo), `NBOOKS_URL` (envoi réel à NBooks, à venir ; l'ancien nom `RBOOKS_URL` est lu en repli). Stockage partagé de la démo : `BLOB_READ_WRITE_TOKEN` ou `KV_REST_API_URL` / `KV_REST_API_TOKEN`, sinon mémoire.

Hébergement : projet Vercel `ncapture` (équipe NEKHEVI), dossier racine `mobile`, fonctions à Montréal (yul1). Domaine prévu : capture.nekhevi.com.

Licence AGPL-3.0 (`LICENSE.txt`), comme NBooks. Voir `../NOTICE.md` et `../DISCLAIMER`.

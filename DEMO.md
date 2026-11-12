# Démo : capture de factures par photo

## Avant la démo (une fois)

```powershell
cd C:\DEV\CODEGOD\RAWLF\rbooks-capture; python -m pip install -r requirements.txt
```

Pare-feu Windows, pour que le téléphone puisse entrer (PowerShell en administrateur, une seule fois) :

```powershell
New-NetFirewallRule -DisplayName "RBooks Capture 4100" -Direction Inbound -Protocol TCP -LocalPort 4100 -Action Allow -Profile Private
```

## Lancer

```powershell
cd C:\DEV\CODEGOD\RAWLF\rbooks-capture; .\lancer.ps1
```

Le script affiche l'adresse pour l'ordinateur (`http://localhost:4100`) et pour le téléphone (`http://<IP-de-l'ordi>:4100`). Le téléphone doit être sur **le même Wi-Fi** que l'ordinateur. Pour trouver l'IP à la main : `ipconfig`, ligne « Adresse IPv4 » de la carte Wi-Fi (souvent `192.168.x.x`).

Le bandeau en haut indique **Mode démo (cache)** : aucune lecture IA, aucun coût. Pour une lecture réelle de nouvelles photos, lancer avec la clé déjà définie dans l'environnement (`$env:ANTHROPIC_API_KEY`), le bandeau passe à « Lecture IA réelle activée ».

Remise à zéro entre deux démos : bouton « Remettre la démo à zéro » en bas de l'écran.

## Parcours de démo en 6 étapes

1. **Photo.** Sur le téléphone, ouvrir l'adresse, toucher **Prendre une photo** (caméra arrière) ou **Choisir des fichiers**. Pour la démo hors caméra : **Charger les factures de test** (10 photos, dont 4 copies). Les fichiers arrivent dans `inbox\<AAAA-MM>\`.
2. **Lecture.** En quelques secondes : 10 photos -> 4 doublons écartés, un reçu RONA photographié en 2 morceaux recollé automatiquement (no d'autorisation 189658), 5 factures à vérifier. Montrer l'onglet « Doublons / non lus ».
3. **Vérification.** Onglet **À vérifier** : chaque facture avec sa photo (toucher pour agrandir), les montants lus, « Total équilibré » et les alertes : pas de no de TPS/TVQ (Le Rouge Gorge, Kinatex), taxes estimées, CTI/RTI refusés, catégorie douteuse (santé). Cliquer **Corriger** : changer le total à 35,00 -> alerte « Total qui ne balance pas » ; remettre 30,41 -> elle disparaît.
4. **Approuver.** Toucher **Approuver** sur une facture (ex. RONA 327,89 $). Elle passe dans l'onglet Approuvées ; si RBooks est prêt, elle est créée tout de suite.
5. **Export.** Boutons **CSV** et **Excel** : `transactions.csv` et `transactions.xlsx` (une feuille par mois : 2025-09, 2025-11, 2026-06, et une feuille **Taxes** TPS/TVQ, CTI/RTI). Total des 5 factures : **680,85 $**.
6. **RBooks.** Dans RBooks (Achats > Factures fournisseurs) : la facture fournisseur créée (numéro `CAP-D000x`), fournisseur créé au besoin, photo en pièce jointe. Si le bandeau dit « serveur pas prêt », approuver quand même puis toucher **Envoyer les approuvées à RBooks** une fois le serveur lancé.

## Si RBooks n'est pas prêt

L'application attend le fichier `C:\DEV\CODEGOD\RAWLF\_tmp_rbooks\SERVEUR-PRET.txt` (le bandeau passe à « serveur prêt » tout seul). Pour forcer l'envoi vers un serveur déjà lancé, sans ce fichier :

```powershell
cd C:\DEV\CODEGOD\RAWLF\rbooks-capture; New-Item -ItemType File -Force C:\DEV\CODEGOD\RAWLF\_tmp_rbooks\SERVEUR-PRET.txt | Out-Null; $env:RBOOKS_URL="http://localhost:3000"; $env:RBOOKS_EMAIL="<courriel>"; $env:RBOOKS_PASSWORD="<mot de passe>"; .\lancer.ps1
```

(`RBOOKS_URL` = adresse de l'API RBooks ; le préfixe `/api` est détecté seul. Sans `RBOOKS_EMAIL` / `RBOOKS_PASSWORD`, les identifiants sont lus dans `C:\DEV\CODEGOD\RAWLF\secrets\rbooks-demo.txt`, lignes `email: ...` et `password: ...`.)

## Dépannage

- Le téléphone n'arrive pas à ouvrir la page : règle de pare-feu ci-dessus, même Wi-Fi, et réseau Windows en « Privé ».
- Une photo HEIC (iPhone) est « illisible » : régler l'appareil photo en « Le plus compatible » (JPEG) ou `python -m pip install pillow-heif`.
- Une photo inconnue du cache en mode démo : elle va dans « Doublons / non lus » ; **Corriger** permet de la saisir à la main.

# Démo : NCapture, app locale

## Avant la démo (une fois)

```powershell
cd C:\DEV\CODEGOD\RAWLF\ncapture\desktop; python -m pip install -r requirements.txt
```

Pare-feu Windows, pour que le téléphone puisse entrer (PowerShell en administrateur, une seule fois) :

```powershell
New-NetFirewallRule -DisplayName "NCapture 4100" -Direction Inbound -Protocol TCP -LocalPort 4100 -Action Allow -Profile Private
```

## Lancer

```powershell
cd C:\DEV\CODEGOD\RAWLF\ncapture\desktop; .\lancer.ps1
```

Le script affiche l'adresse pour l'ordinateur (`http://localhost:4100`) et pour le téléphone (`http://<IP-de-l'ordi>:4100`). Le téléphone doit être sur **le même Wi-Fi** que l'ordinateur. Pour trouver l'IP à la main : `ipconfig`, ligne « Adresse IPv4 » de la carte Wi-Fi (souvent `192.168.x.x`).

L'étiquette en haut indique **Démo** : aucune lecture IA, aucun coût. Pour une lecture réelle de nouvelles photos, lancer avec la clé déjà définie dans l'environnement (`$env:ANTHROPIC_API_KEY`) : l'étiquette passe à « Lecture IA ».

Thème : onglet **Réglages** (Éditorial noir, Instrument, Verre et lumière, Bento audacieux ; Système, Clair, Sombre ; Mouvement réduit). Remise à zéro entre deux démos : **Exporter > Remettre la démo à zéro**.

## Parcours de démo en 7 étapes

1. **Photo.** Toucher le gros bouton **Prendre une photo** : sur l'ordinateur (`localhost`), le viseur s'ouvre avec le cadre de la facture ; sur le téléphone en Wi-Fi local (`http://`), l'appareil photo du téléphone s'ouvre. **Galerie** pour des fichiers. Hors caméra : **Exemples** (photos de test, dont des copies). Les fichiers arrivent dans `inbox\<AAAA-MM>\`.
2. **Lecture.** Les doublons sont écartés (onglet À vérifier, section « Doublons et rejetées »), un reçu RONA photographié en 2 morceaux est recollé automatiquement (no d'autorisation 189658), 5 factures à vérifier.
3. **Vérification.** Onglet **À vérifier** : chaque facture avec sa photo, les montants lus, « Montants vérifiés » ou les alertes : pas de no de TPS/TVQ (Le Rouge Gorge, Kinatex), taxes estimées, CTI/RTI refusés, catégorie douteuse (santé). Ouvrir une facture : changer le total à 35,00 -> le total passe en rouge et « Utiliser » propose la somme ; remettre 30,41.
4. **Compléter.** Dans la fiche, **Reprendre une photo pour compléter** : photographier la partie manquante (date, nos de taxe) ; seuls les champs vides sont remplis, la 2e photo est jointe.
5. **Approuver.** Toucher **Approuver** (ex. RONA 327,89 $). Elle passe dans **Approuvées** ; si NBooks est prêt, elle y est créée tout de suite.
6. **Export.** **Excel**, **CSV** ou **CSV Excel (fr)** : `transactions.xlsx` (une feuille par mois et une feuille **Taxes** TPS/TVQ, CTI/RTI). Total des 5 factures : **680,85 $**.
7. **NBooks.** Dans NBooks (Achats > Factures fournisseurs) : la facture fournisseur créée (numéro `CAP-D000x`), fournisseur créé au besoin, photo en pièce jointe. Si l'accueil dit « serveur pas prêt », approuver quand même puis **Envoyer à NBooks** une fois le serveur lancé.

## Si NBooks n'est pas prêt

L'application attend le fichier `C:\DEV\CODEGOD\RAWLF\_tmp_rbooks\SERVEUR-PRET.txt` (l'accueil passe à « serveur prêt » tout seul). Pour viser un serveur déjà lancé, définir `$env:NBOOKS_URL` (ex. `http://localhost:3000`) avant `.\lancer.ps1`. Identifiants : `$env:NBOOKS_EMAIL` / `$env:NBOOKS_PASSWORD`, sinon lus dans `C:\DEV\CODEGOD\RAWLF\secrets\rbooks-demo.txt`. Les anciens noms `RBOOKS_*` marchent encore.

## Dépannage

- Le téléphone n'arrive pas à ouvrir la page : règle de pare-feu ci-dessus, même Wi-Fi, et réseau Windows en « Privé ».
- Une photo HEIC (iPhone) est « illisible » : régler l'appareil photo en « Le plus compatible » (JPEG) ou `python -m pip install pillow-heif`.
- Une photo inconnue du cache en mode démo : elle reste dans À vérifier, marquée « À saisir » ; l'ouvrir permet de la saisir à la main, ou de la compléter avec une 2e photo.

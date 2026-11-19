# Copie l'habillage commun (shared\) et les icones (brand\out\) dans les deux apps.
# A relancer apres toute modification de shared\ncapture.css, shared\ncapture-ui.js ou du logo.
$ErrorActionPreference = 'Stop'
$R = Split-Path $PSScriptRoot -Parent
$mob = Join-Path $R 'mobile'
$des = Join-Path $R 'desktop\rbcapture\static\assets'
$out = Join-Path $R 'brand\out'
New-Item -ItemType Directory -Force (Join-Path $mob 'brand'), (Join-Path $des 'brand') | Out-Null
foreach ($f in 'ncapture.css', 'ncapture-ui.js') {
  Copy-Item (Join-Path $R "shared\$f") (Join-Path $mob $f) -Force
  Copy-Item (Join-Path $R "shared\$f") (Join-Path $des $f) -Force
}
foreach ($f in 'favicon.ico', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png') {
  Copy-Item (Join-Path $out $f) (Join-Path $mob $f) -Force
  Copy-Item (Join-Path $out $f) (Join-Path $des $f) -Force
}
foreach ($f in 'ncapture-marque-fond-sombre.svg', 'ncapture-marque-fond-clair.svg', 'ncapture-horizontal-fond-sombre.svg', 'ncapture-horizontal-fond-clair.svg', 'ncapture-icone.svg') {
  Copy-Item (Join-Path $out $f) (Join-Path $mob "brand\$f") -Force
  Copy-Item (Join-Path $out $f) (Join-Path $des "brand\$f") -Force
}
Copy-Item (Join-Path $R 'LICENSE') (Join-Path $mob 'LICENSE.txt') -Force
Copy-Item (Join-Path $R 'LICENSE') (Join-Path $des 'LICENSE.txt') -Force
Write-Host 'Synchronisation faite.'

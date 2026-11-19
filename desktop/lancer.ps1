# Lance NCapture (app locale) sur le port 4100 (accessible depuis le téléphone, même Wi-Fi).
# Mode démo (cache) par défaut. Lecture IA réelle : définir ANTHROPIC_API_KEY avant de lancer,
# ou placer la clé dans C:\DEV\CODEGOD\RAWLF\secrets\anthropic-capture.key (lue, jamais affichée).
Set-Location $PSScriptRoot
$env:PYTHONIOENCODING = 'utf-8'
if (-not $env:NBOOKS_URL -and $env:RBOOKS_URL) { $env:NBOOKS_URL = $env:RBOOKS_URL }
foreach ($c in (Join-Path $PSScriptRoot '..\..\secrets\anthropic-capture.key'), (Join-Path $PSScriptRoot '..\secrets\anthropic-capture.key')) {
  if (-not $env:ANTHROPIC_API_KEY -and (Test-Path $c)) { $env:ANTHROPIC_API_KEY = (Get-Content $c -Raw).Trim() }
}
if ($env:ANTHROPIC_API_KEY) { Write-Host "NCapture : lecture IA reelle activee (cle presente dans l'environnement)." }
else { Write-Host "NCapture : mode demo (cache), aucun appel IA." }
Write-Host "Ordinateur : http://localhost:4100"
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\.' -and $_.IPAddress -notmatch '^172\.30\.' } |
  ForEach-Object { Write-Host ("Telephone  : http://{0}:4100" -f $_.IPAddress) }
python -m rbcapture.server

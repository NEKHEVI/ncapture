# Lance RBooks Capture sur le port 4100 (accessible depuis le téléphone, même Wi-Fi).
# Mode démo (cache) par défaut. Lecture IA réelle : définir ANTHROPIC_API_KEY avant de lancer.
Set-Location $PSScriptRoot
$env:PYTHONIOENCODING = 'utf-8'
$cle = Join-Path $PSScriptRoot '..\secrets\anthropic-capture.key'
if (-not $env:ANTHROPIC_API_KEY -and (Test-Path $cle)) { $env:ANTHROPIC_API_KEY = (Get-Content $cle -Raw).Trim() }
if ($env:ANTHROPIC_API_KEY) { Write-Host "Lecture IA reelle activee (cle presente dans l'environnement)." }
else { Write-Host "Mode demo (cache) : aucun appel IA." }
Write-Host "Ordinateur : http://localhost:4100"
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\.' -and $_.IPAddress -notmatch '^172\.30\.' } |
  ForEach-Object { Write-Host ("Telephone  : http://{0}:4100" -f $_.IPAddress) }
python -m rbcapture.server

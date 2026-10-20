$ErrorActionPreference = "Stop"
$DemoRoot = Join-Path $env:LOCALAPPDATA "SKOL-Demo"
$ManifestPath = Join-Path $DemoRoot "server.json"

if (-not (Test-Path $ManifestPath)) {
    Write-Host "Локальный сервер СКОЛ не зарегистрирован как запущенный." -ForegroundColor Yellow
    exit 0
}

$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$ProcessId = [int]$Manifest.pid
$ProjectRoot = [string]$Manifest.root
$ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue

if ($ProcessInfo -and $ProcessInfo.CommandLine -like "*$ProjectRoot*server.js*") {
    Stop-Process -Id $ProcessId -Force
    Write-Host "Локальный сервер СКОЛ остановлен." -ForegroundColor Green
} else {
    Write-Host "Запущенный процесс не подтверждён или уже завершился. Чужой процесс не остановлен." -ForegroundColor Yellow
}
Remove-Item $ManifestPath -Force -ErrorAction SilentlyContinue
Write-Host "Демонстрационная база сохранена: $(Join-Path $DemoRoot 'data')" -ForegroundColor Gray

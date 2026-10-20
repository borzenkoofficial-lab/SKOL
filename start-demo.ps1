$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

function New-RandomToken([int]$ByteCount) {
    $Generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        [byte[]]$Buffer = New-Object byte[] $ByteCount
        $Generator.GetBytes($Buffer)
        return [Convert]::ToBase64String($Buffer).TrimEnd('=').Replace('+', 'X').Replace('/', 'Y')
    } finally {
        $Generator.Dispose()
    }
}

Write-Host ""
Write-Host "СКОЛ / ЛОКАЛЬНАЯ ДЕМО-ПАНЕЛЬ" -ForegroundColor Cyan
Write-Host "Демонстрационные данные будут сохранены отдельно от production-базы." -ForegroundColor Gray
Write-Host ""

$NodeCommand = Get-Command node -ErrorAction SilentlyContinue
$NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
if (-not $NodeCommand -or -not $NpmCommand) {
    throw "Node.js не найден. Установи Node.js 20 или новее и повтори запуск."
}

$NodeVersionText = (& $NodeCommand.Source -p "process.versions.node").Trim()
try { $NodeVersion = [version]$NodeVersionText } catch { throw "Не удалось определить версию Node.js: $NodeVersionText" }
if ($NodeVersion.Major -lt 20) { throw "Нужен Node.js 20+. Сейчас установлена версия $NodeVersionText." }

if (-not (Test-Path (Join-Path $ProjectRoot "node_modules\express"))) {
    Write-Host "Устанавливаю зависимости проекта..." -ForegroundColor Yellow
    & $NpmCommand.Source install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install завершился с ошибкой $LASTEXITCODE." }
}
if (-not (Test-Path (Join-Path $ProjectRoot "node_modules\better-sqlite3"))) {
    throw "Не найден better-sqlite3 после установки. Проверь версию Node.js и сообщения npm."
}

$DemoRoot = Join-Path $env:LOCALAPPDATA "SKOL-Demo"
$DataDirectory = Join-Path $DemoRoot "data"
$LogsDirectory = Join-Path $DemoRoot "logs"
New-Item -ItemType Directory -Force -Path $DataDirectory, $LogsDirectory | Out-Null

$ManifestPath = Join-Path $DemoRoot "server.json"
if (Test-Path $ManifestPath) {
    try {
        $Previous = Get-Content $ManifestPath -Raw | ConvertFrom-Json
        $PreviousProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($Previous.pid)" -ErrorAction SilentlyContinue
        if ($PreviousProcess -and $PreviousProcess.CommandLine -like "*$ProjectRoot*server.js*") {
            Write-Host "Останавливаю предыдущий экземпляр тестового сервера..." -ForegroundColor Yellow
            Stop-Process -Id ([int]$Previous.pid) -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
        }
    } catch {
        Write-Host "Не удалось проверить старый экземпляр; будет выбран свободный порт." -ForegroundColor DarkYellow
    }
}

$Port = 0
for ($Candidate = 3210; $Candidate -le 3299; $Candidate++) {
    $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, [int]$Candidate)
    try {
        $Listener.Start()
        $Port = $Candidate
        break
    } catch {
        $Port = 0
    } finally {
        $Listener.Stop()
    }
}
if ($Port -eq 0) { throw "Не удалось найти свободный локальный порт в диапазоне 3210–3299." }

$AdminUsername = "skol-demo-admin"
$AdminPassword = New-RandomToken 24
$SessionSecret = New-RandomToken 48
$EnvironmentNames = @("NODE_ENV", "HOST", "PORT", "SKOL_DEMO_MODE", "DATA_DIR", "ADMIN_USERNAME", "ADMIN_PASSWORD", "SESSION_SECRET")
$PreviousEnvironment = @{}
foreach ($Name in $EnvironmentNames) { $PreviousEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, "Process") }
$env:NODE_ENV = "development"
$env:HOST = "127.0.0.1"
$env:PORT = [string]$Port
$env:SKOL_DEMO_MODE = "1"
$env:DATA_DIR = $DataDirectory
$env:ADMIN_USERNAME = $AdminUsername
$env:ADMIN_PASSWORD = $AdminPassword
$env:SESSION_SECRET = $SessionSecret

$StdoutLog = Join-Path $LogsDirectory "server-output.log"
$StderrLog = Join-Path $LogsDirectory "server-error.log"
Remove-Item $StdoutLog, $StderrLog -Force -ErrorAction SilentlyContinue
$ServerFile = Join-Path $ProjectRoot "server.js"
$ServerProcess = Start-Process -FilePath $NodeCommand.Source -ArgumentList ('"' + $ServerFile + '"') -WorkingDirectory $ProjectRoot -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru

# The child process inherited the demo environment. Restore this PowerShell session immediately.
foreach ($Name in $EnvironmentNames) {
    if ($null -eq $PreviousEnvironment[$Name]) { Remove-Item ("Env:" + $Name) -ErrorAction SilentlyContinue }
    else { [Environment]::SetEnvironmentVariable($Name, [string]$PreviousEnvironment[$Name], "Process") }
}

@{ pid = $ServerProcess.Id; port = $Port; root = $ProjectRoot; startedAt = (Get-Date).ToString("o") } |
    ConvertTo-Json | Set-Content -Path $ManifestPath -Encoding UTF8

$Ready = $false
for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
    Start-Sleep -Milliseconds 500
    $ServerProcess.Refresh()
    if ($ServerProcess.HasExited) { break }
    try {
        $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        if ($Health.ok -eq $true) { $Ready = $true; break }
    } catch {}
}

if (-not $Ready) {
    if (-not $ServerProcess.HasExited) { Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "Сервер не запустился. Диагностические сообщения:" -ForegroundColor Red
    if (Test-Path $StderrLog) { Get-Content $StderrLog -Tail 50 }
    if (Test-Path $StdoutLog) { Get-Content $StdoutLog -Tail 50 }
    throw "Локальная демо-панель не запущена. Проверь сообщения выше."
}

$AdminUrl = "http://127.0.0.1:$Port/admin"
Write-Host ""
Write-Host "ДЕМО-ПАНЕЛЬ ЗАПУЩЕНА" -ForegroundColor Green
Write-Host "Сайт:       http://127.0.0.1:$Port" -ForegroundColor White
Write-Host "Админка:    $AdminUrl" -ForegroundColor White
Write-Host "Логин:      $AdminUsername" -ForegroundColor White
Write-Host "Пароль:     $AdminPassword" -ForegroundColor Yellow
Write-Host "База:       $DataDirectory" -ForegroundColor Gray
Write-Host "Логи:       $LogsDirectory" -ForegroundColor Gray
Write-Host ""
Write-Host "Это локальный тестовый стенд. Не публикуй его в интернет и не используй эти данные в production." -ForegroundColor Yellow
Write-Host "Для остановки выполни .\stop-demo.ps1. База сохранится для следующего запуска." -ForegroundColor Gray
Write-Host ""

Start-Process $AdminUrl

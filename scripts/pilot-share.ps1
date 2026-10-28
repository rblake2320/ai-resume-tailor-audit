$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$pilotRoot = Join-Path $repoRoot '.resume-foundry\pilot'
$bundlePath = Join-Path $pilotRoot 'operator\owner-secrets.json'
if (-not (Test-Path -LiteralPath $bundlePath)) { throw 'Provision the private invite bundle first. Existing bundles must never be regenerated.' }
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.next\BUILD_ID'))) { throw 'Run npm run verify first.' }
$ownerBundle = Get-Content -LiteralPath $bundlePath -Raw | ConvertFrom-Json
$originHeaders = @{ 'x-resume-pilot-origin' = $ownerBundle.ORIGIN_SECRET }
& docker compose -p resume-foundry-parser -f tika/compose.yaml up -d
if ($LASTEXITCODE -ne 0) { throw 'Private Tika parser startup failed. Ensure Docker Desktop is running.' }
$tikaReady = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $tikaVersion = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:9998/health' -TimeoutSec 2).Content
        if ($tikaVersion -match '^Apache Tika 4\.1\.0\s*$') { $tikaReady = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 500
}
if (-not $tikaReady) { throw 'Pinned Apache Tika did not become ready. Inspect the dedicated Docker container logs.' }
function Test-PilotOrigin([string] $Url) {
    & node scripts/pilot-origin-health.mjs $Url
    return ($LASTEXITCODE -eq 0)
}
# Read-only check of the existing model service. This never launches Ollama or pulls weights.
try { $models = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5 } catch { throw 'The existing local Ollama service is unavailable. Start it yourself, then retry.' }
if (-not ($models.models | Where-Object { $_.name -eq 'qwen3-vl:8b-instruct' })) { throw 'The installed qwen3-vl:8b-instruct model is unavailable. No model will be downloaded automatically.' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-PilotOrigin 'http://127.0.0.1:3102')) {
    if (Get-NetTCPConnection -LocalPort 3102 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 3102 belongs to a different or mismatched server. Resolve it before retrying.' }
    $launcher = Start-Process -FilePath $nodePath -ArgumentList @('--experimental-strip-types','scripts/local-start.mjs','--pilot','--port','3102','--free-ai') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $pilotRoot 'origin.log') -RedirectStandardError (Join-Path $pilotRoot 'origin-error.log') -PassThru
    Set-Content -LiteralPath (Join-Path $pilotRoot 'launcher.pid') -Value $launcher.Id
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (Test-PilotOrigin 'http://127.0.0.1:3102') { $ready = $true; break }
        if ($launcher.HasExited) { throw 'Pilot launcher exited. Inspect the private origin logs.' }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Pilot origin did not become healthy.' }
}
$tunnelLog = Join-Path $pilotRoot 'tunnel.log'
function Get-PilotTunnel {
    if (-not (Test-Path -LiteralPath $tunnelLog)) { return $null }
    $matchesFound = [regex]::Matches((Get-Content -LiteralPath $tunnelLog -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($matchesFound.Count -eq 0) { return $null }
    return $matchesFound[$matchesFound.Count - 1].Value
}
$tunnelUrl = Get-PilotTunnel
if (-not $tunnelUrl -or -not (Test-PilotOrigin $tunnelUrl)) {
    # Preserve diagnostic logs. Never stop an unrelated tunnel or service.
    $tunnelPidFile = Join-Path $pilotRoot 'tunnel.pid'
    if (Test-Path -LiteralPath $tunnelPidFile) {
        $ownedTunnelId = 0
        if (-not [int]::TryParse((Get-Content -LiteralPath $tunnelPidFile -Raw).Trim(), [ref]$ownedTunnelId)) { throw 'Invalid dedicated tunnel PID receipt.' }
        $ownedTunnel = Get-CimInstance Win32_Process -Filter "ProcessId=$ownedTunnelId"
        if ($ownedTunnel -and $ownedTunnel.Name -ne 'cloudflared.exe') {
            # Windows may recycle a saved PID after reboot. Preserve that receipt
            # and leave the unrelated process untouched before creating our tunnel.
            Move-Item -LiteralPath $tunnelPidFile -Destination "$tunnelPidFile.$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).stale"
            Write-Output 'Preserved a recycled tunnel PID receipt; unrelated process left running.'
        } elseif ($ownedTunnel) {
            if (-not $ownedTunnel.CommandLine -or -not $ownedTunnel.CommandLine.Contains('http://127.0.0.1:3102') -or -not $ownedTunnel.CommandLine.Contains($tunnelLog)) { throw 'Dedicated tunnel PID ownership could not be verified. No process was stopped.' }
            $identityFile = Join-Path $pilotRoot 'tunnel.identity.json'
            if (-not (Test-Path -LiteralPath $identityFile)) { throw 'Tunnel birth identity receipt is missing. No process was stopped.' }
            $identity = Get-Content -LiteralPath $identityFile -Raw | ConvertFrom-Json
            $freshTunnel = Get-CimInstance Win32_Process -Filter "ProcessId=$ownedTunnelId"
            if (-not $freshTunnel -or $identity.pid -ne $ownedTunnelId -or $identity.birth -ne $freshTunnel.CreationDate.ToUniversalTime().ToString('o') -or $identity.executable -ne $freshTunnel.ExecutablePath -or $freshTunnel.CommandLine -ne $ownedTunnel.CommandLine) { throw 'Tunnel birth/executable identity changed. No process was stopped.' }
            $processHandle = Get-Process -Id $ownedTunnelId -ErrorAction Stop
            try {
                $null = $processHandle.Handle # Pin this process instance before checking birth or stopping it.
                if ($processHandle.StartTime.ToUniversalTime().Ticks.ToString() -ne $identity.processStartTicks) { throw 'Tunnel process identity changed before stop.' }
                $processHandle.Kill()
                if (-not $processHandle.WaitForExit(10000)) { throw 'Owned tunnel did not exit within ten seconds.' }
            } finally { $processHandle.Dispose() }
        }
    }
    if (Test-Path -LiteralPath $tunnelLog) { Move-Item -LiteralPath $tunnelLog -Destination "$tunnelLog.$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).previous" }
    $cloudflaredPath = (Get-Command cloudflared -ErrorAction Stop).Source
    $tunnel = Start-Process -FilePath $cloudflaredPath -ArgumentList @('tunnel','--url','http://127.0.0.1:3102','--protocol','http2','--no-autoupdate','--logfile',$tunnelLog) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $pilotRoot 'tunnel-output.log') -RedirectStandardError (Join-Path $pilotRoot 'tunnel-error.log') -PassThru
    Set-Content -LiteralPath (Join-Path $pilotRoot 'tunnel.pid') -Value $tunnel.Id
    $createdTunnel = Get-CimInstance Win32_Process -Filter "ProcessId=$($tunnel.Id)"
    if (-not $createdTunnel -or -not $createdTunnel.ExecutablePath) { throw 'New tunnel birth identity could not be recorded.' }
    @{ pid = $tunnel.Id; birth = $createdTunnel.CreationDate.ToUniversalTime().ToString('o'); executable = $createdTunnel.ExecutablePath; processStartTicks = $tunnel.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pilotRoot 'tunnel.identity.json') -Encoding UTF8
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $tunnelUrl = Get-PilotTunnel
        if ($tunnelUrl -and (Test-PilotOrigin $tunnelUrl)) { $ready = $true; break }
        if ($tunnel.HasExited) { throw 'Dedicated tester tunnel exited. Inspect its private logs.' }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Dedicated tester tunnel did not become healthy.' }
}
& npm run pilot:deploy -- --free-ai
if ($LASTEXITCODE -ne 0) { throw 'Pilot deployment failed. Existing invite credentials were preserved.' }
Write-Output 'Share https://resume-foundry-private-pilot.rblake2320.workers.dev with a separate private invite code. Keep this PC and the existing model service running.'

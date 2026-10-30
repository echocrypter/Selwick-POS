# Run from Selwick POS project root in PowerShell.
# Read-only verification: does not import/migrate business data or switch storage modes.
$ErrorActionPreference = 'Continue'
if (-not (Test-Path 'package.json')) { Write-Error 'Open PowerShell in Selwick POS project root first.'; exit 2 }
$log = Join-Path (Get-Location) 'selwick-stage-c-verification.log'
"Selwick Stage C verification - $(Get-Date -Format o)" | Set-Content $log
"Node: $(node --version)" | Add-Content $log
"NPM: $(npm --version)" | Add-Content $log
if (-not (Test-Path 'node_modules/.bin/next.cmd')) { 'Dependencies missing: run npm ci separately before verifying.' | Tee-Object -FilePath $log -Append; exit 3 }
$commands = @('check:env','check:db','check:auth','check:repo','check:migration','check:pos','check:acceptance','check:m6a','check:m6b','check:m6c')
$failed = @()
foreach ($test in $commands) {
  "`n===== npm run $test =====" | Tee-Object -FilePath $log -Append
  & npm run $test 2>&1 | Out-String | Tee-Object -FilePath $log -Append | Out-Null
  if ($LASTEXITCODE -ne 0) { $failed += "$test (exit $LASTEXITCODE)" }
}
"`n===== TypeScript =====" | Tee-Object -FilePath $log -Append
& npx --no-install tsc --noEmit 2>&1 | Out-String | Tee-Object -FilePath $log -Append | Out-Null
if ($LASTEXITCODE -ne 0) { $failed += 'TypeScript' }
"`n===== Production build =====" | Tee-Object -FilePath $log -Append
& npm run build 2>&1 | Out-String | Tee-Object -FilePath $log -Append | Out-Null
if ($LASTEXITCODE -ne 0) { $failed += 'Production build' }
"`nFAILURES: $($failed.Count)" | Tee-Object -FilePath $log -Append
$failed | Tee-Object -FilePath $log -Append
Write-Host "Verification log: $log"
if ($failed.Count -gt 0) { exit 1 } else { exit 0 }

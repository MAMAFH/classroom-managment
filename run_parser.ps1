# Run the schedule parser from the project root
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\run_parser.ps1
#   powershell -ExecutionPolicy Bypass -File .\run_parser.ps1 -Upload

param(
    [switch]$Upload
)

$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

if (-not (Test-Path .venv\Scripts\Activate.ps1)) {
    Write-Host 'Virtual environment not found at .venv\Scripts\Activate.ps1' -ForegroundColor Red
    exit 1
}

& .\.venv\Scripts\Activate.ps1

Write-Host 'Installing parser requirements...' -ForegroundColor Cyan
pip install -r requirements-parser.txt

Write-Host 'Running parser in dry-run mode...' -ForegroundColor Cyan
python scripts/parse_schedules.py --dry-run --semester 2024-2025-S2

if ($Upload) {
    Write-Host 'Uploading parsed schedules to Firestore...' -ForegroundColor Cyan
    python scripts/parse_schedules.py --semester 2024-2025-S2
} else {
    Write-Host 'Dry run complete. Re-run with -Upload to write data to Firestore.' -ForegroundColor Yellow
}

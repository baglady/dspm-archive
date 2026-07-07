# dspm Claude Telegram bot — Windows launcher
# Run from the telegram-bot/ directory: .\run.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# First-time setup: create venv and install deps
if (-not (Test-Path "venv")) {
    Write-Host "Creating venv..." -ForegroundColor Cyan
    python -m venv venv
    .\venv\Scripts\pip install -r requirements.txt
    Write-Host "Setup complete." -ForegroundColor Green
}

# Copy .env.example if .env doesn't exist yet
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host ""
    Write-Host "Created .env — fill in your tokens before continuing:" -ForegroundColor Yellow
    Write-Host "  notepad .env" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host "Starting bot..." -ForegroundColor Green
.\venv\Scripts\python bot.py

@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found in PATH. Install Python 3.11+ first.
  pause
  exit /b 1
)

echo [GlyphLens] Preparing backend dependencies...
python -m pip install --disable-pip-version-check -q -r tools\backend\requirements.txt
if errorlevel 1 (
  echo [ERROR] pip install failed.
  pause
  exit /b 1
)

echo [GlyphLens] Starting FastAPI on http://localhost:8787 (Ctrl+C to stop)
python -m uvicorn tools.backend.main:app --host 127.0.0.1 --port 8787 --reload
pause

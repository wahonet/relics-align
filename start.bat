@echo off
title GlyphLens Dev Server

cd /d "%~dp0glyphlens-web"
if errorlevel 1 (
    echo.
    echo [GlyphLens] Cannot enter glyphlens-web folder.
    echo             Please keep start.bat at the repo root.
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [GlyphLens] Node.js not found on PATH.
    echo             Install Node.js 18+ from https://nodejs.org/
    echo             and make sure "Add to PATH" is checked, then retry.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo.
    echo [GlyphLens] npm not found. If you use nvm, run "nvm use" first.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [GlyphLens] First run: installing dependencies, may take 1-3 minutes...
    call npm install
    if errorlevel 1 (
        echo.
        echo [GlyphLens] npm install failed. Check the log above.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo [GlyphLens] Starting dev server...
echo [GlyphLens] Browser will open http://localhost:5173 in a few seconds.
echo [GlyphLens] Press Ctrl+C to stop the server, then any key to close.
echo.

start "" "http://localhost:5173"

call npm run dev

echo.
echo [GlyphLens] Dev server stopped.
pause

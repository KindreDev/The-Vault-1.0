@echo off
title Build The Vault EXE
setlocal
chcp 65001 >nul

echo.
echo  THE VAULT - EXE BUILDER
echo  Outputs: dist\vault\vault.exe
echo           dist\VaultSetup.exe (if Inno Setup is installed)
echo.

REM Prerequisites check
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Install Python 3.11+ from python.org
    pause & exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install Node.js 20 LTS from nodejs.org
    pause & exit /b 1
)

REM Step 1 - Get FFmpeg
echo [1/5] Checking for FFmpeg...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0get_ffmpeg.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] FFmpeg download failed.
    echo   Manual fix:
    echo     1. Go to https://www.gyan.dev/ffmpeg/builds/
    echo     2. Download ffmpeg-release-essentials.zip
    echo     3. Extract ffmpeg.exe into the tools\ folder here
    echo     4. Re-run build.bat
    echo.
    pause & exit /b 1
)
echo.

REM Step 2 - Build React frontend
echo [2/5] Building React frontend...
cd /d "%~dp0frontend"

call npm ci
if %errorlevel% neq 0 ( echo [ERROR] npm ci failed. & pause & exit /b 1 )

call npm run build
if %errorlevel% neq 0 ( echo [ERROR] npm run build failed. & pause & exit /b 1 )

REM Restore dev node_modules that npm ci wiped (so start.bat works after a build)
call npm install
if %errorlevel% neq 0 ( echo [WARNING] npm install restore failed - run it manually before using start.bat )

if not exist "dist\index.html" (
    echo [ERROR] frontend\dist\index.html missing after build.
    pause & exit /b 1
)
echo     React app built to frontend\dist\
echo.

REM Step 3 - Python venv + dependencies
echo [3/5] Setting up Python environment...
cd /d "%~dp0backend"

if not exist "venv" (
    echo     Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

python -m pip install --upgrade pip pyinstaller
if %errorlevel% neq 0 ( echo [ERROR] pip upgrade failed. & pause & exit /b 1 )

pip install -r requirements.txt
if %errorlevel% neq 0 ( echo [ERROR] pip install failed. & pause & exit /b 1 )

echo     Python environment ready.
echo.

REM Step 4 - PyInstaller
echo [4/5] Running PyInstaller (2-5 minutes)...
cd /d "%~dp0"

backend\venv\Scripts\pyinstaller vault.spec --noconfirm
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] PyInstaller failed. Common fixes:
    echo   - Re-run build.bat (first run sometimes fails due to file locks)
    echo   - Make sure antivirus is not blocking PyInstaller
    echo.
    pause & exit /b 1
)

if not exist "dist\vault\vault.exe" (
    echo [ERROR] dist\vault\vault.exe not found after build.
    pause & exit /b 1
)
echo     EXE built: dist\vault\vault.exe
echo.

REM Step 5 - Inno Setup installer (optional)
echo [5/5] Building Windows installer...

set ISCC=
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
where iscc >nul 2>&1 && set ISCC=iscc

if "%ISCC%"=="" (
    echo     Inno Setup not found - skipping installer.
    echo     Install from https://jrsoftware.org/isinfo.php to get VaultSetup.exe
) else (
    "%ISCC%" installer.iss
    if %errorlevel% equ 0 (
        echo     Installer built: dist\VaultSetup.exe
    ) else (
        echo     Inno Setup failed. Raw exe still at dist\vault\vault.exe
    )
)

echo.
echo  Build complete!
echo.
if exist "dist\VaultSetup.exe" (
    echo   Distribute: dist\VaultSetup.exe
) else (
    echo   Distribute: zip the dist\vault\ folder
)
echo.
echo  NOTE: Windows SmartScreen will warn on first run.
echo  Users click More info then Run anyway.
echo.
pause

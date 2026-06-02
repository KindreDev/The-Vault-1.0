@echo off
title The Vault

echo.
echo  ╔══════════════════════════════════╗
echo  ║         THE VAULT v0.1           ║
echo  ╚══════════════════════════════════╝
echo.

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Install Python 3.11+ from python.org
    pause & exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install Node.js from nodejs.org
    pause & exit /b 1
)

echo [1/4] Setting up Python backend...
cd /d "%~dp0backend"

if not exist "venv" (
    echo     Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

echo     Upgrading pip first...
python -m pip install --upgrade pip setuptools wheel

echo [2/4] Installing Python dependencies...
pip install -r requirements.txt

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Dependency install failed. See error above.
    pause & exit /b 1
)
echo     Backend ready.

echo [3/4] Setting up frontend...
cd /d "%~dp0frontend"
if not exist "node_modules" (
    echo     Installing npm packages...
    npm install
)
echo     Frontend ready.

echo [4/4] Starting servers...
echo.
echo  Backend:  http://localhost:8000
echo  Frontend: http://localhost:5173
echo  API docs: http://localhost:8000/docs
echo.

echo  Stopping any old backend processes on port 8000...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

start "The Vault — Backend" cmd /k "cd /d %~dp0backend && call venv\Scripts\activate.bat && python main.py"
timeout /t 2 /nobreak >nul
start "The Vault — Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo  The Vault is running. Browser should open automatically.
pause

@echo off
cd /d "%~dp0\..\.."
"backend\venv\Scripts\python.exe" "scripts\video_player\run_native_video_test.py"
if errorlevel 1 pause

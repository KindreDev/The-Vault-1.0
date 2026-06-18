@echo off
setlocal enabledelayedexpansion
title The Vault - Mobile

cd /d "%~dp0frontend-mobile"

:: ---------------------------------------------------------------------------
::  The Vault - Mobile launcher
::  Build the Android app, or live-test it on your phone over WiFi.
:: ---------------------------------------------------------------------------

:: Make sure dependencies exist (first run only).
if not exist "node_modules" (
  echo [setup] Installing dependencies, this happens once...
  call npm install || goto :fail
)
if not exist "android" (
  echo [setup] Adding the Android project, this happens once...
  call npx cap add android || goto :fail
)

:menu
cls
echo ============================================
echo            THE VAULT - MOBILE
echo ============================================
echo.
echo   Make sure the Vault desktop app is RUNNING
echo   on this PC before you connect from the phone.
echo.
echo   --------------------------------------------
echo    1.  Test on my phone over WiFi   (fastest)
echo    2.  Build the APK file           (to sideload)
echo    3.  Build + install to plugged-in phone
echo    4.  Open in Android Studio
echo    5.  Quit
echo   --------------------------------------------
echo.
set /p choice="   Pick a number: "

if "%choice%"=="1" goto :wifi
if "%choice%"=="2" goto :apk
if "%choice%"=="3" goto :run
if "%choice%"=="4" goto :studio
if "%choice%"=="5" exit /b 0
goto :menu

:: ---------------------------------------------------------------------------
:wifi
cls
echo Starting the live dev server...
echo.
echo  1) On your phone, connect to the SAME WiFi as this PC.
echo  2) Open this address in the phone's browser:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set ip=%%a
  set ip=!ip: =!
  echo        http://!ip!:5174
)
echo.
echo  3) When the app asks for the "Vault PC address", enter THIS
echo     PC's address with port 8000, for example:  !ip!:8000
echo.
echo  Press Ctrl+C to stop the server when you are done.
echo ============================================
echo.
call npm run dev -- --host
goto :end

:: ---------------------------------------------------------------------------
:apk
cls
echo Building the web app...
call npm run build || goto :fail
echo Syncing into the Android project...
call npx cap sync android || goto :fail
echo Compiling the APK (this can take a few minutes the first time)...
cd android
call gradlew.bat assembleDebug || (cd .. & goto :fail)
cd ..
set "APK=%~dp0frontend-mobile\android\app\build\outputs\apk\debug\app-debug.apk"
echo.
echo ============================================
echo  DONE! Your APK is here:
echo    !APK!
echo.
echo  Copy that file to your phone and tap it to install.
echo  (You may need to allow "install unknown apps".)
echo ============================================
if exist "!APK!" explorer /select,"!APK!"
goto :end

:: ---------------------------------------------------------------------------
:run
cls
echo Make sure your phone is plugged in with USB debugging ON.
echo Building and installing...
call npm run build || goto :fail
call npx cap run android || goto :fail
goto :end

:: ---------------------------------------------------------------------------
:studio
echo Opening Android Studio...
call npx cap open android
goto :end

:: ---------------------------------------------------------------------------
:fail
echo.
echo [ERROR] Something went wrong. Scroll up to see the message.
:end
echo.
pause
goto :menu

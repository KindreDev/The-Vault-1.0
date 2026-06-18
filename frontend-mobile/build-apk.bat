@echo off
title Build The Vault Mobile APK
setlocal
chcp 65001 >nul

echo.
echo  THE VAULT - MOBILE APK BUILDER
echo  Outputs a signed release app to your Desktop: TheVault.apk
echo.

cd /d "%~dp0"

REM Prerequisites
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install Node.js 20 LTS from nodejs.org
    pause & exit /b 1
)

REM Java: needed by Gradle. Fall back to Android Studio's bundled JDK.
if not defined JAVA_HOME (
    if exist "%ProgramFiles%\Android\Android Studio\jbr" (
        set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
    ) else (
        echo [ERROR] JAVA_HOME not set and Android Studio JDK not found.
        echo   Install Android Studio, or set JAVA_HOME to a JDK 17 folder.
        pause & exit /b 1
    )
)
echo  Using Java at: %JAVA_HOME%
echo.

REM Warn if the signing key is missing (release build would be unsigned).
if not exist "android\keystore.properties" (
    echo [WARNING] android\keystore.properties not found.
    echo   The release build will be UNSIGNED and won't install.
    echo   See the signing setup notes if you need to recreate the key.
    echo.
)

REM Step 1 - install deps (only if missing)
echo [1/4] Checking npm packages...
if not exist "node_modules" (
    call npm install
    if %errorlevel% neq 0 ( echo [ERROR] npm install failed. & pause & exit /b 1 )
)
echo.

REM Step 2 - build the web app
echo [2/4] Building web app...
call npm run build
if %errorlevel% neq 0 ( echo [ERROR] vite build failed. & pause & exit /b 1 )
if not exist "dist\index.html" ( echo [ERROR] dist\index.html missing after build. & pause & exit /b 1 )
echo.

REM Step 3 - copy web app into the Android project
echo [3/4] Syncing to Android project...
call npx cap sync android
if %errorlevel% neq 0 ( echo [ERROR] cap sync failed. & pause & exit /b 1 )
echo.

REM Step 4 - assemble the signed release APK
echo [4/4] Building signed release APK (this can take a few minutes)...
cd /d "%~dp0android"
call "%~dp0android\gradlew.bat" assembleRelease
if %errorlevel% neq 0 ( echo [ERROR] Gradle assembleRelease failed. & cd /d "%~dp0" & pause & exit /b 1 )
cd /d "%~dp0"

set "APK=%~dp0android\app\build\outputs\apk\release\app-release.apk"
if not exist "%APK%" (
    echo [ERROR] Release APK not found at:
    echo   %APK%
    pause & exit /b 1
)

copy /Y "%APK%" "%USERPROFILE%\Desktop\TheVault.apk" >nul
REM Also refresh the copy that ships in the repo (frontend-mobile\release\).
copy /Y "%APK%" "%~dp0release\TheVault.apk" >nul
echo.
echo  Build complete!
echo  App copied to: %USERPROFILE%\Desktop\TheVault.apk
echo              and: %~dp0release\TheVault.apk  (committed to the repo)
echo.
echo  Install it on your phone (enable "install unknown apps" if asked).
echo  First time switching from a test build: uninstall the old one first.
echo.
pause

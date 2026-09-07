@echo off
chcp 936 >nul 2>nul
title PDD Profit Calculator - Local Server
cd /d "%~dp0"

echo ============================================
echo    PDD Profit Calculator / Local Server
echo ============================================
echo.
echo [STEP 1/4] Checking current folder...
cd
echo.

echo [STEP 2/4] Checking Node.js ...
where node >nul 2>nul
if errorlevel 1 goto NONODE
node -v
if errorlevel 1 goto NONODE
echo    Node.js OK
echo.

echo [STEP 3/4] Checking files ...
if not exist "server.js" goto NOFILE
if not exist "public\index.html" goto NOFILE
if not exist "data\uploads" mkdir "data\uploads" 2>nul
echo    Files OK
echo.

echo [STEP 4/4] Starting server ...
echo.
echo --------------------------------------------
echo   DO NOT CLOSE THIS WINDOW
echo   Home   : http://localhost:3000
echo   Admin  : http://localhost:3000/admin.html
echo   Login  : admin / admin888
echo --------------------------------------------
echo   To stop: press Ctrl + C, then close window
echo --------------------------------------------
echo.

start "" /min cmd /c "ping -n 5 127.0.0.1 >nul & start http://localhost:3000"
node server.js

echo.
echo [STOPPED] The server has stopped.
pause
goto :EOF

:NONODE
echo.
echo ============================================
echo   ERROR: Node.js is NOT installed
echo ============================================
echo.
echo   Please install Node.js first:
echo       1. Open  https://nodejs.org
echo       2. Click the GREEN "LTS" button
echo       3. Run the installer, click Next all the way
echo       4. RESTART this computer
echo       5. Double-click start.bat again
echo.
pause
goto :EOF

:NOFILE
echo.
echo ============================================
echo   ERROR: server.js NOT FOUND
echo ============================================
echo.
echo   Current folder is shown above.
echo   Make sure start.bat is inside the
echo   pdd-profit folder (same level as server.js)
echo.
echo   Also: you must EXTRACT the zip first,
echo   do not run start.bat from inside the zip.
echo.
pause
goto :EOF

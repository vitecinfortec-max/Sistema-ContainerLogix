@echo off
REM ========================================
REM ContainerLogix - Build Windows Installer
REM ========================================

echo.
echo ========================================
echo ContainerLogix Desktop - Build Windows
echo ========================================
echo.

REM Verificar Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Node.js nao encontrado!
    echo Por favor, instale Node.js 16+ de: https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js encontrado: 
node -v
echo.

REM Verificar Yarn
where yarn >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Yarn nao encontrado. Instalando...
    npm install -g yarn
    if %ERRORLEVEL% NEQ 0 (
        echo [ERRO] Falha ao instalar Yarn
        pause
        exit /b 1
    )
)

echo [OK] Yarn encontrado:
yarn -v
echo.

REM Verificar se esta na pasta correta
if not exist "package.json" (
    echo [ERRO] Arquivo package.json nao encontrado!
    echo Execute este script dentro da pasta /desktop
    pause
    exit /b 1
)

echo ========================================
echo Instalando dependencias...
echo ========================================
echo.

call yarn install
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Falha ao instalar dependencias
    pause
    exit /b 1
)

echo.
echo ========================================
echo Gerando instalador Windows...
echo ========================================
echo.
echo Isso pode levar alguns minutos...
echo.

call yarn build:win
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Falha ao gerar instalador
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build concluido com sucesso!
echo ========================================
echo.

if exist "dist\" (
    echo Arquivos gerados em: dist\
    echo.
    dir dist\*.exe /b
    dir dist\*.msi /b 2>nul
    echo.
)

echo.
echo ========================================
echo Pronto!
echo ========================================
echo.
echo Os instaladores estao disponiveis na pasta "dist"
echo.
echo Arquivos gerados:
echo - ContainerLogix-Setup-x.x.x.exe (NSIS Installer)
echo - ContainerLogix-x.x.x-x64.msi (MSI Installer)
echo.

pause

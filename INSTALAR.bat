@echo off
setlocal enabledelayedexpansion
title ContainerLogix - Instalador
cd /d "%~dp0"

echo ========================================
echo   ContainerLogix - Instalacao
echo ========================================
echo.

REM --- Verifica Python ---
python --version >nul 2>&1
if errorlevel 1 (
    echo [AVISO] Python nao encontrado.
    where winget >nul 2>&1
    if not errorlevel 1 (
        echo Instalando Python 3.11 via winget, aguarde...
        winget install -e --id Python.Python.3.11 --accept-source-agreements --accept-package-agreements
        echo.
        echo IMPORTANTE: Feche esta janela, abra um novo terminal e execute
        echo este script novamente para continuar a instalacao.
        pause
        exit /b 1
    ) else (
        echo Baixe e instale o Python em https://www.python.org/downloads/
        echo Marque a opcao "Add Python to PATH" durante a instalacao.
        pause
        exit /b 1
    )
)
echo [OK] Python encontrado:
python --version
echo.

REM --- Verifica Node.js ---
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org/ e execute este script novamente.
    pause
    exit /b 1
)
echo [OK] Node.js encontrado:
node --version
echo.

REM --- Verifica/instala Yarn ---
yarn --version >nul 2>&1
if errorlevel 1 (
    echo Instalando Yarn...
    call npm install -g yarn
)
echo [OK] Yarn encontrado:
yarn --version
echo.

REM --- Verifica MongoDB ---
sc query MongoDB >nul 2>&1
if errorlevel 1 (
    echo [AVISO] Servico do MongoDB nao encontrado nesta maquina.
    where winget >nul 2>&1
    if not errorlevel 1 (
        echo Instalando MongoDB Community Server via winget, aguarde...
        winget install -e --id MongoDB.Server --accept-source-agreements --accept-package-agreements
    ) else (
        echo Baixe e instale o MongoDB Community Server em:
        echo https://www.mongodb.com/try/download/community
        echo Instale como servico do Windows durante a instalacao.
    )
) else (
    echo [OK] Servico do MongoDB encontrado.
)
echo.

echo ========================================
echo Instalando dependencias do Backend (Python)...
echo ========================================
cd /d "%~dp0backend"
if not exist venv (
    python -m venv venv
)
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias do backend.
    pause
    exit /b 1
)
call venv\Scripts\deactivate.bat
echo.

echo ========================================
echo Instalando dependencias do Frontend (Node)...
echo ========================================
cd /d "%~dp0frontend"
call yarn install
if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias do frontend.
    pause
    exit /b 1
)

cd /d "%~dp0"
echo.
echo ========================================
echo Instalacao concluida com sucesso!
echo ========================================
echo Use o arquivo EXECUTAR.bat para iniciar o sistema.
echo.
pause

@echo off
setlocal enabledelayedexpansion
title ContainerLogix - Clonar fora do Google Drive
REM ---------------------------------------------------------------------
REM Cria uma copia de trabalho do projeto FORA do Google Drive, em
REM C:\Projetos\ContainerLogix, clonada do GitHub.
REM
REM Por que: o git le os arquivos por mapeamento de memoria e, dentro do
REM Google Drive, as vezes recebe uma versao antiga com o final zerado - em
REM 18/10/2026 isso gravou um arquivo corrompido num commit e derrubou o
REM deploy. Fora do Drive o problema nao acontece (e tudo fica mais rapido).
REM
REM Como usar: de dois cliques neste arquivo DENTRO da pasta do projeto no
REM Google Drive (ele copia de la os .env e a chave do Android).
REM Depois disso, trabalhe, faca commit e push so em C:\Projetos\ContainerLogix.
REM ---------------------------------------------------------------------

set "ORIGEM=%~dp0.."
set "DESTINO=C:\Projetos\ContainerLogix"
set "REPO=https://github.com/vitecinfortec-max/Sistema-ContainerLogix.git"

echo ========================================
echo   Clonar o ContainerLogix fora do Drive
echo ========================================
echo Origem (Drive): %ORIGEM%
echo Destino:        %DESTINO%
echo.

git --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Git nao encontrado. Instale em https://git-scm.com/ e rode de novo.
    pause
    exit /b 1
)

if exist "%DESTINO%\.git" (
    echo [OK] O clone ja existe - so atualizando com o GitHub.
    git -C "%DESTINO%" pull --ff-only
) else (
    if not exist "C:\Projetos" mkdir "C:\Projetos"
    echo Clonando do GitHub...
    git clone "%REPO%" "%DESTINO%"
    if errorlevel 1 (
        echo [ERRO] Falha ao clonar. Confira a internet e o acesso ao GitHub.
        pause
        exit /b 1
    )
)
echo.

REM --- Mesmo autor de commit usado na pasta do Drive ---
for /f "delims=" %%A in ('git -C "%ORIGEM%" config --get user.name 2^>nul') do git -C "%DESTINO%" config user.name "%%A"
for /f "delims=" %%A in ('git -C "%ORIGEM%" config --get user.email 2^>nul') do git -C "%DESTINO%" config user.email "%%A"

REM --- Arquivos locais que nao vao para o git (configuracao e chave do Android) ---
echo Copiando configuracoes locais...
for %%F in (backend\.env frontend\.env frontend\.env.production frontend\android\containerlogix-release.keystore frontend\android\local.properties) do (
    if exist "%ORIGEM%\%%F" (
        copy /Y "%ORIGEM%\%%F" "%DESTINO%\%%F" >nul && echo   [OK] %%F
    ) else (
        echo   [--] %%F nao existe nesta maquina
    )
)
if exist "%ORIGEM%\frontend\.vercel" (
    xcopy /E /I /Y /Q "%ORIGEM%\frontend\.vercel" "%DESTINO%\frontend\.vercel" >nul && echo   [OK] frontend\.vercel
)
echo.

REM --- Ambiente do backend (o EXECUTAR.bat usa backend\venv) ---
python --version >nul 2>&1
if errorlevel 1 (
    echo [AVISO] Python nao encontrado - pule esta parte ou rode o INSTALAR.bat no clone.
) else (
    if not exist "%DESTINO%\backend\venv\Scripts\python.exe" (
        echo Criando o ambiente Python do backend...
        python -m venv "%DESTINO%\backend\venv"
    )
    echo Instalando dependencias do backend...
    "%DESTINO%\backend\venv\Scripts\python.exe" -m pip install -q --upgrade pip
    "%DESTINO%\backend\venv\Scripts\python.exe" -m pip install -q -r "%DESTINO%\backend\requirements.txt" -r "%DESTINO%\backend\requirements-dev.txt"
)
echo.

REM --- Dependencias do frontend ---
REM "call": o yarn e um .cmd - sem call, o script terminaria aqui
call yarn --version >nul 2>&1
if errorlevel 1 (
    echo [AVISO] Yarn nao encontrado - instale com: npm install -g yarn
) else (
    echo Instalando dependencias do frontend...
    pushd "%DESTINO%\frontend"
    call yarn install --frozen-lockfile --network-timeout 600000
    popd
)
echo.

echo ========================================
echo   Pronto.
echo ========================================
echo Trabalhe a partir de: %DESTINO%
echo  - para rodar o sistema: %DESTINO%\EXECUTAR.bat
echo  - commits e pushes: so a partir dessa pasta
echo A pasta do Google Drive continua como esta (backups, instalador, APKs),
echo mas nao use mais o git dentro dela.
echo.
pause

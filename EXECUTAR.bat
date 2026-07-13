@echo off
title ContainerLogix - Execucao
cd /d "%~dp0"

echo ========================================
echo   ContainerLogix - Iniciando o sistema
echo ========================================
echo.

echo Iniciando o servico do MongoDB (se instalado como servico)...
net start MongoDB >nul 2>&1

if not exist "backend\venv\Scripts\activate.bat" (
    echo [ERRO] Ambiente do backend nao encontrado.
    echo Execute primeiro o arquivo INSTALAR.bat
    pause
    exit /b 1
)

echo Iniciando Backend (FastAPI) em http://localhost:8000 ...
start "ContainerLogix - Backend" cmd /k "cd /d "%~dp0backend" && call venv\Scripts\activate.bat && uvicorn server:app --host 0.0.0.0 --port 8000 --reload"

echo Aguardando o backend inicializar...
timeout /t 6 /nobreak >nul

echo Iniciando Frontend (React) em http://localhost:3000 ...
start "ContainerLogix - Frontend" cmd /k "cd /d "%~dp0frontend" && yarn start"

echo Aguardando o frontend inicializar...
timeout /t 8 /nobreak >nul

start http://localhost:3000

echo.
echo ========================================
echo Sistema iniciado!
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:3000
echo.
echo Para PARAR o sistema, feche as duas janelas
echo de terminal que foram abertas (Backend e Frontend).
echo ========================================
echo.
pause

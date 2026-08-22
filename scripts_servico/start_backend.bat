@echo off
cd /d "G:\Meu Drive\Sistema-ContainerLogix-main\backend"
".\venv\Scripts\python.exe" -m uvicorn server:app --host 0.0.0.0 --port 8000

@echo off
rem Startet den Test-Server. Danach im Browser oeffnen: http://localhost:8123/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" %*
pause

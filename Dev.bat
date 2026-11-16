@echo off
REM Developer mode: installs packages (first time only) and starts the live-reload dev server.
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:5173/
call npm run dev

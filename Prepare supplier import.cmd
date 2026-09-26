@echo off
cd /d "%~dp0"
node scripts/collect-supplier.mjs --interactive
pause

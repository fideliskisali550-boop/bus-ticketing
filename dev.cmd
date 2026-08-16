@echo off
rem Dev-server launcher. Starts Next.js with this folder as the working
rem directory, so tailwind.config.ts and postcss.config.mjs resolve correctly
rem even when the process is spawned from somewhere else.
cd /d "%~dp0"
node node_modules/next/dist/bin/next dev -p 3200 %*

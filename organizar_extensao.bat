@echo off
title Organizador Twitch Extension - ExplorarLocais Bot

echo ============================================
echo   ORGANIZANDO EXTENSAO TWITCH
echo   ExplorarLocais Bot
echo ============================================
echo.

cd /d "%~dp0"

:: 1. Remove ZIP antigo
echo [1/5] Removendo ZIP antigo...
if exist explorarbot.zip (
    del /f /q explorarbot.zip
    echo       ZIP antigo removido.
) else (
    echo       Nenhum ZIP antigo encontrado.
)

:: 2. Verifica pastas
echo.
echo [2/5] Verificando estrutura da pasta public...

if not exist public mkdir public
if not exist public\css mkdir public\css
if not exist public\js mkdir public\js
if not exist public\assets mkdir public\assets

echo       Estrutura OK.

:: 3. Cria manifest.json dentro da pasta public
echo.
echo [3/5] Criando manifest.json...

(
echo {
echo   "author_name": "ExplorarLocais",
echo   "description": "ExplorarLocais Bot para Twitch",
echo   "name": "ExplorarLocais Bot",
echo   "version": "0.0.2",
echo   "views": {
echo     "panel": {
echo       "viewer_url": "panel.html"
echo     },
echo     "mobile": {
echo       "viewer_url": "mobile.html"
echo     },
echo     "config": {
echo       "viewer_url": "config.html"
echo     }
echo   }
echo }
) > public\manifest.json

echo       manifest.json criado em public\manifest.json

:: 4. Verifica arquivos obrigatorios
echo.
echo [4/5] Verificando arquivos HTML...

set MISSING=0

if not exist public\panel.html  echo [AVISO] Faltando: public\panel.html
if not exist public\panel.html  set MISSING=1

if not exist public\mobile.html echo [AVISO] Faltando: public\mobile.html
if not exist public\mobile.html set MISSING=1

if not exist public\config.html echo [AVISO] Faltando: public\config.html
if not exist public\config.html set MISSING=1

if %MISSING%==0 echo       Todos os arquivos HTML encontrados.

:: 5. Cria o ZIP com o conteudo da pasta public
echo.
echo [5/5] Criando explorarbot.zip...

powershell -NoProfile -Command "Compress-Archive -Path 'public\*' -DestinationPath 'explorarbot.zip' -Force"

if exist explorarbot.zip (
    echo.
    echo ============================================
    echo   SUCESSO!
    echo   Arquivo: explorarbot.zip
    for %%F in (explorarbot.zip) do echo   Tamanho: %%~zF bytes
    echo ============================================
    echo.
    echo   Pronto para upload no Twitch Developer Console!
    echo   https://dev.twitch.tv/console/extensions
    echo.
) else (
    echo.
    echo ============================================
    echo   ERRO: Falha ao criar o ZIP!
    echo   Verifique se o PowerShell esta disponivel.
    echo ============================================
)

echo.
pause

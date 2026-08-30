@echo off
chcp 65001 >nul
title SHADOW - Motor (feche esta janela para desligar o Shadow)
cd /d "%~dp0"

echo.
echo   ============================================
echo      Iniciando S.H.A.D.O.W.
echo   ============================================
echo.

REM Verifica se o Node.js esta instalado. Sem ele, o motor nunca sobe e a
REM janela mostra "localhost recusou a conexao".
where node >nul 2>nul
if errorlevel 1 (
    echo   [ERRO] O Node.js nao esta instalado neste computador.
    echo.
    echo   O Shadow precisa do Node.js para funcionar. Baixe a versao LTS em:
    echo       https://nodejs.org
    echo.
    echo   Instale, feche esta janela e rode o Shadow.bat de novo.
    echo.
    pause
    exit /b 1
)

REM Instala as dependencias na primeira execucao.
if not exist "node_modules" (
    echo   Primeira execucao: instalando dependencias. Pode demorar 1-2 min...
    call npm install
    if errorlevel 1 (
        echo.
        echo   [ERRO] Falha ao instalar as dependencias.
        echo   Verifique sua conexao com a internet e rode o Shadow.bat de novo.
        echo.
        pause
        exit /b 1
    )
    echo.
)

REM Cria o .env a partir do exemplo, se ainda nao existir.
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo   Arquivo .env criado. Abra-o e cole sua GEMINI_API_KEY.
    echo.
)

REM O proprio motor abre a janela do app no instante em que fica pronto
REM (veja openAppWindow em server\index.js). Por isso setamos SHADOW_LAUNCH=1.
REM Assim a janela nunca abre antes da hora e nunca cai em "conexao recusada".
set "SHADOW_LAUNCH=1"

REM Inicia o motor local (mantenha esta janela aberta).
echo   Motor rodando. A janela do Shadow vai abrir quando ele estiver pronto.
echo   Para desligar, feche esta janela.
echo.
node server\index.js

pause

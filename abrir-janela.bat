@echo off
chcp 65001 >nul
REM ---------------------------------------------------------------------
REM Abre a interface do Shadow numa janela dedicada (modo aplicativo),
REM sem barra de navegador, para ter cara de app de desktop de verdade.
REM
REM O Edge vem primeiro DE PROPOSITO: e o unico navegador que traz as
REM vozes neurais da Microsoft "Online (Natural)", usadas como reserva.
REM
REM DUAS REGRAS PARA NAO QUEBRAR ESTE ARQUIVO:
REM  1. Somente caracteres ASCII. Acentos e travessoes desalinham a
REM     leitura do cmd e ele passa a comer o inicio das linhas.
REM  2. Nunca usar %%ProgramFiles(x86)%% dentro de um bloco if (...),
REM     porque o parentese de x86 fecha o bloco no meio. Por isso os
REM     caminhos viram variaveis primeiro e o desvio e feito com goto.
REM ---------------------------------------------------------------------

setlocal
set "PORT=4577"
set "URL=http://localhost:%PORT%"
set "FLAGS=--window-size=1400,900"

REM Espera o motor comecar a responder na porta antes de abrir a janela.
REM Assim a interface nunca cai na tela de "localhost recusou a conexao".
REM Tenta por ate ~60 segundos (120 tentativas de 0,5 s).
echo Aguardando o motor do Shadow ficar pronto...
powershell -NoProfile -Command "for ($i=0; $i -lt 120; $i++) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('localhost', %PORT%); $c.Close(); exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 (
    echo O motor demorou para responder. Abrindo a janela mesmo assim...
)

set "EDGE_A=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE_B=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME_A=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME_B=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "CHROME_C=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE_A%" goto :edge_a
if exist "%EDGE_B%" goto :edge_b
if exist "%CHROME_A%" goto :chrome_a
if exist "%CHROME_B%" goto :chrome_b
if exist "%CHROME_C%" goto :chrome_c
goto :padrao

:edge_a
start "" "%EDGE_A%" --app=%URL% %FLAGS%
goto :fim

:edge_b
start "" "%EDGE_B%" --app=%URL% %FLAGS%
goto :fim

:chrome_a
start "" "%CHROME_A%" --app=%URL% %FLAGS%
goto :fim

:chrome_b
start "" "%CHROME_B%" --app=%URL% %FLAGS%
goto :fim

:chrome_c
start "" "%CHROME_C%" --app=%URL% %FLAGS%
goto :fim

:padrao
REM Sem Edge/Chrome instalado: abre no navegador padrao mesmo.
start "" "%URL%"

:fim
endlocal

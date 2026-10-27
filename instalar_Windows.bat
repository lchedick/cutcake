@echo off
setlocal EnableExtensions
title Instalar CutCake
echo.
echo  === CutCake - Cortes, legendas e zoom - instalacao (Windows) ===
echo.

rem ------------------------------------------------------------------
rem 0) o Premiere precisa estar fechado
rem ------------------------------------------------------------------
:check_premiere
tasklist /FI "IMAGENAME eq Adobe Premiere Pro.exe" 2>nul | find /I "Adobe Premiere Pro.exe" >nul
if errorlevel 1 goto copiar
echo  O Premiere esta aberto. Salve o seu projeto e feche o Premiere.
echo  Depois, volte aqui e aperte qualquer tecla.
pause >nul
goto check_premiere

rem ------------------------------------------------------------------
rem 1) copia o painel para a pasta de extensoes do Premiere
rem ------------------------------------------------------------------
:copiar
set "DEST=%APPDATA%\Adobe\CEP\extensions\CutCake"
if exist "%DEST%" rmdir /S /Q "%DEST%"
xcopy /E /I /Y /Q "%~dp0CutCake" "%DEST%" >nul
if errorlevel 1 goto erro_copia
echo  [ok] Painel copiado para %DEST%

rem ------------------------------------------------------------------
rem 2) libera paineis nao assinados (necessario para extensoes proprias)
rem ------------------------------------------------------------------
for %%v in (9 10 11 12 13 14 15 16) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>nul
echo  [ok] Premiere configurado para carregar o painel

rem ------------------------------------------------------------------
rem 3) transcricao (Whisper): so ela precisa do Python
rem ------------------------------------------------------------------
call :find_python
if defined PY (> "%DEST%\python_path.txt" echo %PY%)

echo.
echo  A transcricao (Whisper) e usada pelo Cacador de trechos e para criar
echo  as legendas. Ela roda no seu computador, sem internet, mas o download
echo  e grande (cerca de 3 GB com a placa de video, 1 GB sem).
echo  Zoom, Render e Animar funcionam sem ela.
echo.
choice /C SN /N /M "  Instalar a transcricao agora? (S/N): "
if errorlevel 2 goto sem_transcricao

if defined PY goto tem_python
echo.
echo  O Python nao esta instalado neste computador. Ele e necessario para
echo  a transcricao. Vou instalar agora (nao precisa de senha de administrador).
call :install_python
call :find_python
if not defined PY goto falha_python

:tem_python
echo  [ok] Python encontrado: %PY%
> "%DEST%\python_path.txt" echo %PY%

echo  Instalando as bibliotecas da transcricao...
%PY% -m pip install --upgrade --disable-pip-version-check -r "%DEST%\engine\requirements.txt"
if errorlevel 1 goto erro_pip
echo  [ok] Bibliotecas instaladas

nvidia-smi -L >nul 2>nul
if errorlevel 1 goto sem_gpu
echo  Placa de video NVIDIA encontrada. Instalando os componentes dela (pode demorar)...
%PY% -m pip install --upgrade --disable-pip-version-check -r "%DEST%\engine\requirements-gpu.txt"
if errorlevel 1 echo  [aviso] Nao consegui instalar os componentes da placa. A transcricao vai usar o processador.
if not errorlevel 1 echo  [ok] Componentes da placa de video instalados
goto modelo

:sem_gpu
echo  Sem placa de video NVIDIA: a transcricao vai usar o processador.

:modelo
echo  Baixando o modelo do Whisper (so desta vez)...
%PY% "%DEST%\engine\cutcake.py" download --model auto --console
if errorlevel 1 echo  [aviso] O modelo nao foi baixado. O CutCake baixa sozinho no primeiro uso.
goto pronto

:sem_transcricao
echo.
echo  Tudo bem. Da para instalar depois em Configuracoes ^> Transcricao
echo  ^> Instalar transcricao (ou rodando este instalador de novo).

:pronto
echo.
echo  Pronto! Abra o Premiere e va em:
echo  Window ^> Extensions ^> CutCake - Cortes, legendas e zoom
echo.
pause
exit /b 0


rem ==================================================================
rem  sub-rotinas
rem ==================================================================

:find_python
set "PY="
py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 ( set "PY=py -3" & goto :eof )
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul
if not errorlevel 1 ( set "PY=python" & goto :eof )
rem instalado agora ha pouco: o PATH desta janela ainda nao foi atualizado
for /d %%d in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
  if exist "%%~d\python.exe" set "PY="%%~d\python.exe""
)
if defined PY goto :eof
if exist "%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" -3"
goto :eof

:install_python
echo.
echo  Instalando o Python (pode levar alguns minutos)...
where winget >nul 2>nul
if errorlevel 1 goto install_site
winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
call :find_python
if defined PY goto :eof
echo  O winget nao conseguiu instalar. Tentando pelo site oficial...

:install_site
set "PYINST=%TEMP%\python-3.12.10-amd64.exe"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -UseBasicParsing -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' -OutFile $env:PYINST"
if not exist "%PYINST%" (
  echo  Nao consegui baixar o instalador do Python. Verifique a internet.
  goto :eof
)
"%PYINST%" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 InstallLauncherAllUsers=0 Include_test=0
del "%PYINST%" >nul 2>nul
goto :eof


rem ==================================================================
rem  erros
rem ==================================================================

:falha_python
echo.
echo  Nao consegui instalar o Python automaticamente.
echo  Instale em https://www.python.org/downloads/ marcando "Add python.exe to PATH"
echo  e rode este instalador de novo. O painel ja esta instalado.
echo.
pause
exit /b 1

:erro_copia
echo  Nao consegui copiar os arquivos. Feche o Premiere e tente de novo.
pause
exit /b 1

:erro_pip
echo  Falha ao instalar as bibliotecas (verifique a internet) e rode de novo.
echo  O painel ja esta instalado; so a transcricao ficou faltando.
pause
exit /b 1

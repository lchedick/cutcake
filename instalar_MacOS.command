#!/bin/bash
# CutCake - instalacao (Mac) [BETA]
cd "$(dirname "$0")" || exit 1
clear
echo ""
echo " === CutCake - Cortes, legendas e zoom - instalacao (Mac) [beta] ==="
echo ""

fim() { echo ""; read -r -p " Pressione Enter para fechar..." _; exit "${1:-0}"; }

# ------------------------------------------------------------------
# 0) o Premiere precisa estar fechado
# ------------------------------------------------------------------
while pgrep -f "/Adobe Premiere Pro[^/]*\.app/Contents/MacOS/" >/dev/null 2>&1; do
  echo " O Premiere esta aberto. Salve o seu projeto e feche o Premiere."
  read -r -p " Depois, aperte Enter aqui..." _
done

# ------------------------------------------------------------------
# 1) copia o painel para a pasta de extensoes do Premiere
# ------------------------------------------------------------------
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/CutCake"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
if ! cp -R "CutCake" "$DEST"; then
  echo " Nao consegui copiar os arquivos. Feche o Premiere e tente de novo."
  fim 1
fi
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
echo " [ok] Painel copiado para $DEST"

# ------------------------------------------------------------------
# 2) libera paineis nao assinados (necessario para extensoes proprias)
# ------------------------------------------------------------------
for v in 9 10 11 12 13 14 15 16; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null
done
echo " [ok] Premiere configurado para carregar o painel"

# ------------------------------------------------------------------
# 3) transcricao (Whisper): so ela precisa do Python
# ------------------------------------------------------------------
find_python() {
  PY=""
  for c in /Library/Frameworks/Python.framework/Versions/3.*/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
    if [ -x "$c" ] && "$c" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" 2>/dev/null; then PY="$c"; fi
  done
  [ -n "$PY" ] && return 0
  # /usr/bin/python3 so existe de verdade se as Ferramentas de Linha de Comando estiverem instaladas
  if xcode-select -p >/dev/null 2>&1 && /usr/bin/python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" 2>/dev/null; then PY="/usr/bin/python3"; fi
  [ -n "$PY" ]
}
find_python && printf '%s\n' "$PY" > "$DEST/python_path.txt"

echo ""
echo " A transcricao (Whisper) e usada pelo Cacador de trechos e para criar"
echo " as legendas. Ela roda no seu computador, sem internet, mas o download"
echo " e grande (cerca de 1 GB). Zoom, Render e Animar funcionam sem ela."
echo ""
read -r -p " Instalar a transcricao agora? (S/N): " resp
case "$resp" in
  [sS]*) ;;
  *) echo ""; echo " Tudo bem. Da para instalar depois em Configuracoes > Transcricao."
     echo ""; echo " Pronto! Abra o Premiere e va em: Window > Extensions > CutCake - Cortes, legendas e zoom"; fim 0 ;;
esac

if ! find_python; then
  echo ""
  echo " O Python nao esta instalado neste Mac. Ele e necessario para a transcricao."
  PKG="/tmp/python-3.12.10-macos11.pkg"
  echo " Baixando o Python..."
  if ! curl -fL --progress-bar -o "$PKG" "https://www.python.org/ftp/python/3.12.10/python-3.12.10-macos11.pkg"; then
    echo " Nao consegui baixar o Python. Verifique a internet."
    fim 1
  fi
  echo ""
  echo " Instalando o Python. O Mac vai pedir a senha do computador:"
  if ! sudo installer -pkg "$PKG" -target /; then
    echo " A instalacao do Python falhou."
    fim 1
  fi
  rm -f "$PKG"
  find_python || { echo " Nao encontrei o Python depois de instalar."; fim 1; }
fi
echo " [ok] Python encontrado: $PY"
printf '%s\n' "$PY" > "$DEST/python_path.txt"

echo " Instalando as bibliotecas da transcricao..."
REQ="$DEST/engine/requirements.txt"
if ! "$PY" -m pip install --upgrade --disable-pip-version-check -r "$REQ" 2>/dev/null; then
  if ! "$PY" -m pip install --user --upgrade --disable-pip-version-check -r "$REQ"; then
    if ! "$PY" -m pip install --user --break-system-packages --upgrade --disable-pip-version-check -r "$REQ"; then
      echo " Falha ao instalar as bibliotecas (verifique a internet) e rode de novo."
      fim 1
    fi
  fi
fi
echo " [ok] Bibliotecas instaladas"

echo " Baixando o modelo do Whisper (so desta vez)..."
"$PY" "$DEST/engine/cutcake.py" download --model auto --console || echo " [aviso] O modelo nao foi baixado. O CutCake baixa sozinho no primeiro uso."

echo ""
echo " Pronto! Abra o Premiere e va em:"
echo " Window > Extensions > CutCake - Cortes, legendas e zoom"
fim 0

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
  # a transcricao (onnxruntime) so funciona do Python 3.10 ao 3.13; prefere o 3.12
  PY=""
  for v in 3.12 3.11 3.13 3.10; do
    for c in "/Library/Frameworks/Python.framework/Versions/$v/bin/python3" "/opt/homebrew/bin/python$v" "/usr/local/bin/python$v"; do
      if [ -x "$c" ] && "$c" -c "import sys" 2>/dev/null; then PY="$c"; return 0; fi
    done
  done
  ok_ver() { "$1" -c "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)" 2>/dev/null; }
  for c in /opt/homebrew/bin/python3 /usr/local/bin/python3; do
    if [ -x "$c" ] && ok_ver "$c"; then PY="$c"; return 0; fi
  done
  # /usr/bin/python3 so existe de verdade se as Ferramentas de Linha de Comando estiverem instaladas
  if xcode-select -p >/dev/null 2>&1 && ok_ver /usr/bin/python3; then PY="/usr/bin/python3"; fi
  [ -n "$PY" ]
}
find_python && printf '%s\n' "$PY" > "$DEST/python_path.txt"

echo ""
echo " O CutCake usa o Python para Sincronizar, Cacar trechos e criar legendas."
echo ""
echo "   1 = Completo: Python + transcricao (Whisper), sem internet. Cerca de 1 GB."
echo "   2 = Leve: so o Python e o basico do Sincronizar (cerca de 60 MB)."
echo "   3 = Agora nao. Zoom, Render e Animar funcionam sem o Python."
echo ""
read -r -p " Escolha 1, 2 ou 3: " resp
case "$resp" in
  1) MODO=completo ;;
  2) MODO=leve ;;
  *) echo ""; echo " Tudo bem. Para instalar depois, rode este instalador de novo."
     echo ""; echo " Pronto! Abra o Premiere e va em: Window > Extensions > CutCake - Cortes, legendas e zoom"; fim 0 ;;
esac

if ! find_python; then
  echo ""
  echo " Nao encontrei um Python compativel (3.10 a 3.13) neste Mac."
  echo " Vou instalar o Python 3.12 (o que ja existir continua funcionando)."
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

if [ "$MODO" = "leve" ]; then
  echo " Instalando o basico do Sincronizar..."
  REQ="$DEST/engine/requirements-base.txt"
else
  echo " Instalando as bibliotecas da transcricao..."
  REQ="$DEST/engine/requirements.txt"
fi
if ! "$PY" -m pip install --upgrade --disable-pip-version-check -r "$REQ" 2>/dev/null; then
  if ! "$PY" -m pip install --user --upgrade --disable-pip-version-check -r "$REQ"; then
    if ! "$PY" -m pip install --user --break-system-packages --upgrade --disable-pip-version-check -r "$REQ"; then
      echo " Falha ao instalar as bibliotecas (verifique a internet) e rode de novo."
      fim 1
    fi
  fi
fi
echo " [ok] Bibliotecas instaladas"

if [ "$MODO" != "leve" ]; then
  echo " Baixando o modelo do Whisper (so desta vez)..."
  "$PY" "$DEST/engine/cutcake.py" download --model auto --console || echo " [aviso] O modelo nao foi baixado. O CutCake baixa sozinho no primeiro uso."
fi

echo ""
echo " Pronto! Abra o Premiere e va em:"
echo " Window > Extensions > CutCake - Cortes, legendas e zoom"
fim 0

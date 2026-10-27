# CutCake • Cortes, legendas e zoom

Painel para **Adobe Premiere Pro** que transforma uma pregação longa em cortes para Instagram e Reels. Ele acha os melhores trechos, cria legendas animadas, dá zoom de ênfase e manda tudo para o Media Encoder.

Foi feito para trabalhar junto com o [GTA • Grand Tracker Auto](https://github.com/lchedick/grand-tracker-auto), que faz o reenquadramento para 9:16.

## Recursos

- **Sincronizar**: alinha câmeras e o áudio da mesa direto na timeline, sem analisar o arquivo inteiro.
  - Procura alguns trechos curtos de cada clipe (ex.: 4 × 15 s) no áudio da referência e depois faz o ajuste fino, com precisão menor que 1 quadro.
  - Quando os microfones são muito diferentes, pode comparar pela fala (Whisper).
  - Mostra um selo de confiança, avisa quando a câmera "escorrega" (drift) e tem botão de desfazer.
- **Caçar**: transcreve o áudio no próprio computador (Whisper, sem internet) e marca na timeline os trechos com mais cara de corte, como marcadores com duração e uma nota de 0 a 100%.
  - Pistas no texto: perguntas, chamadas ("presta atenção"), frases repetidas, início de história e citação de versículo.
  - Pistas no áudio: voz mais forte, pausa antes da frase e mudança de ritmo.
  - Tiram ponto: trechos que começam com "e", "mas" ou "então", avisos e partes sem fala.
  - Os cortes começam e terminam no fim de uma frase.
- **Legendar**: cria a trilha de legendas a partir da transcrição.
  - Animações: **máquina de escrever** e **subida com opacidade**.
  - Ritmo: **palavra por palavra** ou **linha por linha**.
  - Botão **Upgrade para gráfico** (o mesmo que Gráficos e Títulos → Upgrade Caption to Graphic).
- **Zoom**: zoom suave nos trechos marcados com marcadores de zoom. Mantém o assunto no lugar e funciona por cima do tracking do GTA.
- **Render**: manda cada marcador de corte para a fila do Media Encoder, com o preset, a pasta e o nome que você escolher (ex.: `18.10 - corte 3`). Avisa se o arquivo já existir.
- **Fila com progresso**, tempo estimado, cancelamento, barra no ícone do Premiere (Windows), sons e notificação ao terminar.
- **Atualização automática** pelas releases deste repositório, com notas da versão e botão para reiniciar o Premiere.

## Instalação

1. Baixe o zip da [última release](https://github.com/lchedick/cutcake/releases/latest) e descompacte.
2. Feche o Premiere e rode o instalador:
   - **Windows:** dois cliques em `instalar_Windows.bat`.
   - **Mac (beta):** botão direito em `instalar_MacOS.command` → **Abrir** → **Abrir**.
3. Escolha o que instalar: **1 = Completo** (Python + transcrição), **2 = Leve** (só o Python e o básico do Sincronizar) ou **3 = Agora não**. O instalador instala um Python compatível (3.10 a 3.13) se precisar, sem mexer no que já existe. Com placa de vídeo NVIDIA, ele também instala os componentes da placa.
4. No Premiere: **Window → Extensions → CutCake • Cortes, legendas e zoom**.

## Como usar

1. **Sincronizar**: coloque as câmeras e o áudio da mesa na timeline, selecione tudo e clique em **Sincronizar**.
1. **Caçar**: abra a sequência da pregação e clique em **Caçar trechos**. Revise os marcadores criados.
2. Monte o corte em 9:16 e trackeie com o GTA.
3. **Legendar**: clique em **Criar legendas**, selecione as legendas, clique em **Upgrade para gráfico** e, na subida, em **Animar subida**.
4. **Zoom**: marque os trechos de ênfase (In/Out + **Marcar zoom**) e clique em **Aplicar zoom**.
5. **Render**: marque os cortes (In/Out + **Marcar corte**) e clique em **Renderizar cortes**.

## Como funciona

1. O painel pergunta ao Premiere (ExtendScript, `CutCake/jsx/host.jsx`) quais clipes, marcadores e trechos usar.
2. O motor em Python (`CutCake/engine/cutcake.py`) lê só o áudio do trecho, transcreve com o **faster-whisper** e guarda a transcrição em cache.
3. O Caçador dá uma nota a cada frase e a cada janela de frases, e escolhe os melhores trechos sem sobreposição.
4. As legendas viram um arquivo SRT, que o Premiere importa como trilha de legendas.
5. O zoom cria keyframes de Scale e Position e compensa a posição para o ponto de foco ficar parado na tela.
6. O render marca In/Out em cada marcador e chama `encodeSequence` do Media Encoder.
7. O Sincronizar (`CutCake/engine/sync.py`) compara o "desenho" do volume a cada 10 ms para achar o ponto aproximado e usa GCC-PHAT no áudio de verdade para o ajuste fino. Depois move os clipes com o ExtendScript.

## Estrutura

```
CutCake/                   extensão CEP (o que vai para a pasta de extensões)
├── CSXS/manifest.xml
├── index.html             painel (interface)
├── js/main.js             painel (lógica)
├── js/icons.js            ícones usados pelo painel (gerado por tools/build_icons.py)
├── jsx/host.jsx           integração com o Premiere (ExtendScript)
├── engine/                motor em Python (transcrição, Caçador, legendas, sincronizar) + requirements
├── assets/                ícones (SVG e 2 PNGs) e sons
├── CHANGELOG.md           notas de cada versão (mostradas no painel)
└── version.json           versão usada pelo atualizador
instalar_Windows.bat       instalador Windows
instalar_MacOS.command     instalador Mac (beta)
LEIA-ME.txt                guia rápido que vai junto no zip
tests/                     testes do host.jsx com um Premiere simulado
tools/build_release.py     gera o zip da release
tools/build_icons.py       converte os SVGs exportados do Illustrator nos ícones do painel
tools/placeholder_icons/   ícones provisórios (até chegarem os definitivos)
```

## Publicar uma versão nova

Veja [RELEASE.md](RELEASE.md). O histórico de versões fica em [CutCake/CHANGELOG.md](CutCake/CHANGELOG.md).

---

CutCake | Desenvolvido por Lucas Chedick · [Licença MIT](LICENSE) · Licenças de terceiros em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

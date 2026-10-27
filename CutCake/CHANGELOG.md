# Changelog

## v1.0.2 — outubro de 2026

**Nesta versão**

- **Correção do Sincronizar com arquivos MXF** (e outros com várias trilhas de áudio): o CutCake ouvia só a primeira trilha, que em muitas câmeras é muda, e dizia "Não achei este áudio na referência". Agora ele mede todas as trilhas e usa a que tem som. A fila mostra a trilha usada (ex.: "trilha 2 de 4").
- **Caçar e Legendar** também passam a usar a trilha de áudio certa.
- **Aviso claro quando o clipe está mudo** em todas as trilhas.
- **Avisos no topo**: as mensagens de sucesso e de erro e o botão "Reiniciar o Premiere agora" agora aparecem logo abaixo do nome do plugin.
- As transcrições guardadas são refeitas uma vez, porque podiam ter sido feitas na trilha muda.

**O que o CutCake faz**

- **Sincronizar**: procura alguns trechos curtos de cada clipe no áudio da referência e faz o ajuste fino, com precisão menor que 1 quadro. Se os microfones forem muito diferentes, compara pela fala. Cada vídeo anda junto com o seu áudio, e o clipe só é movido quando o selo é bom.
- **Caçar**: transcreve a pregação no próprio computador (Whisper, sem internet) e marca os trechos com mais cara de corte como marcadores com duração, com nota de 0 a 100% e o motivo (pergunta, voz forte, história...).
- **Legendar**: cria as legendas a partir da transcrição em **máquina de escrever** ou **subida com opacidade**, palavra por palavra ou linha por linha. Tem os botões **Upgrade para gráfico** e **Animar subida**.
- **Zoom**: zoom suave nos trechos com marcadores de zoom, por cima do tracking do GTA, com intensidade, rampa e foco ajustáveis.
- **Render**: manda cada marcador de corte para a fila do Media Encoder, com o preset, a pasta e o nome escolhidos (ex.: `18.10 - corte 3`), e avisa se o arquivo já existir.
- **Fila com progresso**, tempo estimado, sons, notificação ao terminar e barra no ícone do Premiere (Windows).
- **Configurações**: modelo da transcrição, placa de vídeo, cores dos marcadores, palavras do Caçador, abas visíveis, tamanho da interface e suporte.

## v1.0.1 — outubro de 2026

**Nesta versão**

- **Nova aba Sincronizar**: alinha as câmeras e o áudio da mesa direto na timeline, pelo áudio, sem analisar o arquivo inteiro. Mostra um selo de confiança, avisa quando a câmera "escorrega" (drift) e tem botão **Desfazer**.
- **Correção do instalador**: a transcrição não instalava quando o computador tinha um Python novo demais (ex.: 3.15). Agora o instalador escolhe um Python compatível (3.10 a 3.13) e, se precisar, instala o 3.12 ao lado, sem mexer no que já existe.
- **Instalador com 3 opções**: Completo (Python + transcrição), Leve (só o Python e o básico do Sincronizar) ou Agora não.
- As Configurações avisam quando o Python não serve para a transcrição.

**O que o CutCake faz**

- **Sincronizar**: procura alguns trechos curtos de cada clipe no áudio da referência e faz o ajuste fino, com precisão menor que 1 quadro. Se os microfones forem muito diferentes, compara pela fala. Cada vídeo anda junto com o seu áudio, e o clipe só é movido quando o selo é bom.
- **Caçar**: transcreve a pregação no próprio computador (Whisper, sem internet) e marca os trechos com mais cara de corte como marcadores com duração, com nota de 0 a 100% e o motivo (pergunta, voz forte, história...).
- **Legendar**: cria as legendas a partir da transcrição em **máquina de escrever** ou **subida com opacidade**, palavra por palavra ou linha por linha. Tem os botões **Upgrade para gráfico** e **Animar subida**.
- **Zoom**: zoom suave nos trechos com marcadores de zoom, por cima do tracking do GTA, com intensidade, rampa e foco ajustáveis.
- **Render**: manda cada marcador de corte para a fila do Media Encoder, com o preset, a pasta e o nome escolhidos (ex.: `18.10 - corte 3`), e avisa se o arquivo já existir.
- **Fila com progresso**, tempo estimado, sons, notificação ao terminar e barra no ícone do Premiere (Windows).
- **Configurações**: modelo da transcrição, placa de vídeo, cores dos marcadores, palavras do Caçador, abas visíveis, tamanho da interface e suporte.

## v1.0.0 — outubro de 2026

- **Primeira versão do CutCake**, com quatro abas: Caçar, Legendar, Zoom e Render.
- **Caçador de trechos**: transcreve a pregação no próprio computador (Whisper, sem internet) e marca na timeline os trechos com mais cara de corte, como marcadores com duração e uma nota de 0 a 100%.
- **Legendas animadas**: cria as legendas a partir da transcrição em dois estilos, **máquina de escrever** e **subida com opacidade**, palavra por palavra ou linha por linha. Inclui o botão **Upgrade para gráfico**.
- **Zoom de ênfase**: dá um zoom suave nos trechos marcados com marcadores de zoom, por cima do tracking do GTA.
- **Render dos cortes**: manda cada marcador de corte para a fila do Media Encoder, com o preset, a pasta e o nome escolhidos (ex.: `18.10 - corte 3`).
- **Cores dos marcadores** de corte e de zoom nas Configurações.

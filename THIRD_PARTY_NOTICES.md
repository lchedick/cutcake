# Licenças de terceiros

O CutCake não inclui modelos dentro do repositório. Na instalação (ou no primeiro uso), ele baixa um destes modelos de transcrição para `%LOCALAPPDATA%\CutCake\models` (Windows) ou `~/Library/Application Support/CutCake/models` (Mac):

## Whisper (OpenAI), convertido para CTranslate2

- Modelo original: https://github.com/openai/whisper (MIT License)
- `Systran/faster-whisper-small` (modo Rápido): https://huggingface.co/Systran/faster-whisper-small (MIT License)
- `mobiuslabsgmbh/faster-whisper-large-v3-turbo` (modo Preciso): https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo (MIT License)

Bibliotecas usadas em tempo de execução (instaladas pelos instaladores `instalar_Windows.bat` e `instalar_MacOS.command`, ou pelo botão "Instalar transcrição"):

- faster-whisper: MIT License (https://github.com/SYSTRAN/faster-whisper)
- CTranslate2: MIT License
- PyAV: BSD 3-Clause License (inclui bibliotecas do FFmpeg, LGPL)
- NumPy: BSD 3-Clause License
- Hugging Face Hub: Apache License 2.0
- Com placa de vídeo NVIDIA: `nvidia-cublas-cu12` e `nvidia-cudnn-cu12` (NVIDIA Software License)

Os ícones de Config, Update, Queue, Ok, Fail, CancelQueue, Pause, Return e Time vêm do GTA • Grand Tracker Auto, do mesmo autor.

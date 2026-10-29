#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CutCake - motor (transcricao + Cacador de trechos + legendas).

Uso (o painel chama assim):
  python cutcake.py check                         -> JSON com versoes, placa de video e modelos baixados
  python cutcake.py download --model turbo        -> baixa o modelo do Whisper (PROGRESS 0.42 no stdout)
  python cutcake.py run --task task.json --out result.json

task.json:
  {
    "action": "hunt" | "captions" | "transcribe",
    "model": "turbo" | "small" | "auto",
    "device": "auto" | "cpu",
    "language": "pt",
    "jobs": [ {"media": "C:/video.mp4", "in": 12.0, "out": 3600.0,
               "seq_start": 0.0, "speed": 1.0, "name": "Pregacao.mp4"} ],
    "range": [0, 60],                 (opcional, em segundos da sequencia)
    "hunt": {...}, "captions": {...}  (ajustes, ver DEFAULT_HUNT e DEFAULT_CAPTIONS)
  }

Toda a analise e feita no tempo da SEQUENCIA: cada palavra transcrita (tempo do arquivo)
e convertida com seq = seq_start + (t - in) / speed.
A transcricao fica guardada em cache (por arquivo), entao rodar de novo e instantaneo.
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys
import time
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 16000          # Whisper trabalha com 16 kHz mono
EN_HOP = 0.05       # envelope de volume: um valor a cada 50 ms


CONSOLE = False   # instalador: mostra "Baixando: 42%" numa linha so, sem as linhas PROGRESS


def log(msg):
    if CONSOLE and msg.startswith("PROGRESS "):
        pct = int(float(msg.split()[1]) * 100)
        sys.stdout.write("\r  Baixando o modelo: %3d%%   " % pct)
        sys.stdout.flush()
        return
    if CONSOLE and msg.startswith("STATUS "):
        msg = "  " + msg[7:]
    print(msg, flush=True)


def fail(msg):
    sys.stderr.write("ERRO: " + msg + "\n")
    sys.stderr.flush()
    sys.exit(2)


# ---------------------------------------------------------------- pastas
def data_dir():
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~\\AppData\\Local")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    d = os.path.join(base, "CutCake")
    os.makedirs(d, exist_ok=True)
    return d


def models_dir():
    d = os.path.join(data_dir(), "models")
    os.makedirs(d, exist_ok=True)
    return d


def cache_dir():
    d = os.path.join(data_dir(), "transcripts")
    os.makedirs(d, exist_ok=True)
    return d


MODEL_REPOS = {
    "small": "Systran/faster-whisper-small",
    "turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
}
MODEL_FILES = ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"]


# ---------------------------------------------------------------- placa de video (Windows)
def add_cuda_dlls():
    """No Windows, as DLLs do CUDA instaladas pelo pip (nvidia-cublas-cu12, nvidia-cudnn-cu12)
    ficam em site-packages/nvidia/*/bin. O ctranslate2 so as encontra se estiverem no PATH."""
    if sys.platform != "win32":
        return
    import site
    roots = []
    try:
        roots += site.getsitepackages()
    except Exception:
        pass
    try:
        roots.append(site.getusersitepackages())
    except Exception:
        pass
    for r in roots:
        nv = os.path.join(r, "nvidia")
        if not os.path.isdir(nv):
            continue
        for sub in os.listdir(nv):
            b = os.path.join(nv, sub, "bin")
            if os.path.isdir(b):
                os.environ["PATH"] = b + os.pathsep + os.environ.get("PATH", "")
                try:
                    os.add_dll_directory(b)
                except Exception:
                    pass


def cuda_available():
    try:
        add_cuda_dlls()
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def gpu_name():
    try:
        import subprocess
        out = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                             capture_output=True, text=True, timeout=10,
                             creationflags=0x08000000 if sys.platform == "win32" else 0)
        return out.stdout.strip().splitlines()[0] if out.returncode == 0 and out.stdout.strip() else ""
    except Exception:
        return ""


# ---------------------------------------------------------------- modelos
def model_path(name):
    """Caminho local do modelo, ou "" se ainda nao foi baixado."""
    repo = MODEL_REPOS.get(name)
    if not repo:
        return ""
    try:
        from huggingface_hub import snapshot_download
        return snapshot_download(repo, allow_patterns=MODEL_FILES, cache_dir=models_dir(), local_files_only=True)
    except Exception:
        return ""


def download_model(name):
    repo = MODEL_REPOS.get(name)
    if not repo:
        fail("modelo desconhecido: " + name)
    from huggingface_hub import snapshot_download
    try:
        from tqdm.auto import tqdm as base_tqdm
    except Exception:
        base_tqdm = None

    if base_tqdm is not None:
        class Prog(base_tqdm):
            """Repassa o progresso do download (bytes) para o painel."""
            _tot = [0, 0]

            def __init__(self, *a, **k):
                k["disable"] = False
                k["file"] = open(os.devnull, "w")
                super().__init__(*a, **k)
                if self.unit == "B" and self.total:
                    Prog._tot[1] += self.total

            def update(self, n=1):
                super().update(n)
                if self.unit == "B" and Prog._tot[1]:
                    Prog._tot[0] += n
                    log("PROGRESS %.3f" % min(0.99, Prog._tot[0] / Prog._tot[1]))
        kw = {"tqdm_class": Prog}
    else:
        kw = {}
    try:
        p = snapshot_download(repo, allow_patterns=MODEL_FILES, cache_dir=models_dir(), **kw)
    except TypeError:
        p = snapshot_download(repo, allow_patterns=MODEL_FILES, cache_dir=models_dir())
    except Exception as e:
        fail("não consegui baixar o modelo (%s). Verifique a internet." % e)
    log("PROGRESS 1.0")
    return p


def pick_model(name, device):
    gpu = device != "cpu" and cuda_available()
    if name in (None, "", "auto"):
        name = "turbo" if gpu else "small"
    return name, gpu


_MODEL_CACHE = {}


def load_whisper(name, gpu):
    key = (name, gpu)
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]
    from faster_whisper import WhisperModel
    path = model_path(name)
    if not path:
        log("Baixando o modelo %s (só na primeira vez)..." % name)
        path = download_model(name)
    m = None
    if gpu:
        try:
            m = WhisperModel(path, device="cuda", compute_type="float16")
        except Exception as e:
            log("Placa de vídeo indisponível (%s). Usando o processador." % e)
            gpu = False
    if m is None:
        threads = max(1, (os.cpu_count() or 4) - 1)
        m = WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=threads)
    _MODEL_CACHE[key] = (m, gpu)
    return m, gpu


# ---------------------------------------------------------------- audio
def decode_audio(media, start, end):
    """Le so o trecho [start, end] (segundos do arquivo) como 16 kHz mono float32, na trilha mais alta."""
    import ccaudio
    try:
        return ccaudio.decode(media, start, end, SR, log)
    except RuntimeError as e:
        fail(str(e))


def energy_envelope(audio):
    """Volume em dB a cada 50 ms."""
    import numpy as np
    hop = int(SR * EN_HOP)
    n = len(audio) // hop
    if n <= 0:
        return []
    fr = audio[:n * hop].reshape(n, hop)
    rms = np.sqrt(np.mean(fr * fr, axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    return [round(float(v), 1) for v in db]


# ---------------------------------------------------------------- cache da transcricao
def cache_file(media, model, language):
    try:
        st = os.stat(media)
        # "a2": desde a v1.0.2 a trilha de audio escolhida e a mais alta (as transcricoes antigas sao refeitas)
        sig = "%s|%d|%d|%s|%s|a2" % (os.path.abspath(media).lower(), st.st_size, int(st.st_mtime), model, language)
    except OSError:
        sig = "%s|%s|%s" % (media, model, language)
    return os.path.join(cache_dir(), hashlib.sha1(sig.encode("utf-8")).hexdigest() + ".json")


def load_cache(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"ranges": []}


def save_cache(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    os.replace(tmp, path)


def from_cache(cache, a, b):
    """Se o trecho [a, b] ja foi transcrito, devolve (palavras, energia, inicio_da_energia)."""
    for r in cache.get("ranges", []):
        if r["start"] <= a + 0.05 and r["end"] >= b - 0.05:
            words = [w for w in r["words"] if a <= (w[1] + w[2]) / 2 <= b]
            i0 = max(0, int((a - r["start"]) / EN_HOP))
            i1 = max(i0, int((b - r["start"]) / EN_HOP))
            return words, r["energy"][i0:i1], r["start"] + i0 * EN_HOP
    return None


def transcribe_range(model, media, a, b, language, on_prog):
    """Transcreve [a, b] do arquivo. Devolve palavras [texto, inicio, fim, prob] no tempo do arquivo."""
    pad = 1.0
    s0 = max(0.0, a - pad)
    audio = decode_audio(media, s0, b + pad)
    if len(audio) < SR * 0.3:
        return [], energy_envelope(audio), s0
    total = max(1e-6, len(audio) / SR)
    segs, info = model.transcribe(
        audio, language=language or None, beam_size=5, word_timestamps=True,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False)
    words = []
    for seg in segs:
        for w in (seg.words or []):
            txt = w.word.strip()
            if not txt:
                continue
            ws, we = s0 + float(w.start), s0 + float(w.end)
            if a <= (ws + we) / 2 <= b:
                words.append([txt, round(ws, 3), round(we, 3), round(float(w.probability or 0), 3)])
        on_prog(min(0.99, float(seg.end) / total))
    return words, energy_envelope(audio), s0


def get_transcripts(task, on_prog):
    """Transcreve (ou pega do cache) cada job e devolve a lista no tempo da sequencia."""
    jobs = task.get("jobs") or []
    if not jobs:
        fail("nenhum clipe para transcrever.")
    language = task.get("language") or "pt"
    name, gpu = pick_model(task.get("model"), task.get("device") or "auto")
    rng = task.get("range")
    total = sum(max(0.1, (j["out"] - j["in"])) for j in jobs)
    done = 0.0
    model = None
    out = []
    for ji, j in enumerate(jobs):
        media, a, b = j["media"], float(j["in"]), float(j["out"])
        speed = float(j.get("speed") or 1.0) or 1.0
        seq0 = float(j.get("seq_start") or 0.0)
        if rng:  # limita ao trecho pedido (tempo da sequencia -> tempo do arquivo)
            a = max(a, float(j["in"]) + (rng[0] - seq0) * speed)
            b = min(b, float(j["in"]) + (rng[1] - seq0) * speed)
        dur = max(0.1, b - a)
        if b - a < 0.2:
            done += max(0.1, (j["out"] - j["in"]))
            continue
        cpath = cache_file(media, name, language)
        cache = load_cache(cpath)
        hit = from_cache(cache, a, b)
        if hit is None:
            if model is None:
                log("STATUS Carregando o Whisper (%s, %s)..." % (name, "placa de vídeo" if gpu else "processador"))
                model, gpu = load_whisper(name, gpu)
            log("STATUS Transcrevendo %s" % (j.get("name") or os.path.basename(media)))
            log("JOB %d" % ji)
            t0 = time.time()

            def prog(p, _d=done):
                on_prog((_d + p * dur) / total)
            words, energy, e0 = transcribe_range(model, media, a, b, language, prog)
            cache.setdefault("ranges", []).append({"start": e0, "end": e0 + len(energy) * EN_HOP,
                                                   "words": words, "energy": energy, "t": int(time.time())})
            try:
                save_cache(cpath, cache)
            except Exception as e:
                log("aviso: não consegui salvar o cache (%s)" % e)
            log("transcrito em %.1fs (%d palavras)" % (time.time() - t0, len(words)))
            hit = from_cache(cache, a, b) or (words, energy, e0)
        words, energy, e0 = hit
        conv = lambda t: seq0 + (t - float(j["in"])) / speed
        out.append({
            "job": ji,
            "words": [[w[0], round(conv(w[1]), 3), round(conv(w[2]), 3), w[3]] for w in words],
            "energy": energy, "energy_start": conv(e0), "energy_hop": EN_HOP / speed,
        })
        done += max(0.1, (j["out"] - j["in"]))
        on_prog(done / total)
    return out, name, gpu


# ---------------------------------------------------------------- texto
def norm(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]+", " ", s).strip()


DEFAULT_LISTS = {
    "chamadas": ["presta atenção", "preste atenção", "deixa eu te dizer", "deixa eu te falar", "escuta isso",
                 "escute", "olha só", "repita comigo", "repete comigo", "eu quero te dizer", "eu preciso te dizer",
                 "anota isso", "guarda isso", "grava isso", "não esquece", "entenda", "você precisa", "sabe por quê",
                 "sabe o que", "a verdade é", "o segredo", "eu te garanto", "eu te desafio", "imagine", "isso é muito importante",
                 "você sabia", "eu quero que você"],
    "historias": ["certa vez", "uma vez", "me lembro", "eu lembro", "lembro quando", "quando eu era", "aconteceu",
                  "um dia", "havia um", "tinha um", "eu estava", "meu pai", "minha mãe", "eu tinha", "conta-se",
                  "existia um", "era uma vez"],
    "conectivos": ["e", "mas", "então", "porque", "pois", "aí", "daí", "por isso", "portanto", "ou seja",
                   "também", "só que", "isso", "né"],
    "evitar": ["aviso", "avisos", "oferta", "ofertas", "dízimo", "dízimos", "inscrição", "inscrições", "pix",
               "programação", "secretaria", "estacionamento", "bem-vindos", "bem vindos", "microfone", "som"],
}

BOOKS = ("genesis exodo levitico numeros deuteronomio josue juizes rute samuel reis cronicas esdras neemias ester "
         "jo salmo salmos proverbios eclesiastes cantares isaias jeremias lamentacoes ezequiel daniel oseias joel amos "
         "obadias jonas miqueias naum habacuque sofonias ageu zacarias malaquias mateus marcos lucas joao atos romanos "
         "corintios galatas efesios filipenses colossenses tessalonicenses timoteo tito filemom hebreus tiago pedro "
         "judas apocalipse").split()
RE_VERSE = re.compile(r"\b(" + "|".join(BOOKS) + r")\s+(capitulo\s+)?\d+|\bcapitulo\s+\d+|\bversiculo\s+\d+")


def compile_list(items):
    pats = [norm(x) for x in items if norm(x)]
    if not pats:
        return None
    pats.sort(key=len, reverse=True)
    return re.compile(r"(?:^|\s)(" + "|".join(re.escape(p) for p in pats) + r")(?=\s|$)")


# ---------------------------------------------------------------- frases
def merge_words(trans):
    words = []
    for t in trans:
        words.extend(t["words"])
    words.sort(key=lambda w: w[1])
    return words


def split_sentences(words, max_gap=1.0, max_words=40):
    out, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        end = bool(re.search(r"[.?!…]$", w[0]))
        gap = nxt is not None and nxt[1] - w[2] > max_gap
        comma_cut = len(cur) >= max_words and re.search(r"[,;:]$", w[0])
        if end or gap or nxt is None or comma_cut or len(cur) >= max_words * 1.5:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def energy_at(trans, a, b):
    vals = []
    for t in trans:
        e, e0, hop = t["energy"], t["energy_start"], t["energy_hop"]
        if not e:
            continue
        i0 = int((a - e0) / hop)
        i1 = int((b - e0) / hop)
        i0, i1 = max(0, i0), min(len(e), max(i1, i0 + 1))
        if i0 < i1:
            vals.extend(e[i0:i1])
    return vals


def median(xs):
    xs = sorted(xs)
    if not xs:
        return 0.0
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


DEFAULT_HUNT = {"count": 5, "min": 30, "max": 90, "pad_in": 0.15, "pad_out": 0.35, "gap": 5, "lists": {}}


def analyse(trans, opts):
    """Da uma nota a cada frase e a cada janela de frases; escolhe os melhores trechos."""
    o = dict(DEFAULT_HUNT)
    o.update({k: v for k, v in (opts or {}).items() if v is not None})
    lists = dict(DEFAULT_LISTS)
    lists.update({k: v for k, v in (o.get("lists") or {}).items() if isinstance(v, list)})
    re_call, re_story = compile_list(lists["chamadas"]), compile_list(lists["historias"])
    re_conn, re_avoid = compile_list(lists["conectivos"]), compile_list(lists["evitar"])

    words = merge_words(trans)
    if len(words) < 10:
        fail("quase não encontrei fala neste trecho (%d palavras)." % len(words))
    sents = split_sentences(words)

    # volume de cada frase (em dB) comparado com o resto
    sdb = []
    for s in sents:
        v = energy_at(trans, s[0][1], s[-1][2])
        v = [x for x in v if x > -60]
        sdb.append(sorted(v)[int(len(v) * 0.8)] if v else None)
    known = [x for x in sdb if x is not None]
    med = median(known)
    spread = max(1.5, median([abs(x - med) for x in known]) * 1.4826) if known else 3.0
    rates = [len(s) / max(0.3, s[-1][2] - s[0][1]) for s in sents]
    rmed = median(rates)
    rspread = max(0.3, median([abs(r - rmed) for r in rates]) * 1.4826)

    info = []
    for i, s in enumerate(sents):
        text = " ".join(w[0] for w in s)
        n = norm(text)
        sc, why = 0.0, []
        if text.rstrip().endswith("?"):
            sc += 1.0; why.append("pergunta")
        if re_call and re_call.search(n):
            sc += 1.2; why.append("chamada")
        if re_story and re_story.search(n):
            sc += 0.8; why.append("história")
        if RE_VERSE.search(n):
            sc += 0.6; why.append("versículo")
        if text.rstrip().endswith("!"):
            sc += 0.5; why.append("exclamação")
        if len(s) <= 7 and len(s) >= 2:
            sc += 0.3
        prev = norm(" ".join(w[0] for w in sents[i - 1])) if i > 0 else ""
        nk = n.split()
        if prev and len(nk) >= 2:
            pk = prev.split()
            same_start = len(pk) >= 2 and pk[:2] == nk[:2]
            jac = len(set(pk) & set(nk)) / max(1, len(set(pk) | set(nk)))
            if same_start or jac >= 0.6:
                sc += 0.8; why.append("repetição")
        if sdb[i] is not None:
            z = (sdb[i] - med) / spread
            sc += 0.6 * max(-1.0, min(2.0, z))
            if z > 1.0:
                why.append("voz forte")
        pause = s[0][1] - sents[i - 1][-1][2] if i > 0 else 0
        if pause >= 1.2:
            sc += 0.6; why.append("pausa")
        elif pause >= 0.7:
            sc += 0.4; why.append("pausa")
        rz = (rates[i] - rmed) / rspread
        if abs(rz) > 1.2:
            sc += 0.3
        if re_avoid and re_avoid.search(n):
            sc -= 1.5; why.append("aviso")
        weak = bool(re_conn and re_conn.match(n))
        avoid = "aviso" in why
        info.append({"s": s[0][1], "e": s[-1][2], "score": sc, "why": why, "text": text, "weak": weak, "avoid": avoid,
                     "speech": sum(w[2] - w[1] for w in s)})

    # janelas: frases seguidas que somam entre min e max segundos
    mn, mx = float(o["min"]), float(o["max"])
    wins = []
    for a in range(len(info)):
        for b in range(a, len(info)):
            dur = info[b]["e"] - info[a]["s"]
            if dur > mx:
                break
            if dur < mn:
                continue
            seg = info[a:b + 1]
            speech = sum(x["speech"] for x in seg)
            density = speech / max(1.0, dur)
            sc = sum(x["score"] for x in seg) / math.sqrt(len(seg))
            sc += 0.5 * max(0.0, seg[0]["score"])          # comeco forte prende
            if seg[0]["weak"]:
                sc -= 1.0                                   # comeca dependendo do que veio antes
            sc -= 1.2 * sum(1 for x in seg if x["avoid"])   # avisos, ofertas... nao viram corte
            if not re.search(r"[.?!…]$", seg[-1]["text"]):
                sc -= 0.4                                   # termina no meio da ideia
            if density < 0.55:
                sc -= 2.0 * (0.55 - density) / 0.55 * 2     # muito silencio (louvor, pausa longa)
            gaps = [seg[k + 1]["s"] - seg[k]["e"] for k in range(len(seg) - 1)]
            if gaps and max(gaps) > 4:
                sc -= 1.5                                   # buraco grande no meio
            wins.append((sc, a, b))
    if not wins:
        fail("não achei trechos entre %d e %d segundos. Diminua a duração mínima." % (mn, mx))

    def pct(score):
        # nota absoluta: trecho comum fica perto de 10-20%, trecho com 2-3 sinais fortes passa de 80%
        return int(round(100.0 / (1.0 + math.exp(-(score - 2.0) / 0.8))))

    picked = []
    for sc, a, b in sorted(wins, key=lambda w: -w[0]):
        s, e = info[a]["s"], info[b]["e"]
        if any(not (e + o["gap"] <= p["s0"] or s >= p["e0"] + o["gap"]) for p in picked):
            continue
        picked.append({"s0": s, "e0": e, "a": a, "b": b, "score": sc})
        if len(picked) >= int(o["count"]):
            break
    picked.sort(key=lambda p: p["s0"])

    cuts = []
    for n, p in enumerate(picked, 1):
        a, b = p["a"], p["b"]
        prev_end = info[a - 1]["e"] if a > 0 else p["s0"] - 1
        next_start = info[b + 1]["s"] if b + 1 < len(info) else p["e0"] + 1
        start = max(p["s0"] - o["pad_in"], min(p["s0"], prev_end + 0.05))
        end = min(p["e0"] + o["pad_out"], max(p["e0"], next_start - 0.05))
        why = []
        for x in info[a:b + 1]:
            for r in x["why"]:
                if r not in why and r != "aviso":
                    why.append(r)
        cuts.append({
            "n": n, "start": round(start, 3), "end": round(end, 3), "score": round(p["score"], 3),
            "pct": max(1, min(99, pct(p["score"]))), "first": info[a]["text"][:160],
            "reasons": why[:4], "sentences": b - a + 1,
        })
    return {"cuts": cuts, "sentences": len(info), "words": len(words), "windows": len(wins)}


# ---------------------------------------------------------------- legendas
DEFAULT_CAPTIONS = {"style": "rise", "mode": "line", "words": 4, "max_chars": 24, "min_dur": 0.3,
                    "upper": False, "strip_punct": True}


def fmt_srt(t):
    t = max(0.0, t)
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def clean_word(w, strip):
    if strip:
        w = re.sub(r"[.,;:!?…]+$", "", w)
        w = re.sub(r"^[\"'“”«»(]+|[\"'“”«»)]+$", "", w)
    return w


def group_lines(words, max_words, max_chars):
    """Agrupa as palavras em linhas curtas (cabem no 9:16), quebrando em pausa e fim de frase."""
    lines, cur = [], []
    for i, w in enumerate(words):
        if cur:
            text_len = len(" ".join(x[0] for x in cur + [w]))
            gap = w[1] - cur[-1][2]
            if len(cur) >= max_words or text_len > max_chars or gap > 0.6 or re.search(r"[.?!…]$", cur[-1][0]):
                lines.append(cur)
                cur = []
        cur.append(w)
    if cur:
        lines.append(cur)
    return lines


def build_captions(trans, opts, rng=None):
    o = dict(DEFAULT_CAPTIONS)
    o.update({k: v for k, v in (opts or {}).items() if v is not None})
    words = merge_words(trans)
    if rng:
        words = [w for w in words if rng[0] - 0.01 <= (w[1] + w[2]) / 2 <= rng[1] + 0.01]
    if not words:
        fail("não encontrei fala neste trecho.")
    lines = group_lines(words, max(1, int(o["words"])), max(4, int(o["max_chars"])))
    cues = []   # (inicio, fim, texto)

    def tx(w):
        t = clean_word(w[0], o["strip_punct"])
        return t.upper() if o["upper"] else t

    for li, line in enumerate(lines):
        nxt = lines[li + 1][0][1] if li + 1 < len(lines) else line[-1][2] + 0.6
        line_end = min(nxt, line[-1][2] + 0.6)
        if o["style"] == "rise" and o["mode"] == "word":
            # uma palavra por vez (cada palavra sobe sozinha)
            for k, w in enumerate(line):
                e = line[k + 1][1] if k + 1 < len(line) else line_end
                cues.append([w[1], e, tx(w)])
        elif o["style"] == "type" and o["mode"] == "word":
            # maquina de escrever: as palavras vao se somando
            for k, w in enumerate(line):
                e = line[k + 1][1] if k + 1 < len(line) else line_end
                cues.append([w[1], e, " ".join(tx(x) for x in line[:k + 1])])
        elif o["style"] == "type":
            # maquina de escrever letra por letra, no ritmo da fala
            full, steps = "", []
            for k, w in enumerate(line):
                t = tx(w)
                prefix = full + (" " if full else "")
                d = max(0.04, w[2] - w[1])
                for c in range(1, len(t) + 1):
                    steps.append((w[1] + d * (c - 1) / len(t), prefix + t[:c]))
                full = prefix + t
            for k, (t0, text) in enumerate(steps):
                e = steps[k + 1][0] if k + 1 < len(steps) else line_end
                cues.append([t0, e, text])
        else:
            cues.append([line[0][1], line_end, " ".join(tx(w) for w in line)])

    # sem sobreposicao e sem legenda curta demais (1 quadro no minimo)
    out = []
    for c in cues:
        if out and c[0] < out[-1][1]:
            out[-1][1] = c[0]
        if c[1] - c[0] < 0.034:
            c[1] = c[0] + 0.034
        out.append(c)
    out = [c for c in out if c[2].strip()]
    srt = []
    for i, (a, b, t) in enumerate(out, 1):
        srt.append("%d\n%s --> %s\n%s\n" % (i, fmt_srt(a), fmt_srt(b), t))
    return "\n".join(srt), len(out), len(lines)


# ---------------------------------------------------------------- comandos
def cmd_check():
    res = {"python": sys.version.split()[0], "faster_whisper": "", "cuda": False, "gpu": gpu_name(),
           "models": [k for k in MODEL_REPOS if model_path(k)], "data": data_dir()}
    try:
        import faster_whisper
        res["faster_whisper"] = getattr(faster_whisper, "__version__", "?")
    except Exception as e:
        res["error"] = "faster-whisper não instalado (%s)" % e
    try:
        import av
        res["av"] = getattr(av, "__version__", "?")
    except Exception:
        res["av"] = ""
    res["cuda"] = cuda_available()
    print(json.dumps(res, ensure_ascii=False))


def run_sync(task, prog):
    try:
        import av  # noqa: F401
        import numpy  # noqa: F401
    except Exception:
        fail("falta o básico do Python para sincronizar. Rode o instalador do CutCake de novo (opção 1 ou 2).")
    import sync as syncmod
    opts = task.get("sync") or {}
    speech_factory = None
    has_whisper = True
    try:
        import faster_whisper  # noqa: F401
    except Exception:
        has_whisper = False
    if has_whisper and opts.get("speech", "auto") != "never":
        base = {"model": task.get("model"), "device": task.get("device"), "language": task.get("language") or "pt"}
        ref_words = {}

        def words_of(media, a, b):
            job = {"media": media, "in": a, "out": b, "seq_start": a, "speed": 1, "name": os.path.basename(media)}
            tr, _, _ = get_transcripts(dict(base, jobs=[job]), lambda p: None)
            return tr[0]["words"] if tr else []

        def speech_factory(ref, item):
            def speech(a, b):
                if "w" not in ref_words:
                    log("STATUS O som não bateu: comparando pela fala (transcrevendo a referência)...")
                    dur = syncmod.media_duration(ref["media"])
                    ref_words["w"] = words_of(ref["media"], 0.0, dur)
                seg = words_of(item["media"], a, b)
                return syncmod.speech_lag(ref_words["w"], seg)
            return speech
    try:
        res = syncmod.run(task, cache_dir(), prog, log, speech_factory)
    except RuntimeError as e:
        fail(str(e))
    res["whisper"] = has_whisper
    return res


def cmd_run(task_path, out_path):
    with open(task_path, "r", encoding="utf-8") as fh:
        task = json.load(fh)
    action = task.get("action")
    if action not in ("hunt", "captions", "transcribe", "sync", "takes"):
        fail("ação desconhecida: %s" % action)
    t0 = time.time()
    last = [0.0]

    def prog(p):
        p = max(last[0], min(0.97, p * 0.95))
        last[0] = p
        log("PROGRESS %.3f" % p)

    if action == "sync":
        res = run_sync(task, prog)
        log("PROGRESS 1.0")
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(res, fh, ensure_ascii=False)
        return

    try:
        import faster_whisper  # noqa: F401
    except Exception:
        fail("a transcrição não está instalada. Use \"Instalar transcrição\" nas Configurações.")
    trans, model, gpu = get_transcripts(task, prog)
    res = {"model": model, "gpu": gpu, "transcribe_time": round(time.time() - t0, 1)}
    if action == "hunt":
        log("STATUS Procurando os melhores trechos...")
        res.update(analyse(trans, task.get("hunt")))
    elif action == "takes":
        import takes as takesmod
        log("STATUS Procurando os takes...")
        try:
            res.update(takesmod.analyse(trans, task.get("jobs") or [], task.get("takes")))
        except RuntimeError as e:
            fail(str(e))
    elif action == "captions":
        srt, n, nl = build_captions(trans, task.get("captions"), task.get("range"))
        srt_path = task.get("srt") or os.path.splitext(out_path)[0] + ".srt"
        with open(srt_path, "w", encoding="utf-8-sig") as fh:
            fh.write(srt)
        res.update({"srt": srt_path, "cues": n, "lines": nl})
    else:
        res["transcripts"] = trans
    log("PROGRESS 1.0")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("check")
    d = sub.add_parser("download")
    d.add_argument("--model", default="auto")
    d.add_argument("--console", action="store_true")
    r = sub.add_parser("run")
    r.add_argument("--task", required=True)
    r.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.cmd == "check":
        cmd_check()
    elif a.cmd == "download":
        global CONSOLE
        CONSOLE = a.console
        name = a.model
        if name == "auto":
            name = "turbo" if (cuda_available() or gpu_name()) else "small"
        log("STATUS Baixando o modelo %s..." % name)
        p = download_model(name)
        if CONSOLE:
            print("\n  [ok] Modelo pronto: %s" % name)
        else:
            print(json.dumps({"model": name, "path": p}))
    elif a.cmd == "run":
        cmd_run(a.task, a.out)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()

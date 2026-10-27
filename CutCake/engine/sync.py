# -*- coding: utf-8 -*-
"""
CutCake - Sincronizar: alinha clipes pelo audio, sem analisar o arquivo inteiro.

1. Ponto aproximado: alguns trechos curtos de cada clipe (ex.: 4 x 15 s) sao procurados no
   audio da referencia pelo "desenho" do som (volume a cada 10 ms). Se o som nao bater
   (microfones muito diferentes), da para usar a fala (palavras do Whisper).
2. Ajuste fino: GCC-PHAT no audio de verdade (8 kHz), numa janela de +-0,5 s em volta do
   ponto aproximado. Precisao bem menor que 1 quadro.
Cada trecho da um "lag" (quanto o clipe esta adiantado/atrasado). Se os trechos concordam,
o selo e alto. A inclinacao dos lags ao longo do clipe mostra o drift.

Tempos em segundos. "lag" = tempo na referencia - tempo no clipe (os dois no tempo do arquivo).
"""
import hashlib
import os

import numpy as np

SR = 8000
HOP = 80                 # 10 ms a 8 kHz
HOP_S = HOP / float(SR)
FINE_WIN = 0.5           # ajuste fino: +-0,5 s em volta do ponto aproximado


# ---------------------------------------------------------------- audio
import ccaudio

LOG = [print]


def media_duration(media):
    cont, st, dur = ccaudio.stream_for_envelope(media, LOG[0])
    cont.close()
    return dur


def decode(media, start, end):
    """Trecho [start, end] (segundos do arquivo) em 8 kHz mono, na trilha de audio mais alta."""
    x = ccaudio.decode(media, start, end, SR, LOG[0])
    return x if x is not None else np.zeros(0, np.float32)


def _feature(env):
    """log-energia sem o nivel medio (assim microfones com volumes diferentes se parecem)."""
    env = np.asarray(env, dtype=np.float32)
    if len(env) < 3:
        return env
    k = 100  # 1 s
    pad = np.pad(env, (k // 2, k // 2), mode="edge")
    c = np.cumsum(np.concatenate([[0.0], pad]))
    mov = (c[k:] - c[:-k]) / k
    f = env - mov[:len(env)]
    return np.clip(f, -3.0, 3.0)


def envelope(x):
    """Log-energia a cada 10 ms (com pre-enfase, que tira o grave/ronco)."""
    if len(x) < HOP:
        return np.zeros(0, np.float32)
    y = np.empty_like(x)
    y[0] = x[0]
    y[1:] = x[1:] - 0.97 * x[:-1]
    n = len(y) // HOP
    fr = y[:n * HOP].reshape(n, HOP)
    return np.log10(np.mean(fr * fr, axis=1) + 1e-9).astype(np.float32)


def ref_envelope(media, cache_dir, on_prog=None):
    """Envelope do arquivo inteiro da referencia, lido em partes (pouca memoria) e guardado em cache."""
    try:
        st = os.stat(media)
        sig = "%s|%d|%d|env8k|t%d" % (os.path.abspath(media).lower(), st.st_size, int(st.st_mtime), ccaudio.pick_stream(media, LOG[0]))
    except OSError:
        sig = media + "|env8k"
    cpath = os.path.join(cache_dir, "env_" + hashlib.sha1(sig.encode("utf-8")).hexdigest() + ".npy")
    if os.path.exists(cpath):
        try:
            return np.load(cpath)
        except Exception:
            pass
    import av
    cont, stream, dur = ccaudio.stream_for_envelope(media, LOG[0])
    dur = max(1.0, dur)
    res = av.AudioResampler(format="flt", layout="mono", rate=SR)
    out, buf, prev, n = [], np.zeros(0, np.float32), 0.0, 0
    try:
        for frame in cont.decode(stream):
            for f in res.resample(frame) or []:
                buf = np.concatenate([buf, f.to_ndarray().reshape(-1).astype(np.float32)])
            if len(buf) >= SR * 10:
                m = (len(buf) // HOP) * HOP
                seg = buf[:m]
                y = np.empty_like(seg)
                y[0] = seg[0] - 0.97 * prev
                y[1:] = seg[1:] - 0.97 * seg[:-1]
                prev = float(seg[-1])
                fr = y.reshape(-1, HOP)
                out.append(np.log10(np.mean(fr * fr, axis=1) + 1e-9).astype(np.float32))
                buf = buf[m:]
                n += m
                if on_prog:
                    on_prog(min(1.0, n / float(SR) / dur))
    finally:
        cont.close()
    if len(buf) >= HOP:
        out.append(envelope(buf))
    env = np.concatenate(out) if out else np.zeros(0, np.float32)
    try:
        np.save(cpath, env)
    except Exception:
        pass
    return env


# ---------------------------------------------------------------- correlacao
def _ncc(ref_f, seg_f):
    """Correlacao normalizada do trecho contra toda a referencia (FFT). Devolve a curva por lag."""
    n, m = len(ref_f), len(seg_f)
    if m < 50 or n < m:
        return None
    s = seg_f - seg_f.mean()
    sn = np.sqrt(np.sum(s * s)) + 1e-9
    L = 1
    while L < n + m:
        L *= 2
    corr = np.fft.irfft(np.fft.rfft(ref_f, L) * np.conj(np.fft.rfft(s, L)), L)[:n - m + 1]
    c1 = np.cumsum(np.concatenate([[0.0], ref_f]))
    c2 = np.cumsum(np.concatenate([[0.0], ref_f * ref_f]))
    ssum = c1[m:] - c1[:-m]
    ssq = c2[m:] - c2[:-m]
    var = np.maximum(ssq - ssum * ssum / m, 1e-9)
    return corr / (np.sqrt(var) * sn)


def _peak(curve, guard):
    i = int(np.argmax(curve))
    best = float(curve[i])
    mask = np.ones(len(curve), bool)
    mask[max(0, i - guard):i + guard + 1] = False
    second = float(curve[mask].max()) if mask.any() else 0.0
    return i, best, best / max(1e-3, second)


def gcc_phat(ref_win, seg):
    """Onde o trecho 'seg' comeca dentro de 'ref_win' (em amostras, com fracao)."""
    n = len(ref_win) + len(seg)
    L = 1
    while L < n:
        L *= 2
    X = np.fft.rfft(ref_win, L)
    Y = np.fft.rfft(seg, L)
    R = X * np.conj(Y)
    R /= np.abs(R) + 1e-12
    cc = np.fft.irfft(R, L)
    span = len(ref_win) - len(seg)
    if span <= 0:
        return None, 0.0
    c = cc[:span + 1]
    k = int(np.argmax(c))
    # interpolacao parabolica (precisao abaixo de 1 amostra)
    frac = 0.0
    if 0 < k < len(c) - 1:
        a, b, d = c[k - 1], c[k], c[k + 1]
        den = a - 2 * b + d
        if abs(den) > 1e-12:
            frac = 0.5 * (a - d) / den
    rest = np.delete(c, range(max(0, k - 40), min(len(c), k + 41)))
    q = float(c[k]) / max(1e-6, float(np.abs(rest).max()) if len(rest) else 1e-6)
    return k + frac, q


def xcorr(ref_win, seg):
    """Correlacao comum (confere o GCC-PHAT)."""
    span = len(ref_win) - len(seg)
    if span <= 0:
        return None
    n = len(ref_win) + len(seg)
    L = 1
    while L < n:
        L *= 2
    cc = np.fft.irfft(np.fft.rfft(ref_win, L) * np.conj(np.fft.rfft(seg, L)), L)[:span + 1]
    return int(np.argmax(cc))


# ---------------------------------------------------------------- fala (Whisper)
def _norm_words(words):
    import re
    import unicodedata
    out = []
    for w in words:
        t = unicodedata.normalize("NFD", w[0].lower())
        t = "".join(c for c in t if unicodedata.category(c) != "Mn")
        t = re.sub(r"[^a-z0-9]+", "", t)
        if t:
            out.append((t, (w[1] + w[2]) / 2.0))
    return out


def speech_lag(ref_words, seg_words):
    """Lag pela fala: trincas de palavras iguais nos dois lados votam num deslocamento."""
    r, s = _norm_words(ref_words), _norm_words(seg_words)
    if len(s) < 4 or len(r) < 4:
        return None
    idx = {}
    for i in range(len(r) - 2):
        idx.setdefault((r[i][0], r[i + 1][0], r[i + 2][0]), []).append(r[i][1])
    votes = []
    for i in range(len(s) - 2):
        for t in idx.get((s[i][0], s[i + 1][0], s[i + 2][0]), []):
            votes.append(t - s[i][1])
    if len(votes) < 2:
        return None
    votes = np.array(votes)
    best, cnt = None, 0
    for v in votes:
        c = int(np.sum(np.abs(votes - v) < 0.3))
        if c > cnt:
            best, cnt = v, c
    if cnt < 2:
        return None
    return float(np.median(votes[np.abs(votes - best) < 0.3])), cnt


# ---------------------------------------------------------------- um clipe
def sync_item(ref, item, ref_env_f, ref_dur, opts, speech=None, log=print):
    """ref/item: {media, in, out, seq_start, speed}. Devolve o resultado desse clipe."""
    seg_len = float(opts.get("seg", 15))
    npts = int(opts.get("points", 4))
    a, b = float(item["in"]), float(item["out"])
    if b - a < 3:
        a, b = 0.0, media_duration(item["media"])
    seg_len = min(seg_len, max(3.0, (b - a) / max(1, npts)))
    if b - a <= seg_len:
        starts = [a]
    else:
        starts = list(np.linspace(a + 0.02 * (b - a), b - seg_len - 0.02 * (b - a), npts))
    pts = []
    for s0 in starts:
        x = decode(item["media"], s0, s0 + seg_len)
        if len(x) < SR * 2 or float(np.sqrt(np.mean(x * x))) < 1e-4:
            pts.append({"pos": s0, "ok": False, "why": "silêncio"})
            continue
        curve = _ncc(ref_env_f, _feature(envelope(x)))
        if curve is None:
            pts.append({"pos": s0, "ok": False, "why": "curto"})
            continue
        i, best, ratio = _peak(curve, int(0.5 / HOP_S))
        pts.append({"pos": s0, "coarse": i * HOP_S - s0, "score": best, "ratio": ratio, "x": x, "ok": best > 0.25 and ratio > 1.25})

    method = "som"
    good = [p for p in pts if p["ok"]]
    weak = len(good) < max(2, (len(pts) + 1) // 2)
    if (weak or opts.get("speech") == "always") and speech is not None and opts.get("speech", "auto") != "never":
        # o som nao bateu: tenta pela fala
        method = "fala"
        for p in pts:
            if "x" not in p:
                p["x"] = decode(item["media"], p["pos"], p["pos"] + seg_len)
            r = speech(p["pos"], p["pos"] + seg_len)
            if r:
                p["coarse"], p["ok"], p["ratio"] = r[0], True, 1.0 + r[1] / 4.0
            else:
                p["ok"] = False
        good = [p for p in pts if p["ok"]]
    if not good:
        mudo = all(p.get("why") == "silêncio" for p in pts)
        msg = ("O áudio deste clipe parece mudo. " + (ccaudio.info(item["media"]) or "")).strip() if mudo \
            else "Não achei este áudio na referência."
        return {"ok": False, "msg": msg, "method": method,
                "points": [{"pos": round(p["pos"], 2), "ok": False} for p in pts]}

    # ajuste fino em cada ponto
    for p in good:
        ref_t0 = p["pos"] + p["coarse"] - FINE_WIN
        rw = decode(ref["media"], max(0.0, ref_t0), ref_t0 + seg_len + 2 * FINE_WIN)
        if ref_t0 < 0:
            rw = np.concatenate([np.zeros(int(round(-ref_t0 * SR)), np.float32), rw])
        k, q = gcc_phat(rw, p["x"])
        k2 = xcorr(rw, p["x"])
        # aceita o GCC-PHAT se o pico for claro ou se a correlacao comum concordar (+-3 ms)
        if k is not None and (q > 1.2 or (k2 is not None and abs(k - k2) < 0.003 * SR)):
            p["lag"] = ref_t0 + k / SR - p["pos"]
            p["q"] = max(q, 1.2)
        else:
            p["lag"] = p["coarse"]
            p["q"] = 0.0
    lags = np.array([p["lag"] for p in good])
    pos = np.array([p["pos"] + seg_len / 2 for p in good])
    med = float(np.median(lags))
    agree = [p for p in good if abs(p["lag"] - med) < 0.04 or (len(good) > 2 and abs(p["lag"] - med) < 0.2)]
    # drift: inclinacao dos lags ao longo do clipe (so com os pontos que concordam)
    slope = 0.0
    if len(agree) >= 3:
        pa = np.array([p["pos"] + seg_len / 2 for p in agree])
        la = np.array([p["lag"] for p in agree])
        if pa.max() - pa.min() > 30:
            slope = float(np.polyfit(pa, la, 1)[0])
    mid = (float(item["in"]) + float(item["out"])) / 2.0
    if agree:
        pa = np.array([p["pos"] + seg_len / 2 for p in agree])
        la = np.array([p["lag"] for p in agree])
        lag = float(np.median(la - slope * (pa - mid)))
    else:
        lag = med
    fine = [p for p in agree if p.get("q", 0) > 0]
    conf = len(agree) / float(len(pts))
    quality = min(1.0, max(0.3, (np.mean([p["ratio"] for p in good]) - 1.0) / 1.0))
    if not fine:
        quality *= 0.7
    pct = int(round(100 * conf * quality))
    # novo inicio na timeline: o mesmo som cai no mesmo tempo da sequencia
    new_start = float(item["in"]) - float(ref["in"]) + float(ref["seq_start"]) + lag
    drift_frames = abs(slope) * (float(item["out"]) - float(item["in"])) * 30.0
    return {
        "ok": True, "lag": round(lag, 4), "delta": round(new_start - float(item["seq_start"]), 4),
        "new_start": round(new_start, 4), "pct": max(1, min(100, pct)), "method": method,
        "agree": len(agree), "total": len(pts), "drift": slope, "drift_frames": round(drift_frames, 1),
        "points": [{"pos": round(p["pos"], 2), "lag": round(p.get("lag", p.get("coarse", 0)), 4) if p.get("ok") else None,
                    "ok": bool(p.get("ok"))} for p in pts],
    }


def run(task, cache_dir, on_prog, log, speech_factory=None):
    LOG[0] = log
    ref = task["ref"]
    items = task["items"]
    opts = task.get("sync") or {}
    for c in [ref] + items:
        if abs(float(c.get("speed") or 1) - 1) > 1e-3:
            raise RuntimeError("clipe com velocidade alterada (%s). Volte para 100%% para sincronizar." % c.get("name"))
    log("STATUS Lendo o áudio da referência...")
    env = ref_envelope(ref["media"], cache_dir, lambda p: on_prog(0.4 * p))
    if len(env) < 200:
        raise RuntimeError("a referência quase não tem áudio.")
    ref_f = _feature(env)
    ref_dur = len(env) * HOP_S
    out = []
    for i, it in enumerate(items):
        log("JOB %d" % i)
        log("STATUS Procurando %s na referência..." % it.get("name", ""))
        speech = speech_factory(ref, it) if speech_factory else None
        try:
            r = sync_item(ref, it, ref_f, ref_dur, opts, speech, log)
        except RuntimeError as e:
            r = {"ok": False, "msg": str(e)}
        r["key"] = it.get("key")
        r["name"] = it.get("name")
        r["track"] = ccaudio.short(it["media"])
        out.append(r)
        on_prog(0.4 + 0.6 * (i + 1) / max(1, len(items)))
    return {"results": out}

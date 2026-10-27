# -*- coding: utf-8 -*-
"""
CutCake - leitura de audio (usada pela transcricao e pelo Sincronizar).

Cuidados com arquivos de camera (MXF, MOV, MP4 com varias trilhas):
- muitas cameras gravam 2 a 8 trilhas de audio mono, e a primeira pode estar muda.
  Aqui escolhemos a trilha mais alta (amostrando alguns pontos do arquivo) e guardamos
  a escolha, para todas as leituras do mesmo arquivo usarem a mesma trilha;
- o tempo zero e o inicio da trilha (start_time da trilha, nao do arquivo);
- se o "seek" cair depois do ponto pedido (acontece em alguns MXF), le desde o comeco.
"""
import os

import numpy as np

_PICK = {}     # arquivo -> indice da trilha escolhida
_INFO = {}     # arquivo -> texto para o log
_SHORT = {}    # arquivo -> "trilha 2 de 4"


def _streams(cont):
    return [s for s in cont.streams if s.type == "audio"]


def _base(cont, stream):
    try:
        if stream.start_time is not None and stream.time_base:
            return float(stream.start_time * stream.time_base)
    except Exception:
        pass
    return float(cont.start_time) / 1e6 if cont.start_time else 0.0


def _duration(cont, stream):
    try:
        if stream.duration and stream.time_base:
            return float(stream.duration * stream.time_base)
    except Exception:
        pass
    return float(cont.duration) / 1e6 if cont.duration else 0.0


def _open(media):
    import av
    try:
        return av.open(media)
    except Exception as e:
        raise RuntimeError("não consegui abrir o arquivo: %s (%s)" % (os.path.basename(media), e))


def _read(cont, stream, start, end, sr, seek=True):
    """Le [start, end] (segundos a partir do inicio da trilha) como mono float32 em sr Hz."""
    import av
    base = _base(cont, stream)
    if seek and start > 1:
        try:
            cont.seek(int((start + base - 1) / stream.time_base), stream=stream, any_frame=False, backward=True)
        except Exception:
            try:
                cont.seek(int((start + base - 1) * 1e6), any_frame=False, backward=True)
            except Exception:
                pass
    res = av.AudioResampler(format="flt", layout="mono", rate=sr)
    chunks, first_t = [], None
    for frame in cont.decode(stream):
        if frame.pts is None:
            continue
        t = float(frame.pts * frame.time_base) - base
        if first_t is None:
            first_t = t
            if seek and t > start + 1.0:
                return None          # o seek passou do ponto: quem chamou le de novo sem seek
        if end is not None and t > end + 0.5:
            break
        if end is not None and t + frame.samples / float(frame.sample_rate or sr) < start - 1.0:
            continue                 # ainda antes do trecho (leitura sem seek)
        for f in res.resample(frame) or []:
            chunks.append((t, f.to_ndarray().reshape(-1)))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    t0 = chunks[0][0]
    a = np.concatenate([c[1] for c in chunks]).astype(np.float32)
    i0 = int(round((start - t0) * sr))
    if i0 < 0:                       # comeco antes do primeiro audio: completa com silencio
        a = np.concatenate([np.zeros(-i0, np.float32), a])
        i0 = 0
    if end is None:
        return a[i0:]
    return a[i0:i0 + int(round((end - start) * sr))]


def pick_stream(media, log=None):
    """Indice da trilha de audio a usar (a mais alta)."""
    if media in _PICK:
        return _PICK[media]
    cont = _open(media)
    try:
        aud = _streams(cont)
        idxs = [x.index for x in aud]
        if not aud:
            raise RuntimeError("o arquivo não tem áudio: " + os.path.basename(media))
        if len(aud) == 1:
            _PICK[media] = aud[0].index
            _INFO[media] = "1 trilha de áudio"
            return aud[0].index
        dur = _duration(cont, aud[0]) or 60.0
    finally:
        cont.close()
    levels = []
    for si in idxs:
        tot, n = 0.0, 0
        for frac in (0.2, 0.5, 0.8):
            t = max(0.0, dur * frac - 4)
            c = _open(media)
            try:
                x = _read(c, c.streams[si], t, t + 8, 8000)
                if x is None:
                    c.close()
                    c = _open(media)
                    x = _read(c, c.streams[si], t, t + 8, 8000, seek=False)
            except Exception:
                x = np.zeros(0, np.float32)
            finally:
                c.close()
            if len(x):
                tot += float(np.mean(x * x))
                n += 1
        levels.append((10 * np.log10(tot / max(1, n) + 1e-12), si))
    best = max(levels)[1]
    desc = ", ".join("trilha %d: %s" % (k + 1, "muda" if db < -80 else "%.0f dB" % db) for k, (db, i) in enumerate(levels))
    _PICK[media] = best
    _INFO[media] = "%d trilhas de áudio (%s) → usando a trilha %d" % (len(idxs), desc, idxs.index(best) + 1)
    _SHORT[media] = "trilha %d de %d" % (idxs.index(best) + 1, len(idxs))
    if log:
        log("Áudio de %s: %s" % (os.path.basename(media), _INFO[media]))
    return best


def info(media):
    return _INFO.get(media, "")


def short(media):
    return _SHORT.get(media, "")


def decode(media, start, end, sr, log=None):
    """Trecho [start, end] do arquivo (segundos), mono, sr Hz, na trilha mais alta."""
    idx = pick_stream(media, log)
    cont = _open(media)
    try:
        x = _read(cont, cont.streams[idx], start, end, sr, seek=True)
    finally:
        cont.close()
    if x is None:
        cont = _open(media)
        try:
            x = _read(cont, cont.streams[idx], start, end, sr, seek=False)
        finally:
            cont.close()
    return x


def stream_for_envelope(media, log=None):
    """(container, trilha, duracao) para ler o arquivo inteiro em partes."""
    idx = pick_stream(media, log)
    cont = _open(media)
    st = cont.streams[idx]
    return cont, st, _duration(cont, st)

# -*- coding: utf-8 -*-
"""
CutCake - Takes (avisos gravados varias vezes).

O pessoal grava, erra, faz uma pausa e grava de novo. Quando acerta, fala um gatilho
("esse foi", "ficou bom"...). O take bom e o ultimo bloco de fala antes do gatilho.

Regras:
- blocos de fala sao separados por pausas de pelo menos `pause` segundos (padrao 2 s);
- o gatilho so vale com silencio antes e depois (padrao 1 s; o fim do clipe tambem conta),
  para "esse foi um culto abencoado" no meio do aviso nao virar gatilho;
- gatilho "antes do take" (ex.: "acao"): o take e o bloco de fala logo depois dele;
- as bordas do take vem do volume do audio (onde a voz comeca e termina), com uma margem.

Entrada: a lista de transcricoes de get_transcripts (tempo da sequencia), uma por clipe.
"""
import re
import unicodedata

DEFAULT_AFTER = ["esse foi", "esse ficou bom", "ficou bom", "foi esse", "esse valeu"]
DEFAULT_OPTS = {"pause": 2.0, "silence": 1.0, "pad_in": 0.15, "pad_out": 0.35,
                "after": None, "before": [], "min_words": 3, "min_len": 1.5}
SIL_TOL = 0.25      # o Whisper costuma esticar o fim da ultima palavra para dentro do silencio


def norm(s):
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]+", " ", s).strip()


def _phrases(items):
    out = []
    for x in items or []:
        p = norm(x).split()
        if p:
            out.append(p)
    out.sort(key=len, reverse=True)      # a frase mais comprida primeiro ("esse ficou bom" antes de "ficou bom")
    return out


def find_triggers(words, phrases):
    """Ocorrencias [(i0, i1, frase)] das frases nas palavras (indices inclusivos)."""
    toks = [norm(w[0]) for w in words]
    hits, used = [], set()
    for ph in phrases:
        n = len(ph)
        for i in range(len(toks) - n + 1):
            if any(k in used for k in range(i, i + n)):
                continue
            # uma palavra do Whisper pode vir com mais de um token ("esse,foi")
            if [t for t in " ".join(toks[i:i + n]).split()] == ph:
                hits.append((i, i + n - 1, " ".join(ph)))
                used.update(range(i, i + n))
    hits.sort()
    return hits


def activity(energy, hop):
    """Mascara de fala pelo volume (True = tem voz), com buracos curtos preenchidos."""
    if not energy:
        return []
    xs = sorted(energy)
    floor = xs[int(len(xs) * 0.10)]
    loud = xs[min(len(xs) - 1, int(len(xs) * 0.95))]
    thr = floor + max(6.0, 0.25 * (loud - floor))
    act = [v > thr for v in energy]
    fill = max(1, int(round(0.2 / hop)))
    i, n = 0, len(act)
    while i < n:                                  # preenche silencios curtos dentro da fala
        if not act[i]:
            j = i
            while j < n and not act[j]:
                j += 1
            if 0 < i and j < n and j - i <= fill:
                for k in range(i, j):
                    act[k] = True
            i = j
        else:
            i += 1
    return act


class Clip(object):
    def __init__(self, tr, seq_start, seq_end):
        self.words = sorted(tr["words"], key=lambda w: w[1])
        self.e0 = tr.get("energy_start", seq_start)
        self.hop = tr.get("energy_hop", 0.05) or 0.05
        self.act = activity(tr.get("energy") or [], self.hop)
        self.start, self.end = seq_start, seq_end

    def idx(self, t):
        return int((t - self.e0) / self.hop)

    def voice_start(self, t, look=0.6, low=None):
        """Recua do inicio da palavra ate onde a voz comeca de fato (no maximo `look` s)."""
        if not self.act:
            return t
        i = self.idx(t)
        lim = self.idx(max(t - look, low if low is not None else t - look))
        i = min(max(i, 0), len(self.act) - 1)
        best = i
        while i - 1 >= max(0, lim) and self.act[i - 1]:
            i -= 1
            best = i
        return self.e0 + best * self.hop

    def voice_end(self, w_start, w_end, limit):
        """Fim da voz da ultima palavra (o Whisper estica o fim da palavra para dentro do silencio)."""
        if not self.act:
            return min(w_end, limit)
        a, b = self.idx(w_start), self.idx(min(w_end + 0.6, limit))
        a, b = max(0, a), min(len(self.act) - 1, b)
        last = None
        for k in range(a, b + 1):
            if self.act[k]:
                last = k
            elif last is not None and (k - last) * self.hop > 0.35:
                break                             # a voz parou: nao emenda com ruido depois
        if last is None:
            return min(w_end, limit)
        return min(limit, max(self.e0 + (last + 1) * self.hop, w_start + 0.1))


def blocks_back(words, i_end, pause, stop_t):
    """Blocos de fala terminando em words[i_end], andando para tras: [(i0, i1), ...]."""
    out = []
    i = i_end
    while i >= 0 and words[i][2] > stop_t:
        j = i
        while j - 1 >= 0 and words[j - 1][2] > stop_t and words[j][1] - words[j - 1][2] < pause - 0.2:
            j -= 1
        out.append((j, i))
        i = j - 1
    return out


def blocks_fwd(words, i_start, pause, stop_t):
    out = []
    i = i_start
    while i < len(words) and words[i][1] < stop_t:
        j = i
        while j + 1 < len(words) and words[j + 1][1] < stop_t and words[j + 1][1] - words[j][2] < pause - 0.2:
            j += 1
        out.append((i, j))
        i = j + 1
    return out


def text_of(words, i0, i1):
    return " ".join(w[0] for w in words[i0:i1 + 1]).strip()


def short(t, n=8, tail=False):
    p = t.split()
    if len(p) <= n:
        return t
    return ("… " + " ".join(p[-n:])) if tail else (" ".join(p[:n]) + " …")


def analyse_clip(c, o, after, before):
    words = c.words
    res, ignored = [], []
    trig = [(a, b, ph, "after") for a, b, ph in find_triggers(words, after)] + \
           [(a, b, ph, "before") for a, b, ph in find_triggers(words, before)]
    trig.sort()
    sil = float(o["silence"])
    valid = []
    for a, b, ph, kind in trig:
        ts, te = words[a][1], words[b][2]
        gap_b = ts - words[a - 1][2] if a > 0 else ts - c.start
        gap_a = words[b + 1][1] - te if b + 1 < len(words) else c.end - te
        ok_b = a == 0 or gap_b >= sil - SIL_TOL
        ok_a = b + 1 >= len(words) or gap_a >= sil - SIL_TOL
        if ok_b and ok_a:
            valid.append((a, b, ph, kind, ts, te))
        else:
            ignored.append({"trigger": ph, "t": round(ts, 3),
                            "why": "sem pausa antes" if not ok_b else "sem pausa depois"})
    pause = float(o["pause"])
    for k, (a, b, ph, kind, ts, te) in enumerate(valid):
        prev_end = valid[k - 1][5] if k else c.start - 1
        next_start = valid[k + 1][4] if k + 1 < len(valid) else c.end + 1
        if kind == "after":
            if a == 0:
                ignored.append({"trigger": ph, "t": round(ts, 3), "why": "não tem fala antes"})
                continue
            bl = blocks_back(words, a - 1, pause, prev_end)
            # pula blocos minusculos ("ok", "pronto") entre o take e o gatilho
            pick = None
            for n, (i0, i1) in enumerate(bl[:3]):
                if i1 - i0 + 1 >= o["min_words"] or words[i1][2] - words[i0][1] >= o["min_len"]:
                    pick = (i0, i1)
                    break
            if pick is None and bl:
                pick = bl[0]
            if pick is None:
                ignored.append({"trigger": ph, "t": round(ts, 3), "why": "não tem fala antes"})
                continue
            i0, i1 = pick
            low = max(prev_end, c.start)
            hi = min(ts - 0.15, c.end)
        else:
            if b + 1 >= len(words):
                ignored.append({"trigger": ph, "t": round(ts, 3), "why": "não tem fala depois"})
                continue
            bl = blocks_fwd(words, b + 1, pause, next_start)
            if not bl:
                ignored.append({"trigger": ph, "t": round(ts, 3), "why": "não tem fala depois"})
                continue
            i0, i1 = bl[0]
            low = max(te + 0.1, c.start)
            hi = min(next_start - 0.15, c.end)
        s = c.voice_start(words[i0][1], low=low)
        e = c.voice_end(words[i1][1], words[i1][2], hi)
        s = max(low, s - float(o["pad_in"]))
        e = min(hi, e + float(o["pad_out"]))
        if e - s < 0.3:
            ignored.append({"trigger": ph, "t": round(ts, 3), "why": "take curto demais"})
            continue
        txt = text_of(words, i0, i1)
        res.append({"start": round(s, 3), "end": round(e, 3), "trigger": ph, "trigger_t": round(ts, 3),
                    "kind": kind, "text": txt, "first": short(txt), "last": short(txt, 6, True),
                    "words": i1 - i0 + 1})
    return res, ignored


def overlap(a, b):
    inter = min(a["end"], b["end"]) - max(a["start"], b["start"])
    return inter / max(1e-6, min(a["end"] - a["start"], b["end"] - b["start"]))


def analyse(trans, jobs, opts):
    """trans: saida de get_transcripts; jobs: os clipes (seq_start, seq_end)."""
    o = dict(DEFAULT_OPTS)
    o.update({k: v for k, v in (opts or {}).items() if v is not None})
    after = _phrases(o["after"] if o["after"] is not None else DEFAULT_AFTER)
    before = _phrases(o["before"])
    if not after and not before:
        raise RuntimeError("não há nenhum gatilho configurado (Configurações → Takes).")
    takes, ignored, n_words = [], [], 0
    for tr in trans:
        j = jobs[tr["job"]]
        c = Clip(tr, float(j.get("seq_start", 0)), float(j.get("seq_end", j.get("seq_start", 0) + 1e9)))
        n_words += len(c.words)
        r, ig = analyse_clip(c, o, after, before)
        for t in r:
            t["clip"] = j.get("name", "")
            # dois audios da mesma fala (ex.: mesa e camera) acham o mesmo take: fica so um
            if any(overlap(t, x) > 0.5 for x in takes):
                continue
            takes.append(t)
        for g in ig:
            if not any(abs(g["t"] - x["t"]) < 0.5 for x in ignored):
                ignored.append(g)
    takes.sort(key=lambda t: t["start"])
    for i, t in enumerate(takes):
        t["n"] = i + 1
    ignored = [g for g in ignored if not any(abs(g["t"] - t["trigger_t"]) < 0.5 for t in takes)]
    ignored.sort(key=lambda g: g["t"])
    return {"takes": takes, "ignored": ignored, "words": n_words}

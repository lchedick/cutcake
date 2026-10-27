// CutCake — lado Premiere (ExtendScript)
// Tempos em segundos. Keyframes ficam em clip.inPoint + (tempo da sequencia - clip.start), igual ao GTA.

var CC_TICKS = 254016000000;
var CC_TAG_HUNT = "[CutCake]";
var CC_TAG_ZOOM = "[CutCake zoom]";

function cc_str(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number") return isFinite(v) ? String(v) : "null";
    if (typeof v === "boolean") return String(v);
    if (typeof v === "string") {
        return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
            .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
    }
    var parts = [], k;
    // nao confiar em instanceof Array no ExtendScript
    if (Object.prototype.toString.call(v) === "[object Array]") {
        for (k = 0; k < v.length; k++) parts.push(cc_str(v[k]));
        return "[" + parts.join(",") + "]";
    }
    for (k in v) { if (v.hasOwnProperty(k)) parts.push(cc_str(k) + ":" + cc_str(v[k])); }
    return "{" + parts.join(",") + "}";
}
function cc_err(msg) { return cc_str({ error: msg }); }
function cc_sec(t) {
    if (t === null || t === undefined) return 0;
    if (typeof t === "number") return t;
    if (typeof t === "string") return Number(t) / CC_TICKS;
    if (t.seconds !== undefined) return Number(t.seconds);
    if (t.ticks !== undefined) return Number(t.ticks) / CC_TICKS;
    return Number(t);
}
function cc_ticks(s) { return String(Math.round(s * CC_TICKS)); }
function cc_round(x) { return Math.round(x * 1000) / 1000; }

function cc_findSequence(id) {
    var s = app.project.activeSequence;
    if (!id) return s;
    if (s && s.sequenceID === id) return s;
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
        if (app.project.sequences[i].sequenceID === id) return app.project.sequences[i];
    }
    return null;
}
function cc_seqEnd(seq) { return cc_sec(seq.end); }
function cc_seqRange(seq) {
    // In/Out da sequencia; null se nao houver (ou se for a sequencia inteira)
    var a = 0, b = 0;
    try { a = cc_sec(seq.getInPointAsTime()); b = cc_sec(seq.getOutPointAsTime()); }
    catch (e) { try { a = Number(seq.getInPoint()); b = Number(seq.getOutPoint()); } catch (e2) { return null; } }
    var end = cc_seqEnd(seq);
    if (!(b - a > 0.1)) return null;
    if (a <= 0.001 && (b >= end - 0.05 || b <= 0)) return null;
    return [cc_round(a), cc_round(b)];
}
function cc_comp(clip, match, names) {
    for (var i = 0; i < clip.components.numItems; i++) {
        var c = clip.components[i];
        if (c.matchName === match) return c;
        for (var n = 0; n < names.length; n++) if (c.displayName === names[n]) return c;
    }
    return null;
}
function cc_motion(clip) { return cc_comp(clip, "AE.ADBE Motion", ["Motion", "Movimento"]); }
function cc_opacity(clip) { return cc_comp(clip, "AE.ADBE Opacity", ["Opacity", "Opacidade"]); }
function cc_mediaPath(item) {
    try {
        var pi = item.projectItem;
        if (!pi) return "";
        if (pi.isSequence && pi.isSequence()) return "";
        return pi.getMediaPath() || "";
    } catch (e) { return ""; }
}
function cc_speed(item) {
    try { var s = Number(item.getSpeed()); if (s > 0) return s; } catch (e) {}
    return 1;
}
function cc_tracks(seq, kind) { return kind === "audio" ? seq.audioTracks : seq.videoTracks; }

// ------------------------------------------------------------ clipes para transcrever
// Usa os clipes selecionados (video ou audio). Sem selecao: a primeira trilha de audio com clipes.
function cc_getJobs(useRange) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return cc_err("Abra uma sequência na timeline.");
        var range = useRange ? cc_seqRange(seq) : null;
        var items = [], skipped = [], i, j, from = "seleção";
        var sel = seq.getSelection();
        for (i = 0; i < sel.length; i++) {
            if (sel[i].mediaType === "Video" || sel[i].mediaType === "Audio") items.push(sel[i]);
        }
        if (!items.length) {
            var kinds = ["audio", "video"];
            for (var k = 0; k < kinds.length && !items.length; k++) {
                var trs = cc_tracks(seq, kinds[k]);
                for (i = 0; i < trs.numTracks && !items.length; i++) {
                    for (j = 0; j < trs[i].clips.numItems; j++) {
                        if (cc_mediaPath(trs[i].clips[j])) items.push(trs[i].clips[j]);
                    }
                    if (items.length) from = (kinds[k] === "audio" ? "A" : "V") + (i + 1);
                }
            }
        }
        if (!items.length) return cc_err("Não achei clipes com áudio nesta sequência.");
        var seen = {}, jobs = [];
        for (i = 0; i < items.length; i++) {
            var it = items[i], media = cc_mediaPath(it);
            if (!media) { skipped.push(it.name); continue; }
            var st = cc_sec(it.start), en = cc_sec(it.end);
            if (range && (en <= range[0] || st >= range[1])) continue;
            var key = media + "|" + Math.round(st * 100);
            if (seen[key]) continue;
            seen[key] = true;
            try { if (it.isSpeedReversed && it.isSpeedReversed()) { skipped.push(it.name + " (invertido)"); continue; } } catch (eR) {}
            jobs.push({ media: media, "in": cc_round(cc_sec(it.inPoint)), out: cc_round(cc_sec(it.outPoint)),
                        seq_start: cc_round(st), seq_end: cc_round(en), speed: cc_speed(it), name: it.name, nodeId: it.nodeId });
        }
        if (!jobs.length) return cc_err(range ? "Nenhum clipe com áudio entre o In e o Out." : "Nenhum clipe com arquivo de mídia.");
        jobs.sort(function (a, b) { return a.seq_start - b.seq_start; });
        return cc_str({ sequenceId: seq.sequenceID, seqName: seq.name, range: range, jobs: jobs, skipped: skipped,
                        from: from, seqW: Number(seq.frameSizeHorizontal), seqH: Number(seq.frameSizeVertical) });
    } catch (e) { return cc_err("Erro ao ler a sequência: " + e.toString()); }
}

// ------------------------------------------------------------ marcadores
function cc_markerArray(seq) {
    var out = [], ms = seq.markers, m, guard = 0;
    try { m = ms.getFirstMarker(); } catch (e) { return out; }
    while (m && guard++ < 5000) {
        out.push(m);
        var n = null;
        try { n = ms.getNextMarker(m); } catch (e2) { n = null; }
        if (!n || (n.guid && m.guid && n.guid === m.guid)) break;
        m = n;
    }
    return out;
}
function cc_color(m) { try { return Number(m.getColorByIndex()); } catch (e) { return -1; } }
function cc_setColor(m, idx) {
    try { m.setColorByIndex(idx, 0); return; } catch (e) {}
    try { m.setColorByIndex(idx); } catch (e2) {}
}
function cc_setEnd(m, s) {
    try { m.end = s; } catch (e) {}
    if (Math.abs(cc_sec(m.end) - s) > 0.01) {
        try { var t = new Time(); t.seconds = s; m.end = t; } catch (e2) {}
    }
}

// d = { sequenceId, color, items:[{start, end, name, comment}] }
function cc_addMarkers(d) {
    try {
        var seq = cc_findSequence(d.sequenceId);
        if (!seq) return cc_err("A sequência não existe mais.");
        var n = 0;
        for (var i = 0; i < d.items.length; i++) {
            var it = d.items[i];
            var m = seq.markers.createMarker(it.start);
            m.name = it.name || "";
            m.comments = it.comment || "";
            if (it.end > it.start) cc_setEnd(m, it.end);
            if (d.color >= 0) cc_setColor(m, d.color);
            n++;
        }
        return cc_str({ ok: true, count: n });
    } catch (e) { return cc_err("Erro ao criar marcadores: " + e.toString()); }
}

// apaga os marcadores que o CutCake criou (tag nos comentarios)
function cc_clearMarkers(d) {
    try {
        var seq = cc_findSequence(d.sequenceId);
        if (!seq) return cc_err("Abra uma sequência na timeline.");
        var all = cc_markerArray(seq), n = 0;
        for (var i = 0; i < all.length; i++) {
            var c = String(all[i].comments || "");
            if (c.indexOf(d.tag || CC_TAG_HUNT) >= 0 && c.indexOf(CC_TAG_ZOOM) < 0) {
                try { seq.markers.deleteMarker(all[i]); n++; } catch (e1) {}
            }
        }
        return cc_str({ ok: true, count: n });
    } catch (e) { return cc_err("Erro ao apagar marcadores: " + e.toString()); }
}

// d = { color, durationOnly }  -> marcadores da cor pedida, em ordem
function cc_getMarkers(d) {
    try {
        var seq = cc_findSequence(d.sequenceId);
        if (!seq) return cc_err("Abra uma sequência na timeline.");
        var all = cc_markerArray(seq), out = [], points = 0, other = 0;
        for (var i = 0; i < all.length; i++) {
            var m = all[i], s = cc_sec(m.start), e = cc_sec(m.end), c = cc_color(m);
            if (d.color >= 0 && c !== d.color) { other++; continue; }
            if (d.durationOnly && !(e - s > 0.05)) { points++; continue; }
            out.push({ start: cc_round(s), end: cc_round(e), name: String(m.name || ""), comments: String(m.comments || ""),
                       color: c, guid: String(m.guid || ""), done: String(m.comments || "").indexOf(CC_TAG_ZOOM) >= 0 });
        }
        out.sort(function (a, b) { return a.start - b.start; });
        return cc_str({ sequenceId: seq.sequenceID, seqName: seq.name, markers: out, points: points, other: other });
    } catch (e) { return cc_err("Erro ao ler marcadores: " + e.toString()); }
}

// cria um marcador com duracao do In ate o Out da sequencia
function cc_markRange(d) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return cc_err("Abra uma sequência na timeline.");
        var r = cc_seqRange(seq);
        if (!r) return cc_err("Marque o In (I) e o Out (O) na timeline primeiro.");
        var count = 1, all = cc_markerArray(seq);
        for (var i = 0; i < all.length; i++) if (cc_color(all[i]) === d.color && cc_sec(all[i].end) - cc_sec(all[i].start) > 0.05) count++;
        var name = String(d.name || "").replace("{n}", String(count));
        var m = seq.markers.createMarker(r[0]);
        m.name = name;
        m.comments = d.comment || "";
        cc_setEnd(m, r[1]);
        cc_setColor(m, d.color);
        return cc_str({ ok: true, start: r[0], end: r[1], name: name });
    } catch (e) { return cc_err("Erro ao criar o marcador: " + e.toString()); }
}

// ------------------------------------------------------------ legendas
function cc_findBin(name) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var c = root.children[i];
        if (c.name === name && c.type === 2) return c;
    }
    return root.createBin(name);
}
// d = { sequenceId, srt }
function cc_importCaptions(d) {
    try {
        var seq = cc_findSequence(d.sequenceId);
        if (!seq) return cc_err("A sequência não existe mais.");
        if (typeof seq.createCaptionTrack !== "function") return cc_err("Esta versão do Premiere não deixa o painel criar legendas. Importe o arquivo SRT manualmente.");
        var bin = cc_findBin("CutCake");
        var fname = String(d.srt).replace(/^.*[\\\/]/, "");
        app.project.importFiles([d.srt], true, bin, false);
        var item = null;
        for (var i = bin.children.numItems - 1; i >= 0; i--) {
            if (bin.children[i].name === fname || bin.children[i].name === fname.replace(/\.srt$/i, "")) { item = bin.children[i]; break; }
        }
        if (!item) return cc_err("O Premiere não importou o arquivo de legendas.");
        var fmt = undefined;
        try { fmt = Sequence.CAPTION_FORMAT_SUBTITLE; } catch (eF) {}
        var ok = fmt !== undefined ? seq.createCaptionTrack(item, 0, fmt) : seq.createCaptionTrack(item, 0);
        if (ok === false) return cc_err("O Premiere não conseguiu criar a trilha de legendas.");
        return cc_str({ ok: true, item: item.name });
    } catch (e) { return cc_err("Erro ao criar as legendas: " + e.toString()); }
}

function cc_keyTimes(prop) {
    var out = [];
    try {
        var ks = prop.getKeys();
        if (ks) for (var i = 0; i < ks.length; i++) out.push(cc_sec(ks[i]));
    } catch (e) {}
    return out;
}
// valor de uma propriedade num instante (tempo do clipe). Se a funcao do Premiere falhar,
// interpola entre os keyframes vizinhos.
function cc_valAt(prop, t) {
    if (!prop.isTimeVarying()) return prop.getValue();
    try { var v = prop.getValueAtTime(t); if (v !== undefined && v !== null) return v; } catch (e) {}
    var ks = cc_keyTimes(prop);
    if (!ks.length) return prop.getValue();
    if (t <= ks[0]) return prop.getValueAtKey(ks[0]);
    if (t >= ks[ks.length - 1]) return prop.getValueAtKey(ks[ks.length - 1]);
    for (var i = 0; i < ks.length - 1; i++) {
        if (t >= ks[i] && t <= ks[i + 1]) {
            var a = prop.getValueAtKey(ks[i]), b = prop.getValueAtKey(ks[i + 1]);
            var u = (t - ks[i]) / Math.max(1e-6, ks[i + 1] - ks[i]);
            if (typeof a === "number") return a + (b - a) * u;
            var r = [];
            for (var j = 0; j < a.length; j++) r.push(a[j] + (b[j] - a[j]) * u);
            return r;
        }
    }
    return prop.getValue();
}
function cc_setKey(prop, t, v, interp) {
    prop.addKey(t);
    prop.setValueAtKey(t, v, true);
    if (interp !== undefined) { try { prop.setInterpolationTypeAtKey(t, interp, true); } catch (e) {} }
}
function cc_selectedVideo(seq) {
    var sel = seq.getSelection(), out = [];
    for (var i = 0; i < sel.length; i++) if (sel[i].mediaType === "Video") out.push(sel[i]);
    out.sort(function (a, b) { return cc_sec(a.start) - cc_sec(b.start); });
    return out;
}

// Subida com opacidade nos clipes selecionados (legendas ja convertidas em grafico)
// d = { dur, dist, seqH }
function cc_animateRise(d) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return cc_err("Abra uma sequência na timeline.");
        var clips = cc_selectedVideo(seq);
        if (!clips.length) return cc_err("Selecione as legendas (já convertidas em gráfico) na timeline.");
        var seqH = Number(seq.frameSizeVertical) || 1920, done = 0, fails = [];
        for (var i = 0; i < clips.length; i++) {
            var c = clips[i];
            var mo = cc_motion(c), op = cc_opacity(c);
            if (!mo || !op) { fails.push(c.name); continue; }
            var t0 = cc_sec(c.inPoint), len = cc_sec(c.end) - cc_sec(c.start);
            var dur = Math.max(0.04, Math.min(d.dur, len * 0.6));
            var pos = mo.properties[0], opa = op.properties[0];
            // posicao de repouso: o valor atual (ou o ultimo keyframe, se ja tiver animacao)
            var base = pos.getValue();
            if (pos.isTimeVarying()) { var ks = cc_keyTimes(pos); if (ks.length) base = pos.getValueAtKey(ks[ks.length - 1]); }
            var top = 100;
            if (!opa.isTimeVarying()) { try { top = Number(opa.getValue()) || 100; } catch (e0) {} }
            if (pos.isTimeVarying()) pos.setTimeVarying(false);
            if (opa.isTimeVarying()) opa.setTimeVarying(false);
            pos.setValue(base, true);
            pos.setTimeVarying(true);
            cc_setKey(pos, t0, [base[0], base[1] + d.dist / seqH], 5);
            cc_setKey(pos, t0 + dur, [base[0], base[1]], 5);
            opa.setTimeVarying(true);
            cc_setKey(opa, t0, 0, 5);
            cc_setKey(opa, t0 + dur, top, 5);
            done++;
        }
        return cc_str({ ok: true, count: done, fails: fails });
    } catch (e) { return cc_err("Erro ao animar: " + e.toString()); }
}

// ------------------------------------------------------------ zoom de enfase
function cc_ease(u) { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); }
function cc_env(t, ms, me, r) {
    if (t <= ms || t >= me) return 0;
    if (t < ms + r) return cc_ease((t - ms) / r);
    if (t > me - r) return cc_ease((me - t) / r);
    return 1;
}
// o clipe de video "de baixo" (a filmagem) que cobre o trecho; ignora graficos e legendas
function cc_baseClips(seq, ms, me) {
    for (var i = 0; i < seq.videoTracks.numTracks; i++) {
        var tr = seq.videoTracks[i], out = [];
        for (var j = 0; j < tr.clips.numItems; j++) {
            var c = tr.clips[j];
            if (cc_sec(c.end) <= ms + 0.001 || cc_sec(c.start) >= me - 0.001) continue;
            if (!cc_mediaPath(c) || !cc_motion(c)) continue;
            out.push(c);
        }
        if (out.length) return out;
    }
    return [];
}
function cc_zoomClip(clip, ms, me, r, amount, cx, cy, step) {
    var cs = cc_sec(clip.start), ce = cc_sec(clip.end), cin = cc_sec(clip.inPoint);
    var a = Math.max(ms, cs), b = Math.min(me, ce);
    if (b - a < 0.02) return 0;
    var mo = cc_motion(clip);
    var pos = mo.properties[0], scale = mo.properties[1], scaleW = null, uniform = true;
    try { uniform = mo.properties[3].getValue() !== false; scaleW = mo.properties[2]; } catch (eU) {}
    var toClip = function (t) { return cin + (t - cs); };
    var ts = [a, b], t, i;
    var add = function (x) { if (x >= a - 0.0005 && x <= b + 0.0005) ts.push(Math.max(a, Math.min(b, x))); };
    for (t = ms; t <= ms + r + 1e-6; t += step) add(t);
    for (t = me - r; t <= me + 1e-6; t += step) add(t);
    add(ms + r); add(me - r);
    var props = [pos, scale];
    if (!uniform && scaleW) props.push(scaleW);
    for (var p = 0; p < props.length; p++) {
        var kk = cc_keyTimes(props[p]);
        for (i = 0; i < kk.length; i++) add(cs + (kk[i] - cin));
    }
    ts.sort(function (x, y) { return x - y; });
    var uniq = [];
    for (i = 0; i < ts.length; i++) if (!uniq.length || ts[i] - uniq[uniq.length - 1] > 0.004) uniq.push(ts[i]);
    // le tudo antes de mexer
    var vals = [];
    for (i = 0; i < uniq.length; i++) {
        var tc = toClip(uniq[i]);
        vals.push({ t: tc, k: 1 + amount * cc_env(uniq[i], ms, me, r),
                    p: cc_valAt(pos, tc), s: cc_valAt(scale, tc), w: (!uniform && scaleW) ? cc_valAt(scaleW, tc) : null });
    }
    var orig = [pos.isTimeVarying(), scale.isTimeVarying()];
    if (!orig[0]) pos.setTimeVarying(true);
    if (!orig[1]) scale.setTimeVarying(true);
    if (!uniform && scaleW && !scaleW.isTimeVarying()) scaleW.setTimeVarying(true);
    for (i = 0; i < vals.length; i++) {
        var v = vals[i];
        // mantem fixo o ponto (cx, cy) da tela: P' = C + (P - C) * k
        cc_setKey(pos, v.t, [cx + (v.p[0] - cx) * v.k, cy + (v.p[1] - cy) * v.k], 0);
        cc_setKey(scale, v.t, v.s * v.k, 0);
        if (v.w !== null) cc_setKey(scaleW, v.t, v.w * v.k, 0);
    }
    return vals.length;
}
// d = { sequenceId, color, amount (0.15 = +15%), ramp, focusY, force }
function cc_applyZoom(d) {
    try {
        var seq = cc_findSequence(d.sequenceId);
        if (!seq) return cc_err("Abra uma sequência na timeline.");
        var all = cc_markerArray(seq), done = 0, skipped = 0, empty = [], keys = 0, points = 0;
        var fps = 30;
        try { fps = CC_TICKS / Number(seq.timebase); } catch (eF) {}
        var step = Math.max(1 / 30, 2 / (fps || 30));
        for (var i = 0; i < all.length; i++) {
            var m = all[i];
            if (cc_color(m) !== d.color) continue;
            var ms = cc_sec(m.start), me = cc_sec(m.end);
            if (!(me - ms > 0.05)) { points++; continue; }
            var com = String(m.comments || "");
            if (com.indexOf(CC_TAG_ZOOM) >= 0 && !d.force) { skipped++; continue; }
            var r = Math.min(d.ramp, (me - ms) / 2);
            var clips = cc_baseClips(seq, ms, me);
            if (!clips.length) { empty.push(m.name || ("marcador em " + Math.round(ms) + "s")); continue; }
            for (var c = 0; c < clips.length; c++) keys += cc_zoomClip(clips[c], ms, me, r, d.amount, 0.5, d.focusY, step);
            if (com.indexOf(CC_TAG_ZOOM) < 0) m.comments = (com ? com + "\n" : "") + CC_TAG_ZOOM;
            done++;
        }
        return cc_str({ ok: true, count: done, skipped: skipped, empty: empty, keys: keys, points: points });
    } catch (e) { return cc_err("Erro ao aplicar o zoom: " + e.toString()); }
}

// ------------------------------------------------------------ render (Media Encoder)
var cc_plug = null, cc_bound = false;
function cc_dispatch(obj) {
    try {
        if (!cc_plug) cc_plug = new ExternalObject("lib:PlugPlugExternalObject");
        var ev = new CSXSEvent();
        ev.type = "com.lchedick.cutcake.encoder";
        ev.data = cc_str(obj);
        ev.dispatch();
    } catch (e) {}
}
function cc_onJobComplete(jobID, out) { cc_dispatch({ type: "complete", jobID: String(jobID), path: String(out || "") }); }
function cc_onJobError(jobID, msg) { cc_dispatch({ type: "error", jobID: String(jobID), msg: String(msg || "") }); }
function cc_onJobProgress(jobID, p) { cc_dispatch({ type: "progress", jobID: String(jobID), progress: Number(p) }); }
function cc_onJobCanceled(jobID) { cc_dispatch({ type: "canceled", jobID: String(jobID) }); }
function cc_bindEncoder() {
    if (cc_bound) return;
    try {
        app.encoder.bind("onEncoderJobComplete", cc_onJobComplete);
        app.encoder.bind("onEncoderJobError", cc_onJobError);
        app.encoder.bind("onEncoderJobProgress", cc_onJobProgress);
        app.encoder.bind("onEncoderJobCanceled", cc_onJobCanceled);
        cc_bound = true;
    } catch (e) {}
}
function cc_ioOk(seq, a, b) {
    try { return Math.abs(cc_sec(seq.getInPointAsTime()) - a) < 0.02 && Math.abs(cc_sec(seq.getOutPointAsTime()) - b) < 0.02; }
    catch (e) { return true; }
}
// o formato aceito mudou entre versoes do Premiere: tenta segundos, Time e ticks
function cc_setIO(seq, a, b) {
    try { seq.setInPoint(a); seq.setOutPoint(b); } catch (e) {}
    if (cc_ioOk(seq, a, b)) return;
    try { var ta = new Time(), tb = new Time(); ta.seconds = a; tb.seconds = b; seq.setInPoint(ta); seq.setOutPoint(tb); } catch (e2) {}
    if (cc_ioOk(seq, a, b)) return;
    try { seq.setInPoint(cc_ticks(a)); seq.setOutPoint(cc_ticks(b)); } catch (e3) {}
}
// extensao do arquivo que o preset gera (mp4, mov...)
function cc_presetExt(d) {
    try {
        var seq = cc_findSequence(d.sequenceId);
        if (!seq) return cc_err("Abra uma sequência na timeline.");
        var ext = "";
        try { ext = String(seq.getExportFileExtension(d.preset) || ""); } catch (e1) {}
        return cc_str({ ext: ext.replace(/^\./, "") });
    } catch (e) { return cc_err(e.toString()); }
}
// d = { sequenceId, preset, jobs:[{start, end, out}], startBatch }
function cc_render(d) {
    try {
        var seq = cc_findSequence(d.sequenceId);
        if (!seq) return cc_err("A sequência não existe mais.");
        if (!app.encoder) return cc_err("Media Encoder não disponível.");
        app.encoder.launchEncoder();
        cc_bindEncoder();
        var oldIn = 0, oldOut = 0;
        try { oldIn = cc_sec(seq.getInPointAsTime()); oldOut = cc_sec(seq.getOutPointAsTime()); } catch (e0) {}
        var ids = [], mode = 1;
        try { if (app.encoder.ENCODE_IN_TO_OUT !== undefined) mode = app.encoder.ENCODE_IN_TO_OUT; } catch (eM) {}
        for (var i = 0; i < d.jobs.length; i++) {
            var j = d.jobs[i];
            cc_setIO(seq, j.start, j.end);
            var id = app.encoder.encodeSequence(seq, j.out, d.preset, mode, 1);
            ids.push(String(id));
        }
        cc_setIO(seq, oldIn, oldOut);
        if (d.startBatch) { try { app.encoder.startBatch(); } catch (eB) {} }
        return cc_str({ ok: true, ids: ids });
    } catch (e) { return cc_err("Erro ao mandar para o Media Encoder: " + e.toString()); }
}

// ------------------------------------------------------------ sincronizar
// Agrupa os clipes selecionados por arquivo (o video e o audio ligados a ele andam juntos).
function cc_trackMap(seq) {
    var map = {}, kinds = [["Video", seq.videoTracks], ["Audio", seq.audioTracks]];
    for (var k = 0; k < kinds.length; k++) {
        var trs = kinds[k][1];
        for (var i = 0; i < trs.numTracks; i++) {
            for (var j = 0; j < trs[i].clips.numItems; j++) {
                var c = trs[i].clips[j];
                map[c.nodeId] = { type: kinds[k][0], track: i, clip: c };
            }
        }
    }
    return map;
}
function cc_syncGroups() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return cc_err("Abra a sequência com os clipes na timeline.");
        var sel = seq.getSelection(), map = cc_trackMap(seq), groups = [], byKey = {}, skipped = [];
        for (var i = 0; i < sel.length; i++) {
            var it = sel[i];
            if (it.mediaType !== "Video" && it.mediaType !== "Audio") continue;
            var media = cc_mediaPath(it);
            if (!media) { skipped.push(it.name); continue; }
            var st = cc_sec(it.start), key = media + "|" + Math.round(st * 100);
            var g = byKey[key];
            if (!g) {
                g = { key: key, media: media, name: it.name, "in": cc_round(cc_sec(it.inPoint)), out: cc_round(cc_sec(it.outPoint)),
                      seq_start: cc_round(st), seq_end: cc_round(cc_sec(it.end)), speed: cc_speed(it), items: [], audioTrack: 999, hasVideo: false };
                byKey[key] = g; groups.push(g);
            }
            var info = map[it.nodeId] || { type: it.mediaType, track: 0 };
            g.items.push({ nodeId: it.nodeId, type: info.type, track: info.track });
            if (info.type === "Audio") g.audioTrack = Math.min(g.audioTrack, info.track);
            else g.hasVideo = true;
        }
        if (groups.length < 2) return cc_err("Selecione pelo menos 2 clipes na timeline (a referência e os que vão andar).");
        // referencia padrao: o clipe da trilha de audio mais baixa (ex.: audio da mesa)
        var ref = 0;
        for (i = 1; i < groups.length; i++) if (groups[i].audioTrack < groups[ref].audioTrack) ref = i;
        return cc_str({ sequenceId: seq.sequenceID, groups: groups, ref: groups[ref].key, skipped: skipped });
    } catch (e) { return cc_err("Erro ao ler a seleção: " + e.toString()); }
}
function cc_moveItem(c, delta) {
    var target = cc_sec(c.start) + delta;
    if (Math.abs(delta) < 1e-6) return true;
    try { var t = new Time(); t.seconds = delta; c.move(t); } catch (e) { try { c.move(delta); } catch (e2) {} }
    if (Math.abs(cc_sec(c.start) - target) < 0.002) return true;
    // em algumas versoes o move recebe a posicao final, e nao o deslocamento
    try { var t2 = new Time(); t2.seconds = target; c.move(t2); } catch (e3) {}
    return Math.abs(cc_sec(c.start) - target) < 0.002;
}
// d = { sequenceId, moves:[{ key, delta, items:[{nodeId, type, track}] }], check }
function cc_syncMove(d) {
    try {
        var seq = cc_findSequence(d.sequenceId);
        if (!seq) return cc_err("A sequência não existe mais.");
        var map = cc_trackMap(seq), mine = {}, i, j, k;
        for (i = 0; i < d.moves.length; i++) for (j = 0; j < d.moves[i].items.length; j++) mine[d.moves[i].items[j].nodeId] = true;
        // nao pode ir para antes do 0 nem cair em cima de outro clipe
        var conflicts = [], before = [];
        for (i = 0; i < d.moves.length; i++) {
            var mv = d.moves[i];
            for (j = 0; j < mv.items.length; j++) {
                var inf = map[mv.items[j].nodeId];
                if (!inf) continue;
                var ns = cc_sec(inf.clip.start) + mv.delta, ne = cc_sec(inf.clip.end) + mv.delta;
                if (ns < -0.001) before.push(inf.clip.name);
                var trs = inf.type === "Audio" ? seq.audioTracks : seq.videoTracks, tr = trs[inf.track];
                for (k = 0; k < tr.clips.numItems; k++) {
                    var o = tr.clips[k];
                    if (mine[o.nodeId]) continue;
                    if (cc_sec(o.end) > ns + 0.001 && cc_sec(o.start) < ne - 0.001)
                        conflicts.push(inf.clip.name + " → " + o.name + " (" + (inf.type === "Audio" ? "A" : "V") + (inf.track + 1) + ")");
                }
            }
        }
        if (before.length) return cc_str({ ok: false, reason: "before", names: before });
        if (conflicts.length) return cc_str({ ok: false, reason: "overlap", names: conflicts });
        if (d.check) return cc_str({ ok: true, checked: true });
        var moved = 0, fails = [];
        for (i = 0; i < d.moves.length; i++) {
            var m2 = d.moves[i], starts = [];
            for (j = 0; j < m2.items.length; j++) { var f = map[m2.items[j].nodeId]; starts.push(f ? cc_sec(f.clip.start) : 0); }
            for (j = 0; j < m2.items.length; j++) {
                var inf2 = map[m2.items[j].nodeId];
                if (!inf2) continue;
                var want = starts[j] + m2.delta, cur = cc_sec(inf2.clip.start);
                if (Math.abs(cur - want) < 0.002) continue;          // ja andou junto com o clipe ligado
                if (!cc_moveItem(inf2.clip, want - cur)) fails.push(inf2.clip.name);
            }
            moved++;
        }
        return cc_str({ ok: !fails.length, moved: moved, fails: fails });
    } catch (e) { return cc_err("Erro ao mover os clipes: " + e.toString()); }
}

// ------------------------------------------------------------ utilidades
function cc_goTo(d) {
    try {
        var seq = cc_findSequence(d.sequenceId);
        if (!seq) return cc_err("A sequência não existe mais.");
        if (app.project.activeSequence !== seq) { try { app.project.activeSequence = seq; } catch (e0) {} }
        seq.setPlayerPosition(cc_ticks(d.t));
        return cc_str({ ok: true });
    } catch (e) { return cc_err(e.toString()); }
}
function cc_info() {
    try {
        var seq = app.project.activeSequence;
        return cc_str({ version: String(app.version), build: String(app.build || ""), appPath: String(app.path || ""),
                        project: app.project ? String(app.project.path || "") : "", seqName: seq ? String(seq.name) : "",
                        sequenceId: seq ? seq.sequenceID : "" });
    } catch (e) { return cc_err(e.toString()); }
}

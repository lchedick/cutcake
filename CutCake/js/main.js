/* CutCake — painel (CEP + Node) */
(function () {
  "use strict";
  var cep = window.__adobe_cep__;
  var req = window.require || (window.cep_node && window.cep_node.require);
  var cp = req("child_process"), fs = req("fs"), os = req("os"), path = req("path"), https = req("https");
  var IS_WIN = os.platform() === "win32";
  var IS_MAC = os.platform() === "darwin";
  var proc = (typeof process !== "undefined" && process.env) ? process : req("process");

  var $ = function (id) { return document.getElementById(id); };
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };

  // icones em SVG (js/icons.js): <i class="ico" data-i="Nome"> recebe o desenho; a cor vem do CSS
  var ICONS = window.CC_ICONS || {};
  function icon(name, cls) { return '<i class="ico' + (cls ? " " + cls : "") + '" data-i="' + name + '">' + (ICONS[name] || "") + "</i>"; }
  function setIcon(el, name) { el.dataset.i = name; el.innerHTML = ICONS[name] || ""; }
  each(document.querySelectorAll("[data-i]"), function (el) { setIcon(el, el.dataset.i); });

  // ------------------------------------------------------------ utilidades
  function extDir() {
    var p = decodeURI(cep.getSystemPath("extension")).replace(/^file:\/{2,3}/, "");
    if (IS_WIN) p = p.replace(/\//g, "\\");
    else if (p[0] !== "/") p = "/" + p;
    return p;
  }
  var EXT = extDir();
  var INFO = { version: "0.0.0", repo: "lchedick/cutcake", author: "Lucas Chedick", name: "CutCake" };
  try { INFO = Object.assign(INFO, JSON.parse(fs.readFileSync(path.join(EXT, "version.json"), "utf8"))); } catch (e) {}
  $("footer").textContent = INFO.name + " | v" + INFO.version + " | Desenvolvido por " + INFO.author;
  $("aboutVer").textContent = "v" + INFO.version;
  // mesma pasta que o motor em Python usa (modelos, transcricoes, legendas)
  var DATA = IS_WIN ? path.join(proc.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CutCake")
                    : IS_MAC ? path.join(os.homedir(), "Library", "Application Support", "CutCake")
                    : path.join(os.homedir(), ".local", "share", "CutCake");

  function evalES(script) {
    return new Promise(function (resolve) { cep.evalScript(script, resolve); });
  }
  async function host(fn, arg) {
    var call = fn + "(" + (arg === undefined ? "" : JSON.stringify(arg)) + ")";
    var raw = await evalES(call);
    var res;
    try { res = JSON.parse(raw); } catch (e) { throw new Error("Resposta inesperada do Premiere: " + raw); }
    if (res && res.error) throw new Error(res.error);
    return res;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function missionHTML(what, time, extra) {
    return '<div class="mission"><div class="mt">Missão cumprida!</div>' +
      '<div class="ms">' + esc(what) + (time ? " em <b>" + esc(time) + "</b>" : "") +
      (extra ? ' · <span style="color:var(--warn)">' + esc(extra) + "</span>" : "") + "</div></div>";
  }
  function showMission(what, time, extra) { $("status").className = ""; $("status").innerHTML = missionHTML(what, time, extra); }
  function setStatus(msg, cls, big) {
    $("status").innerHTML = esc(msg || "").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    $("status").className = (cls || "") + (big ? " big" : "");
  }
  function addLog(s) { var l = $("log"); l.textContent += s; if (l.textContent.length > 20000) l.textContent = l.textContent.slice(-15000); l.scrollTop = l.scrollHeight; }
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60), r = s % 60;
    if (m >= 60) return Math.floor(m / 60) + "h" + (m % 60 ? " " + (m % 60) + "min" : "");
    return m + "min" + (r ? " " + (r < 10 ? "0" : "") + r + "s" : "");
  }
  function fmtClock(s) {
    s = Math.max(0, Math.floor(s));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (r < 10 ? "0" : "") + r;
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function play(name, force) {
    if (!force && !$("optSounds").checked) return;
    try {
      var a = new Audio("assets/sounds/" + name);
      a.volume = Math.max(0, Math.min(1, Number($("vol").value) / 100));
      a.play().catch(function () {});
    } catch (e) {}
  }
  function openURL(url) {
    try {
      if (IS_WIN) cp.spawn("cmd", ["/c", "start", "", url], { windowsHide: true, detached: true, stdio: "ignore" }).unref();
      else cp.spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } catch (e) {}
  }
  function openFolder(dir) {
    try {
      if (IS_WIN) cp.spawn("explorer", [dir], { detached: true, stdio: "ignore" }).unref();
      else cp.spawn("open", [dir], { detached: true, stdio: "ignore" }).unref();
    } catch (e) {}
  }
  function copyText(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    if (!ok && navigator.clipboard) { try { navigator.clipboard.writeText(text); ok = true; } catch (e) {} }
    return ok;
  }
  // roda um comando e devolve stdout (rejeita com stderr)
  function exec(cmd, args, opts) {
    return new Promise(function (resolve, reject) {
      var p, out = "", err = "";
      try { p = cp.spawn(cmd, args, Object.assign({ windowsHide: true }, opts || {})); } catch (e) { return reject(e); }
      p.stdout.on("data", function (b) { out += b; });
      p.stderr.on("data", function (b) { err += b; });
      p.on("error", reject);
      p.on("close", function (c) { c === 0 ? resolve(out) : reject(new Error(err.trim().split("\n").pop() || ("código " + c))); });
    });
  }
  var PY_ENV = Object.assign({}, proc.env, { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" });
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function today() { var d = new Date(); return (d.getDate() < 10 ? "0" : "") + d.getDate() + "." + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1); }

  // ------------------------------------------------------------ preferencias
  function load(k, d) { try { var v = localStorage.getItem("cc_" + k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem("cc_" + k, v); } catch (e) {} }
  var DEF = {
    sPoints: "4", sSeg: "15", sSpeech: "auto", hCount: "5", hMin: "30", hMax: "90", hReplace: "1", hRange: "1",
    capStyle: "rise", capMode: "line", cWords: "4", cChars: "24", cDur: "25", cDist: "40", cUpper: "0", cPunct: "1", cRange: "1",
    zAmount: "15", zRamp: "4", zFocus: "0.5", zForce: "0",
    tPause: "20", tPad: "3", tReplace: "1", tUse: "own", tSil: "10", tAfter: "", tBefore: "",
    rPreset: "", rFolder: "", rName: "{data} - corte {n}", rStart: "1",
    model: "auto", gpu: "1", colorCut: "0", colorZoom: "4", colorTake: "6", lists: "",
    sounds: "1", vol: "100", notify: "1", fgonly: "1", autoupd: "1", ui: "1",
    tab_sync: "1", tab_takes: "1", tab_hunt: "1", tab_captions: "1", tab_zoom: "1", tab_render: "1"
  };
  // cores de marcador do Premiere (indice da API)
  var COLORS = [
    { name: "Verde", hex: "#3fbf5f" }, { name: "Vermelho", hex: "#e0453c" }, { name: "Roxo", hex: "#b15fd3" },
    { name: "Laranja", hex: "#f08c2c" }, { name: "Amarelo", hex: "#e9c92f" }, { name: "Branco", hex: "#e6e6e6" },
    { name: "Azul", hex: "#3b7ff0" }, { name: "Ciano", hex: "#2fc6d6" }
  ];
  var TAG_HUNT = "[CutCake]", TAG_TAKE = "[CutCake take]";
  var DEFAULT_AFTER = ["esse foi", "esse ficou bom", "ficou bom", "foi esse", "esse valeu"];
  var MODEL_HINT = {
    auto: "Usa o Preciso quando tem placa de vídeo NVIDIA e o Rápido quando não tem.",
    small: "Modelo menor (cerca de 0,5 GB). Bom para computadores sem placa de vídeo.",
    turbo: "Modelo grande (cerca de 1,6 GB). Erra menos palavras. Ideal com placa de vídeo."
  };
  var MODE_HINT = {
    "type|word": "As palavras vão aparecendo uma a uma e se somando na linha.",
    "type|line": "Cada linha aparece letra por letra, no ritmo da fala.",
    "rise|word": "Uma palavra por vez na tela, cada uma subindo.",
    "rise|line": "Uma linha por vez na tela, subindo."
  };

  function setSeg(id, v) { each($(id).querySelectorAll("button"), function (b) { b.classList.toggle("on", b.dataset.v === v); }); }
  function segVal(id) { var b = $(id).querySelector("button.on"); return b ? b.dataset.v : ""; }
  function paintRange(el) { el.style.setProperty("--p", ((el.value - el.min) / (el.max - el.min) * 100) + "%"); }
  function setUiScale(v) {
    save("ui", v); setSeg("uiScale", v);
    document.documentElement.style.zoom = v;
    fitActions();
  }
  // botoes principais um embaixo do outro quando o painel estiver estreito
  function fitActions() {
    var z = Number(load("ui", "1")) || 1;
    var w = window.innerWidth / z - 24;
    each(document.querySelectorAll(".actions"), function (a) { a.classList.toggle("stack", w < 270); });
    $("home").classList.toggle("one", w < 270);
  }
  window.addEventListener("resize", fitActions);

  var SLIDERS = ["sPoints", "sSeg", "tPause", "tPad", "tSil", "hCount", "hMin", "hMax", "cWords", "cChars", "cDur", "cDist", "zAmount", "zRamp", "vol"];
  var CHECKS = { tReplace: "tReplace", hReplace: "hReplace", hRange: "hRange", cUpper: "cUpper", cPunct: "cPunct", cRange: "cRange", zForce: "zForce",
                 rStart: "rStart", optGpu: "gpu", optSounds: "sounds", optNotify: "notify", optFgOnly: "fgonly", optAutoUpd: "autoupd" };
  function refresh() {
    // a duracao maxima nunca fica abaixo da minima
    if (Number($("hMax").value) < Number($("hMin").value) + 10) $("hMax").value = Math.min(180, Number($("hMin").value) + 10);
    SLIDERS.forEach(function (id) { paintRange($(id)); save(id === "vol" ? "vol" : id, $(id).value); });
    $("sPointsV").textContent = plural(Number($("sPoints").value), "ponto", "pontos");
    $("sSegV").textContent = $("sSeg").value + "s";
    $("sumSync").textContent = $("sPoints").value + " × " + $("sSeg").value + "s" + (segVal("sSpeech") === "always" ? " · pela fala" : segVal("sSpeech") === "never" ? " · só som" : "");
    var sec1 = function (id) { return (Number($(id).value) / 10).toFixed(1).replace(".", ",") + "s"; };
    $("tPauseV").textContent = sec1("tPause"); $("tPadV").textContent = sec1("tPad"); $("tSilV").textContent = sec1("tSil");
    $("sumTakes").textContent = "pausa " + sec1("tPause") + " · folga " + sec1("tPad");
    $("tUseHint").textContent = segVal("tUse") === "all"
      ? "Todos os marcadores com duração na cor " + colorName(colorTake()) + ", inclusive os que você criou ou ajustou à mão."
      : "Só os marcadores que o “Marcar takes” criou (você pode ajustar as pontas deles).";
    $("hCountV").textContent = plural(Number($("hCount").value), "corte", "cortes");
    $("hMinV").textContent = $("hMin").value + "s"; $("hMaxV").textContent = $("hMax").value + "s";
    $("cWordsV").textContent = $("cWords").value; $("cCharsV").textContent = $("cChars").value;
    $("cDurV").textContent = (Number($("cDur").value) / 100).toFixed(2).replace(".", ",") + "s";
    $("cDistV").textContent = $("cDist").value + " px";
    $("zAmountV").textContent = "+" + $("zAmount").value + "%";
    $("zRampV").textContent = (Number($("zRamp").value) / 10).toFixed(1).replace(".", ",") + "s";
    $("volv").textContent = $("vol").value + "%";
    Object.keys(CHECKS).forEach(function (id) { save(CHECKS[id], $(id).checked ? "1" : "0"); });
    save("py", $("py").value.trim());
    save("rName", $("rName").value);
    $("sumHunt").textContent = plural(Number($("hCount").value), "corte", "cortes") + " · " + $("hMin").value + "–" + $("hMax").value + "s";
    var st = segVal("capStyle"), md = segVal("capMode");
    $("sumCap").textContent = $("cWords").value + " palavras/linha" + ($("cUpper").checked ? " · MAIÚSC." : "");
    $("sumZoom").textContent = "+" + $("zAmount").value + "% · " + $("zRampV").textContent;
    $("capModeHint").textContent = MODE_HINT[st + "|" + md] || "";
    $("riseOpts").hidden = st !== "rise";
    var rise = st === "rise";
    $("capAnimate").disabled = !rise || busyEngine;
    $("stepAnim").classList.toggle("off", !rise);
    $("stepAnimTxt").textContent = rise ? "Selecione os gráficos e anime." : "A máquina de escrever já vem pronta nas legendas. Não precisa animar.";
    $("rNameEx").textContent = fileName(1, "Corte 1", "Culto") + ".mp4";
    $("modelHint").textContent = MODEL_HINT[segVal("model")] || "";
  }

  function applyPrefs() {
    SLIDERS.forEach(function (id) { $(id).value = load(id, DEF[id]); });
    Object.keys(CHECKS).forEach(function (id) { $(id).checked = load(CHECKS[id], DEF[CHECKS[id]]) === "1"; });
    $("py").value = load("py", defaultPy());
    $("rName").value = load("rName", DEF.rName);
    setSeg("sSpeech", load("sSpeech", DEF.sSpeech));
    setSeg("tUse", load("tUse", DEF.tUse));
    setSeg("capStyle", load("capStyle", DEF.capStyle));
    setSeg("capMode", load("capMode", DEF.capMode));
    setSeg("zFocus", load("zFocus", DEF.zFocus));
    setSeg("model", load("model", DEF.model));
    setUiScale(load("ui", DEF.ui));
    each(document.querySelectorAll("[data-tabvis]"), function (el) { el.checked = load("tab_" + el.dataset.tabvis, "1") === "1"; });
    paintSwatches();
    loadLists();
    loadTriggers();
    applyTabs();
    refresh();
  }
  [["sSpeech", "sSpeech"], ["tUse", "tUse"], ["capStyle", "capStyle"], ["capMode", "capMode"], ["zFocus", "zFocus"], ["model", "model"]].forEach(function (p) {
    $(p[0]).addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      setSeg(p[0], b.dataset.v); save(p[1], b.dataset.v); refresh();
    });
  });
  $("uiScale").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setUiScale(b.dataset.v); });
  SLIDERS.concat(Object.keys(CHECKS), ["py", "rName"]).forEach(function (id) {
    $(id).addEventListener("input", refresh); $(id).addEventListener("change", refresh);
  });
  // duplo clique no slider volta ao padrao
  SLIDERS.forEach(function (id) { $(id).addEventListener("dblclick", function () { $(id).value = DEF[id]; refresh(); }); });
  ["moreSync", "moreTakes", "moreHunt", "moreCap", "moreZoom", "foldPy", "foldSup", "foldHunt", "foldTakes"].forEach(function (id) {
    $(id).open = load("open_" + id, "0") === "1";
    $(id).addEventListener("toggle", function () { save("open_" + id, $(id).open ? "1" : "0"); });
  });
  $("playOk").addEventListener("click", function () { play("Alert_OK.mp3", true); });
  $("playFail").addEventListener("click", function () { play("Alert_FAIL.mp3", true); });

  // ------------------------------------------------------------ tela inicial e funcoes
  // O painel sempre abre na tela inicial (6 botoes, na ordem do fluxo). Dentro de uma funcao,
  // o "<" + logo + nome no cabecalho volta para o inicio. Funcoes desligadas em
  // Configuracoes -> Interface somem da tela inicial.
  var tab = "home", visibleTabs = [];
  function applyTabs() {
    visibleTabs = [];
    each($("home").querySelectorAll(".hbtn"), function (b) {
      var on = load("tab_" + b.dataset.tab, "1") === "1";
      b.hidden = !on;
      if (on) visibleTabs.push(b.dataset.tab);
    });
    if (visibleTabs.length === 1) showTab(visibleTabs[0]);
    else if (tab !== "home" && visibleTabs.indexOf(tab) < 0) showHome();
    else if (tab === "home") showHome();
    else showTab(tab);
  }
  function showStatusOf(t) {
    var q = Q[t];
    setStatus(q.statusMsg || "", q.statusCls, q.statusBig);
    if (q.mission) $("status").innerHTML = q.mission;
  }
  function setHomeBtn(atHome) {
    var hb = $("homeBtn");
    hb.classList.toggle("at-home", atHome);
    hb.title = atHome ? "CutCake • Cortes, legendas e zoom" : "Voltar para o início";
  }
  function showHome() {
    if (visibleTabs.length === 1) return showTab(visibleTabs[0]);
    tab = "home";
    setHomeBtn(true);
    $("home").hidden = false;
    each(document.querySelectorAll("section.tab"), function (s) { s.hidden = true; });
    showStatusOf("home");
    renderQueue();
  }
  function showTab(t) {
    tab = t;
    setHomeBtn(visibleTabs.length <= 1);
    $("home").hidden = true;
    each(document.querySelectorAll("section.tab"), function (s) { s.hidden = s.id !== "tab-" + t; });
    showStatusOf(t);
    renderQueue();
    if (t === "render") refreshRender();
    if (TRACK_SEL[t]) refreshTracks();
  }
  $("home").addEventListener("click", function (e) { var b = e.target.closest(".hbtn"); if (b) showTab(b.dataset.tab); });
  $("homeBtn").addEventListener("click", function () { if (tab !== "home") showHome(); });
  // botoes da tela inicial: progresso de quem esta rodando e o resultado da ultima vez
  function updateHome() {
    each($("home").querySelectorAll(".hbtn"), function (b) {
      var q = Q[b.dataset.tab], st = b.querySelector(".hstat"), txt = "", cls = "";
      if (!q) return;
      var pct = Math.round((q.overall || 0) * 100);
      if (q.active) { txt = q.waiting ? "Na fila do Media Encoder" : "Rodando · " + pct + "%"; cls = "run"; }
      else if (q.mission) { txt = "✓ Pronto"; cls = "ok"; }
      else if (q.statusCls === "err" && q.statusMsg) { txt = "✗ Com problema"; cls = "err"; }
      b.classList.toggle("running", !!q.active);
      b.querySelector(".hbar > div").style.width = pct + "%";
      if (st.textContent !== txt) st.textContent = txt;
      st.className = "hstat" + (cls ? " " + cls : "");
    });
  }
  each(document.querySelectorAll("[data-tabvis]"), function (el) {
    el.addEventListener("change", function () {
      var on = document.querySelectorAll("[data-tabvis]:checked").length;
      if (!on) { el.checked = true; return; }   // pelo menos uma aba
      save("tab_" + el.dataset.tabvis, el.checked ? "1" : "0");
      applyTabs();
    });
  });

  // ------------------------------------------------------------ trilha de audio (Legendar, Cacar e Takes)
  // "Automatico" = os clipes selecionados; sem selecao, a trilha de audio mais baixa.
  // Em qualquer caso o host usa um audio so por trecho (duas trilhas com a mesma fala baguncavam as legendas).
  var TRACK_SEL = { hunt: "hTrack", captions: "cTrack", takes: "tTrack" }, lastTracks = [], tracksKey = "";
  function trackVal(k) { return load("trk_" + k, "auto"); }
  function trackHint(k) {
    var v = trackVal(k);
    return v === "auto"
      ? "Usa os clipes selecionados. Sem seleção, a trilha de áudio mais baixa. Se duas trilhas tiverem a mesma fala, usa só a mais baixa."
      : "Usa só a trilha " + v + ". Com clipes selecionados, só a parte da seleção.";
  }
  function fillTracks() {
    Object.keys(TRACK_SEL).forEach(function (k) {
      var el = $(TRACK_SEL[k]), v = trackVal(k);
      var html = '<option value="auto">Automático (seleção ou trilha mais baixa)</option>';
      lastTracks.forEach(function (t) {
        html += '<option value="' + esc(t.key) + '">' + esc(t.key + " · " + t.names[0] + (t.names.length > 1 ? " +" + (t.names.length - 1) : "")) + "</option>";
      });
      if (v !== "auto" && !lastTracks.some(function (t) { return t.key === v; })) html += '<option value="' + esc(v) + '">' + esc(v) + " (sem clipes nesta sequência)</option>";
      if (el.innerHTML !== html) el.innerHTML = html;
      el.value = v;
      $(TRACK_SEL[k] + "Hint").textContent = trackHint(k);
    });
  }
  async function refreshTracks() {
    if (Object.keys(TRACK_SEL).some(function (k) { return document.activeElement === $(TRACK_SEL[k]); })) return;
    try {
      var r = await host("cc_audioTracks"), key = JSON.stringify(r.tracks);
      if (key === tracksKey) return;
      tracksKey = key; lastTracks = r.tracks;
    } catch (e) {}
    fillTracks();
  }
  Object.keys(TRACK_SEL).forEach(function (k) {
    $(TRACK_SEL[k]).addEventListener("change", function () { save("trk_" + k, $(TRACK_SEL[k]).value); fillTracks(); });
  });
  function jobsArg(k, range) { return { range: !!range, track: trackVal(k) }; }
  // conta na fila qual audio foi usado e o que ficou de fora
  function tracksNote(sel) {
    var used = [];
    sel.jobs.forEach(function (j) { var t = j.track ? j.track + " (" + j.name + ")" : j.name; if (used.indexOf(t) < 0) used.push(t); });
    var txt = "Áudio: " + used.slice(0, 2).join(", ") + (used.length > 2 ? "…" : "");
    if (sel.dropped && sel.dropped.length) txt += ". Não usei " + sel.dropped.slice(0, 2).join(", ") + (sel.dropped.length > 2 ? "…" : "") + " (toca junto, com a mesma fala)";
    return txt + ".";
  }

  // ------------------------------------------------------------ cores dos marcadores
  var COLOR_KEYS = { colorCut: "corte", colorZoom: "zoom", colorTake: "take" };
  function paintSwatches() {
    Object.keys(COLOR_KEYS).forEach(function (key) {
      var box = $(key), mine = Number(load(key, DEF[key])), taken = {};
      Object.keys(COLOR_KEYS).forEach(function (o) { if (o !== key) taken[Number(load(o, DEF[o]))] = COLOR_KEYS[o]; });
      box.innerHTML = "";
      COLORS.forEach(function (c, i) {
        var b = document.createElement("button");
        b.className = "sw" + (i === mine ? " on" : "") + (taken[i] ? " taken" : "");
        b.style.background = c.hex; b.title = c.name + (taken[i] ? " (já usada pelo " + taken[i] + ")" : "");
        b.addEventListener("click", function () {
          if (taken[i]) { $("colorResult").className = "result err"; $("colorResult").textContent = "Corte, zoom e take precisam de cores diferentes."; return; }
          save(key, String(i)); $("colorResult").className = "result"; $("colorResult").textContent = "";
          paintSwatches(); refresh();
        });
        box.appendChild(b);
      });
    });
  }
  function colorCut() { return Number(load("colorCut", DEF.colorCut)); }
  function colorZoom() { return Number(load("colorZoom", DEF.colorZoom)); }
  function colorTake() { return Number(load("colorTake", DEF.colorTake)); }
  function colorName(i) { return (COLORS[i] || { name: "?" }).name.toLowerCase(); }

  // ------------------------------------------------------------ palavras do Cacador
  var LIST_IDS = { chamadas: "lChamadas", historias: "lHistorias", conectivos: "lConectivos", evitar: "lEvitar" };
  var DEFAULT_LISTS = {
    chamadas: ["presta atenção", "preste atenção", "deixa eu te dizer", "deixa eu te falar", "escuta isso", "escute", "olha só",
               "repita comigo", "repete comigo", "eu quero te dizer", "eu preciso te dizer", "anota isso", "guarda isso", "grava isso",
               "não esquece", "entenda", "você precisa", "sabe por quê", "sabe o que", "a verdade é", "o segredo", "eu te garanto",
               "eu te desafio", "imagine", "isso é muito importante", "você sabia", "eu quero que você"],
    historias: ["certa vez", "uma vez", "me lembro", "eu lembro", "lembro quando", "quando eu era", "aconteceu", "um dia", "havia um",
                "tinha um", "eu estava", "meu pai", "minha mãe", "eu tinha", "conta-se", "existia um", "era uma vez"],
    conectivos: ["e", "mas", "então", "porque", "pois", "aí", "daí", "por isso", "portanto", "ou seja", "também", "só que", "isso", "né"],
    evitar: ["aviso", "avisos", "oferta", "ofertas", "dízimo", "dízimos", "inscrição", "inscrições", "pix", "programação", "secretaria",
             "estacionamento", "bem-vindos", "bem vindos", "microfone", "som"]
  };
  function getLists() {
    try { var l = JSON.parse(load("lists", "")); if (l && typeof l === "object") return l; } catch (e) {}
    return {};
  }
  function loadLists() {
    var l = getLists();
    Object.keys(LIST_IDS).forEach(function (k) { $(LIST_IDS[k]).value = (l[k] || DEFAULT_LISTS[k]).join("\n"); });
  }
  function saveLists() {
    var out = {};
    Object.keys(LIST_IDS).forEach(function (k) {
      var v = $(LIST_IDS[k]).value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (v.join("|") !== DEFAULT_LISTS[k].join("|")) out[k] = v;
    });
    save("lists", Object.keys(out).length ? JSON.stringify(out) : "");
  }
  Object.keys(LIST_IDS).forEach(function (k) { $(LIST_IDS[k]).addEventListener("change", saveLists); });

  // gatilhos dos Takes: "depois do take" (confirmacao) e "antes do take" (ex.: "acao", vazio por padrao)
  function linesOf(id) { return $(id).value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function loadTriggers() {
    var a = load("tAfter", ""), b = load("tBefore", "");
    $("tAfter").value = a ? a : DEFAULT_AFTER.join("\n");
    $("tBefore").value = b;
  }
  function saveTriggers() {
    var a = linesOf("tAfter");
    save("tAfter", a.join("|") === DEFAULT_AFTER.join("|") ? "" : a.join("\n"));
    save("tBefore", linesOf("tBefore").join("\n"));
  }
  ["tAfter", "tBefore"].forEach(function (id) { $(id).addEventListener("change", saveTriggers); });
  $("resetTrig").addEventListener("click", function () { save("tAfter", ""); save("tBefore", ""); loadTriggers(); });
  $("resetLists").addEventListener("click", function () { save("lists", ""); loadLists(); });

  // ------------------------------------------------------------ fila (uma por aba)
  // item: { name, state, progress, msg, t (tempo na sequencia, para clicar), pct (selo), dur, jobID }
  var Q = {
    home: { items: [], title: "Fila" },
    sync: { items: [], title: "Fila" }, takes: { items: [], title: "Fila" }, hunt: { items: [], title: "Fila" },
    captions: { items: [], title: "Fila" }, zoom: { items: [], title: "Resultado" }, render: { items: [], title: "Fila do Media Encoder" }
  };
  var RUN_ICON = { sync: "Sync", takes: "Takes", hunt: "Hunt", captions: "Captions", zoom: "Zoom", render: "Render" };
  var ST = { queued: "Na fila", ok: "Pronto", fail: "Falhou", skip: "Pulado", cancel: "Cancelado", info: "" };
  function iconFor(it, k) {
    if (it.state === "running") return [RUN_ICON[k] || "Queue", "c-accent"];
    if (it.state === "ok") return ["Ok", "c-ok"];
    if (it.state === "fail") return ["Fail", "c-err"];
    if (it.state === "skip") return ["Fail", "c-warn"];
    if (it.state === "cancel") return ["CancelQueue", ""];
    if (it.state === "info") return [it.icon || "Marker", "c-accent"];
    return ["Queue", ""];
  }
  function rowHTML(it, k) {
    var st = it.state === "running" ? Math.round((it.progress || 0) * 100) + "%" : (it.st !== undefined ? it.st : ST[it.state]);
    if (typeof it.pct === "number") {
      var lv = it.pct >= 80 ? "hi" : it.pct >= 50 ? "mid" : "lo";
      st = '<span class="conf ' + lv + '" title="Nota do trecho (quanto maior, mais cara de corte)">' + it.pct + "%</span>" + esc(st);
    } else st = esc(st);
    var sub = it.state === "running" ? '<div class="bar sub"><div style="width:' + Math.round((it.progress || 0) * 100) + '%"></div></div>' : "";
    var msg = it.msg ? '<div class="msg">' + esc(it.msg) + "</div>" : "";
    var ic = iconFor(it, k);
    return icon(ic[0], ic[1]) + '<span class="name">' + esc(it.name) + '</span><span class="st">' + st + "</span>" + sub + msg;
  }
  function renderQueue() {
    updateHome();
    // barra no icone do Premiere: a fila que estiver rodando (mesmo se a tela mostrar outra)
    var run = Object.keys(Q).filter(function (k) { return Q[k].active; })[0];
    if (run) taskbar.set(Q[run].overall || 0);
    var q = Q[tab], ul = $("queueList");
    // na tela inicial a fila so aparece se houver algo (ex.: instalando a transcricao)
    $("queueCard").hidden = tab === "home" && !q.items.length;
    $("qtitle").textContent = q.title;
    $("qempty").style.display = q.items.length ? "none" : "";
    $("qstatus").textContent = q.sub || q.note || "";
    if (ul._tab !== tab) { ul.innerHTML = ""; ul._tab = tab; }
    while (ul.children.length > q.items.length) ul.removeChild(ul.lastChild);
    q.items.forEach(function (it, i) {
      var li = ul.children[i];
      if (!li) { li = document.createElement("li"); ul.appendChild(li); }
      li.dataset.i = i;
      li.title = typeof it.t === "number" ? "Clique para ir até este ponto na timeline" : "";
      li.style.cursor = typeof it.t === "number" ? "pointer" : "default";
      var key = it.state + "|" + Math.round((it.progress || 0) * 100) + "|" + it.msg + "|" + it.name + "|" + it.pct + "|" + it.st;
      if (li._key !== key) {
        var prev = li._state;
        li.className = it.state;
        li.innerHTML = rowHTML(it, tab);
        li._key = key; li._state = it.state;
        if (prev && prev !== it.state) {
          var ic = li.querySelector(".ico");
          if (it.state === "ok") ic.classList.add("pop");
          else if (it.state === "fail" || it.state === "skip") ic.classList.add("shake");
        }
      }
    });
    var act = q.items.filter(function (it) { return it.state !== "info"; });
    var idx = act.findIndex(function (it) { return it.state === "running"; });
    var done = act.filter(function (it) { return it.state !== "queued" && it.state !== "running"; }).length;
    $("qcount").textContent = q.active && act.length > 1 ? "[" + (idx >= 0 ? idx + 1 : done) + "/" + act.length + "]" : "";
    var frac = q.overall !== undefined ? q.overall : 0;
    $("overall").style.width = Math.round(frac * 100) + "%";
    $("cancel").hidden = !(q.active && q.cancelable);
    $("eta").hidden = !(q.active && q.eta);
    if (q.eta) $("etaText").textContent = q.eta;
    $("qclear").hidden = !!q.active || !q.items.length || q.items.some(function (it) { return it.state === "queued" || it.state === "running"; });
  }
  // "Limpar fila": so tira da tela o que ja terminou
  function clearQueue(k) {
    Object.assign(Q[k], { items: [], overall: 0, sub: "", note: "", eta: "", mission: "", statusMsg: "", statusCls: "", statusBig: false });
    if (k === "render") renderJobs = {};
    if (k === tab) { setStatus(""); renderQueue(); } else updateHome();
  }
  $("qclear").addEventListener("click", function () { clearQueue(tab); });
  function qRender(k) { if (k === tab) renderQueue(); else updateHome(); }
  $("queueList").addEventListener("click", async function (e) {
    var li = e.target.closest("li"); if (!li) return;
    var it = Q[tab].items[Number(li.dataset.i)];
    if (!it || typeof it.t !== "number") return;
    try { await host("cc_goTo", { sequenceId: Q[tab].sequenceId || "", t: it.t }); }
    catch (err) { setStatus(err.message, "err"); }
  });
  function qSet(k, patch) { Object.assign(Q[k], patch); qRender(k); }
  function qStatus(k, msg, cls, big) {
    Q[k].statusMsg = msg; Q[k].statusCls = cls; Q[k].statusBig = big; Q[k].mission = "";
    if (k === tab) setStatus(msg, cls, big);
    updateHome();
  }
  function qMission(k, what, time, extra) {
    Q[k].mission = missionHTML(what, time, extra); Q[k].statusMsg = ""; Q[k].statusCls = "";
    if (k === tab) { $("status").className = ""; $("status").innerHTML = Q[k].mission; }
    updateHome();
  }

  // "higiene" da fila: se o clipe (ou o marcador) de um item foi apagado da sequencia, o item sai
  var pruning = false;
  async function pruneQueues() {
    if (pruning || busyEngine || renderRun || document.hidden) return;
    if (TRACK_SEL[tab]) refreshTracks();
    var ask = {};
    Object.keys(Q).forEach(function (k) {
      var q = Q[k];
      if (q.active || !q.sequenceId) return;
      q.items.forEach(function (it) {
        if (!it.nodeIds && !it.guid) return;
        var a = ask[q.sequenceId] || (ask[q.sequenceId] = { sequenceId: q.sequenceId, nodeIds: [], guids: [] });
        if (it.nodeIds) a.nodeIds = a.nodeIds.concat(it.nodeIds);
        if (it.guid) a.guids.push(it.guid);
      });
    });
    var ids = Object.keys(ask);
    if (!ids.length) return;
    pruning = true;
    try {
      for (var n = 0; n < ids.length; n++) {
        var r = await host("cc_exists", ask[ids[n]]);
        Object.keys(Q).forEach(function (k) {
          var q = Q[k];
          if (q.active || q.sequenceId !== ids[n]) return;
          var before = q.items.length;
          q.items = q.items.filter(function (it) {
            if (!it.nodeIds && !it.guid) return true;
            if (!r.seq) return false;
            if (it.guid) return !!r.guids[it.guid];
            return it.nodeIds.some(function (id) { return r.nodeIds[id]; });
          });
          if (q.items.length !== before) qRender(k);
        });
      }
    } catch (e) {}
    pruning = false;
  }
  setInterval(pruneQueues, 2500);

  // tempo estimado: progresso por segundo de relogio
  function etaText(start, frac) {
    var el = (Date.now() - start) / 1000;
    if (el < 4 || frac <= 0.02) return "calculando…";
    return "≈ " + fmtTime(el * (1 - frac) / frac) + " restantes";
  }

  // ------------------------------------------------------------ python
  // o instalador grava em python_path.txt o Python que ele encontrou ou instalou
  function defaultPy() {
    try {
      var t = fs.readFileSync(path.join(EXT, "python_path.txt"), "utf8").trim();
      if (t) return t;
    } catch (e) {}
    return IS_WIN ? "py -3.12" : "python3";
  }
  // separa o comando respeitando aspas: "C:\Users\Lucas Chedick\python.exe" -3
  function splitCmd(str) {
    var out = [], re = /"([^"]*)"|(\S+)/g, m;
    while ((m = re.exec(str))) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
  }
  function pyCmd() {
    var parts = splitCmd($("py").value.trim());
    return { cmd: parts[0] || (IS_WIN ? "py" : "python3"), args: parts.slice(1) };
  }
  function killTree(p) {
    if (!p) return;
    try {
      if (IS_WIN) cp.spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true });
      else p.kill("SIGTERM");
    } catch (e) {}
  }
  var current = null, cancelled = false, busyEngine = false;

  // roda o motor; h = { progress(p), status(txt), job(i) }
  function runPy(args, h) {
    return new Promise(function (resolve, reject) {
      var py = pyCmd();
      var full = py.args.concat(args);
      addLog("> " + py.cmd + " " + full.join(" ") + "\n");
      var p, errBuf = "", outBuf = "", rest = "";
      try { p = cp.spawn(py.cmd, full, { windowsHide: true, env: PY_ENV }); }
      catch (e) { return reject(new Error("Não consegui iniciar o Python (" + py.cmd + ").")); }
      current = p;
      p.stdout.on("data", function (b) {
        var txt = rest + String(b), lines = txt.split(/\r?\n/);
        rest = lines.pop();
        lines.forEach(function (line) {
          var m;
          if ((m = /^PROGRESS ([\d.]+)/.exec(line))) { if (h && h.progress) h.progress(Math.min(1, Number(m[1]))); }
          else if ((m = /^STATUS (.*)/.exec(line))) { if (h && h.status) h.status(m[1]); addLog(m[1] + "\n"); }
          else if ((m = /^JOB (\d+)/.exec(line))) { if (h && h.job) h.job(Number(m[1])); }
          else if (line.trim()) { outBuf += line + "\n"; addLog(line + "\n"); }
        });
      });
      p.stderr.on("data", function (b) { errBuf += String(b); addLog(String(b)); });
      p.on("error", function () { reject(new Error("Python não encontrado (" + py.cmd + "). Use \"Testar Python\" nas Configurações.")); });
      p.on("close", function (code) {
        current = null;
        if (rest.trim()) outBuf += rest;
        if (cancelled) return reject(new Error("__cancel__"));
        if (code === 0) return resolve(outBuf);
        var m = /ERRO: (.*)/.exec(errBuf);
        var hint = /No module named/.test(errBuf) ? " Use \"Instalar transcrição\" nas Configurações." : "";
        reject(new Error((m ? m[1].trim() : "O motor falhou (código " + code + ").") + hint));
      });
    });
  }
  function engineFile() { return path.join(EXT, "engine", "cutcake.py"); }
  function tmpFile(ext) { return path.join(os.tmpdir(), "cutcake_" + Date.now() + "_" + Math.random().toString(36).slice(2) + ext); }
  // manda uma tarefa (hunt, captions) e devolve o JSON de resposta
  async function engineTask(task, h) {
    var tf = tmpFile(".json"), of = tmpFile(".json");
    fs.writeFileSync(tf, JSON.stringify(task), "utf8");
    try {
      await runPy([engineFile(), "run", "--task", tf, "--out", of], h);
      return JSON.parse(fs.readFileSync(of, "utf8"));
    } finally {
      try { fs.unlinkSync(tf); } catch (e) {}
      try { fs.unlinkSync(of); } catch (e) {}
    }
  }
  function baseTask(action, sel) {
    return {
      action: action, model: segVal("model") || "auto", device: $("optGpu").checked ? "auto" : "cpu", language: "pt",
      jobs: sel.jobs, range: sel.range
    };
  }

  function setBusy(b, kind) {
    busyEngine = b;
    ["syncBtn", "sRead", "takesBtn", "takesMontage", "huntBtn", "huntClear", "capCreate", "capUpgrade", "updateBtn", "hdrUpdate", "installWhisper", "testPy", "clearCache"].forEach(function (id) { $(id).disabled = b; });
    refresh();
    if (!b) $("cancel").disabled = false;
  }
  $("cancel").addEventListener("click", function () {
    if (!busyEngine) return;
    cancelled = true; $("cancel").disabled = true;
    qStatus(Object.keys(Q).filter(function (k) { return Q[k].active; })[0] || tab, "Cancelando…");
    killTree(current);
  });

  // progresso de varios clipes num processo so: o motor avisa "JOB i" e o progresso geral
  function jobHandlers(k, start) {
    var q = Q[k];
    return {
      progress: function (p) {
        q.overall = p;
        var run = q.items.filter(function (x) { return x.state === "running"; })[0];
        if (run && run.w) run.progress = Math.max(0, Math.min(0.99, (p - run.w0) / run.w));
        q.eta = etaText(start, p);
        qRender(k);
      },
      status: function (s) { q.sub = s; qRender(k); },
      job: function (i) {
        q.items.forEach(function (x, n) {
          if (n < i && x.state === "running") { x.state = "ok"; x.progress = 1; }
          if (n === i) { x.state = "running"; x.progress = 0; }
        });
        qRender(k);
      }
    };
  }
  function jobItems(sel, prefix) {
    var tot = sel.jobs.reduce(function (s, j) { return s + Math.max(0.1, j.out - j.in); }, 0), acc = 0;
    return sel.jobs.map(function (j) {
      var w = Math.max(0.1, j.out - j.in) / tot * 0.95, it = { name: prefix + j.name + (j.track ? " (" + j.track + ")" : ""), state: "queued", progress: 0, w0: acc * 0.95 / tot, w: w, msg: "" };
      if (j.nodeId) it.nodeIds = [j.nodeId];
      acc += Math.max(0.1, j.out - j.in);
      return it;
    });
  }
  function startQueue(k, title, items, sequenceId) {
    Object.assign(Q[k], { title: title, items: items, active: true, cancelable: true, overall: 0, eta: "", sub: "", note: "", sequenceId: sequenceId, mission: "" });
    cancelled = false;
    setBusy(true, k);
    taskbar.start();
    qRender(k);
  }
  function endQueue(k, err) {
    Q[k].active = false; Q[k].eta = ""; Q[k].sub = ""; cancelled = false;
    if (!err) Q[k].overall = 1;
    setBusy(false);
    if (err === "cancel") taskbar.stop(); else taskbar.finish(!!err);
    qRender(k);
  }
  function friendly(e) {
    return e.message === "__cancel__" ? "cancel" : e.message;
  }

  // ------------------------------------------------------------ SINCRONIZAR
  var lastSync = null;   // para desfazer: { sequenceId, moves }
  function groupLabel(g) {
    var tr = g.items.map(function (i) { return (i.type === "Audio" ? "A" : "V") + (i.track + 1); }).join("+");
    return g.name + " (" + tr + ")";
  }
  function fillRefs(sel) {
    var cur = $("sRef").value, html = '<option value="">Automático: a trilha de áudio mais baixa</option>';
    sel.groups.forEach(function (g) { html += '<option value="' + esc(g.key) + '">' + esc(groupLabel(g)) + "</option>"; });
    $("sRef").innerHTML = html;
    if (sel.groups.some(function (g) { return g.key === cur; })) $("sRef").value = cur;
  }
  $("sRead").addEventListener("click", async function () {
    try {
      var sel = await host("cc_syncGroups");
      fillRefs(sel);
      var auto = sel.groups.filter(function (g) { return g.key === sel.ref; })[0];
      qStatus("sync", plural(sel.groups.length, "clipe selecionado", "clipes selecionados") + ". No automático, a referência é " + (auto ? auto.name : "?") + ".", "ok");
    } catch (e) { qStatus("sync", e.message, "err"); }
  });
  function fmtDelta(d) { return (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(3).replace(".", ",") + " s"; }
  $("syncBtn").addEventListener("click", async function () {
    if (busyEngine) return;
    $("log").textContent = ""; qStatus("sync", "");
    var sel;
    try { sel = await host("cc_syncGroups"); }
    catch (e) { qStatus("sync", e.message, "err"); return; }
    fillRefs(sel);
    var refKey = $("sRef").value && sel.groups.some(function (g) { return g.key === $("sRef").value; }) ? $("sRef").value : sel.ref;
    var ref = sel.groups.filter(function (g) { return g.key === refKey; })[0];
    var others = sel.groups.filter(function (g) { return g.key !== refKey; });
    var t0 = Date.now(), n = others.length;
    startQueue("sync", "Sincronizar com " + ref.name, others.map(function (g, i) {
      return { name: g.name, state: "queued", progress: 0, w0: 0.4 + 0.6 * i / n, w: 0.6 / n, msg: "",
               nodeIds: g.items.map(function (x) { return x.nodeId; }) };
    }), sel.sequenceId);
    Q.sync.sub = "Referência: " + groupLabel(ref);
    var pick = function (g) { return { key: g.key, media: g.media, "in": g["in"], out: g.out, seq_start: g.seq_start, speed: g.speed, name: g.name }; };
    var task = { action: "sync", model: segVal("model") || "auto", device: $("optGpu").checked ? "auto" : "cpu", language: "pt",
                 ref: pick(ref), items: others.map(pick),
                 sync: { points: Number($("sPoints").value), seg: Number($("sSeg").value), speech: segVal("sSpeech") || "auto" } };
    try {
      var res = await engineTask(task, jobHandlers("sync", t0));
      var moves = [], byKey = {};
      others.forEach(function (g) { byKey[g.key] = g; });
      res.results.forEach(function (r, i) {
        var it = Q.sync.items[i], g = byKey[r.key];
        it.progress = 1;
        if (!r.ok) { it.state = "fail"; it.msg = r.msg || "Não achei este áudio na referência."; return; }
        it.pct = r.pct;
        var info = r.agree + " de " + r.total + " pontos" + (r.method === "fala" ? " · pela fala" : "") + (r.track ? " · " + r.track : "");
        if (r.pct < 50) { it.state = "skip"; it.st = "Não movi"; it.msg = "Não tenho certeza (" + info + "). Confira à mão."; return; }
        it.state = "ok"; it.st = fmtDelta(r.delta);
        it.msg = "Andou " + fmtDelta(r.delta) + " · " + info +
          (r.drift_frames >= 1 ? " · a câmera escorrega ~" + Math.round(r.drift_frames) + (Math.round(r.drift_frames) === 1 ? " quadro" : " quadros") + " ao longo do clipe" : "");
        it.t = g.seq_start + r.delta;
        moves.push({ key: g.key, delta: r.delta, items: g.items, name: g.name });
      });
      renderQueue();
      if (!moves.length) { endQueue("sync", true); qStatus("sync", "Nenhum clipe foi movido (veja a fila).", "err", true); play("Alert_FAIL.mp3"); return; }
      // ninguem pode ir para antes do 0: se precisar, empurra todo mundo (a referencia tambem)
      var minStart = Math.min.apply(null, moves.map(function (m) { return byKey[m.key].seq_start + m.delta; }));
      if (minStart < 0) {
        var shift = -minStart;
        moves.forEach(function (m) { m.delta += shift; });
        moves.push({ key: ref.key, delta: shift, items: ref.items, name: ref.name });
        Q.sync.sub = "Tudo foi empurrado " + fmtDelta(shift) + " para nenhum clipe ficar antes do começo da timeline.";
      }
      var mv = await host("cc_syncMove", { sequenceId: sel.sequenceId, moves: moves });
      if (!mv.ok && mv.reason) {
        Q.sync.items.forEach(function (x) { if (x.state === "ok") { x.state = "skip"; x.st = "Não movi"; } });
        endQueue("sync", true);
        qStatus("sync", (mv.reason === "overlap" ? "Não movi nada: algum clipe cairia em cima de outro. Abra espaço na trilha: " : "Não movi nada: algum clipe iria para antes do começo: ") +
                mv.names.slice(0, 3).join("; ") + (mv.names.length > 3 ? "…" : ""), "err", true);
        play("Alert_FAIL.mp3");
        return;
      }
      lastSync = { sequenceId: sel.sequenceId, moves: moves.map(function (m) { return { key: m.key, delta: -m.delta, items: m.items }; }) };
      $("syncUndo").disabled = false;
      endQueue("sync", mv.fails && mv.fails.length);
      var okN = Q.sync.items.filter(function (x) { return x.state === "ok"; }).length;
      var bad = Q.sync.items.length - okN;
      if (mv.fails && mv.fails.length) qStatus("sync", "Não consegui mover: " + mv.fails.join(", "), "err", true);
      else qMission("sync", plural(okN, "clipe sincronizado", "clipes sincronizados"), fmtTime((Date.now() - t0) / 1000), bad ? plural(bad, "para conferir", "para conferir") : "");
      play(bad ? "Alert_FAIL.mp3" : "Alert_OK.mp3");
      notifyEnd(bad ? "Sincronização com pendências" : "Missão cumprida!", plural(okN, "clipe sincronizado", "clipes sincronizados") + ".");
    } catch (e) {
      var m = friendly(e);
      Q.sync.items.forEach(function (x) { if (x.state === "running" || x.state === "queued") x.state = m === "cancel" ? "cancel" : "fail"; });
      endQueue("sync", m === "cancel" ? "cancel" : true);
      if (m === "cancel") qStatus("sync", "Sincronização cancelada.");
      else { qStatus("sync", m, "err", true); play("Alert_FAIL.mp3"); }
    }
  });
  $("syncUndo").addEventListener("click", async function () {
    if (!lastSync) return;
    try {
      var r = await host("cc_syncMove", lastSync);
      if (!r.ok) throw new Error(r.reason ? "algum clipe cairia em cima de outro." : "não consegui mover: " + (r.fails || []).join(", "));
      lastSync = null; $("syncUndo").disabled = true;
      Q.sync.items = []; renderQueue();
      qStatus("sync", "Pronto: os clipes voltaram para onde estavam.", "ok", true);
    } catch (e) { qStatus("sync", "Não consegui desfazer: " + e.message + " Use Ctrl+Z no Premiere.", "err"); }
  });

  // ------------------------------------------------------------ TAKES
  // Acha os takes bons (o ultimo bloco de fala antes do gatilho) e marca na timeline.
  var WHY = { "sem pausa antes": "sem pausa antes", "sem pausa depois": "sem pausa depois", "não tem fala antes": "não tem fala antes",
              "não tem fala depois": "não tem fala depois", "take curto demais": "o take ficou curto demais" };
  $("takesBtn").addEventListener("click", async function () {
    if (busyEngine) return;
    $("log").textContent = ""; qStatus("takes", "");
    var after = linesOf("tAfter"), before = linesOf("tBefore");
    if (!after.length && !before.length) { qStatus("takes", "Nenhum gatilho configurado. Veja em Configurações → Takes.", "err"); return; }
    var sel;
    try { sel = await host("cc_getJobs", jobsArg("takes", false)); }
    catch (e) { qStatus("takes", e.message, "err"); return; }
    var t0 = Date.now();
    startQueue("takes", "Takes", jobItems(sel, "Transcrever: "), sel.sequenceId);
    Q.takes.note = tracksNote(sel);
    var task = baseTask("takes", sel), pad = Number($("tPad").value) / 10;
    task.takes = { pause: Number($("tPause").value) / 10, silence: Number($("tSil").value) / 10, pad_in: pad, pad_out: pad,
                   after: after, before: before };
    try {
      var res = await engineTask(task, jobHandlers("takes", t0));
      Q.takes.items.forEach(function (x) { if (x.state !== "fail") { x.state = "ok"; x.progress = 1; } });
      Q.takes.sub = "Criando os marcadores…"; renderQueue();
      if ($("tReplace").checked) { try { await host("cc_clearMarkers", { sequenceId: sel.sequenceId, tag: TAG_TAKE }); } catch (e1) { addLog(e1.message + "\n"); } }
      var added = { guids: [] };
      if (res.takes.length) {
        added = await host("cc_addMarkers", { sequenceId: sel.sequenceId, color: colorTake(), items: res.takes.map(function (t) {
          return { start: t.start, end: t.end, name: "Take " + t.n,
                   comment: "“" + t.first + "”\nGatilho: " + t.trigger + " (" + fmtClock(t.trigger_t) + ")\n" + TAG_TAKE };
        }) });
      }
      var silTxt = (Number($("tSil").value) / 10).toFixed(1).replace(".", ",") + " s";
      Q.takes.items = res.takes.map(function (t, i) {
        return { name: "Take " + t.n + " · " + fmtClock(t.start) + " (" + Math.round(t.end - t.start) + "s)", state: "info", icon: "Takes", st: "",
                 t: t.start, guid: (added.guids || [])[i] || undefined,
                 msg: "“" + t.first + "” … gatilho “" + t.trigger + "”" + (res.takes.length > 1 && t.clip ? " · " + t.clip : "") };
      }).concat(res.ignored.map(function (g) {
        return { name: "“" + g.trigger + "” em " + fmtClock(g.t), state: "skip", st: "Ignorado", t: g.t,
                 msg: (WHY[g.why] || g.why) + ". O gatilho precisa de " + silTxt + " de silêncio antes e depois." };
      }));
      Q.takes.title = res.takes.length ? "Takes encontrados" : "Takes";
      endQueue("takes", !res.takes.length);
      var elapsed = (Date.now() - t0) / 1000;
      if (res.takes.length) {
        qMission("takes", plural(res.takes.length, "take marcado", "takes marcados"), fmtTime(elapsed),
                 res.ignored.length ? plural(res.ignored.length, "gatilho ignorado", "gatilhos ignorados") : "");
        play("Alert_OK.mp3");
        notifyEnd("Missão cumprida!", plural(res.takes.length, "take marcado", "takes marcados") + " em " + fmtTime(elapsed) + ".");
      } else {
        qStatus("takes", !res.words ? "Não ouvi fala neste clipe." :
                "Não achei nenhum gatilho (“" + (after[0] || before[0]) + "”…) com pausa em volta. Confira os gatilhos em Configurações → Takes.", "err", true);
        play("Alert_FAIL.mp3");
      }
    } catch (e) {
      var m = friendly(e);
      Q.takes.items.forEach(function (x) { if (x.state === "running" || x.state === "queued") x.state = m === "cancel" ? "cancel" : "fail"; });
      endQueue("takes", m === "cancel" ? "cancel" : true);
      if (m === "cancel") qStatus("takes", "Cancelado.");
      else { qStatus("takes", m, "err", true); play("Alert_FAIL.mp3"); notifyEnd("Os takes falharam", m); }
    }
  });

  // Montagem: copia cada take (todas as trilhas) e cola um em seguida do outro, 1 min depois do ultimo clipe
  $("takesMontage").addEventListener("click", async function () {
    if (busyEngine) return;
    qStatus("takes", "Montando…");
    var own = segVal("tUse") !== "all";
    $("takesMontage").disabled = true;
    try {
      var r = await host("cc_takesMontage", { sequenceId: "", color: colorTake(), onlyTag: own, gap: 60 });
      if (r.reason === "nomarkers") {
        qStatus("takes", own
          ? "Nenhum take marcado pelo CutCake nesta sequência. Use “Marcar takes” primeiro" + (r.other ? " ou escolha “Todos da cor do take” embaixo." : ".")
          : "Nenhum marcador com duração na cor " + colorName(colorTake()) + " nesta sequência.", "err");
        $("takesMontage").disabled = busyEngine;
        return;
      }
      var items = r.takes.map(function (t) {
        var okT = (t.ok || 0) >= t.clips && t.clips > 0;
        return { name: (t.name || "Take") + " → " + fmtClock(t.at), state: okT ? "ok" : "fail", st: Math.round(t.end - t.start) + "s", t: t.at,
                 msg: "Do trecho " + fmtClock(t.start) + " – " + fmtClock(t.end) + " · " + plural(t.clips, "clipe", "clipes") + (okT ? "" : " · algum clipe não foi colado") };
      });
      qSet("takes", { items: items, title: "Montagem", overall: 1, sequenceId: r.sequenceId, note: "",
                      sub: "Começa em " + fmtClock(r.start) + ", 1 minuto depois do último clipe. O original continua no lugar." });
      if (r.fails.length) {
        qStatus("takes", "Montei, mas não consegui colar: " + r.fails.slice(0, 3).join("; ") + (r.fails.length > 3 ? "…" : "") + ". Confira na timeline.", "err", true);
        play("Alert_FAIL.mp3");
      } else {
        qMission("takes", plural(r.takes.length, "take montado", "takes montados"), "",
                 r.skipped.length ? "gráficos e títulos não vão junto" : "");
        play("Alert_OK.mp3");
      }
    } catch (e) { qStatus("takes", e.message, "err", true); play("Alert_FAIL.mp3"); }
    $("takesMontage").disabled = busyEngine;
  });

  // ------------------------------------------------------------ CAÇAR
  $("huntBtn").addEventListener("click", async function () {
    if (busyEngine) return;
    $("log").textContent = ""; qStatus("hunt", "");
    var sel;
    try { sel = await host("cc_getJobs", jobsArg("hunt", $("hRange").checked)); }
    catch (e) { qStatus("hunt", e.message, "err"); return; }
    var t0 = Date.now();
    startQueue("hunt", "Caçador", jobItems(sel, "Transcrever: "), sel.sequenceId);
    Q.hunt.note = (sel.range ? "Só entre o In e o Out (" + fmtClock(sel.range[0]) + " – " + fmtClock(sel.range[1]) + "). " : "") + tracksNote(sel);
    var task = baseTask("hunt", sel);
    task.hunt = { count: Number($("hCount").value), min: Number($("hMin").value), max: Number($("hMax").value), lists: getLists() };
    try {
      var res = await engineTask(task, jobHandlers("hunt", t0));
      Q.hunt.items.forEach(function (x) { if (x.state !== "fail") { x.state = "ok"; x.progress = 1; } });
      Q.hunt.sub = "Criando os marcadores…"; renderQueue();
      if ($("hReplace").checked) { try { await host("cc_clearMarkers", { sequenceId: sel.sequenceId, tag: TAG_HUNT }); } catch (e1) { addLog(e1.message + "\n"); } }
      var items = res.cuts.map(function (c) {
        return { start: c.start, end: c.end, name: "Corte " + c.n + " • " + c.pct + "%",
                 comment: c.first + (c.reasons.length ? "\nMotivos: " + c.reasons.join(", ") : "") + "\n" + TAG_HUNT };
      });
      var added = await host("cc_addMarkers", { sequenceId: sel.sequenceId, color: colorCut(), items: items });
      var elapsed = (Date.now() - t0) / 1000;
      Q.hunt.items = res.cuts.map(function (c, i) {
        return { name: "Corte " + c.n + " · " + fmtClock(c.start) + " (" + Math.round(c.end - c.start) + "s)", state: "info", icon: "Marker",
                 pct: c.pct, st: "", t: c.start, msg: "“" + c.first + "”" + (c.reasons.length ? " · " + c.reasons.join(", ") : ""),
                 guid: (added.guids || [])[i] || undefined };
      });
      Q.hunt.title = "Cortes encontrados";
      endQueue("hunt");
      var low = res.cuts.filter(function (c) { return c.pct < 50; }).length;
      qMission("hunt", plural(res.cuts.length, "corte encontrado", "cortes encontrados"), fmtTime(elapsed),
               low ? plural(low, "com nota baixa", "com nota baixa") : "");
      Q.hunt.lastSummary = res.cuts.map(function (c) { return "- " + c.n + ": " + c.start + "–" + c.end + " " + c.pct + "% " + c.reasons.join(","); }).join("\n") +
        "\nmodelo " + res.model + (res.gpu ? " (placa de vídeo)" : " (processador)") + " · transcrição " + res.transcribe_time + "s";
      play("Alert_OK.mp3");
      notifyEnd("Missão cumprida!", plural(res.cuts.length, "corte encontrado", "cortes encontrados") + " em " + fmtTime(elapsed) + ".");
    } catch (e) {
      var m = friendly(e);
      Q.hunt.items.forEach(function (x) { if (x.state === "running" || x.state === "queued") x.state = m === "cancel" ? "cancel" : "fail"; });
      endQueue("hunt", m === "cancel" ? "cancel" : true);
      if (m === "cancel") qStatus("hunt", "Caçada cancelada.");
      else { qStatus("hunt", m, "err", true); play("Alert_FAIL.mp3"); notifyEnd("O Caçador falhou", m); }
    }
  });

  $("huntClear").addEventListener("click", async function () {
    try {
      var r = await host("cc_clearMarkers", { sequenceId: "", tag: TAG_HUNT });
      qStatus("hunt", r.count ? plural(r.count, "marcador apagado.", "marcadores apagados.") : "Nenhum marcador do Caçador nesta sequência.", r.count ? "ok" : "", true);
      if (r.count) { Q.hunt.items = []; renderQueue(); }
    } catch (e) { qStatus("hunt", e.message, "err"); }
  });

  // ------------------------------------------------------------ LEGENDAR
  function safeName(s) { return String(s || "").replace(/[\\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim(); }
  $("capCreate").addEventListener("click", async function () {
    if (busyEngine) return;
    $("log").textContent = ""; qStatus("captions", "");
    var sel;
    try { sel = await host("cc_getJobs", jobsArg("captions", $("cRange").checked)); }
    catch (e) { qStatus("captions", e.message, "err"); return; }
    var t0 = Date.now();
    startQueue("captions", "Legendas", jobItems(sel, "Transcrever: "), sel.sequenceId);
    Q.captions.note = tracksNote(sel);
    var dir = path.join(DATA, "legendas");
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e0) {}
    var d = new Date(), stamp = d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2) + "-" +
      ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2) + ("0" + d.getSeconds()).slice(-2);
    var style = segVal("capStyle"), mode = segVal("capMode");
    var task = baseTask("captions", sel);
    task.srt = path.join(dir, safeName(sel.seqName) + " " + stamp + ".srt");
    task.captions = { style: style, mode: mode, words: Number($("cWords").value), max_chars: Number($("cChars").value),
                      upper: $("cUpper").checked, strip_punct: $("cPunct").checked };
    try {
      var res = await engineTask(task, jobHandlers("captions", t0));
      Q.captions.items.forEach(function (x) { x.state = "ok"; x.progress = 1; });
      Q.captions.sub = "Criando a trilha de legendas…"; renderQueue();
      await host("cc_importCaptions", { sequenceId: sel.sequenceId, srt: res.srt });
      Q.captions.items.push({ name: plural(res.cues, "legenda criada", "legendas criadas"), state: "info", icon: "Captions", st: "",
                              msg: path.basename(res.srt) });
      endQueue("captions");
      qMission("captions", plural(res.cues, "legenda criada", "legendas criadas"), fmtTime((Date.now() - t0) / 1000),
               style === "rise" ? "agora selecione e faça o Upgrade" : "");
      play("Alert_OK.mp3");
      notifyEnd("Missão cumprida!", plural(res.cues, "legenda criada", "legendas criadas") + ".");
    } catch (e) {
      var m = friendly(e);
      Q.captions.items.forEach(function (x) { if (x.state === "running" || x.state === "queued") x.state = m === "cancel" ? "cancel" : "fail"; });
      endQueue("captions", m === "cancel" ? "cancel" : true);
      if (m === "cancel") qStatus("captions", "Cancelado.");
      else { qStatus("captions", m, "err", true); play("Alert_FAIL.mp3"); }
    }
  });

  // "Upgrade Caption to Graphic": o painel aciona o mesmo item do menu do Premiere.
  // Os comandos do menu agem sobre o painel que esta com o foco. Quando o clique vem do CutCake,
  // o foco esta no CutCake, e o comando nao achava as legendas selecionadas (v1.0.2: "OK", mas
  // nada mudava). Por isso, antes do comando, o foco vai para a timeline:
  // menu Janela > Linhas do tempo > <sequencia> (ou o atalho Shift+3, se o menu nao aparecer).
  // Depois o painel confere se apareceram graficos novos na timeline.
  var MENU_RE = "upgrade.*caption.*graphic|caption.*to.*graphic|legenda.*para.*gr[aá]fico|legenda.*em.*gr[aá]fico";
  function reEsc(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function focusRe(seqName) {
    return seqName ? "^(window|janela) > (timelines?|linhas do tempo|linha do tempo|sequ[eê]ncias?) > " + reEsc(seqName) + "$" : "";
  }
  function upgradeScriptWin(seqName) {
    return [
      "Add-Type -TypeDefinition @'",
      "using System; using System.Text; using System.Runtime.InteropServices; using System.Text.RegularExpressions;",
      "public static class CCMenu {",
      " [DllImport(\"user32.dll\")] static extern IntPtr GetMenu(IntPtr h);",
      " [DllImport(\"user32.dll\")] static extern int GetMenuItemCount(IntPtr m);",
      " [DllImport(\"user32.dll\")] static extern IntPtr GetSubMenu(IntPtr m, int i);",
      " [DllImport(\"user32.dll\")] static extern uint GetMenuItemID(IntPtr m, int i);",
      " [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] static extern int GetMenuString(IntPtr m, uint id, StringBuilder s, int max, uint flags);",
      " [DllImport(\"user32.dll\")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);",
      " [DllImport(\"user32.dll\")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);",
      " [DllImport(\"user32.dll\")] static extern bool SetForegroundWindow(IntPtr h);",
      " [DllImport(\"user32.dll\")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);",
      " static uint found; static string where;",
      " static void Walk(IntPtr h, IntPtr m, Regex re, bool full, string path, int depth) {",
      "  int n = GetMenuItemCount(m);",
      "  for (int i = 0; i < n && found == 0; i++) {",
      "   StringBuilder sb = new StringBuilder(256); GetMenuString(m, (uint)i, sb, 256, 0x400);",
      "   string t = sb.ToString().Replace(\"&\", \"\"); int tab = t.IndexOf('\\t'); if (tab >= 0) t = t.Substring(0, tab);",
      "   IntPtr sub = GetSubMenu(m, i);",
      "   if (sub != IntPtr.Zero) { if (depth < 4) { SendMessage(h, 0x0117, sub, (IntPtr)i); Walk(h, sub, re, full, path + t + \" > \", depth + 1); } }",
      "   else if (re.IsMatch(full ? path + t : t)) { found = GetMenuItemID(m, i); where = path + t; }",
      "  }",
      " }",
      " static uint Find(IntPtr h, string pattern, bool full) {",
      "  IntPtr m = GetMenu(h); if (m == IntPtr.Zero || pattern.Length == 0) return 0;",
      "  found = 0; where = \"\"; Walk(h, m, new Regex(pattern, RegexOptions.IgnoreCase), full, \"\", 0);",
      "  return found == 0xFFFFFFFF ? 0 : found;",
      " }",
      " public static string Run(IntPtr h, string upPattern, string focusPattern) {",
      "  if (GetMenu(h) == IntPtr.Zero) return \"NOMENU\";",
      "  uint up = Find(h, upPattern, false); string upWhere = where;",
      "  if (up == 0) return \"NOTFOUND\";",
      "  uint fo = Find(h, focusPattern, true); string foWhere = where;",
      "  SetForegroundWindow(h); System.Threading.Thread.Sleep(150);",
      "  string how;",
      "  if (fo != 0) { SendMessage(h, 0x0111, (IntPtr)fo, IntPtr.Zero); how = \"foco pelo menu \" + foWhere; }",
      "  else { keybd_event(0x10, 0, 0, UIntPtr.Zero); keybd_event(0x33, 0, 0, UIntPtr.Zero); keybd_event(0x33, 0, 2, UIntPtr.Zero); keybd_event(0x10, 0, 2, UIntPtr.Zero); how = \"foco pelo Shift+3\"; }",
      "  System.Threading.Thread.Sleep(450);",
      "  PostMessage(h, 0x0111, (IntPtr)up, IntPtr.Zero);",
      "  return \"OK|\" + how + \"|\" + upWhere;",
      " }",
      "}",
      "'@",
      "$p = Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
      "if (-not $p) { 'NOPREMIERE'; exit }",
      "[CCMenu]::Run($p.MainWindowHandle, " + psStr(MENU_RE) + ", " + psStr(focusRe(seqName)) + ")"
    ].join("\n");
  }
  function asStr(t) { return '"' + String(t).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  function upgradeScriptMac(seqName) {
    return [
      'tell application "System Events"',
      '  set pp to first application process whose name contains "Premiere Pro"',
      '  set frontmost of pp to true',
      '  delay 0.2',
      '  tell pp',
      // foco na timeline: Window > Timelines > <sequencia>
      '    set focused to false',
      '    repeat with wn in {"Window", "Janela"}',
      '      repeat with tn in {"Timelines", "Linhas do tempo"}',
      '        try',
      '          click menu item ' + asStr(seqName || "") + ' of menu 1 of menu item (tn as text) of menu 1 of menu bar item (wn as text) of menu bar 1',
      '          set focused to true',
      '        end try',
      '        if focused then exit repeat',
      '      end repeat',
      '      if focused then exit repeat',
      '    end repeat',
      '    delay 0.4',
      '    repeat with mb in menu bar items of menu bar 1',
      '      try',
      '        repeat with mi in menu items of menu 1 of mb',
      '          try',
      '            set n to name of mi',
      '            if n is not missing value then',
      '              if (n contains "Upgrade Caption") or ((n contains "egenda") and (n contains "gráfico")) then',
      '                click mi',
      '                return "OK|foco " & focused & "|" & n',
      '              end if',
      '            end if',
      '          end try',
      '        end repeat',
      '      end try',
      '    end repeat',
      '  end tell',
      'end tell',
      'return "NOTFOUND"'
    ].join("\n");
  }
  var MANUAL_UPGRADE = "Faça à mão: na timeline, clique na primeira legenda e Shift+clique na última, e vá no menu Gráficos e Títulos → Upgrade Caption to Graphic (em português: Atualizar legenda para gráfico).";
  $("capUpgrade").addEventListener("click", async function () {
    $("capUpgrade").disabled = true;
    qStatus("captions", "Convertendo as legendas selecionadas…");
    try {
      var info = await loadProjInfo(), before = null;
      try { before = await host("cc_graphicsCount"); } catch (e0) {}
      var out = IS_WIN ? await psRun(upgradeScriptWin(info.seqName)) : IS_MAC ? await exec("osascript", ["-e", upgradeScriptMac(info.seqName)]) : "NOMENU";
      out = String(out).trim().split(/\r?\n/).pop();
      addLog("upgrade: " + out + "\n");
      if (/^OK/.test(out)) {
        // confere se apareceram graficos novos (a conversao pode levar alguns segundos)
        var made = -1;
        if (before) {
          for (var w = 0; w < 8 && made <= 0; w++) {
            await sleep(700);
            try { made = (await host("cc_graphicsCount")).count - before.count; } catch (e1) { made = -1; break; }
          }
        }
        if (made > 0) {
          qMission("captions", plural(made, "legenda virou gráfico", "legendas viraram gráfico"), "", segVal("capStyle") === "rise" ? "agora selecione e anime" : "");
          play("Alert_OK.mp3");
        } else if (made === 0) qStatus("captions", "Mandei o comando, mas as legendas não viraram gráfico. " + MANUAL_UPGRADE, "err", true);
        else qStatus("captions", "Mandei o comando. Se as legendas não viraram gráfico, " + MANUAL_UPGRADE.charAt(0).toLowerCase() + MANUAL_UPGRADE.slice(1), "ok", true);
      }
      else if (out === "NOPREMIERE") qStatus("captions", "Não encontrei a janela do Premiere. " + MANUAL_UPGRADE, "err", true);
      else qStatus("captions", "Não achei o comando no menu do Premiere. " + MANUAL_UPGRADE, "err", true);
    } catch (e) {
      addLog("upgrade: " + e.message + "\n");
      var acc = IS_MAC && /not allowed|assistive|1002|-1719|-25211/i.test(e.message);
      qStatus("captions", acc ? "O Mac precisa liberar o Premiere em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade. " + MANUAL_UPGRADE
                              : "Não consegui acionar o menu sozinho. " + MANUAL_UPGRADE, "err", true);
    }
    $("capUpgrade").disabled = busyEngine;
  });

  $("capAnimate").addEventListener("click", async function () {
    try {
      var r = await host("cc_animateRise", { dur: Number($("cDur").value) / 100, dist: Number($("cDist").value) });
      var msg = plural(r.count, "gráfico animado.", "gráficos animados.");
      if (r.fails && r.fails.length) msg += " Sem Motion/Opacidade: " + r.fails.slice(0, 3).join(", ") + (r.fails.length > 3 ? "…" : "");
      if (r.fails && r.fails.length) qStatus("captions", msg, "err", true);
      else { qMission("captions", plural(r.count, "gráfico animado", "gráficos animados")); play("Alert_OK.mp3"); }
    } catch (e) { qStatus("captions", e.message, "err"); }
  });

  // ------------------------------------------------------------ ZOOM
  $("zoomBtn").addEventListener("click", async function () {
    qStatus("zoom", "");
    try {
      var r = await host("cc_applyZoom", { sequenceId: "", color: colorZoom(), amount: Number($("zAmount").value) / 100,
                                           ramp: Number($("zRamp").value) / 10, focusY: Number(segVal("zFocus") || 0.5), force: $("zForce").checked });
      var items = [];
      if (r.count) items.push({ name: plural(r.count, "trecho com zoom", "trechos com zoom"), state: "ok", st: "+" + $("zAmount").value + "%" });
      if (r.skipped) items.push({ name: plural(r.skipped, "já tinha zoom", "já tinham zoom"), state: "skip", st: "Pulado", msg: "Ligue \"Aplicar de novo\" em Mais opções para refazer." });
      (r.empty || []).forEach(function (n) { items.push({ name: n, state: "fail", msg: "Não achei clipe de vídeo embaixo deste marcador." }); });
      qSet("zoom", { items: items, title: "Resultado", overall: items.length ? 1 : 0 });
      if (!r.count && !r.skipped && !(r.empty || []).length) {
        qStatus("zoom", "Nenhum marcador de zoom com duração (cor " + colorName(colorZoom()) + ") nesta sequência." +
                (r.points ? " Há " + plural(r.points, "marcador sem duração", "marcadores sem duração") + " dessa cor." : ""), "err");
      } else if (r.count) { qMission("zoom", plural(r.count, "zoom aplicado", "zooms aplicados")); play("Alert_OK.mp3"); }
      else qStatus("zoom", "Nada novo para aplicar.", "", true);
    } catch (e) { qStatus("zoom", e.message, "err"); }
  });
  async function markRange(k, color, label) {
    try {
      var r = await host("cc_markRange", { color: color, name: label + " {n}", comment: "" });
      qStatus(k, "Marcador \"" + r.name + "\" criado (" + fmtClock(r.start) + " – " + fmtClock(r.end) + (r.from === "inout" ? ", do In ao Out" : ", dos clipes selecionados") + ").", "ok");
    } catch (e) { qStatus(k, e.message, "err"); }
  }
  $("zoomMark").addEventListener("click", function () { markRange("zoom", colorZoom(), "Zoom"); });
  $("renderMark").addEventListener("click", function () { markRange("render", colorCut(), "Corte"); });

  // ------------------------------------------------------------ RENDER
  var projInfo = { appPath: "", project: "", seqName: "" };
  async function loadProjInfo() { try { projInfo = await host("cc_info"); } catch (e) {} return projInfo; }
  function fileName(n, markerName, seqName) {
    var pat = $("rName").value.trim() || DEF.rName;
    var nome = String(markerName || "").replace(/\s*•\s*\d+%\s*$/, "");
    var out = pat.replace(/\{data\}/gi, today()).replace(/\{n\}/gi, String(n)).replace(/\{nome\}/gi, nome).replace(/\{seq\}/gi, seqName || "");
    return safeName(out) || ("corte " + n);
  }
  function defaultFolder() {
    return projInfo.project ? path.join(path.dirname(projInfo.project), "Cortes") : path.join(os.homedir(), "Desktop", "Cortes");
  }
  function outFolder() { return load("rFolder", "") || defaultFolder(); }
  function showFolder() {
    var custom = !!load("rFolder", "");
    $("rFolderTxt").textContent = outFolder();
    $("rFolderTxt").title = outFolder() + (custom ? "" : " (padrão: pasta Cortes ao lado do projeto)");
    $("rFolderReset").hidden = !custom;
  }
  // presets: os seus (Media Encoder) e os H.264 do Premiere
  function listDir(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; } }
  function findEpr(dir, depth, out) {
    listDir(dir).forEach(function (e) {
      var full = path.join(dir, e.name);
      if (e.isDirectory() && depth > 0) findEpr(full, depth - 1, out);
      else if (/\.epr$/i.test(e.name)) out.push(full);
    });
    return out;
  }
  function docsDirs() {
    var h = os.homedir(), c = [path.join(h, "Documents")];
    if (IS_WIN) c.push(path.join(h, "OneDrive", "Documentos"), path.join(h, "OneDrive", "Documents"), path.join(h, "Documentos"));
    return c.filter(function (d) { return fs.existsSync(d); });
  }
  function scanPresets() {
    var mine = [], sys = [];
    docsDirs().forEach(function (d) {
      listDir(path.join(d, "Adobe", "Adobe Media Encoder")).forEach(function (v) {
        if (v.isDirectory()) findEpr(path.join(d, "Adobe", "Adobe Media Encoder", v.name, "Presets"), 1, mine);
      });
    });
    var roots = [];
    if (projInfo.appPath) {
      roots.push(path.join(projInfo.appPath, "MediaIO", "systempresets"));
      roots.push(path.join(projInfo.appPath, "Contents", "MediaIO", "systempresets"));
    }
    roots.forEach(function (r) {
      findEpr(r, 2, []).forEach(function (f) {
        if (/match source|youtube|vimeo|alta taxa|high bitrate/i.test(path.basename(f)) && /4E49434B_48323634|H264|H\.264/i.test(f + path.basename(f)))
          sys.push(f);
      });
    });
    var uniq = function (l) { var s = {}; return l.filter(function (f) { var k = path.basename(f).toLowerCase(); if (s[k]) return false; s[k] = 1; return true; }); };
    return { mine: uniq(mine), sys: uniq(sys).sort(function (a, b) { return rankSys(a) - rankSys(b); }) };
  }
  function rankSys(f) { var n = path.basename(f).toLowerCase(); return n.indexOf("adaptive high") >= 0 ? 0 : n.indexOf("match source") >= 0 ? 1 : 2; }
  function presetLabel(f) { return path.basename(f).replace(/\.epr$/i, ""); }
  function fillPresets() {
    var sel = $("rPreset"), saved = load("rPreset", ""), p = scanPresets(), html = "";
    var opt = function (f) { return '<option value="' + esc(f) + '"' + (f === saved ? " selected" : "") + ">" + esc(presetLabel(f)) + "</option>"; };
    var known = p.mine.concat(p.sys);
    if (saved && known.indexOf(saved) < 0 && fs.existsSync(saved)) html += '<optgroup label="Escolhido">' + opt(saved) + "</optgroup>";
    if (p.mine.length) html += '<optgroup label="Meus presets">' + p.mine.map(opt).join("") + "</optgroup>";
    if (p.sys.length) html += '<optgroup label="Do Premiere (H.264)">' + p.sys.map(opt).join("") + "</optgroup>";
    html += '<option value="__browse">Procurar arquivo .epr…</option>';
    sel.innerHTML = html;
    if (!saved || !fs.existsSync(saved)) {
      var first = p.sys[0] || p.mine[0] || "";
      if (first) { sel.value = first; save("rPreset", first); }
      else sel.value = "__browse";
    }
    presetHint();
  }
  function presetHint() {
    var v = $("rPreset").value, h = $("rPresetHint");
    h.title = v && v !== "__browse" ? v : "";
    if (!v || v === "__browse") h.textContent = "Nenhum preset encontrado. Escolha um arquivo .epr (crie um no Media Encoder ou exporte do Premiere).";
    else if (/systempresets/i.test(v)) h.textContent = "Preset do Premiere (H.264), na resolução da sequência.";
    else if (/Adobe Media Encoder/i.test(v)) h.textContent = "Seu preset do Media Encoder.";
    else h.textContent = "Arquivo: " + path.basename(path.dirname(v)) + path.sep + path.basename(v);
  }
  function pickDialog(dir, title, types) {
    try {
      var fn = window.cep && window.cep.fs && (window.cep.fs.showOpenDialogEx || window.cep.fs.showOpenDialog);
      if (!fn) return "";
      var r = fn.call(window.cep.fs, false, dir, title, "", types || []);
      return r && r.data && r.data[0] ? decodeURIComponent(String(r.data[0]).replace(/^file:\/\//, "")) : "";
    } catch (e) { addLog("diálogo: " + e.message + "\n"); return ""; }
  }
  $("rPreset").addEventListener("change", function () {
    var v = $("rPreset").value;
    if (v === "__browse") {
      var f = pickDialog(false, "Escolha o preset (.epr)", ["epr"]);
      if (f) save("rPreset", f);
      fillPresets();
      return;
    }
    save("rPreset", v); presetHint();
  });
  $("rFolderPick").addEventListener("click", function () {
    var d = pickDialog(true, "Pasta dos cortes");
    if (d) { save("rFolder", d); showFolder(); }
  });
  $("rFolderReset").addEventListener("click", function () { save("rFolder", ""); showFolder(); });
  $("rFolderTxt").addEventListener("click", function () { var d = outFolder(); if (fs.existsSync(d)) openFolder(d); });
  async function refreshRender() { await loadProjInfo(); fillPresets(); showFolder(); refresh(); }

  // pergunta com botoes; devolve o valor do botao clicado
  function ask(title, html, buttons) {
    return new Promise(function (resolve) {
      $("askTitle").textContent = title;
      $("askBody").innerHTML = html;
      $("askBtns").innerHTML = "";
      var done = function (v) { $("askModal").classList.remove("show"); resolve(v); };
      buttons.forEach(function (b) {
        var el = document.createElement("button");
        el.className = "btn full " + (b.cls || "secondary");
        el.textContent = b.label;
        el.addEventListener("click", function () { done(b.value); });
        $("askBtns").appendChild(el);
      });
      $("askClose").onclick = function () { done(null); };
      $("askModal").classList.add("show");
    });
  }

  var renderJobs = {};   // jobID -> item
  var renderRun = null;
  $("renderBtn").addEventListener("click", async function () {
    if (renderRun) return;
    qStatus("render", "");
    try {
      await loadProjInfo();
      var mk = await host("cc_getMarkers", { sequenceId: "", color: colorCut(), durationOnly: true });
      if (!mk.markers.length) {
        qStatus("render", "Nenhum marcador de corte com duração (cor " + colorName(colorCut()) + ") nesta sequência." +
                (mk.points ? " Há " + plural(mk.points, "marcador sem duração", "marcadores sem duração") + " dessa cor." : ""), "err");
        return;
      }
      var preset = $("rPreset").value;
      if (!preset || preset === "__browse" || !fs.existsSync(preset)) { qStatus("render", "Escolha um preset para o Media Encoder.", "err"); return; }
      var dir = outFolder();
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e0) { qStatus("render", "Não consegui criar a pasta " + dir, "err"); return; }
      var ext = "mp4";
      try { var pe = await host("cc_presetExt", { sequenceId: mk.sequenceId, preset: preset }); if (pe.ext) ext = pe.ext; } catch (e1) {}
      var used = {};
      var jobs = mk.markers.map(function (m, i) {
        var base = fileName(i + 1, m.name, mk.seqName), name = base, k = 2;
        while (used[name.toLowerCase()]) name = base + " (" + (k++) + ")";
        used[name.toLowerCase()] = 1;
        return { start: m.start, end: m.end, name: name, out: path.join(dir, name + "." + ext), marker: m.name };
      });
      var exist = jobs.filter(function (j) { return fs.existsSync(j.out); });
      if (exist.length) {
        var ch = await ask(plural(exist.length, "arquivo já existe", "arquivos já existem"),
          "Na pasta <b>" + esc(dir) + "</b>:<ul>" + exist.map(function (j) { return "<li>" + esc(path.basename(j.out)) + "</li>"; }).join("") + "</ul>",
          [{ label: "Criar com outro nome", value: "rename", cls: "" }, { label: "Substituir", value: "replace" }, { label: "Cancelar", value: null }]);
        if (!ch) { qStatus("render", "Render cancelado."); return; }
        exist.forEach(function (j) {
          if (ch === "replace") { try { fs.unlinkSync(j.out); } catch (e2) {} return; }
          var k = 2, base = j.name;
          while (fs.existsSync(path.join(dir, base + " (" + k + ")." + ext))) k++;
          j.name = base + " (" + k + ")"; j.out = path.join(dir, j.name + "." + ext);
        });
      }
      var start = $("rStart").checked;
      var res = await host("cc_render", { sequenceId: mk.sequenceId, preset: preset, startBatch: start,
                                         jobs: jobs.map(function (j) { return { start: j.start, end: j.end, out: j.out }; }) });
      renderJobs = {};
      var items = jobs.map(function (j, i) {
        var it = { name: j.name + "." + ext, state: "queued", progress: 0, t: j.start, jobID: res.ids[i],
                   st: start ? "Na fila" : "Aguardando", msg: fmtClock(j.start) + " – " + fmtClock(j.end) + " · " + Math.round(j.end - j.start) + "s" };
        renderJobs[String(res.ids[i])] = it;
        return it;
      });
      Object.assign(Q.render, { title: "Fila do Media Encoder", items: items, active: true, cancelable: false, overall: 0,
                                sequenceId: mk.sequenceId, eta: "", sub: "Saída: " + dir, mission: "" });
      renderRun = { t0: Date.now(), total: items.length, dir: dir };
      taskbar.start();
      renderQueue();
      qStatus("render", start ? plural(items.length, "corte enviado", "cortes enviados") + " para o Media Encoder."
                              : plural(items.length, "corte na fila", "cortes na fila") + " do Media Encoder. Clique em ▶ lá para começar.", "ok", true);
      if (!start) finishRender(true);
    } catch (e) { qStatus("render", e.message, "err"); renderRun = null; }
  });
  function finishRender(waiting) {
    var items = Q.render.items, ok = items.filter(function (i) { return i.state === "ok"; }).length;
    var bad = items.filter(function (i) { return i.state === "fail"; }).length;
    Q.render.active = false; Q.render.eta = "";
    if (waiting) { renderRun = null; taskbar.stop(); renderQueue(); return; }
    var el = (Date.now() - renderRun.t0) / 1000, dir = renderRun.dir;
    renderRun = null;
    taskbar.finish(!!bad);
    renderQueue();
    if (bad) {
      qStatus("render", ok + " de " + items.length + " renderizados · " + bad + " com problema (veja a fila).", "err", true);
      play("Alert_FAIL.mp3");
      notifyEnd("Render terminou com problemas", ok + " de " + items.length + " cortes.");
    } else {
      qMission("render", plural(ok, "corte renderizado", "cortes renderizados"), fmtTime(el));
      var b = document.createElement("button");
      b.className = "btn secondary small notes-btn"; b.textContent = "Abrir a pasta";
      b.addEventListener("click", function () { openFolder(dir); });
      if (tab === "render") $("status").appendChild(b);
      play("Alert_OK.mp3");
      notifyEnd("Missão cumprida!", plural(ok, "corte renderizado", "cortes renderizados") + " em " + fmtTime(el) + ".");
    }
  }
  // eventos do Media Encoder (o host.jsx repassa com CSXSEvent)
  function onEncoder(ev) {
    var d = ev && ev.data;
    if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { return; } }
    if (!d || !d.jobID) return;
    var it = renderJobs[String(d.jobID)];
    if (!it) return;
    if (d.type === "progress") { it.state = "running"; it.progress = Math.min(0.99, Number(d.progress) || 0); }
    else if (d.type === "complete") { it.state = "ok"; it.progress = 1; it.st = undefined; }
    else if (d.type === "error") { it.state = "fail"; it.msg = d.msg || "O Media Encoder deu erro."; }
    else if (d.type === "canceled") { it.state = "cancel"; }
    var items = Q.render.items;
    Q.render.overall = items.reduce(function (s, i) { return s + (i.state === "running" ? i.progress : i.state === "queued" ? 0 : 1); }, 0) / Math.max(1, items.length);
    if (renderRun) Q.render.eta = etaText(renderRun.t0, Q.render.overall);
    if (renderRun && items.every(function (i) { return i.state === "ok" || i.state === "fail" || i.state === "cancel"; })) finishRender(false);
    else qRender("render");
  }
  try { cep.addEventListener("com.lchedick.cutcake.encoder", onEncoder); } catch (e) { addLog("eventos do Media Encoder: " + e.message + "\n"); }

  // ------------------------------------------------------------ transcricao (Whisper)
  var lastCheck = null;
  async function checkWhisper() {
    var el = $("whisperStatus");
    if (busyEngine) { el.className = "notif-status"; el.textContent = "A transcrição está em uso agora. Abra de novo quando a fila terminar."; return lastCheck; }
    el.className = "notif-status"; el.textContent = "Verificando a transcrição…";
    try {
      var out = await runPy([engineFile(), "check"]);
      var r = JSON.parse(out.trim().split(/\r?\n/).pop());
      lastCheck = r;
      var pv = String(r.python || "").split(".").map(Number);
      var tooNew = pv[0] === 3 && pv[1] > 13, tooOld = pv[0] === 3 && pv[1] < 10;
      if (!r.faster_whisper && (tooNew || tooOld)) {
        el.className = "notif-status err";
        el.textContent = "✗ O Python " + r.python + " não serve para a transcrição (precisa do 3.10 ao 3.13). Rode o instalador do CutCake de novo: ele instala o Python 3.12 ao lado.";
        $("installWhisper").hidden = true;
      } else if (!r.faster_whisper) {
        el.className = "notif-status err";
        el.textContent = r.av ? "✓ O básico do Sincronizar está instalado · ✗ a transcrição não (Caçar e Legendar precisam dela)." : "✗ A transcrição não está instalada.";
        $("installWhisper").textContent = "Instalar transcrição"; $("installWhisper").hidden = false;
      } else {
        var gpu = r.cuda ? "placa de vídeo" + (r.gpu ? " (" + r.gpu + ")" : "") : (r.gpu ? "processador (a placa " + r.gpu + " não está pronta)" : "processador");
        var models = r.models.length ? r.models.map(function (m) { return m === "turbo" ? "Preciso" : "Rápido"; }).join(" e ") : "nenhum baixado";
        el.className = "notif-status ok";
        el.textContent = "✓ Whisper " + r.faster_whisper + " · usa " + gpu + " · modelos: " + models;
        $("installWhisper").textContent = r.models.length ? "Reinstalar / baixar modelo" : "Baixar modelo";
        $("installWhisper").hidden = false;
      }
    } catch (e) {
      lastCheck = { error: e.message };
      el.className = "notif-status err";
      el.textContent = /não encontrado|ENOENT/i.test(e.message) ? "✗ Python não encontrado. Rode o instalador do CutCake." : "✗ " + e.message;
    }
    return lastCheck;
  }
  async function hasNvidia() {
    if (!IS_WIN) return false;
    try { await exec("nvidia-smi", ["-L"]); return true; } catch (e) { return false; }
  }
  $("installWhisper").addEventListener("click", async function () {
    if (busyEngine) return;
    closeConfig();
    var py = pyCmd(), t0 = Date.now();
    var gpu = $("optGpu").checked && await hasNvidia();
    var steps = [{ name: "Bibliotecas da transcrição", state: "queued", progress: 0 }];
    if (gpu) steps.push({ name: "Componentes da placa de vídeo (NVIDIA)", state: "queued", progress: 0 });
    steps.push({ name: "Modelo do Whisper", state: "queued", progress: 0 });
    startQueue(tab, "Instalando a transcrição", steps, "");   // na tela inicial, a fila aparece enquanto tiver algo
    Q[tab].sub = "Pode levar alguns minutos na primeira vez.";
    var k = tab;
    var pip = function (file) { return runPy(["-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "-r", path.join(EXT, "engine", file)]); };
    try {
      steps[0].state = "running"; renderQueue();
      await pip("requirements.txt"); steps[0].state = "ok";
      var si = 1;
      if (gpu) { steps[1].state = "running"; renderQueue(); await pip("requirements-gpu.txt"); steps[1].state = "ok"; si = 2; }
      steps[si].state = "running"; renderQueue();
      var model = segVal("model") || "auto";
      await runPy([engineFile(), "download", "--model", model], {
        progress: function (p) { steps[si].progress = p; Q[k].overall = (si + p) / steps.length; renderQueue(); },
        status: function (s) { Q[k].sub = s; renderQueue(); }
      });
      steps[si].state = "ok";
      endQueue(k);
      qMission(k, "Transcrição instalada", fmtTime((Date.now() - t0) / 1000));
      play("Alert_OK.mp3");
    } catch (e) {
      var m = friendly(e);
      steps.forEach(function (s) { if (s.state === "running" || s.state === "queued") s.state = m === "cancel" ? "cancel" : "fail"; });
      endQueue(k, m === "cancel" ? "cancel" : true);
      qStatus(k, m === "cancel" ? "Instalação cancelada." : "Falha na instalação: " + m + " (verifique a internet).", m === "cancel" ? "" : "err", m !== "cancel");
    }
  });

  // ------------------------------------------------------------ configuracoes (pop-up)
  function openConfig() { $("config").classList.add("show"); checkWhisper(); }
  function closeConfig() { $("config").classList.remove("show"); }
  $("openConfig").addEventListener("click", openConfig);
  $("closeConfig").addEventListener("click", closeConfig);
  $("config").addEventListener("mousedown", function (e) { if (e.target === $("config")) closeConfig(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeConfig(); closeNotes(); if ($("askModal").classList.contains("show")) $("askClose").click(); }
  });
  $("ghLink").addEventListener("click", function () { openURL("https://github.com/" + INFO.repo); });

  $("testPy").addEventListener("click", async function () {
    var r = $("pyResult");
    r.className = "result"; r.textContent = "Testando…"; $("testPy").disabled = true;
    var c = await checkWhisper();
    if (c && c.python) {
      r.className = "result " + (c.faster_whisper ? "ok" : "err");
      r.textContent = (c.faster_whisper ? "✓ Tudo certo · Python " : "✗ Python " + "") + c.python + (c.faster_whisper ? " · faster-whisper " + c.faster_whisper : " funciona, mas falta a transcrição. Use \"Instalar transcrição\".");
    } else {
      r.className = "result err";
      r.textContent = /não encontrado|ENOENT|not recognized|não é reconhecido/i.test((c && c.error) || "")
        ? "✗ Python não encontrado com \"" + $("py").value + "\". Tente \"python\" ou rode o instalador."
        : "✗ " + ((c && c.error) || "erro");
    }
    $("testPy").disabled = false;
  });

  $("resetDefaults").addEventListener("click", function () {
    Object.keys(DEF).forEach(function (k) { if (k !== "lists" && k !== "rPreset" && k !== "rFolder" && k !== "tAfter" && k !== "tBefore") save(k, DEF[k]); });
    applyPrefs();
    $("supportResult").className = "result ok";
    $("supportResult").textContent = "✓ Padrões restaurados (Python, preset, pasta, palavras e gatilhos foram mantidos).";
  });
  $("clearCache").addEventListener("click", function () {
    var dir = path.join(DATA, "transcripts"), n = 0;
    listDir(dir).forEach(function (e) { if (/\.json$/.test(e.name)) { try { fs.unlinkSync(path.join(dir, e.name)); n++; } catch (x) {} } });
    $("supportResult").className = "result ok";
    $("supportResult").textContent = "✓ " + plural(n, "transcrição apagada.", "transcrições apagadas.");
  });

  $("copyDiag").addEventListener("click", async function () {
    var pv = "?";
    try { var hi = await host("cc_info"); pv = hi.version + (hi.build ? " (" + hi.build + ")" : ""); } catch (e) {}
    var c = lastCheck || {};
    var text = [
      "CutCake v" + INFO.version,
      "Premiere: " + pv + " | Sistema: " + os.platform() + " " + os.release(),
      "Python: " + $("py").value + " | " + (c.python ? "Python " + c.python + " · whisper " + (c.faster_whisper || "não instalado") +
        " · cuda " + c.cuda + " · gpu " + (c.gpu || "-") + " · modelos " + (c.models || []).join(",") : (c.error || "(não testado)")),
      "Ajustes: modelo=" + segVal("model") + " gpu=" + $("optGpu").checked + " cortes=" + $("hCount").value + " dur=" + $("hMin").value + "-" + $("hMax").value +
        " legenda=" + segVal("capStyle") + "/" + segVal("capMode") + "/" + $("cWords").value + " zoom=" + $("zAmount").value + "%/" + $("zRamp").value +
        " foco=" + segVal("zFocus") + " cores=" + colorCut() + "/" + colorZoom() + "/" + colorTake() + " preset=" + $("rPreset").value,
      "Áudio: caçar=" + trackVal("hunt") + " legendar=" + trackVal("captions") + " takes=" + trackVal("takes"),
      "Takes: pausa=" + $("tPause").value / 10 + " silêncio=" + $("tSil").value / 10 + " folga=" + $("tPad").value / 10 + " usa=" + segVal("tUse") +
        " depois=" + linesOf("tAfter").join("/") + " antes=" + (linesOf("tBefore").join("/") || "-"),
      "", "Último Caçador:", Q.hunt.lastSummary || "(nenhum)",
      "", "Filas:", Object.keys(Q).map(function (k) { return k + ": " + Q[k].items.map(function (i) { return i.name + "=" + i.state + (i.msg ? " (" + i.msg + ")" : ""); }).join("; "); }).join("\n"),
      "", "Reinício (últimas linhas):", (function () {
        try { return fs.readFileSync(path.join(os.tmpdir(), "CutCake_restart.log"), "utf8").trim().split(/\r?\n/).slice(-8).join("\n"); }
        catch (e) { return "(sem registro)"; }
      })(),
      "", "Log:", $("log").textContent.slice(-6000) || "(vazio)"
    ].join("\n");
    var ok = copyText(text);
    $("supportResult").className = "result " + (ok ? "ok" : "err");
    $("supportResult").textContent = ok ? "✓ Diagnóstico copiado. Cole na conversa quando precisar de ajuda." : "✗ Não consegui copiar. Abra \"Ver log\" e copie de lá.";
  });

  // ------------------------------------------------------------ barra de progresso no icone (Windows)
  // Um PowerShell fica aberto durante a fila e atualiza o icone do Premiere na barra de tarefas
  // (ITaskbarList3), recebendo comandos pelo stdin: "p 42" (porcentagem), "s 2" (estado), "q" (sair).
  // Estados: 0 = sem barra, 2 = normal (verde), 4 = erro (vermelho), 8 = pausado (amarelo).
  var taskbar = (function () {
    var proc = null, last = -1;
    var script = [
      "$ProgressPreference = 'SilentlyContinue'",
      "Add-Type -TypeDefinition @'",
      "using System; using System.Runtime.InteropServices;",
      "namespace CCTB {",
      " [ComImport, Guid(\"ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]",
      " public interface ITaskbarList3 {",
      "  void HrInit(); void AddTab(IntPtr h); void DeleteTab(IntPtr h); void ActivateTab(IntPtr h); void SetActiveAlt(IntPtr h);",
      "  void MarkFullscreenWindow(IntPtr h, [MarshalAs(UnmanagedType.Bool)] bool f);",
      "  void SetProgressValue(IntPtr h, ulong done, ulong total);",
      "  void SetProgressState(IntPtr h, int flags);",
      " }",
      " [ComImport, Guid(\"56FDF344-FD6D-11d0-958A-006097C9A090\"), ClassInterface(ClassInterfaceType.None)]",
      " public class TaskbarList {}",
      " public static class TB {",
      "  static ITaskbarList3 t;",
      "  public static void Init() { t = (ITaskbarList3)new TaskbarList(); t.HrInit(); }",
      "  public static void Value(IntPtr h, int v) { t.SetProgressValue(h, (ulong)v, 100UL); }",
      "  public static void State(IntPtr h, int s) { t.SetProgressState(h, s); }",
      " }",
      "}",
      "'@",
      "[CCTB.TB]::Init()",
      "$pp = Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
      "if (-not $pp) { exit 1 }",
      "$h = $pp.MainWindowHandle",
      "while ($true) {",
      "  $l = [Console]::In.ReadLine()",
      "  if ($l -eq $null -or $l -eq 'q') { break }",
      "  $a = $l.Split(' ')",
      "  try { if ($a[0] -eq 'p') { [CCTB.TB]::Value($h, [int]$a[1]) } elseif ($a[0] -eq 's') { [CCTB.TB]::State($h, [int]$a[1]) } } catch {}",
      "}",
      "try { [CCTB.TB]::State($h, 0) } catch {}"
    ].join("\n");
    function send(line) { try { if (proc && proc.stdin.writable) proc.stdin.write(line + "\n"); } catch (e) {} }
    function start() {
      if (!IS_WIN) return;
      stop(); last = -1;
      try {
        var enc = req("buffer").Buffer.from(script, "utf16le").toString("base64");
        proc = cp.spawn("powershell", ["-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc], { windowsHide: true });
        proc.on("error", function () { proc = null; });
        proc.on("close", function () { proc = null; });
        proc.stderr.on("data", function (b) { if (!/CLIXML|<Objs /.test(String(b))) addLog("barra do ícone: " + b); });
        send("s 2"); send("p 0");
      } catch (e) { proc = null; }
    }
    function set(frac) {
      var v = Math.max(0, Math.min(100, Math.round(frac * 100)));
      if (v === last) return;
      last = v; send("p " + v);
    }
    function state(s) { send("s " + s); }
    function finish(err) {
      if (!proc) return;
      send("p 100"); send("s " + (err ? 4 : 2));
      setTimeout(stop, err ? 4000 : 1500);
    }
    function stop() {
      if (!proc) return;
      send("s 0"); send("q");
      var p = proc; proc = null;
      setTimeout(function () { try { p.kill(); } catch (e) {} }, 2000);
    }
    return { start: start, set: set, state: state, finish: finish, stop: stop };
  })();

  // ------------------------------------------------------------ atualizacao
  function cmpVer(a, b) {
    var pa = String(a).replace(/^v/i, "").split(/[.-]/).map(Number), pb = String(b).replace(/^v/i, "").split(/[.-]/).map(Number);
    for (var i = 0; i < 3; i++) { var d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
    return 0;
  }
  function httpGet(url, toFile, redirects) {
    redirects = redirects || 0;
    return new Promise(function (resolve, reject) {
      var r = https.get(url, { headers: { "User-Agent": "CutCake", "Accept": toFile ? "application/octet-stream" : "application/vnd.github+json" } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          res.resume(); return resolve(httpGet(res.headers.location, toFile, redirects + 1));
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
        if (toFile) {
          var f = fs.createWriteStream(toFile);
          res.pipe(f); f.on("finish", function () { f.close(function () { resolve(toFile); }); }); f.on("error", reject);
        } else {
          var buf = ""; res.setEncoding("utf8");
          res.on("data", function (c) { buf += c; });
          res.on("end", function () { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
        }
      });
      r.on("error", reject);
      r.setTimeout(20000, function () { r.destroy(new Error("tempo esgotado")); });
    });
  }

  var latest = null;
  async function checkUpdate(silent) {
    var btn = $("hdrUpdate");
    if (!silent) btn.classList.add("spin");
    try {
      var rel = await httpGet("https://api.github.com/repos/" + INFO.repo + "/releases/latest");
      var asset = (rel.assets || []).filter(function (a) { return /\.zip$/i.test(a.name); })[0];
      if (rel.tag_name && cmpVer(rel.tag_name, INFO.version) > 0 && asset) {
        latest = { version: rel.tag_name.replace(/^v/i, ""), url: asset.browser_download_url };
        $("updateText").textContent = "Nova versão v" + latest.version + " disponível";
        $("updateBar").classList.add("show");
        btn.classList.add("has-update");
        btn.title = "Atualizar para v" + latest.version;
      } else {
        latest = null; btn.classList.remove("has-update"); btn.title = "Verificar atualizações";
        if (!silent) {
          setStatus("Você já está na versão mais recente (v" + INFO.version + ").", "ok", true);
          var nb = document.createElement("button");
          nb.className = "btn secondary small notes-btn"; nb.textContent = "Ver notas da versão";
          nb.addEventListener("click", function () { openNotes(); });
          $("status").appendChild(nb);
        }
      }
    } catch (e) {
      if (!silent) setStatus("Não consegui verificar atualizações (" + e.message + ").", "err");
    }
    btn.classList.remove("spin");
  }
  $("hdrUpdate").addEventListener("click", function () {
    if (busyEngine) return;
    if (latest) doUpdate(); else checkUpdate(false);
  });

  function findPluginRoot(dir, depth) {
    if (fs.existsSync(path.join(dir, "CSXS", "manifest.xml"))) return dir;
    if (depth <= 0) return null;
    var ents = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < ents.length; i++) {
      if (ents[i].isDirectory()) { var r = findPluginRoot(path.join(dir, ents[i].name), depth - 1); if (r) return r; }
    }
    return null;
  }
  function copyDir(src, dst) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src, { withFileTypes: true }).forEach(function (e) {
      var s = path.join(src, e.name), d = path.join(dst, e.name);
      if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
    });
  }

  async function doUpdate() {
    if (!latest || busyEngine) return;
    setBusy(true);
    try {
      var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cutcake_upd_"));
      var zip = path.join(tmp, "update.zip"), out = path.join(tmp, "x");
      setStatus("Baixando v" + latest.version + "…");
      await httpGet(latest.url, zip);
      setStatus("Instalando…");
      if (IS_WIN) await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        "Expand-Archive -LiteralPath '" + zip.replace(/'/g, "''") + "' -DestinationPath '" + out.replace(/'/g, "''") + "' -Force"]);
      else await exec("ditto", ["-x", "-k", zip, out]);
      var root = findPluginRoot(out, 3);
      if (!root) throw new Error("O pacote baixado não parece ser o plugin.");
      copyDir(root, EXT);
      var reqFile = path.join(EXT, "engine", "requirements.txt");
      if (fs.existsSync(reqFile) && fs.existsSync(path.join(DATA, "models"))) {
        setStatus("Atualizando bibliotecas do Python…");
        var py = pyCmd();
        try { addLog(await exec(py.cmd, py.args.concat(["-m", "pip", "install", "--upgrade", "-r", reqFile]), { env: PY_ENV })); }
        catch (e) { addLog("pip: " + e.message + "\n"); }
      }
      $("updateBar").classList.remove("show"); $("hdrUpdate").classList.remove("has-update");
      setStatus("Atualizado para v" + latest.version + "! Reinicie o Premiere para concluir.", "ok", true);
      latest = null;
      if (IS_WIN || IS_MAC) $("restart").classList.add("show");
      play("Alert_OK.mp3");
    } catch (e) {
      setStatus("Falha na atualização: " + e.message, "err", true);
      play("Alert_FAIL.mp3");
    }
    setBusy(false);
  }
  $("updateBtn").addEventListener("click", doUpdate);

  // ------------------------------------------------------------ reiniciar o premiere
  // O Premiere encerra junto com ele todos os processos que o painel abriu. Por isso o
  // "vigia" que espera o Premiere fechar e abre de novo e criado pelo WMI do Windows
  // (fica fora do grupo de processos do Premiere e sobrevive ao fechamento).
  // Se a pessoa cancelar o "salvar?", o Premiere nao fecha e o vigia desiste em 3 min.
  // Registro do que aconteceu: %TEMP%\CutCake_restart.log
  function watcherScript(proj) {
    return [
      "$log = Join-Path $env:TEMP 'CutCake_restart.log'",
      "function L($m) { Add-Content -Path $log -Value ((Get-Date -Format s) + ' ' + $m) }",
      "L 'vigia iniciado'",
      "$p = Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue | Select-Object -First 1",
      "if (-not $p) { L 'Premiere nao encontrado'; exit 1 }",
      "$id = $p.Id",
      "$exe = $p.Path",
      "if (-not $exe) { $exe = (Get-CimInstance Win32_Process -Filter (\"ProcessId=$id\")).ExecutablePath }",
      "L ('exe: ' + $exe)",
      "$limite = (Get-Date).AddMinutes(3)",
      "while ((Get-Process -Id $id -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $limite)) { Start-Sleep -Milliseconds 500 }",
      "if (Get-Process -Id $id -ErrorAction SilentlyContinue) { L 'Premiere nao fechou (salvar cancelado?)'; exit 2 }",
      "Start-Sleep -Seconds 3",
      "$proj = " + psStr(proj || ""),
      "$ok = $false",
      "if ($proj -and (Test-Path -LiteralPath $proj)) { try { Invoke-Item -LiteralPath $proj; $ok = $true; L ('reaberto pelo arquivo (como duplo clique): ' + $proj) } catch { L ('falhou abrir o arquivo: ' + $_) } }",
      "if (-not $ok) { Start-Process -FilePath $exe; L 'reaberto sem projeto' }"
    ].join("\n");
  }
  async function startWatcher(proj) {
    var enc = req("buffer").Buffer.from(watcherScript(proj), "utf16le").toString("base64");
    var cmdline = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand " + enc;
    try {
      var out = await psRun([
        "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = " + psStr(cmdline) + " }",
        "Write-Output $r.ReturnValue"
      ].join("; "));
      if (out.trim() === "0") return "wmi";
      addLog("WMI retornou " + out.trim() + "\n");
    } catch (e) { addLog("WMI: " + e.message + "\n"); }
    // plano B: tarefa agendada de uma vez so (tambem roda fora do Premiere)
    var task = "CutCake_Reiniciar";
    await exec("schtasks", ["/Create", "/F", "/SC", "ONCE", "/ST", "23:59", "/TN", task, "/TR", cmdline.length < 260 ? cmdline : "powershell.exe -NoProfile -WindowStyle Hidden -File \"" + writeWatcherFile(proj) + "\""]);
    await exec("schtasks", ["/Run", "/TN", task]);
    setTimeout(function () { exec("schtasks", ["/Delete", "/F", "/TN", task]).catch(function () {}); }, 4000);
    return "schtasks";
  }
  function writeWatcherFile(proj) {
    var f = path.join(os.tmpdir(), "CutCake_vigia.ps1");
    fs.writeFileSync(f, "\ufeff" + watcherScript(proj), "utf8");
    return f;
  }
  // Mac: um bash destacado (setsid) espera o Premiere fechar e abre de novo com "open"
  function startWatcherMac(proj) {
    var log = path.join(os.tmpdir(), "CutCake_restart.log");
    var sh = [
      'LOG=' + shq(log),
      'L() { echo "$(date +%Y-%m-%dT%H:%M:%S) $1" >> "$LOG"; }',
      'L "vigia iniciado"',
      'APP=$(lsappinfo info -only bundlepath "$(lsappinfo front)" | sed -E \'s/.*="(.*)"/\\1/\')',
      'case "$APP" in *"Premiere Pro"*.app) ;; *)',
      '  PID=$(pgrep -f "/Adobe Premiere Pro[^/]*\\.app/Contents/MacOS/" | head -n 1)',
      '  APP=$(ps -p "$PID" -o comm= | sed -E "s#(\\.app)/Contents/.*#\\1#") ;;',
      'esac',
      '[ -z "$APP" ] && { L "Premiere nao encontrado"; exit 1; }',
      'L "app: $APP"',
      // o lsappinfo lista os apps abertos com 'bundle path="..."' (nao pega processos auxiliares)
      'running() { lsappinfo list 2>/dev/null | grep -qF "\\"$APP\\""; }',
      'for i in $(seq 1 360); do running || break; sleep 0.5; done',
      'running && { L "Premiere nao fechou (salvar cancelado?)"; exit 2; }',
      'L "Premiere fechou"',
      'sleep 3',
      'PROJ=' + shq(proj || ""),
      'if [ -n "$PROJ" ] && [ -e "$PROJ" ]; then open -a "$APP" "$PROJ"; L "reaberto com $PROJ"; else open -a "$APP"; L "reaberto"; fi'
    ].join("\n");
    var child = cp.spawn("/bin/bash", ["-c", sh], { detached: true, stdio: "ignore" });
    child.unref();
    return "bash";
  }
  function shq(t) { return "'" + String(t).replace(/'/g, "'\\''") + "'"; }
  var REOPEN_FILE = path.join(os.tmpdir(), "CutCake_reabrir.json");
  // depois de reiniciar: se o Premiere abriu sem o projeto, o painel abre pela API do Premiere
  async function reopenAfterRestart() {
    var info;
    try { info = JSON.parse(fs.readFileSync(REOPEN_FILE, "utf8")); } catch (e) { return; }
    try { fs.unlinkSync(REOPEN_FILE); } catch (e) {}
    if (!info || !info.path || Date.now() - info.t > 15 * 60 * 1000 || !fs.existsSync(info.path)) return;
    await sleep(6000);
    var cur = "";
    try { cur = await evalES("app.project && app.project.path ? app.project.path : ''"); } catch (e) {}
    var norm = function (p) { return String(p || "").replace(/\\/g, "/").toLowerCase(); };
    if (norm(cur) === norm(info.path)) { addLog("reinício: projeto já aberto\n"); return; }
    addLog("reinício: abrindo o projeto pela API do Premiere\n");
    await evalES("app.openDocument(" + JSON.stringify(info.path) + ", true, false, true)");
  }
  async function restartPremiere() {
    var b = this && this.tagName ? this : $("restart");
    b.disabled = true;
    try {
      var proj = "";
      try { proj = await evalES("app.project && app.project.path ? app.project.path : ''"); } catch (e) {}
      if (/^EvalScript error/i.test(proj)) proj = "";
      setStatus("Reiniciando o Premiere…", "ok", true);
      if (proj) { try { fs.writeFileSync(REOPEN_FILE, JSON.stringify({ path: proj, t: Date.now() })); } catch (e) {} }
      var how = IS_MAC ? startWatcherMac(proj) : await startWatcher(proj);
      addLog("vigia iniciado via " + how + "\n");
      setTimeout(function () { evalES("app.quit()"); }, 1200);
      setTimeout(function () { b.disabled = false; }, 15000);   // se cancelou o salvar, libera o botao
    } catch (e) {
      addLog("reiniciar: " + e.message + "\n");
      setStatus("Não consegui reiniciar automaticamente. Feche e abra o Premiere manualmente.", "err", true);
      b.disabled = false;
    }
  }
  $("restart").addEventListener("click", restartPremiere);
  $("restartNow").addEventListener("click", restartPremiere);
  setTimeout(reopenAfterRestart, 500);

  // ------------------------------------------------------------ notas da versao
  // le o CHANGELOG.md do plugin: "## v1.2.3" abre uma versao, "- " e "  - " sao itens
  function parseChangelog() {
    var txt = "";
    try { txt = fs.readFileSync(path.join(EXT, "CHANGELOG.md"), "utf8"); } catch (e) { return []; }
    var out = [], cur = null;
    txt.split(/\r?\n/).forEach(function (line) {
      var m = /^##\s+v?([\d.]+)(?:\s*[—–·-]\s*(.+))?$/.exec(line);
      if (m) { cur = { version: m[1], date: (m[2] || "").trim(), lines: [] }; out.push(cur); return; }
      if (cur && line.trim()) cur.lines.push(line);
    });
    return out;
  }
  function inlineMd(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<b>$1</b>"); }
  function versionHTML(v) {
    var html = "", depth = -1;
    v.lines.forEach(function (line) {
      var m = /^(\s*)-\s+(.*)$/.exec(line);
      if (!m) { html += (depth >= 0 ? "</ul>".repeat(depth + 1) : "") + "<p>" + inlineMd(line) + "</p>"; depth = -1; return; }
      var d = m[1].length >= 2 ? 1 : 0;
      while (depth < d) { html += "<ul>"; depth++; }
      while (depth > d) { html += "</ul>"; depth--; }
      html += "<li>" + inlineMd(m[2]) + "</li>";
    });
    while (depth >= 0) { html += "</ul>"; depth--; }
    return html;
  }
  function openNotes() {
    var all = parseChangelog();
    var curr = all.filter(function (v) { return v.version === INFO.version; })[0] || all[0];
    $("notesTitle").textContent = "Novidades da v" + (curr ? curr.version : INFO.version);
    $("notesDate").textContent = curr && curr.date ? curr.date : "";
    if (!curr) { $("notesBody").innerHTML = "<p>Notas não encontradas.</p>"; }
    else {
      var older = all.filter(function (v) { return v !== curr; });
      $("notesBody").innerHTML = versionHTML(curr) + (older.length ?
        '<details class="older"><summary>Versões anteriores</summary>' +
        older.map(function (v) { return "<h4>v" + esc(v.version) + (v.date ? ' <span class="date">· ' + esc(v.date) + "</span>" : "") + "</h4>" + versionHTML(v); }).join("") + "</details>" : "");
    }
    $("notesModal").classList.add("show");
  }
  function closeNotes() { $("notesModal").classList.remove("show"); }
  $("closeNotes").addEventListener("click", closeNotes);
  $("notesModal").addEventListener("mousedown", function (e) { if (e.target === $("notesModal")) closeNotes(); });
  $("aboutNotes").addEventListener("click", function () { closeConfig(); openNotes(); });

  // ------------------------------------------------------------ notificacao do windows
  var AUMID = "LChedick.CutCake";
  function psRun(script) {
    script = "$ProgressPreference = 'SilentlyContinue'\n" + script;
    var encoded = req("buffer").Buffer.from(script, "utf16le").toString("base64");
    return exec("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]);
  }
  function psStr(t) { return "'" + String(t).replace(/'/g, "''") + "'"; }
  function xmlEsc(t) { return String(t).replace(/[<>&"']/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]; }); }
  var aumidReady = false;
  async function ensureAumid() {
    if (aumidReady) return;
    var iconFile = path.join(EXT, "assets", "icons", "Logo_accent.png");
    await psRun([
      "$k = 'HKCU:\\Software\\Classes\\AppUserModelId\\" + AUMID + "'",
      "New-Item -Path $k -Force | Out-Null",
      "Set-ItemProperty -Path $k -Name DisplayName -Value 'CutCake'",
      "Set-ItemProperty -Path $k -Name IconUri -Value " + psStr(iconFile),
      "Set-ItemProperty -Path $k -Name IconBackgroundColor -Value '00000000'"
    ].join("; "));
    aumidReady = true;
  }
  // o Premiere esta em primeiro plano? No Windows, se nao estiver, ja faz o icone piscar na barra de tarefas
  async function premiereInFront(flashIfBehind) {
    try {
      if (IS_WIN) {
        var out = await psRun([
          "Add-Type -Namespace CCW -Name W -MemberDefinition @'",
          "[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
          "[DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);",
          "[StructLayout(LayoutKind.Sequential)] public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }",
          "[DllImport(\"user32.dll\")] public static extern bool FlashWindowEx(ref FLASHWINFO f);",
          "'@",
          "$pid2 = [uint32]0",
          "[void][CCW.W]::GetWindowThreadProcessId([CCW.W]::GetForegroundWindow(), [ref]$pid2)",
          "$name = (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName",
          "if ($name -like 'Adobe Premiere Pro*' -or $name -like 'CEPHtmlEngine*') { 'FG'; exit }",
          "'BG'",
          flashIfBehind ? [
            "$pp = Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
            "if ($pp) { $f = New-Object CCW.W+FLASHWINFO; $f.cbSize = [uint32][Runtime.InteropServices.Marshal]::SizeOf($f); $f.hwnd = $pp.MainWindowHandle; $f.dwFlags = 14; $f.uCount = 0; $f.dwTimeout = 0; [void][CCW.W]::FlashWindowEx([ref]$f) }"
          ].join("\n") : ""
        ].join("\n"));
        return /FG/.test(out);
      }
      if (IS_MAC) {
        var o = await exec("/bin/bash", ["-c", 'lsappinfo info -only name "$(lsappinfo front)"']);
        return /Premiere/i.test(o);
      }
    } catch (e) { addLog("primeiro plano: " + e.message + "\n"); }
    return false;
  }
  async function notifyEnd(title, body) {
    if (!IS_WIN && !IS_MAC) return;
    var front = await premiereInFront(IS_WIN);
    if (front && $("optFgOnly").checked) return;
    notify(title, body);
  }
  async function notify(title, body, force) {
    if ((!IS_WIN && !IS_MAC) || (!force && !$("optNotify").checked)) return;
    if (IS_MAC) {
      try {
        await exec("osascript", ["-e", "display notification " + JSON.stringify(String(body)) + " with title " +
          JSON.stringify("CutCake") + " subtitle " + JSON.stringify(String(title))]);
      } catch (e) { addLog("notificação: " + e.message + "\n"); }
      return;
    }
    try {
      await ensureAumid();
      var xml = '<toast><visual><binding template="ToastGeneric"><text>' + xmlEsc(title) + "</text><text>" + xmlEsc(body) +
        '</text></binding></visual><audio silent="true"/></toast>';
      await psRun([
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
        "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
        "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
        "$x.LoadXml(" + psStr(xml) + ")",
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('" + AUMID + "').Show([Windows.UI.Notifications.ToastNotification]::new($x))"
      ].join("; "));
    } catch (e) { addLog("notificação: " + e.message + "\n"); }
  }
  // le no registro se as notificacoes estao ligadas (geral e para o CutCake)
  async function checkNotifyStatus() {
    var el = $("notifStatus");
    try {
      var out = await psRun([
        "$g = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications' -Name ToastEnabled -ErrorAction SilentlyContinue).ToastEnabled",
        "$a = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\" + AUMID + "' -Name Enabled -ErrorAction SilentlyContinue).Enabled",
        "Write-Output (\"$g|$a\")"
      ].join("; "));
      var parts = out.trim().split("|");
      if (parts[0] === "0") { el.className = "notif-status err"; el.textContent = "✗ As notificações estão desligadas no Windows (Configurações → Sistema → Notificações)."; }
      else if (parts[1] === "0") { el.className = "notif-status err"; el.textContent = "✗ O Windows está bloqueando as notificações do CutCake (Configurações → Sistema → Notificações)."; }
      else { el.className = "notif-status ok"; el.textContent = "✓ Notificações do Windows ativadas. (Se o \"Não perturbe\" estiver ligado, o Windows pode segurar o aviso.)"; }
    } catch (e) { el.className = "notif-status"; el.textContent = ""; }
  }
  if (!IS_WIN && !IS_MAC) $("notifBox").hidden = true;
  if (IS_MAC) { $("notifLabel").textContent = "Notificação do Mac ao terminar"; $("fgHint").hidden = true; }
  $("openConfig").addEventListener("click", function () {
    if (IS_WIN) checkNotifyStatus();
    else if (IS_MAC) { $("notifStatus").className = "notif-status"; $("notifStatus").textContent = "No Mac, a primeira notificação pode pedir permissão. Se não aparecer, veja Ajustes do Sistema → Notificações → Editor de Scripts."; }
  });
  $("testNotify").addEventListener("click", async function () {
    $("testNotify").disabled = true;
    await notify("Missão cumprida!", "Teste do CutCake: as notificações estão funcionando.", true);
    await checkNotifyStatus();
    $("testNotify").disabled = false;
  });

  // ------------------------------------------------------------ inicio
  applyPrefs();
  loadProjInfo().then(function () { showFolder(); fillPresets(); refresh(); });
  if (load("seen", "") !== INFO.version) { save("seen", INFO.version); setTimeout(openNotes, 600); }
  if ($("optAutoUpd").checked) setTimeout(function () { checkUpdate(true); }, 1500);
})();

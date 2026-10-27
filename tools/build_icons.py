"""Converte os SVGs exportados do Illustrator (SVG-Icon_<Nome>.svg) nos icones do painel.

Uso:  python tools/build_icons.py [pasta com os SVG-Icon_*.svg] ['{"Logo":"<viewBox recortado>"}']

Sem pasta, usa so os icones provisorios (tools/placeholder_icons). Com pasta, os SVGs do Lucas
substituem os provisorios de mesmo nome; os que ainda nao existem continuam provisorios.

- troca as classes do <style> por atributos em cada elemento (evita conflito de .cls-1
  entre icones quando ficam todos na mesma pagina);
- troca o cinza #afafaf por currentColor (a cor passa a vir do CSS do painel);
- o LOGO tem a area vazia da prancheta recortada;
- grava CutCake/assets/icons/<Nome>.svg e gera CutCake/js/icons.js.
"""
import json, os, re, sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "CutCake", "assets", "icons")
OUT_JS = os.path.join(ROOT, "CutCake", "js", "icons.js")
PLACEHOLDERS = os.path.join(ROOT, "tools", "placeholder_icons")
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)
GRAY = re.compile(r"#afafaf", re.I)
CROP = {"LOGO": True}


def parse_style(css):
    rules = {}
    for sel, body in re.findall(r"([^{}]+)\{([^}]*)\}", css):
        props = {}
        for decl in body.split(";"):
            if ":" in decl:
                k, v = decl.split(":", 1)
                props[k.strip()] = v.strip()
        for s in sel.split(","):
            s = s.strip()
            if s.startswith("."):
                rules.setdefault(s[1:], {}).update(props)
    return rules


def convert(path, name):
    tree = ET.parse(path)
    svg = tree.getroot()
    rules = {}
    for st in svg.iter("{%s}style" % SVG_NS):
        rules.update(parse_style(st.text or ""))
    for defs in list(svg.findall("{%s}defs" % SVG_NS)):
        svg.remove(defs)
    for el in svg.iter():
        cls = el.attrib.pop("class", None)
        for c in (cls or "").split():
            for k, v in rules.get(c, {}).items():
                if k == "stroke-width":
                    v = v.replace("px", "")
                el.set(k, v)
        el.attrib.pop("id", None)
        el.attrib.pop("data-name", None)
        for k in list(el.attrib):
            el.set(k, GRAY.sub("currentColor", el.attrib[k]))
    # elemento sem fill definido herda o preto padrao: forca currentColor
    svg.set("fill", "currentColor")
    for k in ("width", "height", "x", "y", "style"):
        svg.attrib.pop(k, None)
    txt = ET.tostring(svg, encoding="unicode")
    txt = re.sub(r"\s*\n\s*", "", txt)
    txt = txt.replace(' xmlns="%s"' % SVG_NS, "", 1)
    txt = txt.replace("<svg", '<svg xmlns="%s"' % SVG_NS, 1)
    return txt


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else ""
    icons, provisorios = {}, []
    for f in sorted(os.listdir(PLACEHOLDERS)):
        if f.endswith(".svg"):
            with open(os.path.join(PLACEHOLDERS, f), encoding="utf-8") as fh:
                icons[f[:-4]] = re.sub(r"\s*\n\s*", "", fh.read().strip())
            provisorios.append(f[:-4])
    for f in (sorted(os.listdir(src)) if src else []):
        m = re.match(r"SVG-Icon_(.+)\.svg$", f, re.I)
        if not m:
            continue
        name = m.group(1)
        name = "Logo" if name.upper() == "LOGO" else name
        icons[name] = convert(os.path.join(src, f), name)
        if name in provisorios:
            provisorios.remove(name)
    crop = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    for name, box in crop.items():
        icons[name] = re.sub(r'viewBox="[^"]*"', 'viewBox="%s"' % box, icons[name], count=1)
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, txt in icons.items():
        with open(os.path.join(OUT_DIR, name + ".svg"), "w", encoding="utf-8") as fh:
            fh.write(txt + "\n")
    with open(OUT_JS, "w", encoding="utf-8") as fh:
        fh.write("// Gerado por tools/build_icons.py a partir dos SVGs do Lucas. Nao edite a mao.\n")
        fh.write("window.CC_ICONS = " + json.dumps(icons, ensure_ascii=False, indent=1) + ";\n")
    # os 2 PNGs: icone do menu Window (cinza) e da notificacao do Windows (azul), gerados do Logo
    try:
        import cairosvg
        for fname, color in (("Logo.png", "#bababa"), ("Logo_accent.png", "#4a9ff0")):
            svg = icons["Logo"].replace("currentColor", color)
            cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=os.path.join(OUT_DIR, fname), output_width=128, output_height=128)
    except ImportError:
        print("aviso: instale o cairosvg (pip install cairosvg) para gerar Logo.png e Logo_accent.png")
    print("%d icones: %s" % (len(icons), ", ".join(icons)))
    if provisorios:
        print("ainda provisorios: " + ", ".join(provisorios))


if __name__ == "__main__":
    main()

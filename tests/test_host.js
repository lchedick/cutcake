const fs=require("fs"), vm=require("vm"), assert=require("assert");
const M=require("./mock_premiere.js");
const src=fs.readFileSync(__dirname+"/../CutCake/jsx/host.jsx","utf8");
function load(seq){ const {app,jobs,bin}=M.makeApp(seq); const ctx={app, Time:M.Time, Sequence:{CAPTION_FORMAT_SUBTITLE:"sub"}, ExternalObject:function(){}, CSXSEvent:function(){ this.dispatch=()=>{}; }, Math, Object, String, Number, isFinite}; vm.createContext(ctx); vm.runInContext(src, ctx); return {ctx, jobs, bin}; }
let pass=0; const ok=(c,m)=>{ assert.ok(c,m); pass++; };

// ---- 1. jobs: sem selecao usa A1; com In/Out
{
  const v=new M.Clip({name:"v", start:0,end:600,inPoint:100,media:"C:/a.mp4"});
  const a=new M.Clip({name:"a", mediaType:"Audio", start:0,end:600,inPoint:100,media:"C:/a.mp4"});
  const seq=new M.Seq({video:[[v]], audio:[[a]], endSec:600});
  const {ctx}=load(seq);
  let r=JSON.parse(ctx.cc_getJobs(true)); ok(r.jobs.length===1 && r.from==="A1" && r.range===null, "jobs A1");
  seq.inP=10; seq.outP=70; r=JSON.parse(ctx.cc_getJobs(true)); ok(r.range[0]===10 && r.range[1]===70, "range");
  v.selected=true; a.selected=true; r=JSON.parse(ctx.cc_getJobs(false)); ok(r.jobs.length===1 && r.from==="seleção", "dedupe v+a");
}
// ---- 2. marcadores
{
  const seq=new M.Seq({video:[[]], endSec:300}); const {ctx}=load(seq);
  let r=JSON.parse(ctx.cc_addMarkers({sequenceId:"seq1", color:0, items:[{start:10,end:50,name:"Corte 1 • 87%",comment:"x\n[CutCake]"},{start:80,end:120,name:"Corte 2",comment:"[CutCake]"}]}));
  ok(r.count===2, "add markers");
  seq.markers.createMarker(5).name="ponto";
  r=JSON.parse(ctx.cc_getMarkers({sequenceId:"seq1", color:0, durationOnly:true})); ok(r.markers.length===2 && r.points===1 && r.markers[0].end===50, "get markers");
  seq.inP=200; seq.outP=230; r=JSON.parse(ctx.cc_markRange({color:4, name:"Zoom {n}", comment:""})); ok(r.name==="Zoom 1" && r.end===230, "mark range");
  r=JSON.parse(ctx.cc_clearMarkers({sequenceId:"seq1", tag:"[CutCake]"})); ok(r.count===2 && seq.markers.list.length===2, "clear markers");
}
// ---- 3. zoom: clipe trackeado pelo GTA (position X com keyframes, escala 177.8)
{
  const c=new M.Clip({name:"cam", start:20, end:80, inPoint:300, media:"C:/a.mp4"});
  const mo=c.components[1].properties; const pos=mo[0], sc=mo[1];
  sc.setValue(177.8); pos.setTimeVarying(true);
  for(let t=0;t<=60;t+=2){ pos.addKey(300+t); pos.setValueAtKey(300+t,[0.5+0.2*Math.sin(t/7),0.5]); }
  const g=new M.Clip({name:"legenda", start:30, end:32, media:""}); // grafico em V2 nao conta
  const seq=new M.Seq({video:[[c],[g]], endSec:100}); const {ctx}=load(seq);
  const m=seq.markers.createMarker(30); m.end=40; m.color=4;
  let r=JSON.parse(ctx.cc_applyZoom({sequenceId:"seq1", color:4, amount:0.2, ramp:0.5, focusY:0.5}));
  ok(r.count===1 && r.keys>10, "zoom aplicado "+JSON.stringify(r));
  const mid = 300+35-20; ok(Math.abs(sc.at(mid)-177.8*1.2)<1e-6, "escala no meio = +20%");
  ok(Math.abs(sc.at(300+29-20)-177.8)<1e-6 && Math.abs(sc.at(300+41-20)-177.8)<1e-6, "fora do marcador nao muda");
  // posicao no meio: C + (P-C)*1.2 com P original da curva
  const P = 0.5+0.2*Math.sin(16/7); // t=16 local -> key existente (300+16 = seq 36)
  ok(Math.abs(pos.at(316)[0]-(0.5+(P-0.5)*1.2))<1e-9, "posicao compensada");
  ok(seq.markers.list[0].comments.indexOf("[CutCake zoom]")>=0, "marcador marcado");
  r=JSON.parse(ctx.cc_applyZoom({sequenceId:"seq1", color:4, amount:0.2, ramp:0.5, focusY:0.5})); ok(r.count===0 && r.skipped===1, "nao aplica 2x");
  ok(!g.components[1].properties[1].varying, "grafico intocado");
}
// ---- 4. zoom em clipe sem keyframes, foco no alto
{
  const c=new M.Clip({name:"cam", start:0, end:30, inPoint:0, media:"C:/a.mp4"});
  const seq=new M.Seq({video:[[c]], endSec:30}); const {ctx}=load(seq);
  const m=seq.markers.createMarker(10); m.end=12; m.color=4;
  JSON.parse(ctx.cc_applyZoom({sequenceId:"seq1", color:4, amount:0.15, ramp:0.4, focusY:0.35}));
  const pos=c.components[1].properties[0], sc=c.components[1].properties[1];
  ok(Math.abs(sc.at(11)-115)<1e-6 && Math.abs(pos.at(11)[1]-(0.35+(0.5-0.35)*1.15))<1e-9, "zoom foco alto");
  ok(Math.abs(sc.at(5)-100)<1e-9 && Math.abs(pos.at(5)[1]-0.5)<1e-9, "antes do zoom intacto");
}
// ---- 5. animar subida
{
  const g=new M.Clip({name:"leg", start:5, end:7, media:"", selected:true});
  const seq=new M.Seq({video:[[],[g]], endSec:10}); const {ctx}=load(seq);
  const r=JSON.parse(ctx.cc_animateRise({dur:0.25, dist:40}));
  const pos=g.components[1].properties[0], op=g.components[0].properties[0];
  ok(r.count===1 && op.at(0)===0 && op.at(0.25)===100 && Math.abs(pos.at(0)[1]-(0.5+40/1920))<1e-9 && pos.at(0.3)[1]===0.5, "subida");
  JSON.parse(ctx.cc_animateRise({dur:0.25, dist:40})); ok(pos.keys.length===2 && pos.at(1)[1]===0.5, "reaplicar nao acumula");
}
// ---- 6. render + legendas
{
  const seq=new M.Seq({video:[[]], endSec:300}); const {ctx,jobs}=load(seq);
  seq.inP=1; seq.outP=2;
  const r=JSON.parse(ctx.cc_render({sequenceId:"seq1", preset:"C:/p.epr", startBatch:true, jobs:[{start:10,end:50,out:"C:/o/18.10 - corte 1.mp4"},{start:80,end:120,out:"C:/o/18.10 - corte 2.mp4"}]}));
  ok(r.ids.length===2 && jobs[0].in===10 && jobs[1].out===120 && seq.inP===1 && seq.outP===2, "render in/out e restaura");
  const c=JSON.parse(ctx.cc_importCaptions({sequenceId:"seq1", srt:"C:/tmp/leg.srt"})); ok(c.ok && seq.captions.item==="leg.srt", "legendas");
  ok(JSON.parse(ctx.cc_presetExt({sequenceId:"seq1", preset:"x"})).ext==="mp4", "ext");
  JSON.parse(ctx.cc_goTo({sequenceId:"seq1", t:12.5})); ok(Math.abs(seq.player-12.5)<1e-6, "goto");
}
// ---- 7. sincronizar: grupos, referencia e mover
{
  const camV=new M.Clip({name:"cam.mp4", start:5, end:305, inPoint:0, media:"C:/cam.mp4", selected:true});
  const camA=new M.Clip({name:"cam.mp4", mediaType:"Audio", start:5, end:305, inPoint:0, media:"C:/cam.mp4", selected:true});
  camV.linked=[camA]; camA.linked=[camV];
  const mesa=new M.Clip({name:"mesa.wav", mediaType:"Audio", start:0, end:600, inPoint:0, media:"C:/mesa.wav", selected:true});
  const outro=new M.Clip({name:"outro.mp4", start:400, end:500, inPoint:0, media:"C:/outro.mp4"});
  const seq=new M.Seq({video:[[camV, outro]], audio:[[mesa],[camA]], endSec:600}); const {ctx}=load(seq);
  let r=JSON.parse(ctx.cc_syncGroups());
  ok(r.groups.length===2 && r.ref.indexOf("mesa")>=0, "2 grupos e a referência é a trilha de áudio mais baixa");
  const cam=r.groups.filter(g=>g.media==="C:/cam.mp4")[0];
  ok(cam.items.length===2 && cam.hasVideo && cam.audioTrack===1, "vídeo e áudio da câmera no mesmo grupo");
  r=JSON.parse(ctx.cc_syncMove({sequenceId:"seq1", moves:[{key:cam.key, delta:118.47, items:cam.items}]}));
  ok(!r.ok && r.reason==="overlap" && /outro/.test(r.names[0]), "avisa que cairia em cima de outro clipe");
  outro.start=new M.Time(450); outro.end=new M.Time(520);
  r=JSON.parse(ctx.cc_syncMove({sequenceId:"seq1", moves:[{key:cam.key, delta:-10, items:cam.items}]}));
  ok(!r.ok && r.reason==="before", "avisa se iria para antes do zero");
  r=JSON.parse(ctx.cc_syncMove({sequenceId:"seq1", moves:[{key:cam.key, delta:118.47, items:cam.items}]}));
  ok(r.ok && r.moved===1, "move a câmera");
  ok(Math.abs(camV.start.seconds-123.47)<1e-6 && Math.abs(camA.start.seconds-123.47)<1e-6, "vídeo e áudio andam juntos, uma vez só");
  ok(mesa.start.seconds===0, "a referência fica parada");
}
console.log("host.jsx: " + pass + " checagens ok");

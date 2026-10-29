// Premiere falso (so o que o host.jsx usa) para testar o ExtendScript no Node
const TICKS = 254016000000;
class Time { constructor(s){ this.seconds = s||0; } get ticks(){ return String(Math.round(this.seconds*TICKS)); } }
class Prop {
  constructor(name, value){ this.displayName=name; this.value=value; this.varying=false; this.keys=[]; }
  isTimeVarying(){ return this.varying; }
  setTimeVarying(b){ this.varying=b; if(!b) this.keys=[]; }
  getValue(){ return this.varying && this.keys.length ? this.at(0) : clone(this.value); }
  setValue(v){ this.value=clone(v); }
  at(t){ const k=this.keys; if(!k.length) return clone(this.value);
    if(t<=k[0].t) return clone(k[0].v); if(t>=k[k.length-1].t) return clone(k[k.length-1].v);
    for(let i=0;i<k.length-1;i++) if(t>=k[i].t&&t<=k[i+1].t){ const u=(t-k[i].t)/(k[i+1].t-k[i].t); return lerp(k[i].v,k[i+1].v,u); } }
  getValueAtTime(t){ return this.at(t); }
  addKey(t){ if(!this.keys.find(k=>Math.abs(k.t-t)<1e-6)){ this.keys.push({t, v:this.at(t), interp:0}); this.keys.sort((a,b)=>a.t-b.t);} }
  findKey(t){ const k=this.keys.find(k=>Math.abs(k.t-t)<1e-6); if(!k) throw new Error("no key at "+t); return k; }
  setValueAtKey(t,v){ this.findKey(t).v=clone(v); }
  getValueAtKey(t){ return clone(this.findKey(t).v); }
  setInterpolationTypeAtKey(t,i){ this.findKey(t).interp=i; }
  getKeys(){ return this.keys.map(k=>new Time(k.t)); }
}
function clone(v){ return Array.isArray(v)? v.slice(): v; }
function lerp(a,b,u){ return Array.isArray(a)? a.map((x,i)=>x+(b[i]-x)*u) : a+(b-a)*u; }
function coll(arr, numName){ const c=arr.slice(); c[numName]=arr.length; return c; }
class Clip {
  constructor(o){ Object.assign(this,{name:"clip", mediaType:"Video", nodeId:"n"+Math.random(), speed:1, selected:false}, o);
    this.start=new Time(o.start); this.end=new Time(o.end); this.inPoint=new Time(o.inPoint||0); this.outPoint=new Time((o.inPoint||0)+o.end-o.start);
    const motion={matchName:"AE.ADBE Motion", displayName:"Motion", properties: coll([new Prop("Position",[0.5,0.5]), new Prop("Scale",100), new Prop("Scale Width",100), new Prop("Uniform Scale",true)],"numItems")};
    const opacity={matchName:"AE.ADBE Opacity", displayName:"Opacity", properties: coll([new Prop("Opacity",100)],"numItems")};
    this.components = coll(o.noMotion? [] : [opacity, motion], "numItems");
    this.projectItem = o.media===null? null : (o.pi || { getMediaPath: ()=> o.media||"", isSequence: ()=>false });
  }
  remove(ripple, align){ if(this._arr){ const i=this._arr.indexOf(this); if(i>=0) this._arr.splice(i,1); } this.removed=true; }
  getSpeed(){ return this.speed; } isSpeedReversed(){ return false; }
  // como no Premiere: move(Time) desloca o clipe; o audio/video ligado (linked) anda junto
  move(t){ const d = typeof t === "number" ? t : t.seconds; const all = [this].concat(this.linked || []);
    all.forEach(c => { c.start = new Time(c.start.seconds + d); c.end = new Time(c.end.seconds + d); }); }
  setSelected(b){ this.selected=b; }
}
class Marker { constructor(s){ this.start=new Time(s); this._end=new Time(s); this.name=""; this.comments=""; this.color=0; this.guid="g"+Math.random(); }
  get end(){ return this._end; } set end(v){ this._end = typeof v==="number"? new Time(v) : v; }
  getColorByIndex(){ return this.color; } setColorByIndex(c){ this.color=c; } }
class Markers { constructor(){ this.list=[]; }
  createMarker(s){ const m=new Marker(s); this.list.push(m); this.list.sort((a,b)=>a.start.seconds-b.start.seconds); return m; }
  getFirstMarker(){ return this.list[0]; } getNextMarker(m){ return this.list[this.list.indexOf(m)+1]; }
  deleteMarker(m){ this.list.splice(this.list.indexOf(m),1); } }
// item do projeto com In/Out (o overwriteClip usa esse recorte), video e/ou audio
const OPTS = { secondsAsTicks:false };
class PItem { constructor(media, dur, hasVideo, hasAudio){ Object.assign(this,{media, dur, hasVideo, hasAudio, io:[0,dur], name:media.replace(/^.*[\\/]/,"")}); }
  getMediaPath(){ return this.media; } isSequence(){ return false; }
  getInPoint(mt){ return new Time(this.io[0]); } getOutPoint(mt){ return new Time(this.io[1]); }
  setInPoint(t, mt){ this.io[0] = typeof t==="number"? t : typeof t==="string"? Number(t)/TICKS : t.seconds; }
  setOutPoint(t, mt){ this.io[1] = typeof t==="number"? t : typeof t==="string"? Number(t)/TICKS : t.seconds; } }
function overwriteInto(arr, mk, at, len){
  const end = at+len;
  for (let i=arr.length-1;i>=0;i--){ const c=arr[i], cs=c.start.seconds, ce=c.end.seconds;
    if (ce<=at+1e-9 || cs>=end-1e-9) continue;
    if (cs>=at-1e-9 && ce<=end+1e-9) { arr.splice(i,1); continue; }
    if (cs<at) { c.end=new Time(at); } else { c.inPoint=new Time(c.inPoint.seconds+(end-cs)); c.start=new Time(end); } }
  const c = mk(); c._arr=arr; arr.push(c); arr.sort((a,b)=>a.start.seconds-b.start.seconds); return c;
}
class Seq { constructor(o){ Object.assign(this,{name:"Seq", sequenceID:"seq1", frameSizeHorizontal:1080, frameSizeVertical:1920, timebase:String(TICKS/30)},o);
    this.markers=new Markers(); this.vt=o.video||[[]]; this.at=o.audio||[[]]; this.inP=0; this.outP=o.endSec; this.end=String(o.endSec*TICKS); this.player=0; }
  get videoTracks(){ this.vt.forEach(cl=>cl.forEach(c=>c._arr=cl)); return coll(this.vt.map((cl,i)=>({clips:coll(cl,"numItems"), overwriteClip:(pi,t)=>this.ow("Video",i,pi,t)})),"numTracks"); }
  get audioTracks(){ this.at.forEach(cl=>cl.forEach(c=>c._arr=cl)); return coll(this.at.map((cl,i)=>({clips:coll(cl,"numItems"), overwriteClip:(pi,t)=>this.ow("Audio",i,pi,t)})),"numTracks"); }
  // como o Premiere: o video vai na trilha pedida e o audio ligado na trilha de audio de mesmo numero (e vice-versa)
  ow(type, i, pi, t){
    let at = typeof t==="number" ? (OPTS.secondsAsTicks ? t/TICKS : t) : typeof t==="string" ? Number(t)/TICKS : t.seconds;
    const len = pi.io[1]-pi.io[0], inP = pi.io[0];
    const mk = (mt)=>()=>new Clip({name:pi.name, mediaType:mt, start:at, end:at+len, inPoint:inP, media:pi.media, pi});
    const out=[];
    const put=(mt, idx)=>{ const arr=(mt==="Video"?this.vt:this.at)[idx]; if(!arr) return; out.push(overwriteInto(arr, mk(mt), at, len)); };
    if (type==="Video") { if(!pi.hasVideo) throw new Error("sem video"); put("Video", i); if(pi.hasAudio) put("Audio", i); }
    else { if(!pi.hasAudio) throw new Error("sem audio"); put("Audio", i); if(pi.hasVideo) put("Video", i); }
    if (out.length===2){ out[0].linked=[out[1]]; out[1].linked=[out[0]]; }
    return true;
  }
  getSelection(){ return [...this.vt.flat(), ...this.at.flat()].filter(c=>c.selected); }
  getInPointAsTime(){ return new Time(this.inP); } getOutPointAsTime(){ return new Time(this.outP); }
  setInPoint(s){ this.inP = typeof s==="string"? Number(s)/TICKS : s; } setOutPoint(s){ this.outP = typeof s==="string"? Number(s)/TICKS : s; }
  setPlayerPosition(t){ this.player=Number(t)/TICKS; }
  getExportFileExtension(p){ return "mp4"; }
  createCaptionTrack(item, t, f){ this.captions={item:item.name, t, f}; return true; }
}
function makeApp(seq){
  const jobs=[];
  const bin = { name:"CutCake", type:2, children: coll([], "numItems") };
  const app = { version:"26.0", build:"1", path:"C:/Program Files/Adobe/Adobe Premiere Pro 2026/",
    project: { activeSequence: seq, sequences: coll([seq],"numSequences"), path:"C:/proj/culto.prproj",
      rootItem: { children: coll([],"numItems"), createBin(n){ return bin; } },
      importFiles(paths, a, b){ const name = paths[0].replace(/^.*[\\/]/,""); b.children = coll([...b.children, {name}], "numItems"); return true; } },
    encoder: { ENCODE_IN_TO_OUT:1, launchEncoder(){}, bind(){}, startBatch(){ this.started=true; },
      encodeSequence(s, out, preset, mode, rm){ jobs.push({in:s.inP, out:s.outP, path:out, preset, mode}); return "job"+jobs.length; } } };
  return {app, jobs, bin};
}
module.exports = { Time, Prop, Clip, Seq, Markers, makeApp, TICKS, PItem, OPTS };

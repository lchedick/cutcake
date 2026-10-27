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
    this.projectItem = o.media===null? null : { getMediaPath: ()=> o.media||"", isSequence: ()=>false };
  }
  getSpeed(){ return this.speed; } isSpeedReversed(){ return false; }
  setSelected(b){ this.selected=b; }
}
class Marker { constructor(s){ this.start=new Time(s); this._end=new Time(s); this.name=""; this.comments=""; this.color=0; this.guid="g"+Math.random(); }
  get end(){ return this._end; } set end(v){ this._end = typeof v==="number"? new Time(v) : v; }
  getColorByIndex(){ return this.color; } setColorByIndex(c){ this.color=c; } }
class Markers { constructor(){ this.list=[]; }
  createMarker(s){ const m=new Marker(s); this.list.push(m); this.list.sort((a,b)=>a.start.seconds-b.start.seconds); return m; }
  getFirstMarker(){ return this.list[0]; } getNextMarker(m){ return this.list[this.list.indexOf(m)+1]; }
  deleteMarker(m){ this.list.splice(this.list.indexOf(m),1); } }
class Seq { constructor(o){ Object.assign(this,{name:"Seq", sequenceID:"seq1", frameSizeHorizontal:1080, frameSizeVertical:1920, timebase:String(TICKS/30)},o);
    this.markers=new Markers(); this.vt=o.video||[[]]; this.at=o.audio||[[]]; this.inP=0; this.outP=o.endSec; this.end=String(o.endSec*TICKS); this.player=0; }
  get videoTracks(){ return coll(this.vt.map(cl=>({clips:coll(cl,"numItems")})),"numTracks"); }
  get audioTracks(){ return coll(this.at.map(cl=>({clips:coll(cl,"numItems")})),"numTracks"); }
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
module.exports = { Time, Prop, Clip, Seq, Markers, makeApp, TICKS };

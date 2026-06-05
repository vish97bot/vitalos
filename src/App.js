import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Label } from "recharts";
import { parseHealthZip, mergeData } from "./DataParser";

const seed=(i,s=1)=>(Math.sin(i*s*7.3+s*13.1)*0.5+0.5);
const genDays=n=>Array.from({length:n},(_,i)=>{
  const d=new Date();d.setDate(d.getDate()-(n-1-i));
  const wl=i%3===0?Math.round(40+seed(i,2)*50):i%5===0?Math.round(60+seed(i,3)*35):Math.round(seed(i,4)*15);
  const sleep=+(6.5+Math.sin(i*0.2)*0.8+seed(i,1)*1.0).toFixed(2);
  const hrv=Math.round(10+Math.sin(i*0.25)*3+seed(i,5)*4-wl*0.04+sleep*0.3);
  const rhr=Math.round(50-hrv*0.3+seed(i,6)*4);
  const sigs=[Math.min(100,hrv/20*100),Math.min(100,sleep/8*100),Math.max(0,100-(rhr-40)*2)];
  const readiness=Math.round(sigs.reduce((a,b)=>a+b,0)/sigs.length);
  return {
    date:d.toISOString().slice(0,10),
    displayDate:d.toLocaleDateString("en",{month:"short",day:"numeric"}),
    dayName:d.toLocaleDateString("en",{weekday:"short"}),
    hrv,rhr,readiness,
    spo2:+(97.5+seed(i,13)*1.0).toFixed(1),
    sleep,deepSleep:+(sleep*0.13+seed(i,11)*0.08).toFixed(2),
    remSleep:+(sleep*0.22+seed(i,12)*0.06).toFixed(2),
    lightSleep:+(sleep*0.55).toFixed(2),
    sleepEfficiency:Math.round(88+seed(i,14)*10),
    steps:Math.round(5000+seed(i,8)*7000+wl*50),
    calories:Math.round(300+wl*3+seed(i,9)*150),
    distance:Math.round(2000+seed(i,10)*5000),
    workoutLoad:wl,
    stress:Math.round(Math.max(10,60-readiness*0.4+seed(i,15)*20)),
    workouts:wl>30?[{name:["Running","Strength","HIIT","Cycling","Walking"][Math.floor(seed(i,16)*5)],duration:Math.round(20+seed(i,17)*50),calories:Math.round(200+wl*3),startTime:d.toISOString().slice(0,10)}]:[],
  };
});
const DEMO=genDays(90);

const pearson=(xs,ys)=>{
  const pairs=xs.map((x,i)=>[x,ys[i]]).filter(([a,b])=>a!=null&&b!=null&&!isNaN(a)&&!isNaN(b));
  if(pairs.length<5)return{r:null,n:pairs.length};
  const ax=pairs.map(p=>p[0]),ay=pairs.map(p=>p[1]),n=ax.length;
  const mx=ax.reduce((a,b)=>a+b)/n,my=ay.reduce((a,b)=>a+b)/n;
  const num=ax.reduce((s,x,i)=>s+(x-mx)*(ay[i]-my),0);
  const den=Math.sqrt(ax.reduce((s,x)=>s+(x-mx)**2,0)*ay.reduce((s,y)=>s+(y-my)**2,0));
  return{r:den?+(num/den).toFixed(3):0,n};
};
const lagCorr=(data,xk,yk,lag)=>{
  const end=data.length-lag||undefined;
  const xs=data.slice(0,end).map(d=>d[xk]);
  const ys=data.slice(lag).map(d=>d[yk]);
  return pearson(xs,ys);
};
const linReg=pts=>{
  const n=pts.length;if(n<2)return{slope:0,intercept:0};
  const mx=pts.reduce((s,p)=>s+p.x,0)/n,my=pts.reduce((s,p)=>s+p.y,0)/n;
  const slope=pts.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/(pts.reduce((s,p)=>s+(p.x-mx)**2,0)||1);
  return{slope,intercept:my-slope*mx};
};

const M={
  hrv:{label:"HRV",unit:"ms",color:"#00d4aa"},
  sleep:{label:"Sleep",unit:"h",color:"#4f8ef7"},
  readiness:{label:"Readiness",unit:"",color:"#a78bfa"},
  rhr:{label:"Resting HR",unit:"bpm",color:"#f87171"},
  steps:{label:"Steps",unit:"",color:"#fbbf24"},
  workoutLoad:{label:"Workout Load",unit:"",color:"#fb923c"},
  deepSleep:{label:"Deep Sleep",unit:"h",color:"#818cf8"},
  remSleep:{label:"REM Sleep",unit:"h",color:"#38bdf8"},
  calories:{label:"Calories",unit:"kcal",color:"#4ade80"},
  stress:{label:"Stress",unit:"",color:"#f472b6"},
};

const PRESETS=[
  {x:"sleep",y:"hrv",lag:1,label:"Sleep → next-day HRV"},
  {x:"workoutLoad",y:"hrv",lag:2,label:"Workout → HRV (2 days later)"},
  {x:"workoutLoad",y:"readiness",lag:1,label:"Workout → next-day Readiness"},
  {x:"sleep",y:"readiness",lag:1,label:"Sleep → next-day Readiness"},
  {x:"rhr",y:"readiness",lag:0,label:"Resting HR vs Readiness"},
  {x:"deepSleep",y:"hrv",lag:1,label:"Deep Sleep → next-day HRV"},
];

const rLabel=r=>{
  if(r===null)return{text:"Not enough data",color:"#444",pct:0};
  const a=Math.abs(r),pos=r>=0;
  if(a>=0.7)return{text:`Strong ${pos?"positive":"negative"}`,color:pos?"#00d4aa":"#f87171",pct:a*100};
  if(a>=0.4)return{text:`Moderate ${pos?"positive":"negative"}`,color:pos?"#fbbf24":"#fb923c",pct:a*100};
  if(a>=0.2)return{text:`Weak ${pos?"positive":"negative"}`,color:"#888",pct:a*100};
  return{text:"No clear link",color:"#444",pct:a*100};
};

const Tip=({active,payload,label})=>{
  if(!active||!payload?.length)return null;
  return <div style={{background:"#0d0f16",border:"1px solid #1e2235",borderRadius:8,padding:"8px 12px",fontSize:11}}>
    <div style={{color:"#555",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.08em",fontSize:9}}>{label}</div>
    {payload.map((p,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",gap:20,marginTop:2}}>
      <span style={{color:"#666"}}>{p.name}</span>
      <span style={{color:p.color,fontWeight:700,fontFamily:"monospace"}}>{p.value??"-"}</span>
    </div>)}
  </div>;
};

const ScatTip=({active,payload})=>{
  if(!active||!payload?.length)return null;
  const d=payload[0]?.payload;
  return <div style={{background:"#0d0f16",border:"1px solid #1e2235",borderRadius:8,padding:"8px 12px",fontSize:11}}>
    <div style={{color:"#555",fontSize:9,marginBottom:4}}>{d?.date}</div>
    {payload.map((p,i)=><div key={i} style={{display:"flex",gap:16,justifyContent:"space-between"}}>
      <span style={{color:"#666"}}>{p.name}</span>
      <span style={{color:"#f0f0f0",fontWeight:700,fontFamily:"monospace"}}>{p.value}</span>
    </div>)}
  </div>;
};

const Ring=({value,max=100,size=130,sw=10,color,label,sub})=>{
  const r=(size-sw*2)/2,c=2*Math.PI*r,dash=c*(Math.min(value||0,max)/max);
  return <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
    <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a1e2e" strokeWidth={sw}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
        style={{filter:`drop-shadow(0 0 8px ${color}99)`,transition:"stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)"}}/>
    </svg>
    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontSize:size>110?30:22,fontWeight:800,color:"#f4f4f5",fontFamily:"monospace",lineHeight:1}}>{value??"-"}</span>
      {label&&<span style={{fontSize:9,color:"#666",textTransform:"uppercase",letterSpacing:"0.1em",marginTop:3}}>{label}</span>}
      {sub&&<span style={{fontSize:9,color,marginTop:2,fontWeight:600}}>{sub}</span>}
    </div>
  </div>;
};

const Stat=({label,value,unit,color="#888"})=><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid #13151f"}}>
  <span style={{fontSize:11,color:"#555",textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</span>
  <div>
    <span style={{fontSize:14,fontWeight:700,color,fontFamily:"monospace"}}>{value??"-"}</span>
    {unit&&<span style={{fontSize:10,color:"#444",marginLeft:3}}>{unit}</span>}
  </div>
</div>;

const Card=({children,style={}})=><div style={{background:"#0d0f16",border:"1px solid #1a1e2e",borderRadius:16,padding:20,...style}}>{children}</div>;

const UploadModal=({onClose,onLoaded})=>{
  const [dragging,setDragging]=useState(false);
  const [queued,setQueued]=useState([]);
  const [busy,setBusy]=useState(false);
  const ref=useRef();
  const add=files=>setQueued(q=>[...q,...Array.from(files).map(f=>({file:f,name:f.name,size:(f.size/1024).toFixed(0)+"KB",status:"ready",source:null,error:null}))]);
  const drop=e=>{e.preventDefault();setDragging(false);add(e.dataTransfer.files);};
  const process=async()=>{
    setBusy(true);
    const res={ultrahuman:null,zepp:null};
    const upd=[...queued];
    for(let i=0;i<upd.length;i++){
      if(upd[i].status!=="ready")continue;
      try{
        upd[i]={...upd[i],status:"parsing"};setQueued([...upd]);
        const{source,data}=await parseHealthZip(upd[i].file);
        res[source]=data;upd[i]={...upd[i],status:"done",source};setQueued([...upd]);
      }catch(e){upd[i]={...upd[i],status:"error",error:e.message};setQueued([...upd]);}
    }
    const uh=res.ultrahuman||[],zp=res.zepp||[];
    let merged;
    if(uh.length&&zp.length)merged=mergeData(uh,zp);
    else if(uh.length)merged=mergeData(uh,[]);
    else if(zp.length)merged=mergeData([],zp);
    if(merged?.length){onLoaded(merged);setTimeout(onClose,600);}
    setBusy(false);
  };
  const sc={ready:"#555",parsing:"#fbbf24",done:"#00d4aa",error:"#f87171"};
  const sl={ready:"Ready",parsing:"Reading…",done:"Loaded ✓",error:"Error"};
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}>
    <div style={{background:"#0a0c14",border:"1px solid #1a1e2e",borderRadius:20,padding:32,width:480,maxWidth:"92vw"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <div><div style={{fontSize:16,fontWeight:800,color:"#f4f4f5"}}>Import Your Data</div>
        <div style={{fontSize:11,color:"#555",marginTop:3}}>Ultrahuman Ring · Zepp / Amazfit</div></div>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:18}}>✕</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
        {[{k:"Ultrahuman",h:"App → Profile → Export Data → ZIP"},{k:"Zepp",h:"App → Profile → My Data → Export → ZIP"}].map(s=><div key={s.k} style={{background:"#13151f",borderRadius:10,padding:"10px 12px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#00d4aa",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>{s.k}</div>
          <div style={{fontSize:10,color:"#555",lineHeight:1.5}}>{s.h}</div>
        </div>)}
      </div>
      <div onClick={()=>ref.current?.click()} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={drop}
        style={{border:`2px dashed ${dragging?"#00d4aa":"#1e2235"}`,borderRadius:12,padding:"28px 20px",textAlign:"center",background:dragging?"#00d4aa0a":"#080a10",transition:"all 0.2s",cursor:"pointer"}}>
        <div style={{fontSize:24,marginBottom:6,color:dragging?"#00d4aa":"#444"}}>↑</div>
        <div style={{color:"#888",fontSize:12}}>Drop ZIP files here or tap to browse</div>
        <div style={{color:"#444",fontSize:10,marginTop:2}}>You can drop both at once</div>
      </div>
      <input ref={ref} type="file" accept=".zip" multiple onChange={e=>add(e.target.files)} style={{display:"none"}}/>
      {queued.length>0&&<div style={{marginTop:14,display:"flex",flexDirection:"column",gap:6}}>
        {queued.map((f,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#13151f",borderRadius:8,padding:"8px 12px"}}>
          <div><span style={{fontSize:12,color:"#ccc"}}>{f.name}</span>{f.source&&<span style={{fontSize:9,color:"#00d4aa",marginLeft:8,textTransform:"uppercase"}}>{f.source}</span>}{f.error&&<div style={{fontSize:9,color:"#f87171",marginTop:1}}>{f.error}</div>}</div>
          <span style={{fontSize:10,color:sc[f.status],fontWeight:700}}>{sl[f.status]}</span>
        </div>)}
        <button onClick={process} disabled={busy||queued.every(f=>f.status==="done")}
          style={{marginTop:4,background:busy?"#13151f":"#00d4aa",color:busy?"#444":"#000",border:"none",borderRadius:10,padding:"12px 0",fontWeight:800,fontSize:12,cursor:busy?"not-allowed":"pointer",transition:"all 0.2s"}}>
          {busy?"READING YOUR DATA…":"LOAD INTO DASHBOARD"}
        </button>
      </div>}
    </div>
  </div>;
};

const CorrelationsTab=({data})=>{
  const[xk,setXk]=useState("sleep");
  const[yk,setYk]=useState("hrv");
  const[lag,setLag]=useState(1);
  const[preset,setPreset]=useState(0);
  const applyPreset=i=>{const p=PRESETS[i];setXk(p.x);setYk(p.y);setLag(p.lag);setPreset(i);};
  const scatter=useMemo(()=>{
    const end=data.length-lag||undefined;
    return data.slice(0,end).map((d,i)=>({x:d[xk],y:data[i+lag][yk],date:d.displayDate||d.date})).filter(p=>p.x!=null&&p.y!=null&&!isNaN(p.x)&&!isNaN(p.y));
  },[data,xk,yk,lag]);
  const{r,n}=useMemo(()=>pearson(scatter.map(p=>p.x),scatter.map(p=>p.y)),[scatter]);
  const{text,color,pct}=rLabel(r);
  const regLine=useMemo(()=>{
    if(scatter.length<3)return[];
    const{slope,intercept}=linReg(scatter);
    const xs=scatter.map(p=>p.x),mn=Math.min(...xs),mx=Math.max(...xs);
    return[{x:mn,y:+(slope*mn+intercept).toFixed(2)},{x:mx,y:+(slope*mx+intercept).toFixed(2)}];
  },[scatter]);
  const lagSweep=useMemo(()=>Array.from({length:8},(_,i)=>{const{r:lr}=lagCorr(data,xk,yk,i);return{lag:i,r:lr??0,label:`+${i}d`};}),[data,xk,yk]);
  const presetCorrs=useMemo(()=>PRESETS.map(p=>{const{r:pr}=lagCorr(data,p.x,p.y,p.lag);return{...p,r:pr};}),[data]);
  const heatmap=[["sleep","hrv"],["sleep","readiness"],["workoutLoad","hrv"],["workoutLoad","readiness"],["rhr","readiness"],["deepSleep","hrv"],["steps","sleep"],["stress","hrv"]];
  const mOpts=Object.entries(M).map(([k,v])=>({value:k,label:v.label}));
  const mx=M[xk],my=M[yk];

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
      {presetCorrs.slice(0,3).map((p,i)=>{
        const{text:t,color:c}=rLabel(p.r);
        return <Card key={i} style={{cursor:"pointer",border:`1px solid ${preset===i?c:"#1a1e2e"}`,background:preset===i?"#0d0f16":"#09090f",transition:"all 0.15s"}}>
          <div onClick={()=>applyPreset(i)}>
            <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>{p.label}</div>
            <div style={{fontSize:32,fontWeight:900,fontFamily:"monospace",color:c,lineHeight:1}}>{p.r!=null?(p.r>=0?"+":"")+p.r.toFixed(2):"—"}</div>
            <div style={{fontSize:10,color:c,marginTop:6}}>{t}</div>
          </div>
        </Card>;
      })}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:12}}>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <Card>
          <div style={{fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:14}}>Explorer</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div>
              <div style={{fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>X — cause</div>
              <select value={xk} onChange={e=>{setXk(e.target.value);setPreset(-1);}} style={{width:"100%",background:"#13151f",border:`1px solid ${mx.color}44`,borderRadius:8,color:mx.color,padding:"7px 10px",fontSize:11,fontWeight:700,outline:"none",fontFamily:"inherit"}}>
                {mOpts.map(o=><option key={o.value} value={o.value} style={{background:"#0d0f16"}}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Y — effect</div>
              <select value={yk} onChange={e=>{setYk(e.target.value);setPreset(-1);}} style={{width:"100%",background:"#13151f",border:`1px solid ${my.color}44`,borderRadius:8,color:my.color,padding:"7px 10px",fontSize:11,fontWeight:700,outline:"none",fontFamily:"inherit"}}>
                {mOpts.map(o=><option key={o.value} value={o.value} style={{background:"#0d0f16"}}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:9,color:"#444",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Lag (days)</div>
              <div style={{display:"flex",gap:4}}>{[0,1,2,3,4].map(l=><button key={l} onClick={()=>{setLag(l);setPreset(-1);}} style={{flex:1,padding:"6px 0",borderRadius:7,fontSize:11,fontWeight:800,background:lag===l?"#00d4aa":"#13151f",border:`1px solid ${lag===l?"#00d4aa":"#1e2235"}`,color:lag===l?"#000":"#555",cursor:"pointer",transition:"all 0.12s"}}>{l}</button>)}</div>
            </div>
          </div>
          <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid #13151f"}}>
            <div style={{fontSize:38,fontWeight:900,fontFamily:"monospace",color,lineHeight:1}}>{r!=null?(r>=0?"+":"")+r.toFixed(2):"—"}</div>
            <div style={{fontSize:10,color,marginTop:4,fontWeight:600}}>{text}</div>
            <div style={{fontSize:9,color:"#444",marginTop:3}}>{n} data points</div>
            <div style={{fontSize:10,color:"#555",marginTop:8,lineHeight:1.6}}>
              {r!=null&&Math.abs(r)>=0.3?`When ${mx.label} is ${r>0?"higher":"lower"}, ${my.label} tends to be ${r>0?"higher":"lower"}${lag>0?` ${lag} day${lag>1?"s":""} later`:" the same day"}.`:"Not enough signal in this pairing yet."}
            </div>
          </div>
        </Card>
        <Card>
          <div style={{fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Quick Presets</div>
          {presetCorrs.map((p,i)=>{
            const{color:c,pct:pt}=rLabel(p.r);
            return <div key={i} onClick={()=>applyPreset(i)} style={{cursor:"pointer",padding:"8px 10px",borderRadius:8,background:preset===i?"#13151f":"transparent",border:`1px solid ${preset===i?"#1e2235":"transparent"}`,transition:"all 0.12s",marginBottom:4}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:10,color:"#888",lineHeight:1.3,maxWidth:160}}>{p.label}</span>
                <span style={{fontSize:11,fontWeight:800,fontFamily:"monospace",color:c,flexShrink:0,marginLeft:8}}>{p.r!=null?(p.r>=0?"+":"")+p.r.toFixed(2):"—"}</span>
              </div>
              <div style={{height:2,background:"#13151f",borderRadius:1}}><div style={{height:"100%",width:`${pt}%`,background:c,borderRadius:1,transition:"width 0.6s ease"}}/></div>
            </div>;
          })}
        </Card>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
            <div>
              <div style={{fontSize:13,fontWeight:800,color:"#f4f4f5"}}>
                <span style={{color:mx.color}}>{mx.label}</span>
                <span style={{color:"#333",margin:"0 8px"}}>→{lag>0?` +${lag}d →`:""}</span>
                <span style={{color:my.color}}>{my.label}</span>
              </div>
              <div style={{fontSize:10,color:"#555",marginTop:3}}>{scatter.length} data points</div>
            </div>
            <div style={{fontSize:28,fontWeight:900,fontFamily:"monospace",color}}>{r!=null?(r>=0?"+":"")+r.toFixed(2):"—"}</div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{top:10,right:10,bottom:24,left:10}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13151f"/>
              <XAxis dataKey="x" type="number" name={mx.label} tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} domain={["auto","auto"]}>
                <Label value={mx.label+(mx.unit?" ("+mx.unit+")":"")} offset={-12} position="insideBottom" style={{fill:mx.color,fontSize:9,textTransform:"uppercase"}}/>
              </XAxis>
              <YAxis dataKey="y" type="number" name={my.label} tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} width={36} domain={["auto","auto"]}>
                <Label value={my.label} angle={-90} position="insideLeft" style={{fill:my.color,fontSize:9,textTransform:"uppercase"}}/>
              </YAxis>
              <ZAxis range={[30,30]}/>
              <Tooltip content={<ScatTip/>}/>
              <Scatter data={scatter} fill={mx.color} fillOpacity={0.65} name={mx.label}/>
              <Scatter data={regLine} fill="none" line={{stroke:color,strokeWidth:2,strokeDasharray:"6 3"}} shape={()=>null} legendType="none"/>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:3}}>Lag Sweep</div>
          <div style={{fontSize:10,color:"#555",marginBottom:12}}>At which lag does the correlation peak?</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={lagSweep} margin={{top:5,right:5,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13151f" vertical={false}/>
              <XAxis dataKey="label" tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false}/>
              <YAxis domain={[-1,1]} tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} width={28}/>
              <Tooltip content={<Tip/>}/>
              <ReferenceLine y={0} stroke="#1e2235"/>
              <Bar dataKey="r" name="r" radius={[3,3,0,0]} fill="#00d4aa"/>
            </BarChart>
          </ResponsiveContainer>
          <div style={{fontSize:9,color:"#555",marginTop:6}}>Peak at +{lagSweep.reduce((a,b)=>Math.abs(b.r)>Math.abs(a.r)?b:a,lagSweep[0]).lag}d lag</div>
        </Card>
      </div>
    </div>

    <Card>
      <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:3}}>Full Correlation Matrix</div>
      <div style={{fontSize:10,color:"#555",marginBottom:14}}>All key pairs · 0–4 day lags · Green = positive · Red = negative · Tap any cell to explore it</div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
        <div style={{width:180,flexShrink:0}}/>
        {[0,1,2,3,4].map(l=><div key={l} style={{flex:1,textAlign:"center",fontSize:9,color:"#555",textTransform:"uppercase"}}>+{l}d</div>)}
      </div>
      {heatmap.map(([x,y],i)=>{
        const corrs=[0,1,2,3,4].map(l=>lagCorr(data,x,y,l));
        const mx2=M[x],my2=M[y];
        return <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0",borderBottom:"1px solid #0d0f16"}}>
          <div style={{width:180,flexShrink:0,fontSize:10,color:"#666"}}>
            <span style={{color:mx2.color}}>{mx2.label}</span>
            <span style={{color:"#333",margin:"0 4px"}}>→</span>
            <span style={{color:my2.color}}>{my2.label}</span>
          </div>
          {corrs.map(({r:cr},j)=>{
            const a=Math.abs(cr||0);
            const bg=cr>0?`rgba(0,212,170,${a*0.9})`:`rgba(248,113,113,${a*0.9})`;
            return <div key={j} onClick={()=>{setXk(x);setYk(y);setLag(j);setPreset(-1);}}
              style={{flex:1,height:30,background:bg,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,fontFamily:"monospace",color:a>0.35?"#000":"#555",cursor:"pointer",transition:"background 0.3s"}}>
              {cr!=null?(cr>=0?"+":"")+cr.toFixed(2):"—"}
            </div>;
          })}
        </div>;
      })}
    </Card>
  </div>;
};

export default function App(){
  const[tab,setTab]=useState("overview");
  const[range,setRange]=useState("30d");
  const[upload,setUpload]=useState(false);
  const[metric,setMetric]=useState("hrv");
  const[realData,setReal]=useState(null);
  const[in_,setIn]=useState(false);
  useEffect(()=>{setTimeout(()=>setIn(true),80);},[]);
  const onLoaded=useCallback(d=>{setReal(d);setRange("30d");},[]);
  const pool=realData||DEMO;
  const n=range==="7d"?7:range==="14d"?14:range==="30d"?30:90;
  const slice=pool.slice(-n);
  const today=pool[pool.length-1]||{};
  const chartData=slice.map(d=>({...d,day:d.dayName||(d.date?.slice(-5))}));
  const tabs=[{id:"overview",label:"Overview",icon:"◎"},{id:"recovery",label:"Recovery",icon:"♡"},{id:"sleep",label:"Sleep",icon:"◑"},{id:"activity",label:"Activity",icon:"⚡"},{id:"correlations",label:"Correlations",icon:"⊞"},{id:"trends",label:"Trends",icon:"↗"}];
  const readColor=v=>!v?"#555":v>=70?"#00d4aa":v>=50?"#fbbf24":"#f87171";
  const readLabel=v=>!v?"—":v>=70?"Optimal":v>=50?"Good":"Rest";

  return <div style={{minHeight:"100vh",background:"#060810",fontFamily:"'Inter',-apple-system,sans-serif",color:"#f4f4f5",opacity:in_?1:0,transform:in_?"none":"translateY(6px)",transition:"opacity 0.4s ease,transform 0.4s ease"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0;}::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:#1e2235;border-radius:2px;}button,select{font-family:inherit;}`}</style>
    {upload&&<UploadModal onClose={()=>setUpload(false)} onLoaded={onLoaded}/>}

    <div style={{padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #13151f",background:"#060810",position:"sticky",top:0,zIndex:50}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:28,height:28,borderRadius:8,background:"linear-gradient(135deg,#00d4aa,#4f8ef7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color:"#000"}}>V</div>
        <span style={{fontSize:15,fontWeight:800,letterSpacing:"-0.02em"}}>VitalOS</span>
        {realData&&<span style={{fontSize:9,background:"#00d4aa22",color:"#00d4aa",padding:"2px 8px",borderRadius:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Live</span>}
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <div style={{display:"flex",background:"#0d0f16",border:"1px solid #1a1e2e",borderRadius:8,padding:3,gap:2}}>
          {["7d","14d","30d","90d"].map(r=><button key={r} onClick={()=>setRange(r)} style={{padding:"4px 9px",borderRadius:6,fontSize:10,fontWeight:700,background:range===r?"#00d4aa":"transparent",color:range===r?"#000":"#555",border:"none",cursor:"pointer",transition:"all 0.12s",letterSpacing:"0.04em"}}>{r.toUpperCase()}</button>)}
        </div>
        <button onClick={()=>setUpload(true)} style={{display:"flex",alignItems:"center",gap:5,padding:"7px 12px",background:"#0d0f16",border:"1px solid #1a1e2e",borderRadius:8,color:"#00d4aa",fontSize:11,fontWeight:700,cursor:"pointer"}}>↑ Import</button>
      </div>
    </div>

    <div style={{display:"flex",padding:"0 20px",borderBottom:"1px solid #13151f",background:"#060810",overflowX:"auto"}}>
      {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{display:"flex",alignItems:"center",gap:5,padding:"12px 14px",background:"none",border:"none",cursor:"pointer",fontSize:11,fontWeight:600,color:tab===t.id?"#f4f4f5":"#444",borderBottom:tab===t.id?"2px solid #00d4aa":"2px solid transparent",transition:"all 0.12s",whiteSpace:"nowrap",letterSpacing:"0.04em",textTransform:"uppercase"}}>
        <span style={{color:tab===t.id?"#00d4aa":"#333"}}>{t.icon}</span>{t.label}
        {t.id==="correlations"&&<span style={{fontSize:7,background:"#00d4aa22",color:"#00d4aa",padding:"1px 4px",borderRadius:3,fontWeight:900}}>★</span>}
      </button>)}
    </div>

    <div style={{padding:"18px 20px 60px",maxWidth:1280}}>
      {realData&&<div style={{marginBottom:12,background:"#00d4aa0a",border:"1px solid #00d4aa22",borderRadius:10,padding:"9px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:11,color:"#00d4aa"}}>✓ Real data — {realData.length} days · {realData.filter(d=>d.source==="both").length} days merged</span>
        <button onClick={()=>setReal(null)} style={{fontSize:10,color:"#555",background:"none",border:"none",cursor:"pointer"}}>Use demo</button>
      </div>}

      {tab==="correlations"&&<CorrelationsTab data={pool}/>}

      {tab==="overview"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:12}}>
          <Card style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,padding:20}}>
            <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.1em"}}>Readiness</div>
            <Ring value={today.readiness} size={130} sw={11} color={readColor(today.readiness)} label="Today" sub={readLabel(today.readiness)}/>
            <div style={{width:"100%"}}>
              {[{k:"hrv",l:"HRV",u:"ms",c:"#00d4aa",max:25},{k:"rhr",l:"RHR",u:"bpm",c:"#f87171",max:70},{k:"spo2",l:"SpO₂",u:"%",c:"#38bdf8",max:100}].map(m=><div key={m.k} style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.07em"}}>{m.l}</span>
                  <span style={{fontSize:11,color:"#f4f4f5",fontFamily:"monospace",fontWeight:700}}>{today[m.k]??"-"}{today[m.k]!=null&&<span style={{color:"#555",fontSize:9}}> {m.u}</span>}</span>
                </div>
                <div style={{height:2,background:"#13151f",borderRadius:1}}><div style={{height:"100%",width:`${Math.min(100,((today[m.k]||0)/m.max)*100)}%`,background:m.c,borderRadius:1,transition:"width 1s ease",boxShadow:`0 0 6px ${m.c}55`}}/></div>
              </div>)}
            </div>
          </Card>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[{k:"hrv",l:"HRV",u:"ms",c:"#00d4aa"},{k:"sleep",l:"Sleep",u:"h",c:"#4f8ef7"},{k:"rhr",l:"Resting HR",u:"bpm",c:"#f87171"},{k:"steps",l:"Steps",u:"",c:"#fbbf24"},{k:"calories",l:"Calories",u:"kcal",c:"#4ade80"},{k:"spo2",l:"SpO₂",u:"%",c:"#38bdf8"}].map(m=><div key={m.k} onClick={()=>setMetric(m.k)} style={{background:metric===m.k?`${m.c}10`:"#0d0f16",border:`1px solid ${metric===m.k?m.c:"#1a1e2e"}`,borderRadius:12,padding:"12px 14px",cursor:"pointer",transition:"all 0.15s",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",top:0,right:0,width:50,height:50,background:`radial-gradient(circle at top right,${m.c}18,transparent 70%)`}}/>
                <div style={{fontSize:20,fontWeight:800,color:"#f4f4f5",fontFamily:"monospace",lineHeight:1}}>{today[m.k]!=null?typeof today[m.k]==="number"&&today[m.k]>1000?today[m.k].toLocaleString():today[m.k]:<span style={{color:"#333",fontSize:14}}>—</span>}</div>
                <div style={{fontSize:9,color:"#555",marginTop:5,textTransform:"uppercase",letterSpacing:"0.07em"}}>{m.l}{m.u&&<span style={{color:"#444",marginLeft:2}}>{m.u}</span>}</div>
              </div>)}
            </div>
            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:M[metric]?.color}}>{M[metric]?.label} — {range}</div>
                <div style={{display:"flex",gap:3}}>
                  {["hrv","sleep","readiness","rhr","steps"].map(k=><button key={k} onClick={()=>setMetric(k)} style={{padding:"3px 7px",borderRadius:5,fontSize:9,fontWeight:700,background:metric===k?M[k]?.color:"transparent",color:metric===k?"#000":M[k]?.color,border:`1px solid ${M[k]?.color}44`,cursor:"pointer",transition:"all 0.12s",textTransform:"uppercase"}}>{k}</button>)}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData} margin={{top:5,right:5,bottom:0,left:0}}>
                  <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={M[metric]?.color} stopOpacity={0.25}/><stop offset="95%" stopColor={M[metric]?.color} stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#13151f" vertical={false}/>
                  <XAxis dataKey="day" tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
                  <YAxis tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} width={28}/>
                  <Tooltip content={<Tip/>}/>
                  <Area type="monotone" dataKey={metric} name={M[metric]?.label} stroke={M[metric]?.color} fill="url(#mg)" strokeWidth={2} dot={false} activeDot={{r:3}} connectNulls/>
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Card>
            <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:12}}>Last Night's Sleep</div>
            <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:14}}>
              <Ring value={today.sleepEfficiency} size={85} sw={8} color="#4f8ef7" label="Eff%"/>
              <div>
                <div style={{fontSize:30,fontWeight:900,fontFamily:"monospace",color:"#4f8ef7",lineHeight:1}}>{today.sleep??<span style={{color:"#333",fontSize:18}}>—</span>}<span style={{fontSize:12,color:"#555",marginLeft:2}}>h</span></div>
                {today.bedtime&&<div style={{fontSize:10,color:"#555",marginTop:4}}>{new Date(today.bedtime).toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"})} → {today.wakeup?new Date(today.wakeup).toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"}):""}</div>}
              </div>
            </div>
            <div style={{display:"flex",height:6,borderRadius:3,overflow:"hidden",gap:1,marginBottom:10}}>
              {[{k:"deepSleep",c:"#818cf8"},{k:"remSleep",c:"#38bdf8"},{k:"lightSleep",c:"#4f8ef7"}].map(s=><div key={s.k} style={{flex:today[s.k]||1,background:s.c,boxShadow:`0 0 4px ${s.c}66`}}/>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
              {[{l:"Deep",k:"deepSleep",c:"#818cf8"},{l:"REM",k:"remSleep",c:"#38bdf8"},{l:"Light",k:"lightSleep",c:"#4f8ef7"}].map(s=><div key={s.k}>
                <div style={{fontSize:13,fontWeight:800,color:s.c,fontFamily:"monospace"}}>{today[s.k]!=null?today[s.k]+"h":"—"}</div>
                <div style={{fontSize:9,color:"#555",marginTop:1}}>{s.l}</div>
              </div>)}
            </div>
          </Card>
          <Card>
            <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:4}}>Recent Workouts</div>
            <div style={{fontSize:9,color:"#555",marginBottom:10}}>{realData?"From your exports":"Demo"}</div>
            {pool.slice(-14).flatMap(d=>d.workouts||[]).slice(-5).reverse().map((w,i)=>{
              const wc=["#00d4aa","#4f8ef7","#f87171","#fbbf24","#a78bfa"][i%5];
              return <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid #13151f"}}>
                <div style={{width:32,height:32,borderRadius:7,background:`${wc}18`,border:`1px solid ${wc}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>⚡</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,fontWeight:600,color:"#f4f4f5"}}>{w.name}</div>
                  <div style={{fontSize:9,color:"#555",marginTop:1}}>{w.startTime?.slice(0,10)} · {w.duration}min{w.distance?` · ${w.distance}km`:""}</div>
                </div>
                {w.calories>0&&<div style={{fontSize:10,color:"#4ade80",fontFamily:"monospace",fontWeight:700}}>{w.calories}kcal</div>}
              </div>;
            })}
            {pool.slice(-14).flatMap(d=>d.workouts||[]).length===0&&<div style={{color:"#333",fontSize:11,padding:"16px 0",textAlign:"center"}}>No workouts logged</div>}
          </Card>
        </div>
      </div>}

      {tab==="recovery"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
          {[{k:"hrv",c:"#00d4aa",max:25},{k:"readiness",c:"#a78bfa",max:100},{k:"rhr",c:"#f87171",max:70}].map(m=><Card key={m.k} style={{textAlign:"center",padding:24}}>
            <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:14}}>{M[m.k].label}</div>
            <div style={{display:"flex",justifyContent:"center",marginBottom:10}}><Ring value={today[m.k]??0} max={m.max} size={110} sw={9} color={m.c}/></div>
            <div style={{fontSize:10,color:"#555"}}>{today[m.k]!=null?`${today[m.k]} ${M[m.k].unit}`:""}</div>
          </Card>)}
        </div>
        <Card>
          <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:14}}>Recovery Signals — {range}</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{top:5,right:5,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13151f" vertical={false}/>
              <XAxis dataKey="day" tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} width={28}/>
              <Tooltip content={<Tip/>}/>
              <Line type="monotone" dataKey="hrv" name="HRV" stroke="#00d4aa" strokeWidth={2} dot={false} activeDot={{r:3}} connectNulls/>
              <Line type="monotone" dataKey="readiness" name="Readiness" stroke="#a78bfa" strokeWidth={2} dot={false} activeDot={{r:3}} connectNulls/>
              <Line type="monotone" dataKey="rhr" name="RHR" stroke="#f87171" strokeWidth={1.5} strokeDasharray="4 2" dot={false} activeDot={{r:3}} connectNulls/>
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>}

      {tab==="sleep"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Card style={{padding:24}}>
            <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:18}}>Last Night</div>
            <div style={{display:"flex",gap:18,alignItems:"center"}}>
              <Ring value={today.sleepEfficiency} size={120} sw={10} color="#4f8ef7" label="Efficiency"/>
              <div style={{flex:1}}>
                <Stat label="Total" value={today.sleep} unit="h" color="#4f8ef7"/>
                <Stat label="Deep" value={today.deepSleep} unit="h" color="#818cf8"/>
                <Stat label="REM" value={today.remSleep} unit="h" color="#38bdf8"/>
                <Stat label="Light" value={today.lightSleep} unit="h" color="#4f8ef7"/>
              </div>
            </div>
          </Card>
          <Card style={{padding:24}}>
            <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:18}}>Timing</div>
            <Stat label="Bedtime" value={today.bedtime?new Date(today.bedtime).toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"}):"—"} color="#4f8ef7"/>
            <Stat label="Wake" value={today.wakeup?new Date(today.wakeup).toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"}):"—"} color="#00d4aa"/>
            <Stat label="Efficiency" value={today.sleepEfficiency} unit="%" color="#fbbf24"/>
            <Stat label="HRV overnight" value={today.hrv} unit="ms" color="#00d4aa"/>
            <Stat label="Resting HR" value={today.rhr} unit="bpm" color="#f87171"/>
          </Card>
        </div>
        <Card>
          <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:14}}>Sleep Duration — {range}</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{top:5,right:5,bottom:0,left:0}}>
              <defs>
                <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4f8ef7" stopOpacity={0.3}/><stop offset="95%" stopColor="#4f8ef7" stopOpacity={0}/></linearGradient>
                <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#818cf8" stopOpacity={0.3}/><stop offset="95%" stopColor="#818cf8" stopOpacity={0}/></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#13151f" vertical={false}/>
              <XAxis dataKey="day" tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
              <YAxis domain={[0,11]} tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} width={24}/>
              <Tooltip content={<Tip/>}/>
              <ReferenceLine y={8} stroke="#00d4aa" strokeDasharray="4 2" strokeOpacity={0.3}/>
              <Area type="monotone" dataKey="sleep" name="Sleep" stroke="#4f8ef7" fill="url(#sg)" strokeWidth={2} dot={false} activeDot={{r:3}} connectNulls/>
              <Area type="monotone" dataKey="deepSleep" name="Deep" stroke="#818cf8" fill="url(#dg)" strokeWidth={1.5} dot={false} connectNulls/>
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>}

      {tab==="activity"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
          {[{k:"steps",c:"#fbbf24"},{k:"calories",c:"#4ade80",u:"kcal"},{k:"distance",c:"#38bdf8",u:"m"},{k:"workoutLoad",c:"#fb923c"}].map(m=><Card key={m.k} style={{padding:16}}>
            <div style={{fontSize:20,fontWeight:800,fontFamily:"monospace",color:m.c,lineHeight:1}}>{today[m.k]!=null?m.k==="steps"?today[m.k].toLocaleString():today[m.k]:<span style={{color:"#333",fontSize:14}}>—</span>}</div>
            <div style={{fontSize:9,color:"#555",marginTop:6,textTransform:"uppercase",letterSpacing:"0.07em"}}>{M[m.k]?.label}{m.u&&<span style={{color:"#444",marginLeft:2}}>{m.u}</span>}</div>
          </Card>)}
        </div>
        <Card>
          <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:14}}>Daily Steps — {range}</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{top:5,right:5,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13151f" vertical={false}/>
              <XAxis dataKey="day" tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} width={36}/>
              <Tooltip content={<Tip/>}/>
              <Bar dataKey="steps" name="Steps" fill="#fbbf24" radius={[3,3,0,0]} opacity={0.85}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:4}}>Workout Log</div>
          <div style={{fontSize:9,color:"#555",marginBottom:10}}>{realData?"From your exports":"Demo"}</div>
          {pool.slice(-30).flatMap(d=>d.workouts||[]).slice(-8).reverse().map((w,i)=>{
            const wc=["#00d4aa","#4f8ef7","#f87171","#fbbf24","#a78bfa"][i%5];
            return <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 0",borderBottom:"1px solid #13151f"}}>
              <div style={{width:34,height:34,borderRadius:8,background:`${wc}18`,border:`1px solid ${wc}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>⚡</div>
              <div style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:600,color:"#f4f4f5"}}>{w.name}</div>
                <div style={{fontSize:9,color:"#555",marginTop:1}}>{w.startTime?.slice(0,10)} · {w.duration}min{w.distance?` · ${w.distance}km`:""}</div>
              </div>
              {w.calories>0&&<div style={{fontSize:10,color:"#4ade80",fontFamily:"monospace",fontWeight:700}}>{w.calories}kcal</div>}
            </div>;
          })}
        </Card>
      </div>}

      {tab==="trends"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <Card>
          <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:14}}>All Signals — {range}</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{top:5,right:5,bottom:0,left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#13151f" vertical={false}/>
              <XAxis dataKey="day" tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
              <YAxis tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} width={28}/>
              <Tooltip content={<Tip/>}/>
              <Line type="monotone" dataKey="hrv" name="HRV" stroke="#00d4aa" strokeWidth={2} dot={false} connectNulls/>
              <Line type="monotone" dataKey="readiness" name="Readiness" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls/>
              <Line type="monotone" dataKey="sleep" name="Sleep(h)" stroke="#4f8ef7" strokeWidth={1.5} strokeDasharray="5 2" dot={false} connectNulls/>
              <Line type="monotone" dataKey="rhr" name="RHR" stroke="#f87171" strokeWidth={1.5} strokeDasharray="3 3" dot={false} connectNulls/>
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Card>
            <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:14}}>Period Averages vs Previous</div>
            {(()=>{
              const cur=pool.slice(-n),prev=pool.slice(-(n*2),-n);
              const avg=(arr,k)=>{const v=arr.map(d=>d[k]).filter(x=>x!=null&&!isNaN(x));return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
              return[{k:"hrv",l:"Avg HRV",u:"ms"},{k:"sleep",l:"Avg Sleep",u:"h"},{k:"rhr",l:"Avg RHR",u:"bpm"},{k:"readiness",l:"Avg Readiness",u:""}].map(m=>{
                const c=avg(cur,m.k),p=avg(prev,m.k),up=c!=null&&p!=null&&c>p;
                return <div key={m.k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid #13151f"}}>
                  <span style={{fontSize:11,color:"#555"}}>{m.l}</span>
                  <div>
                    <span style={{fontSize:14,fontWeight:800,color:M[m.k].color,fontFamily:"monospace"}}>{c!=null?(m.k==="sleep"?c.toFixed(1):Math.round(c)):"—"}{m.u&&<span style={{fontSize:10,color:"#444",marginLeft:2}}>{m.u}</span>}</span>
                    {c!=null&&p!=null&&<span style={{fontSize:9,color:up?"#00d4aa":"#f87171",marginLeft:6}}>{up?"▲":"▼"} {Math.abs(((c-p)/p)*100).toFixed(0)}%</span>}
                  </div>
                </div>;
              });
            })()}
          </Card>
          <Card>
            <div style={{fontSize:11,fontWeight:700,color:"#f4f4f5",marginBottom:14}}>HRV Distribution (90 days)</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={(()=>{
                const vals=pool.slice(-90).map(d=>d.hrv).filter(v=>v!=null&&!isNaN(v));
                if(!vals.length)return[];
                const mn=Math.min(...vals),mx2=Math.max(...vals),bw=Math.max(1,Math.ceil((mx2-mn)/10));
                const bins={};
                vals.forEach(v=>{const b=Math.floor((v-mn)/bw)*bw+mn;bins[b]=(bins[b]||0)+1;});
                return Object.entries(bins).sort(([a],[b])=>+a-+b).map(([k,v])=>({range:k,count:v}));
              })()} margin={{top:5,right:5,bottom:0,left:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#13151f" vertical={false}/>
                <XAxis dataKey="range" tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:"#555",fontSize:9}} axisLine={false} tickLine={false} width={24}/>
                <Tooltip content={<Tip/>}/>
                <Bar dataKey="count" name="Days" fill="#00d4aa" radius={[3,3,0,0]} opacity={0.8}/>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>}
    </div>
  </div>;
}
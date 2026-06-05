import JSZip from "jszip";

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const vals = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ; continue; }
      if (line[i] === "," && !inQ) { vals.push(cur.trim()); cur = ""; continue; }
      cur += line[i];
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== ""));
}

export async function parseUltrahuman(zipFile) {
  const zip = await JSZip.loadAsync(zipFile);
  const ringFiles = Object.keys(zip.files).filter(n => n.match(/ring_data_\d+_\d+\.csv$/));
  const eventFile = Object.keys(zip.files).find(n => n.includes("user_events.csv"));
  const byDate = {};
  const ensure = d => { if (!byDate[d]) byDate[d] = { hrv: [], hr: [], spo2: [], steps: 0, temp: [], rr: [], workouts: [] }; };
  for (const fname of ringFiles) {
    const text = await zip.files[fname].async("string");
    for (const row of parseCSV(text)) {
      if (!row.timestamp_epoch) continue;
      try {
        const ts = parseInt(row.timestamp_epoch);
        const dt = new Date(ts * 1000).toISOString().slice(0, 10);
        const val = parseFloat(row.value);
        if (isNaN(val)) continue;
        ensure(dt);
        const d = byDate[dt];
        if (row.data_type === "raw_hrv_2" && val > 0) d.hrv.push(val);
        else if (row.data_type === "raw_hr" && val > 30 && val < 200) d.hr.push(val);
        else if (row.data_type === "spo2" && val > 90) d.spo2.push(val);
        else if (row.data_type === "steps" && val > 0) d.steps += val;
        else if (row.data_type === "temp" && val > 20 && val < 45) d.temp.push(val);
        else if (row.data_type === "respiratory_rate" && val > 5 && val < 40) d.rr.push(val);
      } catch(e) {}
    }
  }
  if (eventFile) {
    const text = await zip.files[eventFile].async("string");
    for (const row of parseCSV(text)) {
      if (!row["Event Time"]) continue;
      const dt = row["Event Time"].slice(0, 10);
      ensure(dt);
      if (row["Event Type"] === "NATIVE_WORKOUT" || row["Event Type"] === "ACTIVITY") {
        byDate[dt].workouts.push({ name: row["Title"] || "Workout", duration: Math.round((parseInt(row["Duration (seconds)"]) || 0) / 60), startTime: row["Event Time"] });
      }
    }
  }
  const avg = a => a.length ? a.reduce((x,y) => x+y, 0) / a.length : null;
  return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).map(([date, d]) => {
    const sorted = [...d.hr].sort((a,b) => a-b);
    const p10 = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.1)));
    return { date, hrv: d.hrv.length ? Math.round(avg(d.hrv) / 10) : null, rhr: p10.length ? Math.round(avg(p10)) : null, spo2: d.spo2.length ? +avg(d.spo2).toFixed(1) : null, steps: d.steps > 0 ? Math.round(d.steps) : null, temp: d.temp.length ? +avg(d.temp).toFixed(2) : null, rr: d.rr.length ? +avg(d.rr).toFixed(1) : null, workouts: d.workouts };
  });
}

export async function parseZepp(zipFile) {
  const zip = await JSZip.loadAsync(zipFile);
  const find = pat => Object.keys(zip.files).find(n => n.match(pat));
  const read = async f => { if (!f) return []; return parseCSV(await zip.files[f].async("string")); };
  const [sleepRows, actRows, sportRows, hrRows] = await Promise.all([read(find(/SLEEP_\d+\.csv$/)), read(find(/ACTIVITY_\d+\.csv$/)), read(find(/SPORT_\d+\.csv$/)), read(find(/HEARTRATE_AUTO_\d+\.csv$/))]);
  const byDate = {};
  const ensure = d => { if (!byDate[d]) byDate[d] = { date: d }; };
  for (const row of sleepRows) {
    const date = (row.date || row["\uFEFFdate"] || "").trim();
    if (!date) continue;
    ensure(date);
    const deep=parseInt(row.deepSleepTime)||0, light=parseInt(row.shallowSleepTime)||0, rem=parseInt(row.REMTime)||0, wake=parseInt(row.wakeTime)||0, total=deep+light+rem;
    Object.assign(byDate[date], { sleep: total>0?+(total/60).toFixed(2):null, deepSleep:+(deep/60).toFixed(2), remSleep:+(rem/60).toFixed(2), lightSleep:+(light/60).toFixed(2), sleepEfficiency:(total+wake)>0?Math.round(total/(total+wake)*100):null, bedtime:row.start||null, wakeup:row.stop||null });
  }
  for (const row of actRows) {
    const date = (row.date || row["\uFEFFdate"] || "").trim();
    if (!date) continue;
    ensure(date);
    Object.assign(byDate[date], { steps:parseInt(row.steps)||null, calories:parseInt(row.calories)||null, distance:parseInt(row.distance)||null });
  }
  const sportMap = {1:"Running",9:"Indoor Run",6:"Cycling",52:"Strength",53:"Yoga",5:"Walking",4:"Hiking",78:"HIIT",8:"Swimming"};
  for (const row of sportRows) {
    const st = row.startTime || ""; if (!st) continue;
    const date = st.slice(0,10); ensure(date);
    if (!byDate[date].workouts) byDate[date].workouts = [];
    const typeNum = parseInt(row["\uFEFFtype"] || row.type);
    byDate[date].workouts.push({ name:sportMap[typeNum]||"Activity", duration:Math.round((parseInt(row["sportTime(s)"])||0)/60), calories:Math.round(parseFloat(row["calories(kcal)"])||0), distance:parseFloat(row["distance(m)"])>0?+(parseFloat(row["distance(m)"])/1000).toFixed(2):null, startTime:st });
  }
  const hrByDate = {};
  for (const row of hrRows) {
    const date=(row.date||row["\uFEFFdate"]||"").trim(), hr=parseInt(row.heartRate);
    if (!date||!hr||hr<30||hr>200) continue;
    if (!hrByDate[date]) hrByDate[date]=[];
    hrByDate[date].push(hr);
  }
  for (const [date,hrs] of Object.entries(hrByDate)) {
    ensure(date);
    const s=[...hrs].sort((a,b)=>a-b), p=s.slice(0,Math.max(1,Math.floor(s.length*0.1)));
    byDate[date].rhr=Math.round(p.reduce((a,b)=>a+b,0)/p.length);
  }
  return Object.values(byDate).sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,source:"zepp"}));
}

export function mergeData(uhDays, zpDays) {
  const merged = {};
  for (const d of uhDays) merged[d.date] = { ...d, source:"ultrahuman" };
  for (const d of zpDays) {
    if (merged[d.date]) {
      merged[d.date] = { ...merged[d.date], sleep:d.sleep??merged[d.date].sleep, deepSleep:d.deepSleep??merged[d.date].deepSleep, remSleep:d.remSleep??merged[d.date].remSleep, lightSleep:d.lightSleep??merged[d.date].lightSleep, sleepEfficiency:d.sleepEfficiency??merged[d.date].sleepEfficiency, bedtime:d.bedtime??merged[d.date].bedtime, wakeup:d.wakeup??merged[d.date].wakeup, steps:d.steps??merged[d.date].steps, calories:d.calories??merged[d.date].calories, distance:d.distance??merged[d.date].distance, workouts:[...(merged[d.date].workouts||[]),...(d.workouts||[])], source:"both" };
    } else { merged[d.date] = { ...d }; }
  }
  return Object.values(merged).sort((a,b)=>a.date.localeCompare(b.date)).map(d => {
    const sigs=[];
    if (d.hrv) sigs.push(Math.min(100,d.hrv/60*100));
    if (d.sleep) sigs.push(Math.min(100,d.sleep/8*100));
    if (d.rhr) sigs.push(Math.max(0,100-(d.rhr-40)*2));
    const readiness=sigs.length?Math.round(sigs.reduce((a,b)=>a+b,0)/sigs.length):null;
    const dt=new Date(d.date+"T12:00:00Z");
    return { ...d, readiness, displayDate:dt.toLocaleDateString("en",{month:"short",day:"numeric"}), dayName:dt.toLocaleDateString("en",{weekday:"short"}) };
  });
}

export async function parseHealthZip(file) {
  const zip = await JSZip.loadAsync(file);
  const files = Object.keys(zip.files);
  const isUltrahuman = files.some(f => f.match(/ring_data_\d+_\d+\.csv/));
  const isZepp = files.some(f => f.match(/SLEEP_\d+\.csv/));
  if (isUltrahuman) return { source:"ultrahuman", data:await parseUltrahuman(file) };
  if (isZepp) return { source:"zepp", data:await parseZepp(file) };
  throw new Error("Unrecognized format. Please upload a Ultrahuman or Zepp ZIP.");
}
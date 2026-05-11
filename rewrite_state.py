#!/usr/bin/env python3
"""
Rewrite governance.html to use DB as source of truth.
Key changes:
1. ST starts empty (no localStorage for data)
2. Fetch from API on load, populate ST, then render
3. All changes PATCH to API + update ST in memory
4. localStorage only for facility preference
"""

with open('public/governance.html', 'r', errors='ignore') as f:
    c = f.read()

# ═════════════════════════════════════════════════════════════════
# STEP 1: Replace STATE section
# ═════════════════════════════════════════════════════════════════

old_state = """// STATE
let ST={},CH=null,PENDING={},EDIT_MODE=false,DRAFT_UP={},DRAFT_RM={};
const CU=()=>ST[document.getElementById('fs').value];
// DF = Display resolver: ST + PENDING merged for UI/chart
const DF=()=>{
  var f=document.getElementById('fs').value;
  var d={pp:'',ms:{},up:{}};
  if(ST[f]){d.pp=ST[f].pp;d.ms=JSON.parse(JSON.stringify(ST[f].ms));d.up=ST[f].up?JSON.parse(JSON.stringify(ST[f].up)):{};}
  if(PENDING[f]&&PENDING[f].ms){
    Object.entries(PENDING[f].ms).forEach(function(e){
      var k=e[0],v=e[1];
      if(!d.ms[k])d.ms[k]={};
      if(v.compDate!==undefined)d.ms[k].compDate=v.compDate;
    });
  }
  return d;
};"""

new_state = """// STATE
let ST={},CH=null,PENDING={},EDIT_MODE=false,DRAFT_UP={},DRAFT_RM={};
const API_BASE='';
const CU=()=>ST[document.getElementById('fs').value];
// DF = Display resolver: ST + PENDING merged for UI/chart
const DF=()=>{
  var f=document.getElementById('fs').value;
  var d={pp:'',ms:{},up:{}};
  if(ST[f]){d.pp=ST[f].pp;d.ms=JSON.parse(JSON.stringify(ST[f].ms));d.up=ST[f].up?JSON.parse(JSON.stringify(ST[f].up)):{};}
  if(PENDING[f]&&PENDING[f].ms){
    Object.entries(PENDING[f].ms).forEach(function(e){
      var k=e[0],v=e[1];
      if(!d.ms[k])d.ms[k]={};
      if(v.compDate!==undefined)d.ms[k].compDate=v.compDate;
    });
  }
  return d;
};

// ═══ DB-FIRST STATE MANAGEMENT ═══
// All data comes from the API. ST is in-memory only.
// localStorage is only used for "which facility was last selected".

// Fetch ALL state (milestones + files) from DB
async function fetchStateFromDB(facility){
  console.log('[DB] Fetching state for', facility);
  try{
    var resp=await fetch(API_BASE+'/api/governance/state/'+encodeURIComponent(facility));
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    var data=await resp.json();
    if(data.error)throw new Error(data.error);
    
    // Build ST entry for this facility
    if(!ST[facility])ST[facility]={pp:'',ms:{},up:{}};
    
    // Apply milestone states from DB
    if(data.states){
      data.states.forEach(function(s){
        ST[facility].ms[s.milestoneId]={
          subDate:s.subDate||'',
          compDate:s.compDate||'',
          pct:s.customPct
        };
      });
    }
    
    // Apply files from DB
    if(data.files){
      ST[facility].up={};
      data.files.forEach(function(f){
        var key=f.milestoneId;
        if(!ST[facility].up[key])ST[facility].up[key]=[];
        ST[facility].up[key].push({
          id:f.id,
          name:f.filename,
          url:f.fileUrl,
          size:f.fileSize||0,
          date:f.uploadedAt,
          fromDB:true
        });
      });
    }
    
    // Ensure all milestones exist (even if no DB record)
    Object.keys(MSD).forEach(function(m){
      if(!ST[facility].ms[m])ST[facility].ms[m]={subDate:'',compDate:'',pct:null};
    });
    
    console.log('[DB] State loaded for', facility);
    return true;
  }catch(e){
    console.error('[DB] Fetch failed:', e.message);
    // Fallback: ensure facility exists with empty data
    if(!ST[facility])ST[facility]={pp:'',ms:{},up:{}};
    Object.keys(MSD).forEach(function(m){
      if(!ST[facility].ms[m])ST[facility].ms[m]={subDate:'',compDate:'',pct:null};
    });
    return false;
  }
}

// Save a milestone state to DB
async function saveMilestoneToDB(facility, mId, changes){
  try{
    var resp=await fetch(API_BASE+'/api/governance/state/'+encodeURIComponent(facility),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        milestoneId:mId,
        compDate:changes.compDate!==undefined?changes.compDate:undefined,
        customPct:changes.pct!==undefined?changes.pct:undefined,
        pppDate:changes.ppp!==undefined?changes.ppp:undefined
      })
    });
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    var data=await resp.json();
    console.log('[DB] Saved milestone', mId, ':', data.success);
    return data.success;
  }catch(e){
    console.error('[DB] Save failed for', mId, ':', e.message);
    return false;
  }
}

// Save a file record to DB
async function saveFileToDB(facility, milestoneId, fileData){
  try{
    var resp=await fetch(API_BASE+'/api/governance/files',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        facilitySlug:facility,
        milestoneId:milestoneId,
        filename:fileData.name,
        fileUrl:fileData.url,
        fileSize:fileData.size||0,
        uploadedAt:fileData.date||new Date().toISOString()
      })
    });
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    var data=await resp.json();
    if(data.file){
      if(ST[facility]&&ST[facility].up&&ST[facility].up[milestoneId]){
        var localFile=ST[facility].up[milestoneId].find(function(u){return u.name===fileData.name&&!u.id;});
        if(localFile)localFile.id=data.file.id;
      }
      console.log('[DB] Saved file', data.file.id);
    }
    return data.file;
  }catch(e){
    console.log('[DB] File save failed:', e.message);
    return null;
  }
}

// Delete a file from DB
async function deleteFileFromDB(fileId){
  try{
    var resp=await fetch(API_BASE+'/api/governance/files/'+fileId,{method:'DELETE'});
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    console.log('[DB] Deleted file', fileId);
    return true;
  }catch(e){
    console.log('[DB] File delete failed:', e.message);
    return false;
  }
}

// Get total file count
function getTotalFileCount(){
  var f=document.getElementById('fs').value;
  if(!ST[f]||!ST[f].up)return 0;
  var count=0;
  Object.values(ST[f].up).forEach(function(arr){count+=(arr||[]).length;});
  return count;
}"""

c = c.replace(old_state, new_state)
print("1. STATE section replaced with DB-first approach")

# ═════════════════════════════════════════════════════════════════
# STEP 2: Replace STORAGE (LD/SV) — no more localStorage for data
# ═════════════════════════════════════════════════════════════════

old_storage = """// STORAGE
function LD(){let s=null;
  try{s=localStorage.getItem('omg5')}catch(e){}
  if(s){
    try{
      const t=JSON.parse(s);
      if(t&&typeof t==='object'&&!Array.isArray(t)){
        ST=t;
        let mig=false;
        FAC.forEach(function(f){
          if(!ST[f]||typeof ST[f]!=='object')ST[f]={pp:'',ms:{},up:{}};
          if(!ST[f].ms)ST[f].ms={};
          if(!ST[f].up)ST[f].up={};
          Object.keys(MSD).forEach(function(m){
            if(!ST[f].ms[m])ST[f].ms[m]={subDate:'',compDate:'',pct:null};
            if(ST[f].ms[m].subDate===undefined){ST[f].ms[m].subDate='';mig=true}
            if(ST[f].ms[m].compDate===undefined){ST[f].ms[m].compDate='';mig=true}
            if(ST[f].ms[m].pct===undefined){ST[f].ms[m].pct=null;mig=true}
          });
        });
        if(mig)SV();
        return;
      }
    }catch(e){console.error('LD parse error:',e)}
  }
  ST={};
  FAC.forEach(function(f){
    ST[f]={pp:'',ms:{},up:{}};
    Object.keys(MSD).forEach(function(m){ST[f].ms[m]={subDate:'',compDate:'',pct:null}});
  });
  ST.AGLIPAY.pp='2026-01-01';ST.HTT.pp='2026-02-01';ST.EASTBAY.pp='2026-03-01';ST.KAYSAKAT.pp='2026-04-01';
  SV();
}
function SV(){localStorage.setItem('omg5',JSON.stringify(ST))}"""

new_storage = """// STORAGE (DEPRECATED — data now comes from API)
// Only facility preference is saved in localStorage
function LD(){
  // ST starts empty — data will be fetched from API
  ST={};
  // Load default facility from localStorage if available
  var savedFac=null;
  try{savedFac=localStorage.getItem('omg5_facility');}catch(e){}
  if(savedFac&&FAC.includes(savedFac)){
    document.getElementById('fs').value=savedFac;
  }
}
function SV(){
  // Only save facility preference, NOT data
  try{localStorage.setItem('omg5_facility',document.getElementById('fs').value);}catch(e){}
}
function saveFacilityPreference(){SV();}"""

c = c.replace(old_storage, new_storage)
print("2. STORAGE replaced — no more localStorage for data")

# ═════════════════════════════════════════════════════════════════
# STEP 3: Replace INIT — fetch from DB before rendering
# ═════════════════════════════════════════════════════════════════

old_init = """// INIT
function INIT(){LD();document.getElementById('fs').addEventListener('change',e=>{EDIT_MODE=false;PENDING={};updateEditButtons();document.getElementById('fl').textContent=e.target.value;document.getElementById('pp').value=ST[e.target.value].pp;document.getElementById('dlf').textContent=e.target.value;loadFilesFromDB(e.target.value);ALL();syncEditMode();});document.getElementById('pp').addEventListener('change',e=>{CU().pp=e.target.value;SV();ALL()});const f=document.getElementById('fs').value;document.getElementById('fl').textContent=f;document.getElementById('dlf').textContent=f;document.getElementById('pp').value=ST[f].pp;loadFilesFromDB(f);ALL()}"""

new_init = """// INIT
async function INIT(){
  LD(); // Load facility preference only
  var f=document.getElementById('fs').value;
  
  // Facility change listener
  document.getElementById('fs').addEventListener('change',async function(e){
    EDIT_MODE=false;PENDING={};updateEditButtons();
    document.getElementById('fl').textContent=e.target.value;
    document.getElementById('dlf').textContent=e.target.value;
    SV(); // Save facility preference
    // Fetch from DB before rendering
    await fetchStateFromDB(e.target.value);
    document.getElementById('pp').value=ST[e.target.value]?ST[e.target.value].pp:'';
    ALL();
    syncEditMode();
  });
  
  // PPP date change
  document.getElementById('pp').addEventListener('change',function(e){
    var f=document.getElementById('fs').value;
    if(!ST[f])ST[f]={pp:'',ms:{},up:{}};
    ST[f].pp=e.target.value;
    // Also save PPP to DB for M1
    saveMilestoneToDB(f,'M1',{ppp:e.target.value});
    ALL();
  });
  
  // Initial load: fetch from DB then render
  document.getElementById('fl').textContent=f;
  document.getElementById('dlf').textContent=f;
  await fetchStateFromDB(f);
  document.getElementById('pp').value=ST[f]?ST[f].pp:'';
  ALL();
}"""

c = c.replace(old_init, new_init)
print("3. INIT replaced — fetches from DB before rendering")

# Write
with open('public/governance.html', 'w') as f:
    f.write(c)
print("Written")

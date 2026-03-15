(function(){
  const STORAGE_KEY = 'schedulerRebuildStateV13';
  let memoryFallback = null;

  function storageAvailable(){
    try{
      const k='__sched_test__';
      localStorage.setItem(k,'1');
      localStorage.removeItem(k);
      return true;
    }catch(e){ return false; }
  }
  function readRaw(){
    try{ if(storageAvailable()) return localStorage.getItem(STORAGE_KEY); }catch(e){}
    return memoryFallback;
  }
  function writeRaw(value){
    try{ if(storageAvailable()) { localStorage.setItem(STORAGE_KEY, value); } }catch(e){}
    memoryFallback = value;
    try{ window.SchedulerCloud?.queuePush?.(STORAGE_KEY, value); }catch(e){}
  }
  function deepClone(x){ return JSON.parse(JSON.stringify(x)); }

  const physicians = [
    { id:'CL', name:'CL', type:'physician', services:['ICU','GIM','CAR1','CAR2','Echo','Weekend','Night','OP'], echoEligible:true, weekendEligible:true, nightEligible:true, opEligible:true,
      fairnessWeights:{ weeklyServices:1, icu:1, weekends:1, weekdayCall:1 } },
    { id:'JK', name:'JK', type:'physician', services:['ICU','GIM','CAR1','CAR2','Weekend','Night','OP'], echoEligible:false, weekendEligible:true, nightEligible:true, opEligible:true,
      fairnessWeights:{ weeklyServices:1, icu:1, weekends:1, weekdayCall:1 } },
    { id:'DK', name:'DK', type:'physician', services:['ICU','GIM','CAR1','CAR2','Echo','Weekend','Night','OP'], echoEligible:true, weekendEligible:true, nightEligible:true, opEligible:true,
      fairnessWeights:{ weeklyServices:1, icu:1, weekends:1, weekdayCall:1 } },
    { id:'DC', name:'DC', type:'physician', services:['ICU','GIM','CAR1','CAR2','Echo','Weekend','Night','OP'], echoEligible:true, weekendEligible:true, nightEligible:true, opEligible:true,
      fairnessWeights:{ weeklyServices:0.5, icu:0.5, weekends:0.5, weekdayCall:0.5 } },
    { id:'CD', name:'CD', type:'physician', services:['ICU','GIM','CAR1','CAR2','Weekend','Night','OP'], echoEligible:false, weekendEligible:true, nightEligible:true, opEligible:true,
      fairnessWeights:{ weeklyServices:1, icu:1, weekends:1, weekdayCall:1 } },
    { id:'JL', name:'JL', type:'physician', services:['ICU','GIM','CAR1','Weekend','Night','OP'], echoEligible:false, weekendEligible:true, nightEligible:true, opEligible:true,
      fairnessWeights:{ weeklyServices:1, icu:1, weekends:1, weekdayCall:1 } },
    { id:'BB', name:'BB', type:'physician', services:['ICU','Resp','Weekend','Night'], echoEligible:false, weekendEligible:true, nightEligible:true, opEligible:false,
      fairnessWeights:{ weeklyServices:1, icu:0.8, weekends:0.8, weekdayCall:0.8 } },
    { id:'BF', name:'BF', type:'physician', services:['Nephro','Weekend','Night'], echoEligible:false, weekendEligible:true, nightEligible:true, opEligible:false,
      fairnessWeights:{ weeklyServices:1, icu:1, weekends:1, weekdayCall:1 } },
    { id:'SM', name:'SM', type:'physician', services:['Nephro'], echoEligible:false, weekendEligible:false, nightEligible:false, opEligible:false,
      fairnessWeights:{ weeklyServices:1, icu:1, weekends:1, weekdayCall:1 } },
    { id:'TR', name:'TR', type:'physician', services:['Resp'], echoEligible:false, weekendEligible:false, nightEligible:false, opEligible:false,
      fairnessWeights:{ weeklyServices:1, icu:1, weekends:1, weekdayCall:1 } }
  ];

  const locums = [
    { id:'LOC1', name:'Locum 1', initials:'', type:'locum', generalLocum:true, coveringPhysician:'', weeklyCoverage:[], callDates:[], weekendDates:[] },
    { id:'LOC2', name:'Locum 2', initials:'', type:'locum', generalLocum:true, coveringPhysician:'', weeklyCoverage:[], callDates:[], weekendDates:[] }
  ];

  function defaultState(){
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth()+1).padStart(2,'0');
    return {
      physicians: deepClone(physicians),
      locums: deepClone(locums),
      requests: [],
      draftWeeks: [],
      publishedWeeks: [],
      draftNightManual: [],
      publishedNightManual: [],
      overrideLog: [],
      settings: {
        scheduleStart: `${yyyy}-${mm}-01`,
        scheduleEnd: `${yyyy}-${mm}-28`
      },
      metadata: {
        lastGeneratedAt: null,
        lastPublishedAt: null,
        buildResetMarker: ''
      },
      fairnessCarryForward: {},
      publishHistory: [],
      publishedArchives: [],
      currentPublishedArchiveId: '',
      generatedSummary: {
        fairnessSummary: [],
        validation: []
      }
    };
  }

  function mergePeople(existing, canonical){
    const map = Object.fromEntries((existing || []).map(p => [p.id, p]));
    return canonical.map(base => ({
      ...deepClone(base),
      ...(map[base.id] || {}),
      fairnessWeights: deepClone(base.fairnessWeights || (map[base.id]?.fairnessWeights) || {}),
      weeklyCoverage: deepClone(map[base.id]?.weeklyCoverage || base.weeklyCoverage || []),
      callDates: deepClone(map[base.id]?.callDates || base.callDates || []),
      weekendDates: deepClone(map[base.id]?.weekendDates || base.weekendDates || []),
      initials: (map[base.id]?.initials ?? base.initials ?? '')
    }));
  }

  
  function applyOneTimeFreshReset(merged){
    const marker = 'fresh_start_v1';
    if(merged?.metadata?.buildResetMarker === marker) return merged;
    merged.draftWeeks = [];
    merged.publishedWeeks = [];
    merged.draftNightManual = [];
    merged.publishedNightManual = [];
    merged.overrideLog = [];
    merged.fairnessCarryForward = {};
    merged.publishHistory = [];
    merged.publishedArchives = [];
    merged.currentPublishedArchiveId = '';
    merged.generatedSummary = { fairnessSummary: [], validation: [] };
    merged.metadata = { ...(merged.metadata || {}), lastGeneratedAt: null, lastPublishedAt: null, buildResetMarker: marker };
    return merged;
  }

  function removePublishedScheduleById(state, archiveId=''){
    if(!archiveId) return state;
    state.publishedArchives = (state.publishedArchives || []).filter(a => a.id !== archiveId);
    state.publishHistory = (state.publishHistory || []).filter(p => p.id !== archiveId);
    if(state.currentPublishedArchiveId === archiveId) state.currentPublishedArchiveId = '';
    if(!(state.publishedArchives || []).length){
      state.publishedWeeks = [];
      state.publishedNightManual = [];
      state.metadata.lastPublishedAt = null;
    }
    return state;
  }

  
  function rangesOverlap(startA, endA, startB, endB){
    if(!startA || !endA || !startB || !endB) return false;
    return !(endA < startB || startA > endB);
  }

  function getPublishedConflict(state, start, end){
    return (state.publishedArchives || []).find(a => rangesOverlap(start, end, a.start, a.end)) || null;
  }

  function getPublishedExactRange(state, start, end){
    return (state.publishedArchives || []).find(a => a.start === start && a.end === end) || null;
  }

  function publishRangeExists(state, start, end){
    return !!getPublishedConflict(state, start, end);
  }

  function loadState(){
    try{
      const raw = readRaw();
      let parsed = null;
      if(raw){
        parsed = JSON.parse(raw);
      } else {
        const boot = window.SchedulerCloud?.getBootState?.();
        if(boot && typeof boot === 'object'){
          parsed = deepClone(boot);
        }
      }
      if(!parsed){
        const init = defaultState();
        return init;
      }
      const base = defaultState();
      const merged = {
        ...base,
        ...parsed,
        physicians: mergePeople(parsed.physicians, base.physicians),
        locums: mergePeople(parsed.locums, base.locums),
        requests: parsed.requests || [],
        draftWeeks: parsed.draftWeeks || [],
        publishedWeeks: parsed.publishedWeeks || [],
        draftNightManual: parsed.draftNightManual || [],
        publishedNightManual: parsed.publishedNightManual || [],
        overrideLog: parsed.overrideLog || [],
        settings: { ...base.settings, ...(parsed.settings || {}) },
        metadata: { ...base.metadata, ...(parsed.metadata || {}) },
        fairnessCarryForward: parsed.fairnessCarryForward || {},
        publishHistory: parsed.publishHistory || [],
        publishedArchives: parsed.publishedArchives || [],
        currentPublishedArchiveId: parsed.currentPublishedArchiveId || '',
        generatedSummary: { ...base.generatedSummary, ...(parsed.generatedSummary || {}) }
      };
      applyOneTimeFreshReset(merged);
      saveState(merged);
      return merged;
    }catch(err){
      console.error('loadState failed', err);
      const boot = window.SchedulerCloud?.getBootState?.();
      if(boot && typeof boot === 'object'){
        try{
          const cloned = deepClone(boot);
          saveState(cloned);
          return cloned;
        }catch(innerErr){
          console.error('loadState boot fallback failed', innerErr);
        }
      }
      const init = defaultState();
      saveState(init);
      return init;
    }
  }

  function saveState(state){ writeRaw(JSON.stringify(state)); }
  function updateState(mutator){
    const current = loadState();
    const next = mutator(deepClone(current)) || current;
    saveState(next);
    return next;
  }
  function resetState(){ const init = defaultState(); saveState(init); return init; }
  
  function emptyCarryForwardRow(id, name){
    return {
      id,
      name: name || id,
      serviceCounts: { ICU:0, GIM:0, CAR1:0, CAR2:0, OP1:0, OP2:0, OP3:0, Resp:0, Nephro:0, Echo:0 },
      nightCalls: 0,
      weekends: 0
    };
  }

  function accumulateFairnessIntoCarryForward(target, fairnessRows){
    (fairnessRows || []).forEach(row => {
      const cur = target[row.id] || emptyCarryForwardRow(row.id, row.name);
      cur.name = row.name || cur.name || row.id;
      Object.keys(cur.serviceCounts).forEach(service => {
        cur.serviceCounts[service] = (cur.serviceCounts[service] || 0) + (row.serviceCounts?.[service] || 0);
      });
      cur.nightCalls = (cur.nightCalls || 0) + (row.nightCalls || 0);
      cur.weekends = (cur.weekends || 0) + (row.weekends || 0);
      target[row.id] = cur;
    });
    return target;
  }

  function publishRangeExists(state, start, end){
    return !!getPublishedConflict(state, start, end);
  }

  
  function rebuildCarryForwardFromHistory(publishHistory){
    const out = {};
    (publishHistory || []).forEach(entry => {
      accumulateFairnessIntoCarryForward(out, entry.fairnessSummary || []);
    });
    return out;
  }

  function unpublishCurrentRange(){
    return updateState(state => {
      const start = state.settings?.scheduleStart || '';
      const end = state.settings?.scheduleEnd || '';
      state.publishHistory = (state.publishHistory || []).filter(entry => !(entry.start === start && entry.end === end));
      state.fairnessCarryForward = rebuildCarryForwardFromHistory(state.publishHistory || []);
      state.publishedWeeks = [];
      state.publishedNightManual = [];
      state.metadata.lastPublishedAt = null;
      return state;
    });
  }

  function publishDraft(){
    return updateState(state => {
      const start = state.settings?.scheduleStart || '';
      const end = state.settings?.scheduleEnd || '';
      if(publishRangeExists(state, start, end)) return state;
      const now = new Date().toISOString();
      const archiveId = `pub_${Date.now()}`;
      state.publishedWeeks = deepClone(state.draftWeeks);
      state.publishedNightManual = deepClone(state.draftNightManual);
      const fairnessSummary = (state.generatedSummary?.fairnessSummary || []);
      state.fairnessCarryForward = accumulateFairnessIntoCarryForward(state.fairnessCarryForward || {}, fairnessSummary);
      state.publishHistory = state.publishHistory || [];
      state.publishHistory.push({ id: archiveId, publishedAt: now, start, end, fairnessSummary: deepClone(fairnessSummary) });
      state.publishedArchives = state.publishedArchives || [];
      state.publishedArchives.push({ id: archiveId, publishedAt: now, start, end, weeks: deepClone(state.draftWeeks || []), nightAssignments: deepClone(state.draftNightManual || []) });
      state.currentPublishedArchiveId = archiveId;
      state.metadata.lastPublishedAt = now;
      return state;
    });
  }
  function upsertRequest(req){
    return updateState(state => {
      const idx = state.requests.findIndex(r => r.id === req.id);
      if(idx >= 0) state.requests[idx] = req;
      else state.requests.push(req);
      return state;
    });
  }
  function removeRequest(id){
    return updateState(state => {
      state.requests = state.requests.filter(r => r.id !== id);
      return state;
    });
  }
  function saveLocum(locumId, patch){
    return updateState(state => {
      const idx = state.locums.findIndex(l => l.id === locumId);
      if(idx >= 0) state.locums[idx] = { ...state.locums[idx], ...deepClone(patch) };
      return state;
    });
  }
  function addOverride(entry){
    return updateState(state => { state.overrideLog.unshift(entry); return state; });
  }
  function clearOverrides(){
    return updateState(state => { state.overrideLog = []; return state; });
  }

  window.AppState = {
    STORAGE_KEY,
    deepClone,
    defaultState,
    loadState,
    saveState,
    updateState,
    resetState,
    publishDraft,
    publishRangeExists,
    getPublishedConflict,
    getPublishedExactRange,
    removePublishedScheduleById,
    removePublishedScheduleById,
    publishRangeExists,
    unpublishCurrentRange,
    emptyCarryForwardRow,
    accumulateFairnessIntoCarryForward,
    publishRangeExists,
    upsertRequest,
    removeRequest,
    saveLocum,
    addOverride,
    clearOverrides
  };
})();

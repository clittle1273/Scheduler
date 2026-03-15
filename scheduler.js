
// --- Deterministic CAR rotation (nuclear fix) ---
function eligibleCAR(state, service){
  return state.physicians
    .filter(p => canDoService(p, service))
    .sort((a,b)=> (a.name||a.id).localeCompare(b.name||b.id));
}

function applyCarRotation(state, weeks, availability){
  if(!state.metadata) state.metadata = {};
  if(!state.metadata.carRotation) state.metadata.carRotation = {CAR1:0, CAR2:0};

  ['CAR1','CAR2'].forEach(service=>{
    const eligible = eligibleCAR(state, service);
    if(!eligible.length) return;

    let idx = state.metadata.carRotation[service] || 0;

    weeks.forEach(week=>{
      if(week.services && week.services[service]) return; // already locked
      let tries=0;
      while(tries < eligible.length){
        const p = eligible[idx % eligible.length];
        idx++;
        tries++;

        const available = !availability || !availability[p.id] || availability[p.id][week.weekStart]?.serviceAvailable !== false;
        if(available){
          if(!week.services) week.services={};
          week.services[service] = p.id;
          break;
        }
      }
    });

    state.metadata.carRotation[service] = idx % eligible.length;
  });
}

(function(){
  const MAJOR_SERVICES = ['ICU','GIM','CAR1','CAR2','Resp','Nephro','OP1','OP2','OP3'];
  const REQUIRED_SERVICES = ['ICU','Resp','Nephro','GIM','CAR1','CAR2'];
  const OPTIONAL_OP_SERVICES = ['OP1','OP2','OP3'];
  const ROW_SERVICES = ['ICU','GIM','CAR1','CAR2','Resp','Nephro','OP1','OP2','OP3','Echo','Weekend'];
  const OP_SERVICES = ['OP1','OP2','OP3'];
  const ECHO_ALLOWED = ['ICU','GIM','CAR1','CAR2','OP1','OP2','OP3'];

  function iso(date){ return new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,10); }
  function parseDate(str){ return new Date(str + 'T12:00:00'); }
  function addDays(date, days){ const d = new Date(date); d.setDate(d.getDate()+days); return d; }
  function monthKey(dateStr){ return dateStr.slice(0,7); }
  function startOfWeekMonday(date){ const d = new Date(date); const day = (d.getDay()+6)%7; return addDays(d, -day); }
  function daterange(start, end){ const arr=[]; let cur=new Date(start); while(cur<=end){ arr.push(new Date(cur)); cur=addDays(cur,1); } return arr; }
  function unique(arr){ return [...new Set(arr)]; }

  function getWeeks(startStr, endStr){
    const start = parseDate(startStr);
    const end = parseDate(endStr);
    const firstMon = startOfWeekMonday(start);
    const weeks = [];
    let cur = new Date(firstMon);
    while(cur <= end){
      const weekStart = iso(cur);
      weeks.push({
        weekStart,
        weekEnd: iso(addDays(cur,4)),
        weekendStart: iso(addDays(cur,5)),
        weekendEnd: iso(addDays(cur,6)),
        month: weekStart.slice(0,7),
        services: Object.fromEntries(MAJOR_SERVICES.concat(['Echo']).map(s => [s,''])),
        weekendOwner: '',
        validation: []
      });
      cur = addDays(cur,7);
    }
    return weeks;
  }

  function getAllPeople(state){ return [...state.physicians, ...state.locums]; }
  function personMap(state){ return Object.fromEntries(getAllPeople(state).map(p => [p.id, p])); }
  function physicianMap(state){ return Object.fromEntries(state.physicians.map(p => [p.id, p])); }
  function getApprovedRequests(state){ return (state.requests || []).filter(r => r.status !== 'denied'); }
  function requestOverlap(r, startStr, endStr){ return !(r.endDate < startStr || r.startDate > endStr); }
  function hasRequest(state, personId, type, startStr, endStr){
    return getApprovedRequests(state).some(r => r.personId === personId && r.type === type && requestOverlap(r, startStr, endStr));
  }
  function hasVacation(state, personId, startStr, endStr){ return hasRequest(state, personId, 'vacation', startStr, endStr); }
  function getLocumById(state, id){ return (state.locums || []).find(l => l.id === id); }

  function canDoService(person, service){
    if(!person) return false;
    if(service === 'Echo') return !!person.echoEligible;
    if(OP_SERVICES.includes(service)) return !!person.opEligible;
    if(service === 'Weekend') return !!person.weekendEligible;
    if(service === 'Night') return !!person.nightEligible;
    return (person.services || []).includes(service);
  }

  function fairnessWeight(person, bucket){
    const w = person?.fairnessWeights || {};
    if(bucket === 'service') return w.weeklyServices || 1;
    if(bucket === 'icu') return w.icu || 1;
    if(bucket === 'weekend') return w.weekends || 1;
    if(bucket === 'night') return w.weekdayCall || 1;
    return 1;
  }

  function targetPhysicianIdForAssignment(state, ownerId){
    const person = personMap(state)[ownerId];
    if(!person) return null;
    if(person.type !== 'locum') return ownerId;
    if(person.generalLocum) return null;
    return person.coveringPhysician || null;
  }

  
  function emptyCarryForwardRowScheduler(id, name){
    return {
      id:id,
      name:name || id,
      serviceCounts:{ ICU:0, GIM:0, CAR1:0, CAR2:0, OP1:0, OP2:0, OP3:0, Resp:0, Nephro:0, Echo:0 },
      nightCalls:0,
      weekends:0
    };
  }

  function currentScheduleYear(state){
    const start = state?.settings?.scheduleStart || '';
    return /^\d{4}/.test(start) ? start.slice(0,4) : '';
  }

  function buildYearlyCarryForward(state){
    const year = currentScheduleYear(state);
    const out = {};
    (state.publishHistory || []).forEach(entry => {
      const entryYear = (entry?.start || '').slice(0,4);
      if(year && entryYear !== year) return;
      (entry.fairnessSummary || []).forEach(row => {
        const cur = out[row.id] || emptyCarryForwardRowScheduler(row.id, row.name);
        cur.name = row.name || cur.name || row.id;
        Object.keys(cur.serviceCounts).forEach(service => {
          cur.serviceCounts[service] = (cur.serviceCounts[service] || 0) + (row.serviceCounts?.[service] || 0);
        });
        cur.nightCalls = (cur.nightCalls || 0) + (row.nightCalls || 0);
        cur.weekends = (cur.weekends || 0) + (row.weekends || 0);
        out[row.id] = cur;
      });
    });
    return out;
  }

  function initFairnessStore(state){
    const store = {};
    const carry = buildYearlyCarryForward(state);
    state.physicians.forEach(p => {
      const fte = (p.fte || 1.0);
      const hist = carry[p.id] || emptyCarryForwardRowScheduler(p.id, p.name);
      const fte = (p.fte || 1.0);
      const serviceCounts = {
        ICU: hist.serviceCounts?.ICU || 0,
        GIM: hist.serviceCounts?.GIM || 0,
        CAR1: hist.serviceCounts?.CAR1 || 0,
        CAR2: hist.serviceCounts?.CAR2 || 0,
        OP1: hist.serviceCounts?.OP1 || 0,
        OP2: hist.serviceCounts?.OP2 || 0,
        OP3: hist.serviceCounts?.OP3 || 0,
        Resp: hist.serviceCounts?.Resp || 0,
        Nephro: hist.serviceCounts?.Nephro || 0,
        Echo: hist.serviceCounts?.Echo || 0
      };
      const icuWeeks = serviceCounts.ICU || 0;
      const weeklyServices = Object.entries(serviceCounts).reduce((sum, entry) => {
        const [service, count] = entry;
        return sum + (service === 'ICU' ? 0 : (count || 0));
      }, 0);
      const weekends = hist.weekends || 0;
      const nightCalls = hist.nightCalls || 0;
      store[p.id] = {
        id:p.id,
        name:p.name,
        weekends:weekends,
        nightCalls:nightCalls,
        icuWeeks:icuWeeks,
        weeklyServices:weeklyServices,
        serviceCounts:serviceCounts,
        weighted:{
          weekends: +(weekends / fairnessWeight(p,'weekend')).toFixed(2),
          nightCalls: +(nightCalls / fairnessWeight(p,'night')).toFixed(2),
          icu: +(icuWeeks / fairnessWeight(p,'icu')).toFixed(2),
          services: +(weeklyServices / fairnessWeight(p,'service')).toFixed(2)
        }
      };
    });
    return store;
  }

  function addFairnessCharge(state, store, ownerId, kind, service){
    const targetId = targetPhysicianIdForAssignment(state, ownerId);
    if(!targetId || !store[targetId]) return;
    const person = physicianMap(state)[targetId];
    if(kind === 'weekend'){
      store[targetId].weekends += 1;
      const fte = (person?.fte || 1.0);
      store[targetId].weighted.weekends = +((store[targetId].weighted.weekends || 0) + (1 / fte)).toFixed(2);
    } else if(kind === 'night'){
      store[targetId].nightCalls += 1;
      store[targetId].weighted.nightCalls = +(store[targetId].nightCalls / fairnessWeight(person,'night')).toFixed(2);
    } else if(kind === 'service'){
      if(service === 'ICU'){
        store[targetId].icuWeeks += 1;
        store[targetId].weighted.icu = +(store[targetId].icuWeeks / fairnessWeight(person,'icu')).toFixed(2);
      } else {
        store[targetId].weeklyServices += 1;
        store[targetId].weighted.services = +(store[targetId].weeklyServices / fairnessWeight(person,'service')).toFixed(2);
      }
      if(service){ store[targetId].serviceCounts[service] = (store[targetId].serviceCounts[service] || 0) + 1; }
    }
  }

  function summarizeFairness(state, weeks, nights){
    const store = initFairnessStore(state);
    weeks.forEach(week => {
      MAJOR_SERVICES.forEach(service => { if(week.services[service]) addFairnessCharge(state, store, week.services[service], 'service', service); });
      if(week.weekendOwner) addFairnessCharge(state, store, week.weekendOwner, 'weekend');
    });
    (nights || []).filter(n => !n.weekend && n.owner).forEach(n => addFairnessCharge(state, store, n.owner, 'night'));
    return Object.values(store).map(item => {
      item.compositeScore = +(
        item.weighted.services + item.weighted.icu + item.weighted.weekends + item.weighted.nightCalls
      ).toFixed(2);
      return item;
    }).sort((a,b) => a.compositeScore - b.compositeScore || a.id.localeCompare(b.id));
  }

  
  
  function getPriorWeekMap(state){
    return Object.fromEntries((state.draftWeeks || []).map(w => [w.weekStart, w]));
  }

  function getPriorNightMap(state){
    return Object.fromEntries((state.draftNightManual || []).map(n => [n.date, n]));
  }

  function copyLockedWeekToNewWeek(prior, week){
    week.locked = true;
    week.services = Object.assign({}, prior.services || {});
    week.weekendOwner = prior.weekendOwner || '';
    week.pinnedServices = Object.assign({}, prior.pinnedServices || {});
  }

  function applyLockedWeeks(state, weeks){
    const priorMap = getPriorWeekMap(state);
    weeks.forEach(week => {
      const prior = priorMap[week.weekStart];
      if(prior && prior.locked){
        copyLockedWeekToNewWeek(prior, week);
      } else if(prior && prior.pinnedServices){
        week.pinnedServices = Object.assign({}, prior.pinnedServices || {});
      }
    });
  }

  function stableBonusWeek(state, weekStart, service, personId){
    const prior = getPriorWeekMap(state)[weekStart];
    if(!prior) return 0;
    const priorOwner = service === 'Weekend' ? prior.weekendOwner : (prior.services || {})[service];
    return priorOwner === personId ? -0.35 : 0;
  }

  function stableBonusNight(state, date, personId){
    const prior = getPriorNightMap(state)[date];
    return prior && prior.owner === personId ? -0.35 : 0;
  }

  function seedLockedMajorAssignments(state, weeks, store){
    const priorMap = getPriorWeekMap(state);
    weeks.forEach(week => {
      const prior = priorMap[week.weekStart];
      if(prior && prior.locked){
        copyLockedWeekToNewWeek(prior, week);
        MAJOR_SERVICES.forEach(service => {
          const owner = week.services[service];
          if(owner) addAssignmentChargeSimple(store, state, owner, 'service', service);
        });
      }
    });
  }

  function seedLockedWeekendAssignments(state, weeks, store){
    const priorMap = getPriorWeekMap(state);
    weeks.forEach(week => {
      const prior = priorMap[week.weekStart];
      if(prior && prior.locked){
        copyLockedWeekToNewWeek(prior, week);
        if(week.weekendOwner) addAssignmentChargeSimple(store, state, week.weekendOwner, 'weekend');
      }
    });
  }

  function seedLockedNightAssignments(state, weeks, store, out, map, perMonth, perWeek){
    const priorWeekMap = getPriorWeekMap(state);
    const priorNightMap = getPriorNightMap(state);
    weeks.forEach((week, idx) => {
      const prior = priorWeekMap[week.weekStart];
      if(!(prior && prior.locked)) return;
      copyLockedWeekToNewWeek(prior, week);
      const mon = parseDate(week.weekStart);
      for(let i=0;i<5;i++){
        const date = iso(addDays(mon,i));
        const prev = priorNightMap[date];
        const owner = prev ? (prev.owner || '') : '';
        out.push({ date, owner, weekend:false, weekStart:week.weekStart });
        if(owner){
          const month = monthKey(date);
          map[date] = owner;
          perMonth[`${owner}:${month}`] = (perMonth[`${owner}:${month}`]||0)+1;
          perWeek[`${owner}:${week.weekStart}`] = (perWeek[`${owner}:${week.weekStart}`]||0)+1;
          addAssignmentChargeSimple(store, state, owner, 'night');
        }
      }
      out.push({ date: week.weekendStart, owner: week.weekendOwner || '', weekend:true, weekStart:week.weekStart });
      out.push({ date: week.weekendEnd, owner: week.weekendOwner || '', weekend:true, weekStart:week.weekStart });
      if(week.weekendOwner){
        map[week.weekendStart] = week.weekendOwner;
        map[week.weekendEnd] = week.weekendOwner;
      }
    });
  }

  function applyPinnedAssignments(state, weeks){
    const priorWeeks = state.draftWeeks || [];
    const priorMap = Object.fromEntries(priorWeeks.map(w => [w.weekStart, w]));
    weeks.forEach(week => {
      const prior = priorMap[week.weekStart];
      if(!prior) return;
      if(prior.locked) return;
      week.pinnedServices = Object.assign({}, prior.pinnedServices || {});
      Object.keys(week.pinnedServices).forEach(service => {
        if(!week.pinnedServices[service]) return;
        if(service === 'Weekend') week.weekendOwner = prior.weekendOwner || '';
        else week.services[service] = (prior.services || {})[service] || '';
      });
    });
  }

    const priorWeeks = state.draftWeeks || [];
    const priorMap = Object.fromEntries(priorWeeks.map(w => [w.weekStart, w]));
    

  function currentScore(store, id, bucket){
    if(!store[id]) return 999;
    if(bucket === 'weekend') return store[id].weighted.weekends;
    if(bucket === 'night') return store[id].weighted.nightCalls;
    if(bucket === 'ICU') return store[id].weighted.icu;
    return store[id].weighted.services;
  }

  function buildAvailability(state, weeks){
    const avail = {};
    getAllPeople(state).forEach(person => {
      avail[person.id] = {};
      weeks.forEach(week => {
        if(week.locked) return;
        if(week.locked) return;
        avail[person.id][week.weekStart] = {
          serviceAvailable: !hasVacation(state, person.id, week.weekStart, week.weekendEnd),
          nightAvailable: !hasVacation(state, person.id, week.weekStart, week.weekendEnd) && !hasRequest(state, person.id,'no_call',week.weekStart, week.weekEnd) && !hasRequest(state, person.id,'no_night_call',week.weekStart, week.weekEnd),
          weekendAvailable: !hasVacation(state, person.id, week.weekStart, week.weekendEnd) && !hasRequest(state, person.id,'weekends_off',week.weekendStart, week.weekendEnd),
          respRequested: hasRequest(state, person.id, 'resp_week_request', week.weekStart, week.weekEnd),
          nephroRequested: hasRequest(state, person.id, 'nephro_week_request', week.weekStart, week.weekEnd)
        };
      });
    });
    return avail;
  }

  function peopleAssignedThisWeek(week){
    const ids = {};
    MAJOR_SERVICES.forEach(service => { if(week.services[service]) ids[week.services[service]] = service; });
    return ids;
  }

  
  function serviceBucketWeight(person, service){
    return service === 'ICU' ? fairnessWeight(person,'icu') : fairnessWeight(person,'service');
  }


  function computeIcuTargetsForRange(state, weeks, store){
    const eligible = state.physicians.filter(p => canDoService(p, 'ICU'));
    const totalEligibleFte = eligible.reduce((sum, p) => sum + Math.max(0.01, p.fte || 1.0), 0) || 1;
    const historicalDone = eligible.reduce((sum, p) => sum + ((store[p.id]?.serviceCounts?.ICU) || 0), 0);
    const blockIcuWeeks = weeks.length;
    const totalIcuWeeks = historicalDone + blockIcuWeeks;
    return Object.fromEntries(
      eligible.map(p => [p.id, totalIcuWeeks * (Math.max(0.01, p.fte || 1.0) / totalEligibleFte)])
    );
  }

  function computeServiceTargets(state, weeks, services){
    const targets = {};
    (services || MAJOR_SERVICES).forEach(service => {
      const eligible = state.physicians.filter(p => canDoService(p, service));
      const totalWeight = eligible.reduce((sum, p) => {
        const fte = p?.fte || 1.0;
        return sum + (fte * serviceBucketWeight(p, service));
      }, 0) || 1;
      targets[service] = {};
      eligible.forEach(p => {
        const fte = p?.fte || 1.0;
        targets[service][p.id] = +(weeks.length * ((fte * serviceBucketWeight(p, service)) / totalWeight)).toFixed(4);
      });
    });
    return targets;
  }

  function serviceDeficitScore(store, personId, service, targets){
    const target = targets?.[service]?.[personId];
    if(target == null || target <= 0) return 999;
    const current = store[personId]?.serviceCounts?.[service] || 0;
    return +((current) / target).toFixed(4);
  }

  function serviceRecentPenalty(weeks, weekStart, personId, service) {
    const idx = weeks.findIndex(w => w.weekStart === weekStart);
    if (idx <= 0) return 0;
    let penalty = 0;
    // stronger CAR1/CAR2 deterrent
    if (['CAR1','CAR2'].includes(service)) {
      if (idx-1 >= 0 && weeks[idx-1].services?.[service] === personId) penalty += 2.0;
      if (idx-2 >= 0 && weeks[idx-2].services?.[service] === personId) penalty += 1.0;
    } else {
      if (idx-1 >= 0 && weeks[idx-1].services?.[service] === personId) penalty += 0.25;
      if (idx-2 >= 0 && weeks[idx-2].services?.[service] === personId) penalty += 0.15;
    }
    return penalty;
  }

  function overallWeeklyBurden(store, personId){
    if(!store[personId]) return 999;
    return +(store[personId].weighted.services + store[personId].weighted.icu).toFixed(4);
  }

  function opPriorityPenalty(service){
    return service === 'OP1' ? 0 : service === 'OP2' ? 0.2 : 0.4;
  }

  function serviceCandidates(state, availability, week, service, fairnessStore){
    const assigned = peopleAssignedThisWeek(week);
    return state.physicians.filter(p => {
      if(!canDoService(p, service)) return false;
      if(assigned[p.id]) return false;
      if(!availability[p.id][week.weekStart].serviceAvailable) return false;
      return true;
    }).sort((a,b) => {
      const aPref = service === 'Resp' ? (availability[a.id][week.weekStart].respRequested ? -1 : 0)
        : service === 'Nephro' ? (availability[a.id][week.weekStart].nephroRequested ? -1 : 0) : 0;
      const bPref = service === 'Resp' ? (availability[b.id][week.weekStart].respRequested ? -1 : 0)
        : service === 'Nephro' ? (availability[b.id][week.weekStart].nephroRequested ? -1 : 0) : 0;
      if(aPref !== bPref) return aPref - bPref;
      const as = currentScore(fairnessStore, a.id, service);
      const bs = currentScore(fairnessStore, b.id, service);
      if(as !== bs) return as - bs;
      return a.id.localeCompare(b.id);
    });
  }

  function addAssignmentChargeSimple(store, state, ownerId, kind, service){
    const targetId = targetPhysicianIdForAssignment(state, ownerId) || ownerId;
    if(!store[targetId]) return;
    const person = physicianMap(state)[targetId];
    if(kind === 'weekend'){
      store[targetId].weekends += 1;
      const fte = (person?.fte || 1.0);
      store[targetId].weighted.weekends = +((store[targetId].weighted.weekends || 0) + (1 / fte)).toFixed(2);
    } else if(kind === 'night'){
      store[targetId].nightCalls += 1;
      store[targetId].weighted.nightCalls = +(store[targetId].nightCalls / fairnessWeight(person,'night')).toFixed(2);
    } else if(kind === 'service'){
      if(service === 'ICU'){
        store[targetId].icuWeeks += 1;
        store[targetId].weighted.icu = +(store[targetId].icuWeeks / fairnessWeight(person,'icu')).toFixed(2);
      } else {
        store[targetId].weeklyServices += 1;
        store[targetId].weighted.services = +(store[targetId].weeklyServices / fairnessWeight(person,'service')).toFixed(2);
      }
    }
  }

  

  function seedLocumWeeklyCoverage(state, weeks, availability, store){
    const locums = (state.locums || []).slice().sort((a,b) => a.id.localeCompare(b.id));
    const weekMap = Object.fromEntries(weeks.map(w => [w.weekStart, w]));
    locums.forEach(locum => {
      (locum.weeklyCoverage || []).forEach(entry => {
        const week = weekMap[entry.weekStart];
        if(!week || week.locked) return;
        (entry.services || []).forEach(service => {
          if(!MAJOR_SERVICES.includes(service)) return;
          if(week.services[service]) return;
          if(!availability[locum.id]?.[week.weekStart]?.serviceAvailable) return;
          week.services[service] = locum.id;
          addAssignmentChargeSimple(store, state, locum.id, 'service', service);
        });
      });
    });
  }

  function seedLocumWeekendCoverage(state, weeks, availability, store){
    const locums = (state.locums || []).slice().sort((a,b) => a.id.localeCompare(b.id));
    const weekByWeekend = Object.fromEntries(weeks.map(w => [w.weekendStart, w]));
    locums.forEach(locum => {
      (locum.weekendDates || []).forEach(date => {
        const week = weekByWeekend[date];
        if(!week || week.locked) return;
        if(week.weekendOwner) return;
        if(!availability[locum.id]?.[week.weekStart]?.weekendAvailable) return;
        week.weekendOwner = locum.id;
        addAssignmentChargeSimple(store, state, locum.id, 'weekend');
      });
    });
  }

  function getLocumForNightDate(state, weekStart, date, weekend){
    const locums = (state.locums || []).slice().sort((a,b) => a.id.localeCompare(b.id));
    if(weekend){
      return locums.find(locum => (locum.weekendDates || []).includes(date)) || null;
    }
    return locums.find(locum => (locum.callDates || []).includes(date)) || null;
  }


  function assignMajorServices(state, weeks, availability, options={
  // deterministic CAR rotation first
  applyCarRotation(state, weeks, availability);}){
    const store = initFairnessStore(state);
    seedLockedMajorAssignments(state, weeks, store);
    seedLocumWeeklyCoverage(state, weeks, availability, store);
    const requiredTargets = computeServiceTargets(state, weeks, REQUIRED_SERVICES);
    const icuTargets = computeIcuTargetsForRange(state, weeks, store);

    REQUIRED_SERVICES.forEach(service => {
      weeks.forEach(week => {
        if(week.services[service]) return;
        const assigned = peopleAssignedThisWeek(week);
        const prevOwner = idx > 0 ? weeks[idx-1].services?.[service] : '';
        const prev2Owner = idx > 1 ? weeks[idx-2].services?.[service] : '';

        let candidates = state.physicians.filter(p => {
          if(!canDoService(p, service)) return false;
          if(assigned[p.id]) return false;
          if(!availability[p.id][week.weekStart].serviceAvailable) return false;
          if(service === 'Resp' && p.id === 'BB'){
            const bbTarget = Math.max(0.001, icuTargets['BB'] || 0.001);
            const bbDone = store['BB']?.serviceCounts?.ICU || 0;
            const bbCompletion = bbDone / bbTarget;
            if(bbCompletion < 0.999) return false;
          }
          if((service === 'CAR1' || service === 'CAR2') && (p.id === prevOwner || p.id === prev2Owner)) return false;
          return true;
        });

        if(!candidates.length && (service === 'CAR1' || service === 'CAR2')){
          candidates = state.physicians.filter(p => {
            if(!canDoService(p, service)) return false;
            if(assigned[p.id]) return false;
            if(!availability[p.id][week.weekStart].serviceAvailable) return false;
            return true;
          });
        }

        candidates = candidates.sort((a,b) => {
          const aPref = service === 'Resp' ? (availability[a.id][week.weekStart].respRequested ? -1 : 0)
            : service === 'Nephro' ? (availability[a.id][week.weekStart].nephroRequested ? -1 : 0) : 0;
          const bPref = service === 'Resp' ? (availability[b.id][week.weekStart].respRequested ? -1 : 0)
            : service === 'Nephro' ? (availability[b.id][week.weekStart].nephroRequested ? -1 : 0) : 0;
          if(aPref !== bPref) return aPref - bPref;

          if(service === 'ICU'){
            const targetA = Math.max(0.001, icuTargets[a.id] || 0.001);
            const targetB = Math.max(0.001, icuTargets[b.id] || 0.001);
            const doneA = store[a.id]?.serviceCounts?.ICU || 0;
            const doneB = store[b.id]?.serviceCounts?.ICU || 0;
            const completionA = doneA / targetA;
            const completionB = doneB / targetB;
            if(completionA !== completionB) return completionA - completionB;
            const prefA = a.id === 'BB' ? -0.05 : 0;
            const prefB = b.id === 'BB' ? -0.05 : 0;
            if(prefA !== prefB) return prefA - prefB;
          }

          const aDef = serviceDeficitScore(store, a.id, service, requiredTargets) + serviceRecentPenalty(weeks, week.weekStart, a.id, service) + (options.stable ? stableBonusWeek(state, week.weekStart, service, a.id) : 0);
          const bDef = serviceDeficitScore(store, b.id, service, requiredTargets) + serviceRecentPenalty(weeks, week.weekStart, b.id, service) + (options.stable ? stableBonusWeek(state, week.weekStart, service, b.id) : 0);
          if(aDef !== bDef) return aDef - bDef;

          const aOverall = overallWeeklyBurden(store, a.id);
          const bOverall = overallWeeklyBurden(store, b.id);
          if(aOverall !== bOverall) return aOverall - bOverall;

          return a.id.localeCompare(b.id);
        });
        if(candidates[0]){
          week.services[service] = candidates[0].id;
          addAssignmentChargeSimple(store, state, candidates[0].id, 'service', service);
        }
      });
    });

    OPTIONAL_OP_SERVICES.forEach(service => {
      weeks.forEach(week => {
        if(week.services[service]) return;
        const assigned = peopleAssignedThisWeek(week);
        const prevOwner = idx > 0 ? weeks[idx-1].services?.[service] : '';
        const prev2Owner = idx > 1 ? weeks[idx-2].services?.[service] : '';

        let candidates = state.physicians.filter(p => {
          if(!canDoService(p, service)) return false;
          if(assigned[p.id]) return false;
          if(!availability[p.id][week.weekStart].serviceAvailable) return false;
          if((service === 'CAR1' || service === 'CAR2') && (p.id === prevOwner || p.id === prev2Owner)) return false;
          return true;
        });

        if(!candidates.length && (service === 'CAR1' || service === 'CAR2')){
          candidates = state.physicians.filter(p => {
            if(!canDoService(p, service)) return false;
            if(assigned[p.id]) return false;
            if(!availability[p.id][week.weekStart].serviceAvailable) return false;
            return true;
          });
        }

        candidates = candidates.sort((a,b) => {
          const aOverall = overallWeeklyBurden(store, a.id) + serviceRecentPenalty(weeks, week.weekStart, a.id, service) + opPriorityPenalty(service) + (options.stable ? stableBonusWeek(state, week.weekStart, service, a.id) : 0);
          const bOverall = overallWeeklyBurden(store, b.id) + serviceRecentPenalty(weeks, week.weekStart, b.id, service) + opPriorityPenalty(service) + (options.stable ? stableBonusWeek(state, week.weekStart, service, b.id) : 0);
          if(aOverall !== bOverall) return aOverall - bOverall;
          return a.id.localeCompare(b.id);
        });
        if(candidates[0]){
          week.services[service] = candidates[0].id;
          addAssignmentChargeSimple(store, state, candidates[0].id, 'service', service);
        } else {
          week.services[service] = '';
        }
      });
    });

    weeks.forEach((week, idx) => {
      const echoCandidates = state.physicians.filter(p => p.echoEligible && availability[p.id][week.weekStart].serviceAvailable && ECHO_ALLOWED.includes(getPrimaryServiceForPerson(week,p.id)))
        .sort((a,b) => {
          const as = currentScore(store, a.id, 'service');
          const bs = currentScore(store, b.id, 'service');
          if(as !== bs) return as - bs;
          return a.id.localeCompare(b.id);
        });
      if(echoCandidates.length){
        const order = ['CL','DK','DC'];
        const preferred = order[idx % order.length];
        const match = echoCandidates.find(p => p.id === preferred);
        week.services.Echo = (match || echoCandidates[0]).id;
      } else {
        week.services.Echo = '';
      }
    });
  }

  function getPrimaryServiceForPerson(week, personId){
    return MAJOR_SERVICES.find(s => week.services[s] === personId) || '';
  }

  function weekendPreferenceScore(weeks, idx, personId){
    let score = 0;
    const prev = weeks[idx-1];
    const next = weeks[idx+1];
    const prevSvc = prev ? getPrimaryServiceForPerson(prev, personId) : '';
    const nextSvc = next ? getPrimaryServiceForPerson(next, personId) : '';
    if(['ICU','GIM'].includes(prevSvc)) score -= 1.1;
    if(['ICU','GIM'].includes(nextSvc)) score -= 1.0;
    return score;
  }

  function assignWeekendOwners(state, weeks, availability, options={}){
    const store = initFairnessStore(state);
    seedLockedWeekendAssignments(state, weeks, store);
    seedLocumWeekends(state, weeks, availability, store);

    const eligible = state.physicians.filter(p => p.weekendEligible);
    const fullWeekendPool = eligible.filter(p => Math.abs((p.fte || 1.0) - 1.0) < 0.01);
    const baseline = fullWeekendPool.length ? (weeks.length / fullWeekendPool.length) : weeks.length;

    const weekendCaps = {
      BB: Math.round(baseline * 0.8),
      DC: Math.round(baseline * 0.5)
    };

    weeks.forEach((week, idx) => {
      if(week.locked) return;
      if(week.weekendOwner) return;

      const month = monthKey(week.weekendStart);
      const monthCounts = Object.fromEntries(state.physicians.map(p => [p.id, 0]));
      weeks.slice(0, idx).forEach(prev => {
        if(prev.weekendOwner && state.physicians.some(p => p.id===prev.weekendOwner) && monthKey(prev.weekendStart)===month){
          monthCounts[prev.weekendOwner] = (monthCounts[prev.weekendOwner] || 0) + 1;
        }
      });

      let candidates = eligible.filter(p => {
        if(!availability[p.id][week.weekStart].weekendAvailable) return false;
        const done = store[p.id]?.weekends || 0;
        const cap = weekendCaps[p.id];
        if(cap !== undefined && done >= cap) return false;
        return true;
      });

      if(!candidates.length){
        candidates = eligible.filter(p => availability[p.id][week.weekStart].weekendAvailable);
      }

      candidates = candidates.sort((a, b) => {
        const aCap = weekendCaps[a.id] ?? baseline;
        const bCap = weekendCaps[b.id] ?? baseline;
        const doneA = store[a.id]?.weekends || 0;
        const doneB = store[b.id]?.weekends || 0;

        const aRatio = doneA / Math.max(1, aCap);
        const bRatio = doneB / Math.max(1, bCap);
        if(aRatio !== bRatio) return aRatio - bRatio;

        const aMonth = monthCounts[a.id] || 0;
        const bMonth = monthCounts[b.id] || 0;
        if(aMonth !== bMonth) return aMonth - bMonth;

        return a.id.localeCompare(b.id);
      });

      if(candidates[0]){
        week.weekendOwner = candidates[0].id;
        addAssignmentChargeSimple(store, state, candidates[0].id, 'weekend');
      }
    });
  }

  function nightAssignmentsMap(nights){ return Object.fromEntries((nights||[]).map(n => [n.date, n.owner])); }
  function hasConsecutiveNight(map, personId, dateStr){
    const prev = iso(addDays(parseDate(dateStr), -1));
    const next = iso(addDays(parseDate(dateStr), 1));
    return map[prev] === personId || map[next] === personId;
  }

  function assignWeekdayNights(state, weeks, availability, options={}){
    const store = initFairnessStore(state);
    const out = [];
    const map = {};
    const perMonth = {};
    const perWeek = {};
    seedLockedNightAssignments(state, weeks, store, out, map, perMonth, perWeek);
    seedLocumNightCalls(state, weeks, availability, store, out, map, perMonth, perWeek);

    weeks.forEach((week, idx) => {
      if(week.locked) return;
      const mon = parseDate(week.weekStart);
      for(let i=0;i<5;i++){
        const date = iso(addDays(mon,i));
        const month = monthKey(date);
        const prevWeekendOwner = i===0 && idx>0 ? weeks[idx-1].weekendOwner : '';
        if(map[date]) continue;
        const candidates = state.physicians.filter(p => {
          if(!p.nightEligible) return false;
          if(!availability[p.id][week.weekStart].nightAvailable) return false;
          if(hasRequest(state,p.id,'no_call',date,date) || hasRequest(state,p.id,'no_night_call',date,date) || hasVacation(state,p.id,date,date)) return false;
          if((perMonth[`${p.id}:${month}`]||0) >= 4) return false;
          if((perWeek[`${p.id}:${week.weekStart}`]||0) >= 2) return false;
          if(week.weekendOwner === p.id && (perWeek[`${p.id}:${week.weekStart}`]||0) >= 1) return false;
          if(i===4 && week.weekendOwner === p.id) return false;
          if(i===0 && prevWeekendOwner === p.id) return false;
          if(hasConsecutiveNight(map,p.id,date)) return false;
          return true;
        }).sort((a,b) => {
          const as = currentScore(store, a.id, 'night') + (options.stable ? stableBonusNight(state, date, a.id) : 0);
          const bs = currentScore(store, b.id, 'night') + (options.stable ? stableBonusNight(state, date, b.id) : 0);
          if(as !== bs) return as - bs;
          return a.id.localeCompare(b.id);
        });
        const chosen = candidates[0];
        out.push({ date, owner: chosen ? chosen.id : '', weekend:false, weekStart:week.weekStart });
        if(chosen){
          map[date] = chosen.id;
          perMonth[`${chosen.id}:${month}`] = (perMonth[`${chosen.id}:${month}`]||0)+1;
          perWeek[`${chosen.id}:${week.weekStart}`] = (perWeek[`${chosen.id}:${week.weekStart}`]||0)+1;
          addAssignmentChargeSimple(store, state, chosen.id, 'night');
        }
      }
      if(!map[week.weekendStart]) out.push({ date: week.weekendStart, owner: week.weekendOwner || '', weekend:true, weekStart:week.weekStart });
      if(!map[week.weekendEnd]) out.push({ date: week.weekendEnd, owner: week.weekendOwner || '', weekend:true, weekStart:week.weekStart });
      if(week.weekendOwner){ map[week.weekendStart] = week.weekendOwner; map[week.weekendEnd] = week.weekendOwner; }
    });
    return out;
  }

  function generatedOverrideRecord(kind, context, fromOwner, toOwner){
    return {
      id:`ovr-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      kind,
      context,
      fromOwner,
      toOwner,
      timestamp:new Date().toISOString()
    };
  }

  function validateSchedule(state, weeks, nights){
    const map = personMap(state);
    const issues = [];
    const nightMap = nightAssignmentsMap(nights);
    const weekdayMonthCounts = {};
    const weekendMonthCounts = {};
    const weekdayWeekCounts = {};

    weeks.forEach(week => {
      const assignedPeople = {};
      MAJOR_SERVICES.forEach(service => {
        const owner = week.services[service];
        if(!owner){ if(!OPTIONAL_OP_SERVICES.includes(service)) issues.push({ level:'warning', code:'service-unfilled', message:`${service} unfilled`, weekStart:week.weekStart }); return; }
        if(map[owner]?.type !== 'locum' && !canDoService(map[owner], service)) issues.push({ level:'error', code:'service-eligibility', message:`${owner} not eligible for ${service}`, weekStart:week.weekStart });
        if(assignedPeople[owner]) issues.push({ level:'error', code:'double-major-service', message:`${owner} has multiple major services`, weekStart:week.weekStart });
        assignedPeople[owner] = service;
      });
      if(!week.services.Echo) issues.push({ level:'warning', code:'echo-unfilled', message:'Echo unfilled', weekStart:week.weekStart });
      else {
        const base = getPrimaryServiceForPerson(week, week.services.Echo);
        if(!ECHO_ALLOWED.includes(base)) issues.push({ level:'error', code:'illegal-echo-pairing', message:`Echo paired illegally with ${base || 'none'}`, weekStart:week.weekStart });
      }
      if(!week.weekendOwner) issues.push({ level:'warning', code:'weekend-unfilled', message:'Weekend owner unfilled', weekStart:week.weekStart });
      const sat = nights.find(n => n.date === week.weekendStart);
      const sun = nights.find(n => n.date === week.weekendEnd);
      if((sat?.owner||'') !== (sun?.owner||'')) issues.push({ level:'error', code:'weekend-split', message:'Weekend split detected', weekStart:week.weekStart });
      if(week.weekendOwner){
        const mk = `${week.weekendOwner}:${monthKey(week.weekendStart)}`;
        weekendMonthCounts[mk] = (weekendMonthCounts[mk]||0)+1;
      }
    });

    nights.filter(n => !n.weekend).forEach(n => {
      if(!n.owner){ issues.push({ level:'warning', code:'night-unfilled', message:`Night call unfilled on ${n.date}`, date:n.date }); return; }
      if(map[n.owner]?.type !== 'locum' && !canDoService(map[n.owner], 'Night')) issues.push({ level:'error', code:'night-eligibility', message:`${n.owner} not eligible for night call`, date:n.date });
      const prev = iso(addDays(parseDate(n.date), -1));
      if(nightMap[prev] === n.owner) issues.push({ level:'error', code:'back-to-back-night-calls', message:`${n.owner} has back to back night calls`, date:n.date });
      const mk = `${n.owner}:${monthKey(n.date)}`;
      const wk = `${n.owner}:${n.weekStart}`;
      weekdayMonthCounts[mk] = (weekdayMonthCounts[mk]||0)+1;
      weekdayWeekCounts[wk] = (weekdayWeekCounts[wk]||0)+1;
    });

    Object.entries(weekdayMonthCounts).forEach(([k,v]) => { if(v > 4) issues.push({ level:'error', code:'call-limits-exceeded', message:`${k} exceeds 4 weekday calls per month` }); });
    Object.entries(weekdayWeekCounts).forEach(([k,v]) => { if(v > 2) issues.push({ level:'error', code:'call-limits-exceeded', message:`${k} exceeds 2 weekday calls per week` }); });
    Object.entries(weekendMonthCounts).forEach(([k,v]) => { if(v > 1) issues.push({ level:'error', code:'weekend-limits-exceeded', message:`${k} exceeds 1 weekend per month` }); });
    return issues;
  }

  function generateSchedule(state, startDate, endDate, options={}){
    const weeks = getWeeks(startDate, endDate);
    const availability = buildAvailability(state, weeks);
    applyLockedWeeks(state, weeks);
    assignMajorServices(state, weeks, availability, options);
    assignWeekendOwners(state, weeks, availability, options);
    applyPinnedAssignments(state, weeks);
    const nights = assignWeekdayNights(state, weeks, availability, options);
    const fairnessSummary = summarizeFairness(state, weeks, nights);
    const validation = validateSchedule(state, weeks, nights);
    return { weeks, nightAssignments:nights, fairnessSummary, validation };
  }

  function persistGeneratedDraft(startDate, endDate, options={}){
    const state = window.AppState.loadState();
    const result = generateSchedule(state, startDate, endDate, options);
    state.settings.scheduleStart = startDate;
    state.settings.scheduleEnd = endDate;
    state.draftWeeks = result.weeks;
    state.draftNightManual = result.nightAssignments;
    state.generatedSummary = { fairnessSummary: result.fairnessSummary, validation: result.validation };
    state.metadata.lastGeneratedAt = new Date().toISOString();
    state.metadata.lastGenerationMode = options.stable ? 'stable' : 'fresh';
    window.AppState.saveState(state);
    return result;
  }

  function recomputeDraftSummary(state){
    const fairnessSummary = summarizeFairness(state, state.draftWeeks || [], state.draftNightManual || []);
    const validation = validateSchedule(state, state.draftWeeks || [], state.draftNightManual || []);
    return { fairnessSummary, validation };
  }

  function getEligibleOwnersForWeek(state, week, target){
    const all = getAllPeople(state);
    if(target === 'Weekend'){
      return all.filter(person => {
        if(person.type === 'locum') return person.weekendDates?.includes(week.weekendStart);
        return person.weekendEligible && !hasVacation(state, person.id, week.weekStart, week.weekendEnd) && !hasRequest(state, person.id,'weekends_off', week.weekendStart, week.weekendEnd);
      });
    }
    if(target === 'Echo'){
      return all.filter(person => {
        if(person.type === 'locum') return false;
        if(!person.echoEligible) return false;
        const base = getPrimaryServiceForPerson(week, person.id);
        return ECHO_ALLOWED.includes(base);
      });
    }
    if(MAJOR_SERVICES.includes(target)){
      return all.filter(person => {
        if(person.type === 'locum'){
          return (person.weeklyCoverage || []).some(entry => entry.weekStart === week.weekStart && (entry.services || []).includes(target));
        }
        return canDoService(person, target) && !hasVacation(state, person.id, week.weekStart, week.weekEnd);
      });
    }
    return [];
  }

  function getEligibleOwnersForNight(state, nightEntry){
    const all = getAllPeople(state);
    return all.filter(person => {
      if(nightEntry.weekend){
        if(person.type === 'locum') return person.weekendDates?.includes(nightEntry.date);
        return person.weekendEligible;
      }
      if(person.type === 'locum') return person.callDates?.includes(nightEntry.date);
      return person.nightEligible && !hasRequest(state, person.id,'no_call',nightEntry.date,nightEntry.date) && !hasRequest(state, person.id,'no_night_call',nightEntry.date,nightEntry.date) && !hasVacation(state, person.id,nightEntry.date,nightEntry.date);
    });
  }

  function applyWeekOverride(state, weekStart, target, ownerId){
    const week = state.draftWeeks.find(w => w.weekStart === weekStart);
    if(!week) return state;
    const fromOwner = target === 'Weekend' ? week.weekendOwner : week.services[target];
    if(target === 'Weekend') week.weekendOwner = ownerId;
    else week.services[target] = ownerId;
    state.overrideLog.unshift(generatedOverrideRecord(target === 'Weekend' ? 'weekend' : 'service', `${weekStart}:${target}`, fromOwner, ownerId));
    state.generatedSummary = recomputeDraftSummary(state);
    window.AppState.saveState(state);
    return state;
  }

  function applyNightOverride(state, date, ownerId){
    const entry = state.draftNightManual.find(n => n.date === date);
    if(!entry) return state;
    const fromOwner = entry.owner;
    entry.owner = ownerId;
    const week = state.draftWeeks.find(w => w.weekendStart === date || w.weekendEnd === date);
    if(entry.weekend && week){ week.weekendOwner = ownerId; }
    state.overrideLog.unshift(generatedOverrideRecord(entry.weekend ? 'weekend-night' : 'night', date, fromOwner, ownerId));
    state.generatedSummary = recomputeDraftSummary(state);
    window.AppState.saveState(state);
    return state;
  }

  window.SchedulerEngine = {
    MAJOR_SERVICES,
    ROW_SERVICES,
    ECHO_ALLOWED,
    iso,
    parseDate,
    addDays,
    monthKey,
    daterange,
    getWeeks,
    canDoService,
    getPrimaryServiceForPerson,
    generateSchedule,
    persistGeneratedDraft,
    recomputeDraftSummary,
    summarizeFairness,
    validateSchedule,
    getEligibleOwnersForWeek,
    getEligibleOwnersForNight,
    applyWeekOverride,
    applyNightOverride
  };
})();

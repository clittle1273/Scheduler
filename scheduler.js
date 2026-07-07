(function(){
  const MAJOR_SERVICES = ['ICU','GIM','CAR1','CAR2','Resp','Nephro','OP1','OP2','OP3'];
  const REQUIRED_SERVICES = ['Resp','Nephro','ICU','GIM','CAR1','CAR2'];
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
    if(bucket === 'echo') return w.echo || 1;
    return 1;
  }

  function targetPhysicianIdForAssignment(state, ownerId){
    const person = personMap(state)[ownerId];
    if(!person) return null;
    if(person.type !== 'locum') return ownerId;
    if(person.generalLocum) return null;
    return person.coveringPhysician || null;
  }

  function initFairnessStore(state){
    const store = {};
    state.physicians.forEach(p => {
      store[p.id] = {
        id:p.id,
        name:p.name,
        weekends:0,
        nightCalls:0,
        icuWeeks:0,
        weeklyServices:0,
        serviceCounts:{},
        weighted:{ weekends:0, nightCalls:0, icu:0, services:0 }
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
      store[targetId].weighted.weekends = +(store[targetId].weekends / fairnessWeight(person,'weekend')).toFixed(2);
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

  
  function applyPinnedAssignments(state, weeks){
    const priorWeeks = state.draftWeeks || [];
    const priorMap = Object.fromEntries(priorWeeks.map(w => [w.weekStart, w]));
    weeks.forEach(week => {
      const prior = priorMap[week.weekStart];
      if(!prior) return;
      week.pinnedServices = Object.assign({}, prior.pinnedServices || {});
      Object.keys(week.pinnedServices).forEach(service => {
        if(!week.pinnedServices[service]) return;
        if(service === 'Weekend') week.weekendOwner = prior.weekendOwner || '';
        else week.services[service] = (prior.services || {})[service] || '';
      });
    });
  }

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
        avail[person.id][week.weekStart] = {
          serviceAvailable: !hasVacation(state, person.id, week.weekStart, week.weekendEnd),
          nightAvailable: !hasVacation(state, person.id, week.weekStart, week.weekendEnd) && !hasRequest(state, person.id,'no_call',week.weekStart, week.weekEnd) && !hasRequest(state, person.id,'no_night_call',week.weekStart, week.weekEnd),
          weekendAvailable: !hasVacation(state, person.id, week.weekStart, week.weekendEnd) && !hasRequest(state, person.id,'weekends_off',week.weekendStart, week.weekendEnd),
          respRequested: hasRequest(state, person.id, 'resp_week_request', week.weekStart, week.weekEnd),
          nephroRequested: hasRequest(state, person.id, 'nephro_week_request', week.weekStart, week.weekEnd),
          noGimWeek: hasRequest(state, person.id, 'no_gim_week', week.weekStart, week.weekEnd),
          noIcuWeek: hasRequest(state, person.id, 'no_icu_week', week.weekStart, week.weekEnd)
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
      const totalWeight = eligible.reduce((sum, p) => sum + serviceBucketWeight(p, service), 0) || 1;
      targets[service] = {};
      eligible.forEach(p => {
        targets[service][p.id] = +(weeks.length * serviceBucketWeight(p, service) / totalWeight).toFixed(4);
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

  function serviceRecentPenalty(weeks, weekStart, personId, service){
    const idx = weeks.findIndex(w => w.weekStart === weekStart);
    if(idx <= 0) return 0;
    let penalty = 0;
    if(idx-1 >= 0 && weeks[idx-1].services?.[service] === personId) penalty += 0.25;
    if(idx-2 >= 0 && weeks[idx-2].services?.[service] === personId) penalty += 0.15;
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
      if(service === 'GIM' && availability[p.id][week.weekStart].noGimWeek) return false;
      if(service === 'ICU' && availability[p.id][week.weekStart].noIcuWeek) return false;
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
      store[targetId].weighted.weekends = +(store[targetId].weekends / fairnessWeight(person,'weekend')).toFixed(2);
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
    const weekMap = Object.fromEntries(weeks.map(w => [w.weekStart, w]));
    (state.locums || []).forEach(locum => {
      (locum.weeklyCoverage || []).forEach(entry => {
        const week = weekMap[entry.weekStart];
        if(!week || week.locked) return;
        if(!availability[locum.id]?.[week.weekStart]?.serviceAvailable) return;
        (entry.services || []).forEach(service => {
          if(!MAJOR_SERVICES.includes(service)) return;
          if(!week.services[service]){
            week.services[service] = locum.id;
            addAssignmentChargeSimple(store, state, locum.id, 'service', service);
          }
        });
      });
    });
  }

  function seedLocumWeekends(state, weeks, availability, store){
    const weekMap = Object.fromEntries(weeks.map(w => [w.weekendStart, w]));
    (state.locums || []).forEach(locum => {
      (locum.weekendDates || []).forEach(date => {
        const week = weekMap[date];
        if(!week || week.locked) return;
        if(!availability[locum.id]?.[week.weekStart]?.weekendAvailable) return;
        if(!week.weekendOwner){
          week.weekendOwner = locum.id;
          addAssignmentChargeSimple(store, state, locum.id, 'weekend');
        }
      });
    });
  }

  function seedLocumNightCalls(state, weeks, availability, store, out, map, perMonth, perWeek){
    const validDates = new Set();
    weeks.forEach(week => {
      const mon = parseDate(week.weekStart);
      for(let i=0;i<5;i++) validDates.add(iso(addDays(mon,i)));
    });
    (state.locums || []).forEach(locum => {
      (locum.callDates || []).forEach(date => {
        if(!validDates.has(date)) return;
        const week = weeks.find(w => date >= w.weekStart && date <= w.weekEnd);
        if(!week || week.locked) return;
        if(!availability[locum.id]?.[week.weekStart]?.nightAvailable) return;
        const month = monthKey(date);
        if(map[date]) return;
        out.push({ date, owner: locum.id, weekend:false, weekStart:week.weekStart });
        map[date] = locum.id;
        perMonth[`${locum.id}:${month}`] = (perMonth[`${locum.id}:${month}`]||0)+1;
        perWeek[`${locum.id}:${week.weekStart}`] = (perWeek[`${locum.id}:${week.weekStart}`]||0)+1;
        addAssignmentChargeSimple(store, state, locum.id, 'night');
      });
    });
  }


  function assignMajorServices(state, weeks, availability){
    const store = initFairnessStore(state);
    seedLocumWeeklyCoverage(state, weeks, availability, store);
    const requiredTargets = computeServiceTargets(state, weeks, REQUIRED_SERVICES);
    const icuTargets = computeIcuTargetsForRange(state, weeks, store);

    REQUIRED_SERVICES.forEach(service => {
      weeks.forEach(week => {
        if(week.services[service]) return;
        const assigned = peopleAssignedThisWeek(week);
        const candidates = state.physicians.filter(p => {
          if(!canDoService(p, service)) return false;
          // BB ICU rule: BB remains ICU-eligible at 0.8 FTE, but only on weeks
          // where Resp is either already BB or still open and can be paired with BB.
          // This avoids excluding BB from ICU just because ICU is assigned before Resp.
          const bbRespIcuWeek = service === 'ICU' && p.id === 'BB' && week.services.Resp === 'BB';
          const bbRespIcuPairable = service === 'ICU' && p.id === 'BB' && !week.services.Resp && canDoService(p, 'Resp') && availability[p.id][week.weekStart].serviceAvailable;
          if(service === 'ICU' && p.id === 'BB' && !(bbRespIcuWeek || bbRespIcuPairable)) return false;
          if(assigned[p.id] && !bbRespIcuWeek) return false;
          if(!availability[p.id][week.weekStart].serviceAvailable) return false;
          return true;
        }).sort((a,b) => {
          const aPref = service === 'Resp' ? (availability[a.id][week.weekStart].respRequested ? -1 : 0)
            : service === 'Nephro' ? (availability[a.id][week.weekStart].nephroRequested ? -1 : 0) : 0;
          const bPref = service === 'Resp' ? (availability[b.id][week.weekStart].respRequested ? -1 : 0)
            : service === 'Nephro' ? (availability[b.id][week.weekStart].nephroRequested ? -1 : 0) : 0;
          if(aPref !== bPref) return aPref - bPref;

          // BB ICU pairing rule: Resp is assigned before ICU. If BB has Resp this week,
          // strongly prefer BB for ICU as well so his 0.8 FTE ICU share is preserved.
          // This must not override Resp requests, because Resp has already been assigned.
          const aBbRespIcuBonus = service === 'ICU' && a.id === 'BB' && week.services.Resp === 'BB' ? -4 : 0;
          const bBbRespIcuBonus = service === 'ICU' && b.id === 'BB' && week.services.Resp === 'BB' ? -4 : 0;

          const aDef = serviceDeficitScore(store, a.id, service, requiredTargets) + serviceRecentPenalty(weeks, week.weekStart, a.id, service) + aBbRespIcuBonus;
          const bDef = serviceDeficitScore(store, b.id, service, requiredTargets) + serviceRecentPenalty(weeks, week.weekStart, b.id, service) + bBbRespIcuBonus;
          if(aDef !== bDef) return aDef - bDef;

          const aOverall = overallWeeklyBurden(store, a.id);
          const bOverall = overallWeeklyBurden(store, b.id);
          if(aOverall !== bOverall) return aOverall - bOverall;

          return a.id.localeCompare(b.id);
        });
        if(candidates[0]){
          week.services[service] = candidates[0].id;
          addAssignmentChargeSimple(store, state, candidates[0].id, 'service', service);
          // Resp is intentionally scheduled before ICU. Do not assign Resp from inside ICU logic.
        }
      });
    });

    OPTIONAL_OP_SERVICES.forEach(service => {
      weeks.forEach(week => {
        if(week.services[service]) return;
        const assigned = peopleAssignedThisWeek(week);
        const candidates = state.physicians.filter(p => {
          if(!canDoService(p, service)) return false;
          if(assigned[p.id]) return false;
          if(!availability[p.id][week.weekStart].serviceAvailable) return false;
          return true;
        }).sort((a,b) => {
          const aOverall = overallWeeklyBurden(store, a.id) + serviceRecentPenalty(weeks, week.weekStart, a.id, service) + opPriorityPenalty(service);
          const bOverall = overallWeeklyBurden(store, b.id) + serviceRecentPenalty(weeks, week.weekStart, b.id, service) + opPriorityPenalty(service);
          if(aOverall !== bOverall) return aOverall - bOverall;
          return a.id.localeCompare(b.id);
        });
        if(candidates[0]){
          week.services[service] = candidates[0].id;
          addAssignmentChargeSimple(store, state, candidates[0].id, 'service', service);
          // Resp is intentionally scheduled before ICU. Do not assign Resp from inside ICU logic.
        } else {
          week.services[service] = '';
        }
      });
    });

    const echoOrder = ['CL','DK','DC'];
    const echoCounts = Object.fromEntries(echoOrder.map(id => [id, 0]));
    function echoLoadScore(personId){
      const p = physicianMap(state)[personId];
      return (echoCounts[personId] || 0) / fairnessWeight(p, 'echo');
    }
    function tryMakeEchoEligible(week, person){
      if(!person || !person.echoEligible) return false;
      if(!availability[person.id]?.[week.weekStart]?.serviceAvailable) return false;
      if(getPrimaryServiceForPerson(week, person.id)) return ECHO_ALLOWED.includes(getPrimaryServiceForPerson(week, person.id));
      const assigned = peopleAssignedThisWeek(week);
      if(assigned[person.id]) return false;
      const openOp = ['OP3','OP2','OP1'].find(s => !week.services[s] && canDoService(person, s));
      if(openOp){
        week.services[openOp] = person.id;
        addAssignmentChargeSimple(store, state, person.id, 'service', openOp);
        return true;
      }
      return false;
    }

    weeks.forEach((week, idx) => {
      const preferred = echoOrder[idx % echoOrder.length];
      const lowestEchoId = echoOrder.slice().sort((a,b) => {
        const diff = echoLoadScore(a) - echoLoadScore(b);
        if(diff !== 0) return diff;
        return echoOrder.indexOf(a) - echoOrder.indexOf(b);
      })[0];
      const preferredPerson = physicianMap(state)[lowestEchoId || preferred];
      tryMakeEchoEligible(week, preferredPerson);

      const echoCandidates = state.physicians.filter(p => p.echoEligible && availability[p.id][week.weekStart].serviceAvailable && ECHO_ALLOWED.includes(getPrimaryServiceForPerson(week,p.id)))
        .sort((a,b) => {
          const as = echoLoadScore(a.id);
          const bs = echoLoadScore(b.id);
          if(as !== bs) return as - bs;
          const ap = echoOrder.indexOf(a.id); const bp = echoOrder.indexOf(b.id);
          if(ap !== bp) return (ap === -1 ? 99 : ap) - (bp === -1 ? 99 : bp);
          return a.id.localeCompare(b.id);
        });
      if(echoCandidates.length){
        week.services.Echo = echoCandidates[0].id;
        if(echoCounts[week.services.Echo] != null) echoCounts[week.services.Echo] += 1;
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
    const current = weeks[idx];
    const next = weeks[idx+1];

    // Strong preference: the GIM or ICU physician for the current service week
    // should take the weekend immediately following that week if available.
    const currentSvc = current ? getPrimaryServiceForPerson(current, personId) : '';
    if(['ICU','GIM'].includes(currentSvc)) score -= 1000;

    // Fallback preference: if the following-week service person cannot take their own
    // following weekend, prefer assigning them the weekend before that service week.
    const nextSvc = next ? getPrimaryServiceForPerson(next, personId) : '';
    if(['ICU','GIM'].includes(nextSvc)) score -= 250;

    return score;
  }

  function assignWeekendOwners(state, weeks, availability){
    const store = initFairnessStore(state);
    seedLocumWeekends(state, weeks, availability, store);
    weeks.forEach((week, idx) => {
      if(week.locked) return;
      if(week.weekendOwner) return;
      const month = monthKey(week.weekendStart);
      const monthCounts = Object.fromEntries(state.physicians.map(p => [p.id, 0]));
      weeks.slice(0,idx).forEach(prev => { if(prev.weekendOwner && state.physicians.some(p => p.id===prev.weekendOwner)) monthCounts[prev.weekendOwner] = (monthCounts[prev.weekendOwner]||0)+ (monthKey(prev.weekendStart)===month?1:0); });
      const candidates = state.physicians.filter(p => p.weekendEligible && availability[p.id][week.weekStart].weekendAvailable && (monthCounts[p.id]||0) < 1)
        .sort((a,b) => {
          const aScore = currentScore(store, a.id, 'weekend') + weekendPreferenceScore(weeks, idx, a.id);
          const bScore = currentScore(store, b.id, 'weekend') + weekendPreferenceScore(weeks, idx, b.id);
          if(aScore !== bScore) return aScore - bScore;
          return a.id.localeCompare(b.id);
        });
      if(candidates[0]){
        week.weekendOwner = candidates[0].id;
        addAssignmentChargeSimple(store, state, candidates[0].id, 'weekend');
      }
    });
  }

  function nightAssignmentsMap(nights){ return Object.fromEntries((nights||[]).map(n => [n.date, n.owner])); }
  function isLocumId(state, personId){ return (state.locums || []).some(l => l.id === personId); }
  function isPhysicianId(state, personId){ return (state.physicians || []).some(p => p.id === personId); }
  function isBFAllowedWeekdayNight(week, personId){
    // BF weekday night call only on weeks where BF is assigned to Nephro. Weekend/locum rules are separate.
    return personId !== 'BF' || ((week && week.services && week.services.Nephro) === 'BF');
  }
  function daysBetween(dateA, dateB){
    return Math.round((parseDate(dateA) - parseDate(dateB)) / 86400000);
  }
  function callSpacingPenalty(state, map, personId, dateStr, week, dayIndex, weeks, idx){
    if(isLocumId(state, personId) || !isPhysicianId(state, personId)) return 0;
    let penalty = 0;
    Object.entries(map || {}).forEach(([assignedDate, owner]) => {
      if(owner !== personId) return;
      if(isLocumId(state, owner)) return;
      const gap = Math.abs(daysBetween(dateStr, assignedDate));
      if(gap === 1) penalty += 10000;       // back-to-back call
      else if(gap === 2) penalty += 6500;   // 48-hour / Monday-Wednesday style spacing
    });

    const prevWeekendOwner = idx > 0 ? weeks[idx-1].weekendOwner : '';
    if(prevWeekendOwner === personId && isPhysicianId(state, prevWeekendOwner) && dayIndex <= 1) penalty += 9000; // Mon/Tue after physician weekend
    if(week.weekendOwner === personId && isPhysicianId(state, week.weekendOwner) && dayIndex >= 3) penalty += 9000; // Thu/Fri before physician weekend
    return penalty;
  }

  function violatesHardPhysicianCallSpacing(state, map, personId, dateStr, week, dayIndex, weeks, idx){
    // Justin rule: for regular physicians only, do not place call within 48 hours of another call.
    // Locum-selected dates are not constrained by this rule.
    if(isLocumId(state, personId) || !isPhysicianId(state, personId)) return false;

    for(const [assignedDate, owner] of Object.entries(map || {})){
      if(owner !== personId) continue;
      if(isLocumId(state, owner)) continue;
      const gap = Math.abs(daysBetween(dateStr, assignedDate));
      if(gap <= 2) return true;
    }

    const prevWeekendOwner = idx > 0 ? weeks[idx-1].weekendOwner : '';
    if(prevWeekendOwner === personId && isPhysicianId(state, prevWeekendOwner) && dayIndex <= 1) return true;
    if(week.weekendOwner === personId && isPhysicianId(state, week.weekendOwner) && dayIndex >= 3) return true;
    return false;
  }

  function assignWeekdayNights(state, weeks, availability){
    const store = initFairnessStore(state);
    const out = [];
    const map = {};
    const perMonth = {};
    const perWeek = {};
    seedLocumNightCalls(state, weeks, availability, store, out, map, perMonth, perWeek);

    weeks.forEach((week, idx) => {
      if(week.locked) return;
      const mon = parseDate(week.weekStart);
      for(let i=0;i<5;i++){
        const date = iso(addDays(mon,i));
        const month = monthKey(date);
        if(map[date]) continue;

        const baseCandidates = state.physicians.filter(p => {
          if(!p.nightEligible) return false;
          if(!availability[p.id][week.weekStart].nightAvailable) return false;
          if(hasRequest(state,p.id,'no_call',date,date) || hasRequest(state,p.id,'no_night_call',date,date) || hasVacation(state,p.id,date,date)) return false;
          if((perMonth[`${p.id}:${month}`]||0) >= 4) return false;
          if((perWeek[`${p.id}:${week.weekStart}`]||0) >= 2) return false;
          if(week.weekendOwner === p.id && (perWeek[`${p.id}:${week.weekStart}`]||0) >= 1) return false;
          if(!isBFAllowedWeekdayNight(week, p.id)) return false;
          return true;
        });

        const candidates = baseCandidates
          .filter(p => !violatesHardPhysicianCallSpacing(state, map, p.id, date, week, i, weeks, idx))
          .sort((a,b) => {
            const as = currentScore(store, a.id, 'night') + callSpacingPenalty(state, map, a.id, date, week, i, weeks, idx);
            const bs = currentScore(store, b.id, 'night') + callSpacingPenalty(state, map, b.id, date, week, i, weeks, idx);
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
      out.push({ date: week.weekendStart, owner: week.weekendOwner || '', weekend:true, weekStart:week.weekStart });
      out.push({ date: week.weekendEnd, owner: week.weekendOwner || '', weekend:true, weekStart:week.weekStart });
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
      const nightWeek = weeks.find(w => w.weekStart === n.weekStart);
      if(n.owner === 'BF' && !isBFAllowedWeekdayNight(nightWeek, n.owner)) issues.push({ level:'error', code:'bf-nephro-night-rule', message:'BF assigned weekday night call outside a BF Nephro week', date:n.date });
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

  function generateSchedule(state, startDate, endDate){
    const weeks = getWeeks(startDate, endDate);
    const availability = buildAvailability(state, weeks);
    assignMajorServices(state, weeks, availability);
    assignWeekendOwners(state, weeks, availability);
    applyPinnedAssignments(state, weeks);
    const nights = assignWeekdayNights(state, weeks, availability);
    const fairnessSummary = summarizeFairness(state, weeks, nights);
    const validation = validateSchedule(state, weeks, nights);
    return { weeks, nightAssignments:nights, fairnessSummary, validation };
  }

  function persistGeneratedDraft(startDate, endDate){
    const state = window.AppState.loadState();
    const result = generateSchedule(state, startDate, endDate);
    state.settings.scheduleStart = startDate;
    state.settings.scheduleEnd = endDate;
    state.draftWeeks = result.weeks;
    state.draftNightManual = result.nightAssignments;
    state.generatedSummary = { fairnessSummary: result.fairnessSummary, validation: result.validation };
    state.metadata.lastGeneratedAt = new Date().toISOString();
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
      const nightWeek = (state.draftWeeks || []).find(w => w.weekStart === nightEntry.weekStart);
      if(!isBFAllowedWeekdayNight(nightWeek, person.id)) return false;
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

function tableToCSV(table){
  const rows=[...table.querySelectorAll("tr")];
  return rows.map(r=>[...r.children].map(c=>'"'+c.innerText.replace(/"/g,'""')+'"').join(",")).join("\n");
}

function downloadCSV(csv,name){
  const blob=new Blob([csv],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name;a.click();
  URL.revokeObjectURL(url);
}

function exportMasterExcel(){
  const table=document.querySelector(".fit-master table");
  if(!table) return alert("No master schedule found");
  downloadCSV(tableToCSV(table),"master_schedule.csv");
}

function exportNightExcel(){
  const state = window.AppState && window.AppState.loadState ? window.AppState.loadState() : null;
  const nights = (state && state.draftNightManual) ? state.draftNightManual : [];
  if(!nights.length) return alert("No night call calendar found");
  const people = Object.fromEntries([...(state?.physicians || []), ...(state?.locums || [])].map(p => [p.id, p.name || p.id]));
  const rows = [["Date","Owner","Type"]].concat(
    nights.map(n => [
      n.date || "",
      people[n.owner] || n.owner || "",
      n.weekend ? "Weekend call" : "Weekday night call"
    ])
  );
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(",")).join("\n");
  downloadCSV(csv, "night_call.csv");
}

function exportMasterPDF(){
  const wrap = document.querySelector('.fit-master');
  const table = wrap ? wrap.querySelector('table') : null;
  if(!table){
    alert("Master schedule not found");
    return;
  }

  const html = table.outerHTML;
  const win = window.open('', '_blank');
  win.document.write(`
    <html>
      <head>
        <title>Master Schedule</title>
        <style>
          @page { size: landscape; margin: 10mm; }
          body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; }
          .print-wrap { width: 100%; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th, td { border: 1px solid #d6d6d6; padding: 6px 4px; font-size: 11px; text-align: center; vertical-align: top; }
          th.service-col, td.week-row-label { width: 110px; text-align: left; }
          .small { font-size: 10px; color: #666; }
          .service-header { font-weight: 700; }
          .chip, .day-owner {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 999px;
            font-size: 10px;
            line-height: 1.2;
            white-space: nowrap;
            border: 1px solid #d9d9d9;
            background: #f7f7f7;
            color: #111;
          }
          .service-cell.mine, .my-week-row td { background: #fafafa; }
          .service-ICU, .service-GIM, .service-CAR1, .service-CAR2, .service-Resp, .service-Nephro,
          .service-OP1, .service-OP2, .service-OP3, .service-Echo, .service-Weekend { background: transparent; }
          .lock-toggle, .btn, button { display: none !important; }
        </style>
</head>
      <body>
        <div class="print-wrap">${html}</div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}


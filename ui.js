(function(){
  const PAGE = window.PAGE_TYPE || document.body?.dataset?.page || 'index';
  const S = () => window.AppState.loadState();
  const serviceRows = window.SchedulerEngine ? window.SchedulerEngine.ROW_SERVICES : [];
  const el = sel => document.querySelector(sel);
  const els = sel => Array.from(document.querySelectorAll(sel));

  function fmtDateTime(v){ if(!v) return 'Not yet'; try{return new Date(v).toLocaleString();}catch(e){return v;} }
  function fmtDate(v){ if(!v) return ''; try{return new Date(v+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});}catch(e){return v;} }
  function safe(str){ return String(str ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function peopleMap(state){ return Object.fromEntries([...state.physicians, ...state.locums].map(p => [p.id,p])); }
  function physicianMap(state){ return Object.fromEntries(state.physicians.map(p => [p.id,p])); }
  function badge(text, cls=''){ return `<span class="badge ${cls}">${safe(text)}</span>`; }
  function chipForOwner(state, ownerId, kind=''){ 
    if(!ownerId) return `<span class="assign-chip unfilled">Unfilled</span>`;
    const p = peopleMap(state)[ownerId];
    if(!p) return `<span class="assign-chip">${safe(ownerId)}</span>`;
    const cls = p.type === 'locum' ? 'locum' : (kind==='weekend' ? 'weekend' : '');
    const locumBase = p.initials ? p.initials : p.name;
    const label = p.type === 'locum' ? `${locumBase}${p.generalLocum ? ' (Gen)' : ` → ${p.coveringPhysician || 'Cover'}`}` : p.name;
    return `<span class="assign-chip ${cls}">${safe(label)}</span>`;
  }
  function requestLabel(type){
    return {
      vacation:'Vacation',
      no_call:'No Call',
      no_night_call:'No Night Call',
      weekends_off:'Weekends Off',
      resp_week_request:'Resp Week Request',
      nephro_week_request:'Nephro Week Request'
    }[type] || type;
  }
  function allRequestTypes(){ return ['vacation','no_call','no_night_call','weekends_off','resp_week_request','nephro_week_request']; }

  function baseShell(title, subtitle, tabs, inspectorTitle='Inspector'){
    return `
      <div class="page-shell">
        <aside class="sidebar">
          <div class="brand">Department Scheduling</div>
          <div class="brand-sub">${safe(subtitle)}</div>
          <nav class="side-nav">
            ${tabs.map(t => `<button data-tab="${t.key}" class="${t.active?'active':''}">${safe(t.label)}</button>`).join('')}
          </nav>
          <div class="side-footer">
            <div>Local browser build</div>
            <div class="small">Shared state updates across pages</div>
          </div>
        </aside>
        <main class="main-panel">
          <div class="topbar">
            <div class="title-block">
              <h1>${safe(title)}</h1>
              <p class="subtitle">${safe(subtitle)}</p>
            </div>
            <div id="topActions"></div>
          </div>
          <div id="summaryBar"></div>
          <div id="mainContent"></div>
        </main>
        <aside class="inspector">
          <h3>${safe(inspectorTitle)}</h3>
          <div id="inspectorContent"></div>
        </aside>
      </div>`;
  }

  function attachTabBehavior(onChange){
    els('.side-nav button').forEach(btn => btn.addEventListener('click', () => {
      els('.side-nav button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.tab);
    }));
  }

  function renderIndex(){
    document.body.innerHTML = `
      <div class="home-shell">
        <div class="brand">Department Scheduling</div>
        <p class="subtitle">Open the tool you need. All pages share the same local saved state.</p>
        <div class="home-grid">
          <a class="portal-link" href="admin.html"><h2>Admin Dashboard</h2><div>Generate, review, validate, override, and publish.</div></a>
          <a class="portal-link" href="physician.html"><h2>Physician Portal</h2><div>See assignments and submit requests.</div></a>
          <a class="portal-link" href="locum.html"><h2>Locum Portal</h2><div>Choose service coverage and explicit call dates.</div></a>
          <a class="portal-link" href="mobile_snapshot.html"><h2>Mobile Snapshot</h2><div>Read only quick view.</div></a>
        </div>
      </div>`;
  }

  function ensureSummary(state){
    state.generatedSummary = state.generatedSummary || window.SchedulerEngine.recomputeDraftSummary(state);
    return state.generatedSummary;
  }

  function adminTopActions(state){
    return `
      <div class="top-inputs">
        <label>Start</label><input id="adminStart" type="date" value="${safe(state.settings.scheduleStart || '')}">
        <label>End</label><input id="adminEnd" type="date" value="${safe(state.settings.scheduleEnd || '')}">
        <button class="primary" id="generateBtn">Generate Fresh</button>
        <button class="ghost" id="stableGenerateBtn">Stable Regenerate</button>
        <button class="ghost" id="clearDraftBtn">Clear Draft</button>
        <button class="ghost" id="reloadBtn">Reload Saved Data</button>
        <button class="success" id="publishBtn">Finalize and Publish</button>
      </div>`;
  }

  function computeSummaryCounts(state){
    const summary = ensureSummary(state);
    const countServices = serviceRows.filter(s => !['Weekend','Echo','OP2','OP3'].includes(s));
    return {
      unresolvedRequests:(state.requests||[]).filter(r => r.status !== 'approved' && r.status !== 'denied').length,
      unfilledAssignments:(state.draftWeeks||[]).reduce((n,w) => n + countServices.filter(s => !w.services[s]).length + (!w.weekendOwner?1:0),0)
        + (state.draftNightManual||[]).filter(n => !n.owner).length,
      warnings:(summary.validation||[]).length,
      scheduleRange:(state.settings.scheduleStart && state.settings.scheduleEnd) ? `${fmtDate(state.settings.scheduleStart)} – ${fmtDate(state.settings.scheduleEnd)}` : 'No range'
    };
  }

  function renderAdmin(){
    const state = S();
    const tabs = [
      ['overview','Overview'],['master','Master Schedule'],['night','Night Call Calendar'],['requests','Requests'],['fairness','Fairness'],['totalfairness','Yearly Fairness'],['overrides','Overrides'],['physicians','Physician Summary'],['locums','Locum Coverage'],['publish','Publish Review']
    ].map((x,i) => ({key:x[0], label:x[1], active:i===0}));
    document.body.innerHTML = baseShell('Admin Dashboard','Draft and published schedule control',tabs,'Assignment Inspector');
    el('#topActions').innerHTML = adminTopActions(state);
    renderAdminSummaryBar();
    const active = { key:'overview' };
    function redraw(tabKey){
      active.key = tabKey || active.key;
      renderAdminSummaryBar();
      const st = S();
      const summary = ensureSummary(st);
      const main = el('#mainContent');
      const inspector = el('#inspectorContent');
      if(active.key === 'overview'){
        main.innerHTML = renderAdminOverview(st, summary);
        inspector.innerHTML = renderOverviewInspector(st, summary);
      } else if(active.key === 'master'){
        main.innerHTML = renderMasterSchedule(st);
        inspector.innerHTML = '<div class="detail-box">Click directly inside the calendar to change any unlocked assignment.</div>';
        bindMasterSchedule();
      } else if(active.key === 'night'){
        main.innerHTML = renderNightCalendar(st);
        inspector.innerHTML = '<div class="detail-box">Click directly inside the calendar to change any unlocked call assignment.</div>';
        bindNightCalendar();
      } else if(active.key === 'requests'){
        main.innerHTML = renderRequestsAdmin(st);
        inspector.innerHTML = '<div class="detail-box">Review incoming requests. Vacation, no call, no night call, and weekends off are hard blocks. Resp and nephro requests are soft preferences.</div>';
        bindRequestAdmin();
      } else if(active.key === 'fairness'){
        main.innerHTML = renderFairness(st, summary);
        inspector.innerHTML = '<div class="detail-box">Fairness is shown for the current draft. BB weighting affects ICU, weekends, and weekday call. DC weighting affects weekly services, weekends, and weekday call.</div>';
      } else if(active.key === 'totalfairness'){
        main.innerHTML = renderTotalFairness(st, summary);
        inspector.innerHTML = '<div class="detail-box">Yearly Fairness tracks published blocks from the same calendar year plus the current draft. It also feeds back into the next schedule so major services, weekday call, and weekends are balanced by FTE across that year.</div>';
      } else if(active.key === 'overrides'){
        main.innerHTML = renderOverrides(st);
        inspector.innerHTML = '<div class="detail-box">Each manual change logs the original owner, the replacement, and the timestamp.</div>';
        bindOverrides();
      } else if(active.key === 'physicians'){
        main.innerHTML = renderPhysicianSummary(st, summary);
        inspector.innerHTML = '<div class="detail-box">These cards summarize burden and approved requests for each physician.</div>';
      } else if(active.key === 'locums'){
        main.innerHTML = renderLocumCoverage(st);
        inspector.innerHTML = '<div class="detail-box">Locums are not in the automatic pooled call algorithm. Admin can assign them manually where they explicitly volunteered.</div>';
      } else if(active.key === 'exports'){
        main.innerHTML = renderExports(st, summary);
        inspector.innerHTML = '<div class="detail-box">Export the current draft master schedule, night schedule, or fairness table as Excel-ready CSV files.</div>';
        bindExports();
      } else if(active.key === 'publish'){
        main.innerHTML = renderPublishReview(st, summary);
        inspector.innerHTML = '<div class="detail-box">Publish copies Draft Schedule to Published Schedule as a snapshot. Drafts can continue changing afterward.</div>';
        bindPublishReview();
      }
    }

    attachTabBehavior(redraw);
    bindAdminTopActions(redraw);
    redraw('overview');
  }

  function renderAdminSummaryBar(){
    const state = S();
    const counts = computeSummaryCounts(state);
    el('#summaryBar').innerHTML = `
      <div class="summary-grid">
        <div class="card stat-card"><h3>Status</h3><div class="stat-value">${state.publishedWeeks?.length ? 'Draft + Published' : 'Draft Only'}</div><div class="stat-sub">${counts.scheduleRange}</div></div>
        <div class="card stat-card"><h3>Unresolved Requests</h3><div class="stat-value">${counts.unresolvedRequests}</div><div class="stat-sub">Needs review</div></div>
        <div class="card stat-card"><h3>Published Blocks</h3><div class="stat-value">${(state.publishHistory||[]).length}</div><div class="stat-sub">Total fairness tracker</div></div>
        <div class="card stat-card"><h3>Unfilled Assignments</h3><div class="stat-value">${counts.unfilledAssignments}</div><div class="stat-sub">Weekly + call</div></div>
        <div class="card stat-card"><h3>Warnings</h3><div class="stat-value">${counts.warnings}</div><div class="stat-sub">Validation flags</div></div>
        <div class="card stat-card"><h3>Last Generated</h3><div class="stat-value" style="font-size:15px">${safe(fmtDateTime(state.metadata.lastGeneratedAt))}</div><div class="stat-sub">Draft schedule</div></div>
        <div class="card stat-card"><h3>Last Published</h3><div class="stat-value" style="font-size:15px">${safe(fmtDateTime(state.metadata.lastPublishedAt))}</div><div class="stat-sub">Published snapshot</div></div>
      </div>`;
  }

  function renderAdminOverview(state, summary){
    const validation = summary.validation || [];
    const topIssues = validation.slice(0,8);
    const coveragePct = state.draftWeeks?.length ? Math.round(100 * ((serviceRows.length * state.draftWeeks.length + (state.draftNightManual||[]).length - computeSummaryCounts(state).unfilledAssignments) / ((serviceRows.length * state.draftWeeks.length) + (state.draftNightManual||[]).length || 1))) : 0;
    return `
      <div class="panel-grid">
        <div class="stack">
          <div class="card">
            <div class="section-title"><h2>Overview</h2>${badge(`${coveragePct}% coverage`, coveragePct > 95 ? 'good' : coveragePct > 80 ? 'warn':'bad')}</div>
            <div class="card-grid-2">
              <div class="quick-card"><strong>Coverage Completion</strong><div class="small">Tracks filled weekly assignments and call dates in the draft.</div></div>
              <div class="quick-card"><strong>Pending Requests</strong><div class="small">${(state.requests||[]).filter(r => r.status !== 'approved' && r.status !== 'denied').length} still need review.</div></div>
              <div class="quick-card"><strong>Conflicts</strong><div class="small">${validation.filter(v => v.level==='error').length} errors and ${validation.filter(v => v.level!=='error').length} warnings.</div></div>
              <div class="quick-card"><strong>Fairness Snapshot</strong><div class="small">See category burden table in the Fairness section.</div></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Top Warnings</h2></div>
          <div class="notice-list">
            ${topIssues.length ? topIssues.map(v => `<div class="notice ${v.level}">${safe(v.message)} ${v.weekStart ? `<span class="small">${safe(v.weekStart)}</span>`:''} ${v.date ? `<span class="small">${safe(v.date)}</span>`:''}</div>`).join('') : '<div class="notice">No current warnings.</div>'}
          </div>
        </div>
      </div>`;
  }

  function renderOverviewInspector(state, summary){
    const fairness = (summary.fairnessSummary||[]).slice(0,6);
    return `
      <div class="detail-box">
        <strong>Schedule Status</strong>
        <div class="kv" style="margin-top:10px">
          <div>Range</div><div>${safe(state.settings.scheduleStart || '—')} to ${safe(state.settings.scheduleEnd || '—')}</div>
          <div>Draft Weeks</div><div>${(state.draftWeeks||[]).length}</div>
          <div>Published Weeks</div><div>${(state.publishedWeeks||[]).length}</div>
        </div>
      </div>
      <div class="detail-box">
        <strong>Lowest Current Burden</strong>
        <div class="list" style="margin-top:10px">
          ${fairness.map(f => `<div class="list-item"><strong>${safe(f.name)}</strong><div class="small">Composite ${f.compositeScore} · ICU ${f.icuWeeks} · Weekends ${f.weekends} · Nights ${f.nightCalls}</div></div>`).join('') || '<div class="small">Generate a draft to see fairness.</div>'}
        </div>
      </div>`;
  }

  function renderMasterSchedule(state){
    const weeks = state.draftWeeks || [];
    if(!weeks.length) return `<div class="card"><strong>No draft schedule yet.</strong><div class="small">Generate a schedule from the top bar to populate the master schedule.</div></div>`;
    const cols = ['ICU','GIM','CAR1','CAR2','Resp','Nephro','OP1','OP2','OP3','Echo','Weekend'];
    return `
      <div class="card">
        <div class="section-title"><h2>Master Weekly Schedule</h2>${badge(`${weeks.length} weeks`)}</div>
        <div class="table-wrap fit-master"><table>
          <thead>
            <tr>
              <th class="service-col">Week</th>
              ${cols.map(service => `<th class="service-header service-${service}">${safe(service)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${weeks.map(w => `<tr>
              <td class="week-row-label">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                  <div>
                    <div>${safe(fmtDate(w.weekStart))}</div>
                    <div class="small">${safe(w.weekStart)}</div>
                  </div>
                  <span class="lock-toggle" title="Lock week" data-lock-week="${w.weekStart}">${w.locked ? '🔒' : '🔓'}</span>
                </div>
              </td>
              ${cols.map(service => {
                const owner = service === 'Weekend' ? w.weekendOwner : w.services[service];
                const pinned = !!(w.pinnedServices && w.pinnedServices[service]);
                const cls = `${!owner ? 'unfilled' : ''} service-cell service-${service} ${pinned ? 'pinned' : ''}`;
                return `<td class="assign-cell ${cls}" data-week="${w.weekStart}" data-target="${service}">
                  <div class="cell-inner">
                    ${chipForOwner(state, owner, service === 'Weekend' ? 'weekend' : '')}
                    <span class="pin-toggle" title="Pin assignment" data-pin="${w.weekStart}|${service}">${pinned ? '📌' : '📍'}</span>
                  </div>
                </td>`;
              }).join('')}
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
  }

  function bindMasterSchedule(){
    els('[data-jump]').forEach(btn => btn.addEventListener('click', () => {
      const target = btn.dataset.jump;
      const b = el(`.side-nav button[data-tab="${target}"]`);
      if(b) b.click();
    }));
    els('[data-lock-week]').forEach(lock => lock.addEventListener('click', e => {
      e.stopPropagation();
      const weekStart = lock.dataset.lockWeek;
      const state = S();
      const week = state.draftWeeks.find(w => w.weekStart === weekStart);
      if(!week) return;
      week.locked = !week.locked;
      state.generatedSummary = window.SchedulerEngine.recomputeDraftSummary(state);
      window.AppState.saveState(state);
      renderAdmin();
      const tab = el('.side-nav button[data-tab="master"]'); if(tab) tab.click();
    }));
    els('[data-pin]').forEach(pin => pin.addEventListener('click', e => {
      e.stopPropagation();
      const [weekStart, target] = pin.dataset.pin.split('|');
      const state = S();
      const week = state.draftWeeks.find(w => w.weekStart === weekStart);
      if(!week) return;
      week.pinnedServices = week.pinnedServices || {};
      week.pinnedServices[target] = !week.pinnedServices[target];
      state.generatedSummary = window.SchedulerEngine.recomputeDraftSummary(state);
      window.AppState.saveState(state);
      renderAdmin();
      const tab = el('.side-nav button[data-tab="master"]'); if(tab) tab.click();
    }));
    els('.assign-cell').forEach(cell => cell.addEventListener('click', e => {
      if(e.target.closest('[data-pin]') || e.target.closest('.inline-cell-editor')) return;
      const state = S();
      const week = state.draftWeeks.find(w => w.weekStart === cell.dataset.week);
      const target = cell.dataset.target;
      if(!week) return;
      if(week.locked){
        alert('This week is locked. Unlock it first to change assignments.');
        return;
      }
      const everyone = [...state.physicians, ...state.locums].sort((a,b) => a.name.localeCompare(b.name));
      const currentOwner = target === 'Weekend' ? week.weekendOwner : week.services[target];
      cell.dataset.originalHtml = cell.innerHTML;
      cell.innerHTML = `
        <div class="inline-cell-editor">
          <select class="field inline-cell-select">
            <option value="">Leave Unfilled</option>
            ${everyone.map(p => `<option value="${p.id}" ${p.id===currentOwner?'selected':''}>${safe(p.name)}${p.type==='locum' ? (p.initials ? ` (${safe(p.initials)})` : ' (Locum)') : ''}</option>`).join('')}
          </select>
          <div class="inline-actions" style="margin-top:6px;justify-content:center">
            <button class="btn primary inline-save">Save</button>
            <button class="btn inline-cancel">Cancel</button>
          </div>
        </div>`;
      cell.querySelector('.inline-cancel').onclick = ev => {
        ev.stopPropagation();
        cell.innerHTML = cell.dataset.originalHtml || '';
        bindMasterSchedule();
      };
      cell.querySelector('.inline-save').onclick = ev => {
        ev.stopPropagation();
        const ownerId = cell.querySelector('.inline-cell-select').value;
        const fresh = S();
        window.SchedulerEngine.applyWeekOverride(fresh, week.weekStart, target, ownerId);
        renderAdmin();
        const tab = el('.side-nav button[data-tab="master"]'); if(tab) tab.click();
      };
    }));
  }

  function renderNightCalendar(state){
    const nights = state.draftNightManual || [];
    if(!nights.length) return `<div class="card"><strong>No night call draft yet.</strong></div>`;
    const months = Array.from(new Set(nights.map(n => n.date.slice(0,7))));
    return months.map(month => renderMonth(state, month, nights.filter(n => n.date.startsWith(month)))).join('');
  }

  function renderMonth(state, month, entries){
    const first = new Date(month + '-01T12:00:00');
    const startPad = first.getDay();
    const last = new Date(first.getFullYear(), first.getMonth()+1, 0, 12);
    const days = [];
    for(let i=0;i<startPad;i++) days.push(null);
    for(let d=1; d<=last.getDate(); d++){
      const date = `${month}-${String(d).padStart(2,'0')}`;
      days.push(entries.find(e => e.date === date) || { date, owner:'', weekend:[0,6].includes(new Date(date+'T12:00:00').getDay()) });
    }
    while(days.length % 7) days.push(null);
    return `
      <div class="calendar-month" style="margin-bottom:14px">
        <div class="month-title">${safe(first.toLocaleDateString(undefined,{month:'long',year:'numeric'}))}</div>
        <div class="month-grid">
          ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="day-head">${d}</div>`).join('')}
          ${days.map(day => {
            if(!day) return '<div class="day-cell"></div>';
            const p = peopleMap(state)[day.owner];
            const cls = `${day.weekend?'weekend':''} ${!day.owner?'unfilled':''}`;
            return `<div class="day-cell ${cls}" data-night-date="${day.date}">
              <div class="day-num">${safe(day.date.slice(-2))}</div>
              <div>${day.owner ? `<span class="day-owner ${p?.type==='locum'?'locum':''} ${day.weekend?'weekend':''}">${safe(p?.name || day.owner)}</span>` : '<span class="day-owner">Unfilled</span>'}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function bindNightCalendar(){
    els('[data-night-date]').forEach(cell => cell.addEventListener('click', e => {
      if(e.target.closest('.inline-cell-editor')) return;
      const state = S();
      const entry = state.draftNightManual.find(n => n.date === cell.dataset.nightDate) || { date: cell.dataset.nightDate, owner:'', weekend:false };
      const relatedWeek = state.draftWeeks.find(w => w.weekStart === entry.weekStart || w.weekendStart === entry.date || w.weekendEnd === entry.date);
      if(relatedWeek?.locked){
        alert('This week is locked. Unlock it first to change call assignments.');
        return;
      }
      const everyone = [...state.physicians, ...state.locums].sort((a,b) => a.name.localeCompare(b.name));
      cell.dataset.originalHtml = cell.innerHTML;
      cell.innerHTML = `
        <div class="day-num">${safe(entry.date.slice(-2))}</div>
        <div class="inline-cell-editor" style="margin-top:4px">
          <select class="field inline-cell-select">
            <option value="">Leave Unfilled</option>
            ${everyone.map(p => `<option value="${p.id}" ${p.id===entry.owner?'selected':''}>${safe(p.name)}${p.type==='locum' ? (p.initials ? ` (${safe(p.initials)})` : ' (Locum)') : ''}</option>`).join('')}
          </select>
          <div class="inline-actions" style="margin-top:6px;justify-content:center">
            <button class="btn primary inline-save">Save</button>
            <button class="btn inline-cancel">Cancel</button>
          </div>
        </div>`;
      cell.querySelector('.inline-cancel').onclick = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        renderAdmin();
        const tab = el('.side-nav button[data-tab="night"]'); if(tab) tab.click();
      };
      cell.querySelector('.inline-save').onclick = ev => {
        ev.stopPropagation();
        const ownerId = cell.querySelector('.inline-cell-select').value;
        const fresh = S();
        window.SchedulerEngine.applyNightOverride(fresh, entry.date, ownerId);
        renderAdmin();
        const tab = el('.side-nav button[data-tab="night"]'); if(tab) tab.click();
      };
    }));
  }

  function renderRequestsAdmin(state){
    const people = peopleMap(state);
    const start = state.settings?.scheduleStart || '';
    const end = state.settings?.scheduleEnd || '';
    const inRange = (state.requests || []).filter(r => {
      if(!start || !end) return true;
      return !(r.endDate < start || r.startDate > end);
    });
    return `
      <div class="card">
        <div class="section-title"><h2>Requests</h2>${badge(`${inRange.length} in range`)}</div>
        <div class="list">
          ${inRange.length ? inRange.map(r => `<div class="list-item">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
              <div><strong>${safe(people[r.personId]?.name || r.personId)}</strong> · ${safe(requestLabel(r.type))}<div class="small">${safe(r.startDate)} to ${safe(r.endDate)}</div></div>
              <div class="inline-actions">
                ${badge(r.status || 'approved', r.status==='approved'?'good':r.status==='denied'?'bad':'warn')}
                ${r.status==='denied'
                  ? `<button class="btn" data-req-act="approved" data-req-id="${r.id}">Reinstate</button>`
                  : `<button class="btn" data-req-act="denied" data-req-id="${r.id}">Reject</button>`}
              </div>
            </div>
          </div>`).join('') : '<div class="list-item">No requests within the current schedule range.</div>'}
        </div>
      </div>`;
  }

  function bindRequestAdmin(){
    els('[data-req-act]').forEach(btn => btn.addEventListener('click', () => {
      const state = S();
      const req = state.requests.find(r => r.id === btn.dataset.reqId);
      if(!req) return;
      req.status = btn.dataset.reqAct;
      window.AppState.upsertRequest(req);
      renderAdmin();
      const tab = el('.side-nav button[data-tab="requests"]'); if(tab) tab.click();
    }));
  }

  
  function fairnessNoteForRow(r){
    return r.id==='DC' ? '0.5 weeks/weekends/call' : (r.id==='BB' ? '0.8 ICU/weekends/call' : '1.0');
  }

  function emptyFairnessDisplayRow(id, name){
    return {
      id, name: name || id,
      serviceCounts:{ ICU:0, GIM:0, CAR1:0, CAR2:0, OP1:0, OP2:0, OP3:0, Resp:0, Nephro:0, Echo:0 },
      nightCalls:0, weekends:0
    };
  }

  
  function currentScheduleYearUI(state){
    const start = state?.settings?.scheduleStart || '';
    return /^\d{4}/.test(start) ? start.slice(0,4) : '';
  }

  function buildYearlyPublishedFairness(state){
    const year = currentScheduleYearUI(state);
    const map = {};
    (state.publishHistory || []).forEach(entry => {
      const entryYear = (entry?.start || '').slice(0,4);
      if(year && entryYear !== year) return;
      (entry.fairnessSummary || []).forEach(row => {
        const cur = map[row.id] || emptyFairnessDisplayRow(row.id, row.name);
        cur.name = row.name || cur.name || row.id;
        Object.keys(cur.serviceCounts).forEach(service => {
          cur.serviceCounts[service] = (cur.serviceCounts[service] || 0) + (row.serviceCounts?.[service] || 0);
        });
        cur.nightCalls = (cur.nightCalls || 0) + (row.nightCalls || 0);
        cur.weekends = (cur.weekends || 0) + (row.weekends || 0);
        map[row.id] = cur;
      });
    });
    return map;
  }

  function buildTotalFairnessRows(state, summary){
    const map = {};
    Object.values(state.fairnessCarryForward || {}).forEach(row => {
      map[row.id] = JSON.parse(JSON.stringify(row));
    });
    (summary?.fairnessSummary || []).forEach(row => {
      const cur = map[row.id] || emptyFairnessDisplayRow(row.id, row.name);
      cur.name = row.name || cur.name || row.id;
      Object.keys(cur.serviceCounts).forEach(service => {
        cur.serviceCounts[service] = (cur.serviceCounts[service] || 0) + (row.serviceCounts?.[service] || 0);
      });
      cur.nightCalls = (cur.nightCalls || 0) + (row.nightCalls || 0);
      cur.weekends = (cur.weekends || 0) + (row.weekends || 0);
      map[row.id] = cur;
    });
    return Object.values(map).sort((a,b) => a.id.localeCompare(b.id));
  }

  function renderTotalFairness(state, summary){
    const rows = buildTotalFairnessRows(state, summary);
    const services = ['ICU','GIM','CAR1','CAR2','OP1','OP2','OP3','Resp','Nephro'];
    return `
      <div class="stack">
        <div class="card">
          <div class="section-title"><h2>Yearly Fairness</h2>${badge(`${currentScheduleYearUI(state) || 'Current'} year`)}</div>
          <div class="small">Published blocks from the same calendar year plus the current draft.</div>
        </div>
        <div class="card">
          <div class="table-wrap"><table class="fairness-tight">
            <thead>
              <tr>
                <th>Physician</th>
                <th>FTE Notes</th>
                ${services.map(s => `<th class="service-${s}">${safe(s)}</th>`).join('')}
                <th>Yearly Major Weeks</th>
                <th>Yearly Weekday Call</th>
                <th>Yearly Weekend Call</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const majorTotal = services.reduce((sum,s)=>sum + (r.serviceCounts?.[s] || 0), 0);
                return `<tr>
                  <td><strong>${safe(r.name || r.id)}</strong></td>
                  <td class="small">${safe(fairnessNoteForRow(r))}</td>
                  ${services.map(s => `<td>${r.serviceCounts?.[s] || 0}</td>`).join('')}
                  <td>${majorTotal}</td>
                  <td>${r.nightCalls || 0}</td>
                  <td>${r.weekends || 0}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>
        </div>
      </div>`;
  }

  function renderFairness(state, summary){
    const rows = summary.fairnessSummary || [];
    const services = ['ICU','GIM','CAR1','CAR2','OP1','OP2','OP3','Resp','Nephro'];
    return `
      <div class="card">
        <div class="section-title"><h2>Fairness</h2>${badge('Detailed by service')}</div>
        <div class="table-wrap"><table class="fairness-tight">
          <thead>
            <tr>
              <th>Physician</th>
              <th>FTE Notes</th>
              ${services.map(s => `<th class="service-${s}">${safe(s)}</th>`).join('')}
              <th>Major Weeks</th>
              <th>Weekday Call</th>
              <th>Weekend Call</th>
              <th>Composite</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const note = r.id==='DC' ? '0.5 weeks/weekends/call' : (r.id==='BB' ? '0.8 ICU/weekends/call' : '1.0');
              const majorTotal = services.reduce((sum,s)=>sum + (r.serviceCounts?.[s] || 0), 0);
              return `<tr>
                <td><strong>${safe(r.name)}</strong></td>
                <td class="small">${safe(note)}</td>
                ${services.map(s => `<td>${r.serviceCounts?.[s] || 0}</td>`).join('')}
                <td>${majorTotal}</td>
                <td>${r.nightCalls} <span class="small">(${r.weighted.nightCalls})</span></td>
                <td>${r.weekends} <span class="small">(${r.weighted.weekends})</span></td>
                <td><strong>${safe(String(r.compositeScore))}</strong></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>`;
  }

  
  function csvEscape(value){
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }
  function downloadCsv(filename, rows){
    const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  function buildMasterScheduleRows(state){
    const weeks = state.draftWeeks || [];
    const cols = ['Week Start','Week End','ICU','GIM','CAR1','CAR2','Resp','Nephro','OP1','OP2','OP3','Echo','Weekend','Locked'];
    const rows = [cols];
    weeks.forEach(w => {
      rows.push([
        w.weekStart || '',
        w.weekEnd || '',
        w.services?.ICU || '',
        w.services?.GIM || '',
        w.services?.CAR1 || '',
        w.services?.CAR2 || '',
        w.services?.Resp || '',
        w.services?.Nephro || '',
        w.services?.OP1 || '',
        w.services?.OP2 || '',
        w.services?.OP3 || '',
        w.services?.Echo || '',
        w.weekendOwner || '',
        w.locked ? 'Yes' : 'No'
      ]);
    });
    return rows;
  }
  function buildNightScheduleRows(state){
    const nights = state.draftNightManual || [];
    const rows = [['Date','Week Start','Owner','Type']];
    nights.forEach(n => rows.push([n.date || '', n.weekStart || '', n.owner || '', n.weekend ? 'Weekend' : 'Weekday Night']));
    return rows;
  }
  function buildFairnessRows(summary){
    const rows = [['Physician','FTE Notes','ICU','GIM','CAR1','CAR2','OP1','OP2','OP3','Resp','Nephro','Major Weeks','Weekday Call','Weekday Call Weighted','Weekend Call','Weekend Call Weighted','Composite']];
    (summary.fairnessSummary || []).forEach(r => {
      const note = r.id==='DC' ? '0.5 weeks/weekends/call' : (r.id==='BB' ? '0.8 ICU/weekends/call' : '1.0');
      const services = ['ICU','GIM','CAR1','CAR2','OP1','OP2','OP3','Resp','Nephro'];
      const majorTotal = services.reduce((sum,s)=>sum + (r.serviceCounts?.[s] || 0), 0);
      rows.push([
        r.name || r.id || '',
        note,
        r.serviceCounts?.ICU || 0,
        r.serviceCounts?.GIM || 0,
        r.serviceCounts?.CAR1 || 0,
        r.serviceCounts?.CAR2 || 0,
        r.serviceCounts?.OP1 || 0,
        r.serviceCounts?.OP2 || 0,
        r.serviceCounts?.OP3 || 0,
        r.serviceCounts?.Resp || 0,
        r.serviceCounts?.Nephro || 0,
        majorTotal,
        r.nightCalls || 0,
        r.weighted?.nightCalls || 0,
        r.weekends || 0,
        r.weighted?.weekends || 0,
        r.compositeScore || 0
      ]);
    });
    return rows;
  }
  function renderExports(state, summary){
    const start = state.settings?.scheduleStart || 'schedule';
    const end = state.settings?.scheduleEnd || 'range';
    return `
      <div class="card">
        <div class="section-title"><h2>Exports</h2>${badge('Excel-ready CSV')}</div>
        <div class="list">
          <div class="list-item">
            <div><strong>Master Schedule</strong><div class="small">Exports the full weekly assignment grid.</div></div>
            <button class="btn primary" id="exportMasterBtn">Export Master Schedule</button>
          </div>
          <div class="list-item">
            <div><strong>Night Call Schedule</strong><div class="small">Exports all weekday and weekend call dates.</div></div>
            <button class="btn primary" id="exportNightBtn">Export Night Schedule</button>
          </div>
          <div class="list-item">
            <div><strong>Fairness</strong><div class="small">Exports physician fairness totals and weighted call/weekend burden.</div></div>
            <button class="btn primary" id="exportFairnessBtn">Export Fairness</button>
          </div>
        </div>
        <div class="detail-box" style="margin-top:14px">Files download as CSV and open directly in Excel.</div>
      </div>`;
  }
  function bindExports(){
    const state = S();
    const summary = ensureSummary(state);
    const start = state.settings?.scheduleStart || 'schedule';
    const end = state.settings?.scheduleEnd || 'range';
    const base = `${start}_to_${end}`;
    const master = el('#exportMasterBtn');
    const night = el('#exportNightBtn');
    const fairness = el('#exportFairnessBtn');
    if(master) master.onclick = () => downloadCsv(`master_schedule_${base}.csv`, buildMasterScheduleRows(state));
    if(night) night.onclick = () => downloadCsv(`night_schedule_${base}.csv`, buildNightScheduleRows(state));
    if(fairness) fairness.onclick = () => downloadCsv(`fairness_${base}.csv`, buildFairnessRows(summary));
  }

function renderOverrides(state){
    return `
      <div class="card">
        <div class="section-title"><h2>Overrides</h2><button class="btn" id="clearOverridesOnly">Clear Log</button></div>
        <div class="list">
          ${(state.overrideLog||[]).length ? state.overrideLog.map(o => `<div class="list-item"><strong>${safe(o.kind)}</strong><div class="small code">${safe(o.context)}</div><div class="small">${safe(o.fromOwner || 'Unfilled')} → ${safe(o.toOwner || 'Unfilled')}</div><div class="small">${safe(fmtDateTime(o.timestamp))}</div></div>`).join('') : '<div class="list-item">No overrides yet.</div>'}
        </div>
      </div>`;
  }
  function bindOverrides(){ const b = el('#clearOverridesOnly'); if(b) b.onclick = () => { const st=S(); st.overrideLog=[]; window.AppState.saveState(st); renderAdmin(); const tab=el('.side-nav button[data-tab="overrides"]'); if(tab) tab.click(); }; }

  function renderPhysicianSummary(state, summary){
    const requestsByPerson = {};
    (state.requests||[]).filter(r => r.status === 'approved').forEach(r => { requestsByPerson[r.personId] = (requestsByPerson[r.personId] || 0) + 1; });
    return `<div class="selector-grid">${(summary.fairnessSummary||[]).map(r => `<div class="card"><div class="section-title"><h2>${safe(r.name)}</h2>${badge(`Score ${r.compositeScore}`)}</div><div class="small">Approved requests: ${requestsByPerson[r.id] || 0}</div><div class="small">Weekly services ${r.weeklyServices} · ICU ${r.icuWeeks}</div><div class="small">Weekends ${r.weekends} · Nights ${r.nightCalls}</div></div>`).join('')}</div>`;
  }

  function renderLocumCoverage(state){
    return `<div class="stack">
      ${state.locums.map(l => `
        <div class="card">
          <div class="section-title">
            <h2>${safe(l.name)}</h2>
            ${badge(l.generalLocum ? 'General Locum' : `Covering ${l.coveringPhysician || 'Unassigned'}`, l.generalLocum ? 'locum' : 'warn')}
          </div>
          <div class="selector-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
            <div class="detail-box">
              <strong>Availability</strong>
              <div class="small" style="margin-top:8px">Coverage weeks: ${(l.weeklyCoverage||[]).length}</div>
              <div class="small">Weekday call dates: ${(l.callDates||[]).length}</div>
              <div class="small">Weekend dates: ${(l.weekendDates||[]).length}</div>
              <div class="small">Initials: ${safe(l.initials || '—')}</div>
            </div>
            <div class="detail-box">
              <strong>Physician Here For</strong>
              <div class="small" style="margin-top:8px">${safe(l.generalLocum ? 'General locum' : (l.coveringPhysician || 'Unassigned'))}</div>
            </div>
            <div class="detail-box" style="grid-column:1 / -1">
              <strong>Services Covered</strong>
              <div class="small" style="margin-top:8px">
                ${(l.weeklyCoverage||[]).length ? (l.weeklyCoverage||[]).map(e => `${safe(e.weekStart)}: ${safe((e.services||[]).join(', ') || 'None')}`).join('<br>') : 'No weekly coverage entered.'}
              </div>
            </div>
            <div class="detail-box">
              <strong>Calls Covered</strong>
              <div class="small" style="margin-top:8px">${(l.callDates||[]).length ? safe((l.callDates||[]).join(', ')) : 'No call dates selected.'}</div>
            </div>
            <div class="detail-box">
              <strong>Weekends Covered</strong>
              <div class="small" style="margin-top:8px">${(l.weekendDates||[]).length ? safe((l.weekendDates||[]).join(', ')) : 'No weekend dates selected.'}</div>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
  }

  function renderPublishReview(state, summary){
    const validation = summary.validation || [];
    return `
      <div class="panel-grid">
        <div class="card">
          <div class="section-title"><h2>Final Review</h2>${badge(`${validation.length} flags`, validation.some(v => v.level==='error')?'bad':'warn')}</div>
          <div class="notice-list">${validation.length ? validation.map(v => `<div class="notice ${v.level}">${safe(v.message)}</div>`).join('') : '<div class="notice">No warnings.</div>'}</div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Publish</h2></div>
          <p class="small">Publishing copies Draft Schedule to Published Schedule as a snapshot. You cannot publish the same date range more than once unless you first undo that publish.</p>
          <div class="inline-actions">
            <button class="btn success" id="publishNowBtn">Finalize and Publish</button>
            <button class="btn" id="unpublishCurrentRangeBtn">Undo Publish for This Date Range</button>
          </div>
        </div>
      </div>`;
  }
  function bindPublishReview(){
    const b = el('#publishNowBtn');
    if(b) b.onclick = () => {
      const state = S();
      const start = state.settings?.scheduleStart || '';
      const end = state.settings?.scheduleEnd || '';
      if(window.AppState.publishRangeExists && window.AppState.publishRangeExists(state, start, end)){
        alert('A published schedule already exists for this exact date range. Undo that publish first if you want to republish changes.');
        return;
      }
      window.AppState.publishDraft();
      renderAdmin();
      alert('Published schedule snapshot saved.');
    };

    const u = el('#unpublishCurrentRangeBtn');
    if(u) u.onclick = () => {
      const state = S();
      const start = state.settings?.scheduleStart || '';
      const end = state.settings?.scheduleEnd || '';
      if(!(window.AppState.publishRangeExists && window.AppState.publishRangeExists(state, start, end))){
        alert('There is no published schedule for this exact date range.');
        return;
      }
      window.AppState.unpublishCurrentRange();
      renderAdmin();
      alert('Published schedule removed for this date range. You can now republish changes.');
    };
  }

  function bindAdminTopActions(redraw){
    el('#generateBtn').onclick = () => {
      const start = el('#adminStart').value, end = el('#adminEnd').value;
      if(!start || !end) return alert('Choose both start and end dates.');
      window.SchedulerEngine.persistGeneratedDraft(start, end, { stable:false });
      redraw('overview');
    };
    if(el('#stableGenerateBtn')) el('#stableGenerateBtn').onclick = () => {
      const start = el('#adminStart').value, end = el('#adminEnd').value;
      if(!start || !end) return alert('Choose both start and end dates.');
      window.SchedulerEngine.persistGeneratedDraft(start, end, { stable:true });
      redraw('overview');
    };
    el('#clearDraftBtn').onclick = () => {
      const state = S(); state.draftWeeks=[]; state.draftNightManual=[]; state.generatedSummary={fairnessSummary:[],validation:[]}; window.AppState.saveState(state); redraw('overview');
    };
    el('#reloadBtn').onclick = () => renderAdmin();
    el('#publishBtn').onclick = () => { window.AppState.publishDraft(); redraw('overview'); alert('Published schedule snapshot saved.'); };
  }

  function renderDateStrip(container, dates, selection, mode='range'){
    container.innerHTML = `<div class="request-strip">${dates.map(d => {
      const cls = selection.single === d ? 'single' : selection.start === d || selection.end === d ? 'active' : selection.range?.includes(d) ? 'in-range' : '';
      const dt = new Date(d+'T12:00:00');
      return `<button type="button" class="date-pill ${cls}" data-date-pill="${d}"><small>${dt.toLocaleDateString(undefined,{weekday:'short'})}</small>${dt.getDate()}</button>`;
    }).join('')}</div>`;
    els('[data-date-pill]').forEach(btn => btn.addEventListener('click', () => {
      const d = btn.dataset.datePill;
      if(mode === 'single'){
        selection.single = selection.single === d ? '' : d;
      } else {
        if(!selection.start || (selection.start && selection.end)){
          selection.start = d; selection.end = ''; selection.range = [d];
        } else {
          if(d < selection.start){ selection.end = selection.start; selection.start = d; }
          else selection.end = d;
          selection.range = dateRangeStrings(selection.start, selection.end);
        }
      }
      renderDateStrip(container, dates, selection, mode);
      if(container.dataset.onchange) window[container.dataset.onchange]?.();
    }));
  }

  function dateRangeStrings(start, end){
    const out=[]; let cur = new Date(start+'T12:00:00'); const stop = new Date(end+'T12:00:00');
    while(cur <= stop){ out.push(window.SchedulerEngine.iso(cur)); cur = window.SchedulerEngine.addDays(cur,1); }
    return out;
  }

  function getPortalBase(title, subtitle, tabs, inspector='Details'){
    document.body.innerHTML = baseShell(title, subtitle, tabs, inspector);
  }

  function renderPhysician(){
    const state = S();
    const currentId = (window.AppPrefs.get('schedPhysicianSelected') || state.physicians[0].id);
    const tabs = [['schedule','Master Schedule'],['calls','Night Call'],['request','Submit Request'],['history','Request History']].map((x,i)=>({key:x[0],label:x[1],active:i===0}));
    getPortalBase('Physician Portal','View assignments and submit requests',tabs,null);
    const inspector = document.querySelector('.inspector'); if(inspector) inspector.remove();
    const shell = document.querySelector('.page-shell'); if(shell) shell.style.gridTemplateColumns = '240px minmax(0,1fr)';
    const myWeeksOnly = window.AppPrefs.get('physMyWeeksOnly') === '1';
    el('#topActions').innerHTML = `<div class="top-inputs"><label>Physician</label><select id="physicianSelect">${state.physicians.map(p => `<option value="${p.id}" ${p.id===currentId?'selected':''}>${p.name}</option>`).join('')}</select><label style="display:inline-flex;align-items:center;gap:8px;margin-left:8px"><input type="checkbox" id="physMyWeeksOnly" ${myWeeksOnly?'checked':''}> My Weeks Only</label></div>`;
    renderPhysicianSummaryBar(currentId);
    let active = window.AppPrefs.get('physActiveTab') || 'schedule';
    attachTabBehavior(tab => { active=tab; window.AppPrefs.set('physActiveTab', tab); draw(); });
    setTimeout(() => { const btn = el(`.side-nav button[data-tab="${active}"]`); if(btn) btn.click(); }, 0);
    el('#physicianSelect').onchange = e => { window.AppPrefs.set('schedPhysicianSelected', e.target.value); renderPhysician(); };
    if(el('#physMyWeeksOnly')) el('#physMyWeeksOnly').onchange = e => { window.AppPrefs.set('physMyWeeksOnly', e.target.checked ? '1' : '0'); renderPhysician(); const tab=el('.side-nav button[data-tab="schedule"]'); if(tab) tab.click(); };
    function draw(){
      const fresh = S(); const pid = window.AppPrefs.get('schedPhysicianSelected') || currentId;
      if(active==='schedule'){
        el('#mainContent').innerHTML = renderPhysicianSchedule(fresh,pid);
        
      } else if(active==='calls'){
        el('#mainContent').innerHTML = renderPhysicianCalls(fresh,pid);
        
      } else if(active==='request'){
        el('#mainContent').innerHTML = renderPhysicianRequestForm(fresh,pid);
        
        bindPhysicianRequestForm(pid);
      } else if(active==='history'){
        el('#mainContent').innerHTML = renderPhysicianHistory(fresh,pid);
        els('[data-cancel-request]').forEach(btn => btn.addEventListener('click', () => {
          window.AppState.removeRequest(btn.dataset.cancelRequest);
          window.AppPrefs.set('physActiveTab', 'history');
          renderPhysician();
        }));
      }
    }
    draw();
  }

  function renderPhysicianSummaryBar(pid){
    const state = S();
    const summary = ensureSummary(state).fairnessSummary || [];
    const row = summary.find(r => r.id===pid) || {weeklyServices:0,icuWeeks:0,weekends:0,nightCalls:0,compositeScore:0};
    const approved = (state.requests||[]).filter(r => r.personId===pid && r.status==='approved').length;
    el('#summaryBar').innerHTML = `
      <div class="summary-grid" style="grid-template-columns:repeat(5,1fr)">
        <div class="card stat-card"><h3>Composite Score</h3><div class="stat-value">${row.compositeScore}</div></div>
        <div class="card stat-card"><h3>Weekly Services</h3><div class="stat-value">${row.weeklyServices}</div></div>
        <div class="card stat-card"><h3>ICU Weeks</h3><div class="stat-value">${row.icuWeeks}</div></div>
        <div class="card stat-card"><h3>Weekends</h3><div class="stat-value">${row.weekends}</div></div>
        <div class="card stat-card"><h3>Approved Requests</h3><div class="stat-value">${approved}</div></div>
      </div>`;
  }

  function renderPhysicianSchedule(state,pid){
    const baseWeeks = (state.publishedWeeks?.length ? state.publishedWeeks : state.draftWeeks) || [];
    if(!baseWeeks.length) return `<div class="card"><strong>No schedule available yet.</strong></div>`;
    const cols = ['ICU','GIM','CAR1','CAR2','Resp','Nephro','OP1','OP2','OP3','Echo','Weekend'];
    const myWeeksOnly = window.AppPrefs.get('physMyWeeksOnly') === '1';
    const weeks = myWeeksOnly
      ? baseWeeks.filter(w => cols.some(service => {
          const owner = service === 'Weekend' ? w.weekendOwner : w.services[service];
          return owner === pid;
        }))
      : baseWeeks;
    return `
      <div class="card">
        <div class="section-title"><h2>Master Schedule</h2>${badge('Read only')}</div>
        <div class="table-wrap fit-master"><table>
          <thead>
            <tr>
              <th class="service-col">Week</th>
              ${cols.map(service => `<th class="service-header service-${service}">${safe(service)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${weeks.map(w => `<tr class="${cols.some(service => ((service === 'Weekend' ? w.weekendOwner : w.services[service]) === pid)) ? 'my-week-row' : ''}">
              <td class="week-row-label"><div>${safe(fmtDate(w.weekStart))}</div><div class="small">${safe(w.weekStart)}</div></td>
              ${cols.map(service => {
                const owner = service === 'Weekend' ? w.weekendOwner : w.services[service];
                const mine = owner === pid ? 'mine' : '';
                return `<td class="service-cell service-${service} ${mine}">${chipForOwner(state, owner, service === 'Weekend' ? 'weekend' : '')}</td>`;
              }).join('')}
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
  }
  function renderPhysicianCalls(state,pid){
    const nights = (state.publishedNightManual?.length ? state.publishedNightManual : state.draftNightManual) || [];
    if(!nights.length) return `<div class="card"><strong>No night call schedule available yet.</strong></div>`;
    const months = Array.from(new Set(nights.map(n => n.date.slice(0,7))));
    const byDate = Object.fromEntries(nights.map(n => [n.date, n]));
    const myByMonth = Object.fromEntries(months.map(m => [m, nights.filter(n => n.owner===pid && n.date.slice(0,7)===m).length]));
    return `<div class="stack">
      <div class="card">
        <div class="section-title"><h2>My Call Count by Month</h2>${badge('Read only')}</div>
        <div class="selector-grid">
          ${months.map(monthKey => `<div class="card stat-card"><h3>${safe(monthLabel(monthKey))}</h3><div class="stat-value">${myByMonth[monthKey] || 0}</div><div class="stat-sub">Total calls</div></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="section-title"><h2>Night Call Calendar</h2>${badge('Read only')}</div>
        <div class="calendar-months">
          ${months.map(monthKey => renderMonthCalendar(monthKey, (dateStr, day) => {
            const entry = byDate[dateStr];
            const weekend = entry?.weekend;
            const mine = entry?.owner === pid;
            const cls = ['day-cell', weekend ? 'weekend' : '', mine ? 'mine' : ''].join(' ').trim();
            const label = entry ? chipForOwner(state, entry.owner, weekend ? 'weekend' : '') : '<span class="small">—</span>';
            return `<div class="${cls}"><span class="day-num">${day}</span>${label}<span class="day-note">${entry ? (weekend ? 'Weekend call' : 'Night call') : ''}</span></div>`;
          })).join('')}
        </div>
      </div>
    </div>`;
  }
  function renderPhysicianHistory(state,pid){
    const mine = (state.requests||[]).filter(r => r.personId===pid).sort((a,b)=>b.startDate.localeCompare(a.startDate));
    return `<div class="card"><div class="section-title"><h2>Request History</h2></div><div class="list">${mine.length ? mine.map(r => `<div class="list-item"><strong>${safe(requestLabel(r.type))}</strong><div class="small">${safe(r.startDate)} to ${safe(r.endDate)}</div><div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${badge(r.status || 'approved', r.status==='approved'?'good':r.status==='denied'?'bad':'warn')}<button class="btn warn" data-cancel-request="${r.id}">Cancel Request</button></div></div>`).join('') : '<div class="list-item">No requests submitted yet.</div>'}</div></div>`;
  }
  function renderPhysicianInspector(state,pid){
    const p = physicianMap(state)[pid];
    return `<div class="detail-box"><strong>${safe(p.name)}</strong><div class="small">Eligible services: ${(p.services||[]).join(', ')}</div></div>`;
  }
  function renderPhysicianRequestForm(state,pid){
    const start = state.settings.scheduleStart || window.SchedulerEngine.iso(new Date());
    const end = state.settings.scheduleEnd || window.SchedulerEngine.iso(window.SchedulerEngine.addDays(window.SchedulerEngine.parseDate(start), 90));
    const months = monthKeysBetween(start, end);
    const currentMonth = window.AppPrefs.get('physReqMonth') || months[0];
    return `<div class="card">
      <div class="section-title"><h2>Submit Request</h2></div>
      <div class="selector-grid physician-request-top">
        <div>
          <label class="small">Request Type</label>
          <select id="physReqType" class="field" style="width:100%">${allRequestTypes().map(t=>`<option value="${t}">${requestLabel(t)}</option>`).join('')}</select>
        </div>
        <div class="inline-date-fields">
          <div>
            <label class="small">Selected Start</label>
            <input id="physReqStart" class="field" type="date" style="width:100%" readonly>
          </div>
          <div>
            <label class="small">Selected End</label>
            <input id="physReqEnd" class="field" type="date" style="width:100%" readonly>
          </div>
        </div>
      </div>
      <div style="margin-top:14px">
        <div class="section-title">
          <h2>Choose Dates</h2>
          <div class="inline-actions">
            <button class="btn" id="physPrevMonth">← Prev</button>
            <div class="detail-chip">${safe(monthLabel(currentMonth))}</div>
            <button class="btn" id="physNextMonth">Next →</button>
            <button class="btn" id="clearPhysRange">Clear Range</button>
          </div>
        </div>
        <div class="detail-box">Click a start date, then click an end date. The selected request range will highlight across the calendar.</div>
        <div id="physMonthCalendar" class="calendar-months single-month" style="margin-top:14px">
          ${renderMonthCalendar(currentMonth, (dateStr, day) => {
            const dt = new Date(dateStr+'T12:00:00');
            const weekend = [0,6].includes(dt.getDay());
            return `<button type="button" class="day-cell clickable ${weekend ? 'weekend-muted' : ''}" data-phys-date="${dateStr}"><span class="day-num">${day}</span></button>`;
          })}
        </div>
      </div>
      <div class="inline-actions physician-save-row" style="margin-top:14px"><button class="btn primary" id="savePhysReq">Save Request</button></div>
    </div>`;
  }
  function bindPhysicianRequestForm(pid){
    const state = S();
    const start = state.settings.scheduleStart || window.SchedulerEngine.iso(new Date());
    const end = state.settings.scheduleEnd || window.SchedulerEngine.iso(window.SchedulerEngine.addDays(window.SchedulerEngine.parseDate(start), 90));
    const months = monthKeysBetween(start, end);
    const selection = {start:'', end:'', range:[]};

    function applyVisuals(){
      els('[data-phys-date]').forEach(btn => {
        const d = btn.dataset.physDate;
        btn.classList.remove('single-selected','range-selected');
        if(selection.start === d && (!selection.end || selection.end === selection.start)){
          btn.classList.add('single-selected');
        }
        if(selection.range.includes(d)){
          btn.classList.add('range-selected');
        }
      });
      el('#physReqStart').value = selection.start || '';
      el('#physReqEnd').value = selection.end || selection.start || '';
    }

    els('[data-phys-date]').forEach(btn => btn.onclick = () => {
      const d = btn.dataset.physDate;
      if(!selection.start || (selection.start && selection.end)){
        selection.start = d;
        selection.end = '';
        selection.range = [d];
      } else {
        if(d < selection.start){
          selection.end = selection.start;
          selection.start = d;
        } else {
          selection.end = d;
        }
        selection.range = dateRangeStrings(selection.start, selection.end);
      }
      applyVisuals();
    });

    const currentMonth = window.AppPrefs.get('physReqMonth') || months[0];
    const idx = months.indexOf(currentMonth);

    el('#physPrevMonth').onclick = () => {
      const nextIdx = Math.max(0, idx - 1);
      window.AppPrefs.set('physReqMonth', months[nextIdx]);
      window.AppPrefs.set('physActiveTab', 'request');
      renderPhysician();
    };
    el('#physNextMonth').onclick = () => {
      const nextIdx = Math.min(months.length - 1, idx + 1);
      window.AppPrefs.set('physReqMonth', months[nextIdx]);
      window.AppPrefs.set('physActiveTab', 'request');
      renderPhysician();
    };

    el('#clearPhysRange').onclick = () => {
      selection.start = '';
      selection.end = '';
      selection.range = [];
      applyVisuals();
    };

    el('#savePhysReq').onclick = () => {
      const startDate = el('#physReqStart').value;
      const endDate = el('#physReqEnd').value || startDate;
      if(!startDate || !endDate) return alert('Choose a start and end date.');
      window.AppState.upsertRequest({
        id:`req-${Date.now()}`,
        personId:pid,
        type:el('#physReqType').value,
        startDate:startDate,
        endDate:endDate,
        status:'approved',
        createdAt:new Date().toISOString()
      });
      alert('Request saved.');
      window.AppPrefs.set('physActiveTab', 'request');
      renderPhysician();
    };

    applyVisuals();
  }

  function renderLocum(){
    const state = S();
    const currentId = window.AppPrefs.get('schedLocumSelected') || state.locums[0].id;
    const tabs = [['coverage','Coverage Weeks'],['calls','Call Dates'],['weekends','Weekend Dates'],['summary','Summary']].map((x,i)=>({key:x[0],label:x[1],active:i===0}));
    getPortalBase('Locum Portal','Set weekly coverage and explicit call availability',tabs,'Locum Details');
    const selected = state.locums.find(l => l.id === currentId) || state.locums[0];
    el('#topActions').innerHTML = `<div class="top-inputs"><label>Locum</label><select id="locumSelect">${state.locums.map(l => `<option value="${l.id}" ${l.id===selected.id?'selected':''}>${l.name}</option>`).join('')}</select><label>Initials</label><input id="locumInitials" class="field" type="text" maxlength="4" value="${safe(selected.initials || '')}" placeholder="e.g. AB" style="width:90px"><button class="btn" id="saveLocumInitials">Save Initials</button></div>`;
    renderLocumSummaryBar(selected);
    let active='coverage';
    attachTabBehavior(tab => { active=tab; draw(); });
    el('#locumSelect').onchange = e => { window.AppPrefs.set('schedLocumSelected', e.target.value); renderLocum(); };
    if(el('#saveLocumInitials')) el('#saveLocumInitials').onclick = () => {
      const value = (el('#locumInitials')?.value || '').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);
      window.AppState.saveLocum(selected.id, { initials:value });
      alert('Locum initials saved.');
      renderLocum();
    };
    function draw(){
      const fresh = S(); const loc = fresh.locums.find(l => l.id === (window.AppPrefs.get('schedLocumSelected') || currentId)) || fresh.locums[0];
      if(active==='coverage'){
        el('#mainContent').innerHTML = renderLocumCoverageEditor(fresh, loc);
        
        bindLocumCoverageEditor(loc.id);
      } else if(active==='calls'){
        el('#mainContent').innerHTML = renderLocumCallEditor(fresh, loc);
        
        bindLocumCallEditor(loc.id);
      } else if(active==='weekends'){
        el('#mainContent').innerHTML = renderLocumWeekendEditor(fresh, loc);
        
        bindLocumWeekendEditor(loc.id);
      } else if(active==='summary'){
        el('#mainContent').innerHTML = renderLocumSummaryPage(fresh, loc);
        
      }
    }
    draw();
  }
  function renderLocumSummaryBar(loc){
    el('#summaryBar').innerHTML = `
      <div class="summary-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="card stat-card"><h3>Coverage Type</h3><div class="stat-value" style="font-size:18px">${loc.generalLocum ? 'General Locum' : `Covering ${safe(loc.coveringPhysician || 'Physician')}`}</div></div>
        <div class="card stat-card"><h3>Call Initials</h3><div class="stat-value" style="font-size:18px">${safe(loc.initials || '—')}</div></div>
        <div class="card stat-card"><h3>Coverage Weeks</h3><div class="stat-value">${(loc.weeklyCoverage||[]).length}</div></div>
        <div class="card stat-card"><h3>Call Dates</h3><div class="stat-value">${(loc.callDates||[]).length}</div></div>
        <div class="card stat-card"><h3>Weekend Dates</h3><div class="stat-value">${(loc.weekendDates||[]).length}</div></div>
      </div>`;
  }
  function getUpcomingWeeks(state){ return window.SchedulerEngine.getWeeks(state.settings.scheduleStart || window.SchedulerEngine.iso(new Date()), state.settings.scheduleEnd || window.SchedulerEngine.iso(window.SchedulerEngine.addDays(new Date(), 56))); }
  function monthLabel(monthKey){
    const [y,m] = monthKey.split('-').map(Number);
    return new Date(y, m-1, 1).toLocaleDateString(undefined,{month:'long',year:'numeric'});
  }
  function monthKeysBetween(startStr, endStr){
    const start = window.SchedulerEngine.parseDate(startStr);
    const end = window.SchedulerEngine.parseDate(endStr);
    const out = [];
    let y = start.getFullYear(), m = start.getMonth();
    while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())){
      out.push(`${y}-${String(m+1).padStart(2,'0')}`);
      m += 1;
      if(m > 11){ m = 0; y += 1; }
    }
    return out;
  }
  function renderMonthCalendar(monthKey, buildCell){
    const [y,m] = monthKey.split('-').map(Number);
    const first = new Date(y, m-1, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    let html = `<div class="month-card"><div class="month-header">${safe(monthLabel(monthKey))}</div><div class="month-grid">`;
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => { html += `<div class="day-head">${d}</div>`; });
    for(let i=0;i<startDow;i++) html += `<div class="day-cell muted"></div>`;
    for(let day=1; day<=daysInMonth; day++){
      const dateStr = `${monthKey}-${String(day).padStart(2,'0')}`;
      html += buildCell(dateStr, day);
    }
    html += `</div></div>`;
    return html;
  }
  function renderLocumCoverageEditor(state, loc){
    const weeks = getUpcomingWeeks(state);
    const start = state.settings.scheduleStart || weeks[0]?.weekStart || window.SchedulerEngine.iso(new Date());
    const end = state.settings.scheduleEnd || weeks[weeks.length-1]?.weekEnd || window.SchedulerEngine.iso(window.SchedulerEngine.addDays(new Date(),56));
    const monthKeys = monthKeysBetween(start, end);
    const currentMonth = window.AppPrefs.get('locCoverageMonth') || monthKeys[0];
    const selectedMap = Object.fromEntries((loc.weeklyCoverage||[]).map(x => [x.weekStart, x.services || []]));
    const weekByDate = {};
    weeks.forEach(w => {
      let cur = window.SchedulerEngine.parseDate(w.weekStart);
      for(let i=0;i<5;i++){
        weekByDate[window.SchedulerEngine.iso(cur)] = w.weekStart;
        cur = window.SchedulerEngine.addDays(cur,1);
      }
    });
    return `<div class="card">
      <div class="section-title"><h2>Weekly Service Coverage</h2></div>
      <div class="selector-grid">
        <div><label class="small">Coverage Type</label><select id="locumGeneralType" class="field" style="width:100%"><option value="general" ${loc.generalLocum?'selected':''}>General Locum</option><option value="covering" ${!loc.generalLocum?'selected':''}>Covering for Specific Physician</option></select></div>
        <div ${loc.generalLocum?'class="hidden"':''} id="coveringWrap"><label class="small">Covering Physician</label><select id="coveringPhysician" class="field" style="width:100%">${state.physicians.map(p => `<option value="${p.id}" ${loc.coveringPhysician===p.id?'selected':''}>${p.name}</option>`).join('')}</select></div>
      </div>
      <div class="section-title" style="margin-top:14px">
        <h2>Choose Coverage Weeks</h2>
        <div class="inline-actions">
          <button class="btn" id="locCovPrevMonth">← Prev</button>
          <div class="detail-chip">${safe(monthLabel(currentMonth))}</div>
          <button class="btn" id="locCovNextMonth">Next →</button>
        </div>
      </div>
      <div class="detail-box">Click any weekday in the calendar to select that Monday to Friday week. Then choose the service coverage below.</div>
      <div id="locumCoverageCalendar" class="calendar-months single-month" style="margin-top:14px">${renderMonthCalendar(currentMonth, (dateStr, day) => {
        const weekStart = weekByDate[dateStr];
        const selected = weekStart && selectedMap[weekStart];
        const weekend = [0,6].includes(new Date(dateStr+'T12:00:00').getDay());
        const cls = ['day-cell', weekend ? 'weekend-muted' : '', weekStart ? 'clickable' : 'disabled', selected ? 'range-selected' : ''].join(' ').trim();
        const serviceText = selected ? `<span class="day-note">${safe((selected||[]).join(', '))}</span>` : '';
        return `<button type="button" class="${cls}" data-loc-coverage-date="${dateStr}" ${weekStart ? '' : 'disabled'}><span class="day-num">${day}</span>${serviceText}</button>`;
      })}</div>
      <div id="locumCoverageSelections" style="margin-top:14px"></div>
      <div class="inline-actions" style="margin-top:14px"><button class="btn primary" id="saveLocumCoverage">Save Coverage</button></div>
    </div>`;
  }
  function bindLocumCoverageEditor(locumId){
    const state = S();
    const weeks = getUpcomingWeeks(state);
    const start = state.settings.scheduleStart || weeks[0]?.weekStart || window.SchedulerEngine.iso(new Date());
    const end = state.settings.scheduleEnd || weeks[weeks.length-1]?.weekEnd || window.SchedulerEngine.iso(window.SchedulerEngine.addDays(new Date(),56));
    const monthKeys = monthKeysBetween(start, end);
    const currentMonth = window.AppPrefs.get('locCoverageMonth') || monthKeys[0];
    const currentIdx = monthKeys.indexOf(currentMonth);
    const loc = state.locums.find(l => l.id === locumId);
    const selectedMap = Object.fromEntries((loc.weeklyCoverage||[]).map(x => [x.weekStart, new Set(x.services||[])]));
    const weekByDate = {};
    weeks.forEach(w => {
      let cur = window.SchedulerEngine.parseDate(w.weekStart);
      for(let i=0;i<5;i++){
        weekByDate[window.SchedulerEngine.iso(cur)] = w.weekStart;
        cur = window.SchedulerEngine.addDays(cur,1);
      }
    });
    const typeSel = el('#locumGeneralType'); if(typeSel) typeSel.onchange = () => renderLocum();
    if(el('#locCovPrevMonth')) el('#locCovPrevMonth').onclick = () => {
      const nextIdx = Math.max(0, currentIdx - 1);
      window.AppPrefs.set('locCoverageMonth', monthKeys[nextIdx]);
      renderLocum(); const tab=el('.side-nav button[data-tab="coverage"]'); if(tab) tab.click();
    };
    if(el('#locCovNextMonth')) el('#locCovNextMonth').onclick = () => {
      const nextIdx = Math.min(monthKeys.length - 1, currentIdx + 1);
      window.AppPrefs.set('locCoverageMonth', monthKeys[nextIdx]);
      renderLocum(); const tab=el('.side-nav button[data-tab="coverage"]'); if(tab) tab.click();
    };
    function redrawSelections(){
      const wrap = el('#locumCoverageSelections');
      const selectedWeeks = weeks.filter(w => selectedMap[w.weekStart]);
      wrap.innerHTML = selectedWeeks.length ? selectedWeeks.map(w => `
        <div class="list-item coverage-row">
          <div><strong>${safe(w.weekStart)} to ${safe(w.weekEnd)}</strong><div class="small">Select services for this week</div></div>
          <div class="checkbox-grid">${serviceRows.filter(s => !['Echo','Weekend'].includes(s)).map(service => `<label class="check-card"><input type="checkbox" data-week-service="${w.weekStart}|${service}" ${selectedMap[w.weekStart].has(service)?'checked':''}> ${safe(service)}</label>`).join('')}</div>
        </div>`).join('') : '<div class="detail-box">No weeks selected yet.</div>';
      els('[data-week-service]').forEach(cb => cb.onchange = () => {
        const [week, service] = cb.dataset.weekService.split('|');
        if(!selectedMap[week]) selectedMap[week] = new Set();
        if(cb.checked) selectedMap[week].add(service); else selectedMap[week].delete(service);
      });
    }
    els('[data-loc-coverage-date]').forEach(btn => btn.onclick = () => {
      const dateStr = btn.dataset.locCoverageDate;
      const weekStart = weekByDate[dateStr];
      if(!weekStart) return;
      if(selectedMap[weekStart]) delete selectedMap[weekStart];
      else selectedMap[weekStart] = new Set();
      redrawSelections();
      els('[data-loc-coverage-date]').forEach(b => {
        const ws = weekByDate[b.dataset.locCoverageDate];
        b.classList.toggle('range-selected', !!(ws && selectedMap[ws]));
      });
    });
    redrawSelections();
    el('#saveLocumCoverage').onclick = () => {
      const current = S();
      const loc2 = current.locums.find(l => l.id === locumId);
      loc2.generalLocum = el('#locumGeneralType').value === 'general';
      loc2.coveringPhysician = loc2.generalLocum ? '' : (el('#coveringPhysician')?.value || '');
      loc2.weeklyCoverage = Object.entries(selectedMap)
        .map(([weekStart, services]) => ({ weekStart, services:[...services].sort() }))
        .filter(x => x.services.length);
      window.AppState.saveLocum(locumId, loc2);
      alert('Locum weekly coverage saved.');
      renderLocum();
      const tab=el('.side-nav button[data-tab="coverage"]'); if(tab) tab.click();
    };
  }
  function renderLocumCallEditor(state, loc){
    const start = state.settings.scheduleStart || window.SchedulerEngine.iso(new Date());
    const end = state.settings.scheduleEnd || window.SchedulerEngine.iso(window.SchedulerEngine.addDays(window.SchedulerEngine.parseDate(start), 56));
    const monthKeys = monthKeysBetween(start, end);
    const currentMonth = window.AppPrefs.get('locCallMonth') || monthKeys[0];
    const selected = new Set(loc.callDates || []);
    return `<div class="card">
      <div class="section-title"><h2>Weekday Call Dates</h2>
        <div class="inline-actions">
          <button class="btn" id="locCallPrevMonth">← Prev</button>
          <div class="detail-chip">${safe(monthLabel(currentMonth))}</div>
          <button class="btn" id="locCallNextMonth">Next →</button>
          <button class="btn" id="clearCallDates">Clear All</button>
        </div>
      </div>
      <div class="detail-box">Click weekday dates you are willing to cover. Weekend dates are managed separately.</div>
      <div id="locumCallStrip" class="calendar-months single-month" style="margin-top:14px">${renderMonthCalendar(currentMonth, (dateStr, day) => {
        const dow = new Date(dateStr+'T12:00:00').getDay();
        const weekday = ![0,6].includes(dow);
        const active = selected.has(dateStr);
        const cls = ['day-cell', weekday ? 'clickable' : 'disabled', active ? 'single-selected' : '', !weekday ? 'weekend-muted' : ''].join(' ').trim();
        return `<button type="button" class="${cls}" data-loc-call="${dateStr}" ${weekday ? '' : 'disabled'}><span class="day-num">${day}</span></button>`;
      })}</div>
      <div class="inline-actions" style="margin-top:14px"><button class="btn primary" id="saveLocumCalls">Save Call Dates</button></div>
    </div>`;
  }
  function bindLocumCallEditor(locumId){
    const state = S();
    const start = state.settings.scheduleStart || window.SchedulerEngine.iso(new Date());
    const end = state.settings.scheduleEnd || window.SchedulerEngine.iso(window.SchedulerEngine.addDays(window.SchedulerEngine.parseDate(start), 56));
    const monthKeys = monthKeysBetween(start, end);
    const currentMonth = window.AppPrefs.get('locCallMonth') || monthKeys[0];
    const currentIdx = monthKeys.indexOf(currentMonth);
    const selection = { singles:new Set((S().locums.find(l => l.id===locumId)?.callDates)||[]) };
    function redraw(){ els('[data-loc-call]').forEach(btn => { const d = btn.dataset.locCall; btn.classList.toggle('single-selected', selection.singles.has(d)); }); }
    els('[data-loc-call]').forEach(btn => btn.onclick = () => { const d=btn.dataset.locCall; if(selection.singles.has(d)) selection.singles.delete(d); else selection.singles.add(d); redraw(); });
    redraw();
    if(el('#locCallPrevMonth')) el('#locCallPrevMonth').onclick = () => {
      const nextIdx = Math.max(0, currentIdx - 1);
      window.AppPrefs.set('locCallMonth', monthKeys[nextIdx]);
      renderLocum(); const tab=el('.side-nav button[data-tab="calls"]'); if(tab) tab.click();
    };
    if(el('#locCallNextMonth')) el('#locCallNextMonth').onclick = () => {
      const nextIdx = Math.min(monthKeys.length - 1, currentIdx + 1);
      window.AppPrefs.set('locCallMonth', monthKeys[nextIdx]);
      renderLocum(); const tab=el('.side-nav button[data-tab="calls"]'); if(tab) tab.click();
    };
    el('#clearCallDates').onclick = () => { selection.singles.clear(); redraw(); };
    el('#saveLocumCalls').onclick = () => { window.AppState.saveLocum(locumId, { callDates:[...selection.singles].sort() }); alert('Locum call dates saved.'); renderLocum(); const tab=el('.side-nav button[data-tab="calls"]'); if(tab) tab.click(); };
  }
  function renderLocumWeekendEditor(state, loc){
    const start = state.settings.scheduleStart || window.SchedulerEngine.iso(new Date());
    const end = state.settings.scheduleEnd || window.SchedulerEngine.iso(window.SchedulerEngine.addDays(window.SchedulerEngine.parseDate(start), 56));
    const monthKeys = monthKeysBetween(start, end);
    const currentMonth = window.AppPrefs.get('locWeekendMonth') || monthKeys[0];
    const selected = new Set(loc.weekendDates || []);
    return `<div class="card">
      <div class="section-title"><h2>Weekend Call Dates</h2>
        <div class="inline-actions">
          <button class="btn" id="locWeekendPrevMonth">← Prev</button>
          <div class="detail-chip">${safe(monthLabel(currentMonth))}</div>
          <button class="btn" id="locWeekendNextMonth">Next →</button>
          <button class="btn" id="clearWeekendDates">Clear All</button>
        </div>
      </div>
      <div class="detail-box">Click a Saturday or Sunday to select the entire weekend. The stored weekend date is the Saturday start date.</div>
      <div id="locumWeekendStrip" class="calendar-months single-month" style="margin-top:14px">${renderMonthCalendar(currentMonth, (dateStr, day) => {
        const dt = new Date(dateStr+'T12:00:00');
        const dow = dt.getDay();
        let sat = '';
        if(dow === 6) sat = dateStr;
        else if(dow === 0){
          const prev = window.SchedulerEngine.addDays(dt,-1);
          sat = window.SchedulerEngine.iso(prev);
        }
        const weekend = dow === 6 || dow === 0;
        const active = sat && selected.has(sat);
        const cls = ['day-cell', weekend ? 'clickable weekend' : 'disabled', active ? 'range-selected' : ''].join(' ').trim();
        return `<button type="button" class="${cls}" data-loc-weekend="${sat}" ${weekend ? '' : 'disabled'}><span class="day-num">${day}</span>${dow===6?'<span class="day-note">Sat</span>':dow===0?'<span class="day-note">Sun</span>':''}</button>`;
      })}</div>
      <div class="inline-actions" style="margin-top:14px"><button class="btn primary" id="saveLocumWeekends">Save Call Dates</button></div>
    </div>`;
  }
  function bindLocumWeekendEditor(locumId){
    const state = S();
    const start = state.settings.scheduleStart || window.SchedulerEngine.iso(new Date());
    const end = state.settings.scheduleEnd || window.SchedulerEngine.iso(window.SchedulerEngine.addDays(window.SchedulerEngine.parseDate(start), 56));
    const monthKeys = monthKeysBetween(start, end);
    const currentMonth = window.AppPrefs.get('locWeekendMonth') || monthKeys[0];
    const currentIdx = monthKeys.indexOf(currentMonth);
    const selection = { singles:new Set((S().locums.find(l => l.id===locumId)?.weekendDates)||[]) };
    function redraw(){ els('[data-loc-weekend]').forEach(btn => { const d = btn.dataset.locWeekend; if(!d) return; btn.classList.toggle('range-selected', selection.singles.has(d)); }); }
    els('[data-loc-weekend]').forEach(btn => btn.onclick = () => { const d=btn.dataset.locWeekend; if(!d) return; if(selection.singles.has(d)) selection.singles.delete(d); else selection.singles.add(d); redraw(); });
    redraw();
    if(el('#locWeekendPrevMonth')) el('#locWeekendPrevMonth').onclick = () => {
      const nextIdx = Math.max(0, currentIdx - 1);
      window.AppPrefs.set('locWeekendMonth', monthKeys[nextIdx]);
      renderLocum(); const tab=el('.side-nav button[data-tab="weekends"]'); if(tab) tab.click();
    };
    if(el('#locWeekendNextMonth')) el('#locWeekendNextMonth').onclick = () => {
      const nextIdx = Math.min(monthKeys.length - 1, currentIdx + 1);
      window.AppPrefs.set('locWeekendMonth', monthKeys[nextIdx]);
      renderLocum(); const tab=el('.side-nav button[data-tab="weekends"]'); if(tab) tab.click();
    };
    el('#clearWeekendDates').onclick = () => { selection.singles.clear(); redraw(); };
    el('#saveLocumWeekends').onclick = () => { window.AppState.saveLocum(locumId, { weekendDates:[...selection.singles].sort() }); alert('Locum weekend dates saved.'); renderLocum(); const tab=el('.side-nav button[data-tab="weekends"]'); if(tab) tab.click(); };
  }
  function renderLocumSummaryPage(state, loc){
    return `<div class="panel-grid"><div class="card"><div class="section-title"><h2>Weekly Coverage</h2></div><div class="list">${(loc.weeklyCoverage||[]).length ? loc.weeklyCoverage.map(w => `<div class="list-item"><strong>${safe(w.weekStart)}</strong><div class="small">${safe((w.services||[]).join(', '))}</div></div>`).join('') : '<div class="list-item">No weekly service coverage selected.</div>'}</div></div><div class="stack"><div class="card"><div class="section-title"><h2>Weekday Call Dates</h2></div><div class="small">${(loc.callDates||[]).join(', ') || 'None selected'}</div></div><div class="card"><div class="section-title"><h2>Weekend Dates</h2></div><div class="small">${(loc.weekendDates||[]).join(', ') || 'None selected'}</div></div></div></div>`;
  }

  function renderMobile(){
    const state = S();
    const publishedWeeks = state.publishedWeeks?.length ? state.publishedWeeks : state.draftWeeks;
    const publishedNights = state.publishedNightManual?.length ? state.publishedNightManual : state.draftNightManual;
    document.body.innerHTML = `<div class="mobile-shell"><div class="brand">Department Scheduling</div><p class="subtitle">Read only mobile snapshot</p><div class="card-grid-2"><div class="card"><div class="section-title"><h2>Upcoming Weekends</h2></div><div class="list">${(publishedWeeks||[]).slice(0,6).map(w => `<div class="list-item"><strong>${safe(w.weekendStart)}</strong><div>${chipForOwner(state,w.weekendOwner,'weekend')}</div></div>`).join('') || '<div class="list-item">No schedule loaded.</div>'}</div></div><div class="card"><div class="section-title"><h2>Upcoming Night Calls</h2></div><div class="list">${(publishedNights||[]).filter(n=>!n.weekend).slice(0,10).map(n => `<div class="list-item"><strong>${safe(n.date)}</strong><div>${chipForOwner(state,n.owner)}</div></div>`).join('') || '<div class="list-item">No nights loaded.</div>'}</div></div></div><div class="card" style="margin-top:14px"><div class="section-title"><h2>Master Schedule Snapshot</h2></div>${renderMasterSchedule({ ...state, draftWeeks: publishedWeeks })}</div></div>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    try{
      if(PAGE==='index') renderIndex();
      else if(PAGE==='admin') renderAdmin();
      else if(PAGE==='physician') renderPhysician();
      else if(PAGE==='locum') renderLocum();
      else if(PAGE==='mobile') renderMobile();
      else renderIndex();
    }catch(err){
      console.error(err);
      document.body.innerHTML = `<div class="home-shell"><div class="brand">Department Scheduling</div><p class="subtitle">The page failed to render.</p><pre class="card">${safe(err.stack || String(err))}</pre></div>`;
    }
  });
})();

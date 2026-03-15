(function(){
  const config = {
    url: 'https://sptnpbtwlowhurtqhnqv.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwdG5wYnR3bG93aHVydHFobnF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MjAyMDksImV4cCI6MjA4ODQ5NjIwOX0.gksbgmiUoPVA-1N3KcIl59D4BhGAVFbw3d2lkjUXEbo',
    table: 'scheduler_state',
    rowId: 'global',
    pollIntervalMs: 15000
  };

  let lastSeenUpdatedAt = null;
  let pollHandle = null;
  let pushTimer = null;
  let pendingPayload = null;
  let inflightPush = null;
  let bootState = null;

  const prefStore = Object.create(null);

  window.AppPrefs = window.AppPrefs || {
    get(key){
      return Object.prototype.hasOwnProperty.call(prefStore, key) ? prefStore[key] : null;
    },
    set(key, value){
      prefStore[key] = String(value);
    },
    remove(key){
      delete prefStore[key];
    }
  };

  function configured(){
    return !!(config.url && config.anonKey && config.table && config.rowId);
  }

  function headers(extra){
    return Object.assign({
      'apikey': config.anonKey,
      'Authorization': 'Bearer ' + config.anonKey,
      'Content-Type': 'application/json'
    }, extra || {});
  }

  function rowUrl(selectClause){
    const select = selectClause || 'id,state,updated_at';
    return `${config.url}/rest/v1/${config.table}?id=eq.${encodeURIComponent(config.rowId)}&select=${encodeURIComponent(select)}`;
  }

  function isMeaningfulState(value){
    if(value == null) return false;
    if(Array.isArray(value)) return value.length > 0;
    if(typeof value !== 'object') return true;
    if(Object.keys(value).length === 0) return false;
    return Object.values(value).some(v => {
      if(v == null) return false;
      if(Array.isArray(v)) return v.length > 0;
      if(typeof v === 'object') return Object.keys(v).length > 0;
      if(typeof v === 'string') return v !== '';
      return true;
    });
  }

  function safeJsonParse(raw){
    if(!raw) return null;
    try{ return JSON.parse(raw); }catch(err){ return null; }
  }


  async function fetchRow(){
    if(!configured()) return null;
    try{
      const resp = await fetch(rowUrl(), {
        method: 'GET',
        headers: headers()
      });
      if(!resp.ok){
        const text = await resp.text().catch(() => '');
        console.error('Supabase fetch failed', resp.status, text);
        return { __fetchError: true, status: resp.status, body: text };
      }
      const data = await resp.json();
      return Array.isArray(data) ? (data[0] || null) : (data || null);
    }catch(error){
      console.error('Supabase fetch failed', error);
      return { __fetchError: true, error: String(error) };
    }
  }

  async function upsertStateObject(stateObj){
    if(!configured()) return null;
    const payload = [{ id: config.rowId, state: stateObj || {}, updated_at: new Date().toISOString() }];
    try{
      const resp = await fetch(`${config.url}/rest/v1/${config.table}?on_conflict=id`, {
        method: 'POST',
        headers: headers({
          'Prefer': 'resolution=merge-duplicates,return=representation'
        }),
        body: JSON.stringify(payload)
      });
      if(!resp.ok){
        const text = await resp.text().catch(() => '');
        console.error('Supabase upsert failed', resp.status, text);
        return { __upsertError: true, status: resp.status, body: text };
      }
      const data = await resp.json();
      return Array.isArray(data) ? (data[0] || null) : (data || null);
    }catch(error){
      console.error('Supabase upsert failed', error);
      return { __upsertError: true, error: String(error) };
    }
  }

  async function ensureRow(storageKey){
    const existing = await fetchRow();
    if(existing?.__fetchError) return null;

    const remoteState = existing?.state;
    const remoteMeaningful = isMeaningfulState(remoteState);

    if(existing && remoteMeaningful) return existing;

    if(existing) return existing;

    const created = await upsertStateObject({});
    if(created && !created.__upsertError) return created;
    return null;
  }

  async function hydrateLocalState(storageKey){
    if(!configured()) return false;
    const row = await ensureRow(storageKey);
    if(!row || row.__fetchError || row.__upsertError) return false;
    bootState = row.state || {};
    lastSeenUpdatedAt = row.updated_at || null;
    return true;
  }

  async function pushNow(storageKey, payload){
    if(!configured()) return false;
    const parsed = typeof payload === 'string' ? safeJsonParse(payload) : payload;
    if(!parsed || typeof parsed !== 'object') return false;
    inflightPush = (async () => {
      const data = await upsertStateObject(parsed);
      if(!data || data.__upsertError) return false;
      lastSeenUpdatedAt = data.updated_at || new Date().toISOString();
      bootState = JSON.parse(JSON.stringify(parsed));
      return true;
    })();
    const result = await inflightPush;
    inflightPush = null;
    return result;
  }

  function queuePush(storageKey, payload){
    if(!configured()) return;
    pendingPayload = payload;
    if(pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      const nextPayload = pendingPayload;
      pendingPayload = null;
      await pushNow(storageKey, nextPayload);
    }, 400);
  }

  async function pullLatest(storageKey, onRemoteApplied){
    if(!configured()) return false;
    if(inflightPush) return false;
    const row = await fetchRow();
    if(!row || row.__fetchError || !row.updated_at) return false;
    if(lastSeenUpdatedAt && row.updated_at <= lastSeenUpdatedAt) return false;
    const remoteState = row.state || {};
    const currentRaw = bootState ? JSON.stringify(bootState) : null;
    const remoteRaw = JSON.stringify(remoteState);
    bootState = JSON.parse(remoteRaw);
    lastSeenUpdatedAt = row.updated_at;
    if(remoteRaw !== currentRaw && typeof onRemoteApplied === 'function') onRemoteApplied(row);
    return remoteRaw !== currentRaw;
  }

  function startPolling(storageKey, onRemoteApplied){
    if(!configured() || pollHandle) return;
    pollHandle = setInterval(() => {
      pullLatest(storageKey, onRemoteApplied).catch(err => console.error('Supabase poll failed', err));
    }, config.pollIntervalMs);
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'visible'){
        pullLatest(storageKey, onRemoteApplied).catch(err => console.error('Supabase visibility sync failed', err));
      }
    });
  }

  function getBootState(){
    return bootState ? JSON.parse(JSON.stringify(bootState)) : null;
  }

  function setBootState(stateObj){
    if(stateObj && typeof stateObj === 'object') bootState = JSON.parse(JSON.stringify(stateObj));
    else bootState = null;
  }

  window.SCHEDULER_SUPABASE_CONFIG = config;
  window.SchedulerCloud = {
    configured,
    hydrateLocalState,
    queuePush,
    pullLatest,
    startPolling,
    getBootState,
    setBootState,
    pushNow,
    fetchRow
  };
})();

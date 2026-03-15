(function(){
  const config = {
    url: 'https://sptnpbtwlowhurtqhnqv.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwdG5wYnR3bG93aHVydHFobnF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MjAyMDksImV4cCI6MjA4ODQ5NjIwOX0.gksbgmiUoPVA-1N3KcIl59D4BhGAVFbw3d2lkjUXEbo',
    table: 'scheduler_state',
    rowId: 'global',
    pollIntervalMs: 15000
  };

  function configured(){
    return !!(window.supabase && config.url && config.anonKey &&
      config.url !== 'PASTE_YOUR_SUPABASE_PROJECT_URL_HERE' &&
      config.anonKey !== 'PASTE_YOUR_SUPABASE_ANON_KEY_HERE');
  }

  let client = null;
  let lastSeenUpdatedAt = null;
  let pollHandle = null;
  let pushTimer = null;
  let pendingPayload = null;
  let inflightPush = null;
  let bootState = null;

  function getClient(){
    if(!configured()) return null;
    if(!client) client = window.supabase.createClient(config.url, config.anonKey);
    return client;
  }

  async function fetchRow(){
    const c = getClient();
    if(!c) return null;
    const { data, error } = await c
      .from(config.table)
      .select('id, state, updated_at')
      .eq('id', config.rowId)
      .maybeSingle();
    if(error){
      console.error('Supabase fetch failed', error);
      return { __fetchError: true };
    }
    return data || null;
  }

  async function ensureRow(storageKey){
    const c = getClient();
    if(!c) return null;
    const existing = await fetchRow();
    if(existing?.__fetchError) return null;
    if(existing) return existing;

    let localValue = null;
    try{ localValue = localStorage.getItem(storageKey); }catch(e){}
    let state = {};
    if(localValue){
      try{ state = JSON.parse(localValue); }catch(e){ state = {}; }
    }
    const payload = { id: config.rowId, state: state, updated_at: new Date().toISOString() };
    const { data, error } = await c.from(config.table).upsert(payload).select('id, state, updated_at').single();
    if(error){
      console.error('Supabase initial upsert failed', error);
      return null;
    }
    return data || null;
  }

  async function hydrateLocalState(storageKey){
    if(!configured()) return false;
    const row = await ensureRow(storageKey);
    if(!row || row.__fetchError) return false;
    bootState = row.state || {};
    const remoteRaw = JSON.stringify(bootState);
    try{ localStorage.setItem(storageKey, remoteRaw); }catch(e){}
    lastSeenUpdatedAt = row.updated_at || null;
    return true;
  }

  async function pushNow(storageKey, payload){
    const c = getClient();
    if(!c) return false;
    inflightPush = (async () => {
      const parsed = JSON.parse(payload);
      const { data, error } = await c
        .from(config.table)
        .upsert({ id: config.rowId, state: parsed, updated_at: new Date().toISOString() })
        .select('updated_at')
        .single();
      if(error){
        console.error('Supabase save failed', error);
        return false;
      }
      lastSeenUpdatedAt = data?.updated_at || new Date().toISOString();
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
    bootState = row.state || {};
    const remoteRaw = JSON.stringify(bootState);
    let currentRaw = null;
    try{ currentRaw = localStorage.getItem(storageKey); }catch(e){}
    try{ localStorage.setItem(storageKey, remoteRaw); }catch(e){}
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

  window.SCHEDULER_SUPABASE_CONFIG = config;
  window.SchedulerCloud = {
    configured,
    hydrateLocalState,
    queuePush,
    pullLatest,
    startPolling,
    getBootState
  };
})();

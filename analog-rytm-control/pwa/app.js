// app.js — auto-renders the Analog Rytm control surface from midi-map.js and
// streams {channel, value} to the bridge (or straight to Web MIDI).
//
// Tabs are the 12 drum tracks + 'auto' (active track) + 'fx' + 'perf'. Each tab
// renders the param set for its scope; the wire-channel id encodes the scope so
// the bridge knows which MIDI channel to use. See ../midi-map.js / ../RYTM-MIDI.md.
(function () {
  const CFG = window.RYTM_CONFIG;
  const MAP = window.RYTM_MIDI_MAP;
  const statusEl = document.getElementById('status');

  let send = () => {};
  const outChannels = MAP.expandChannels();

  // Per-channel value memory (normalised 0..1). Survives tab switches and is
  // what presets snapshot/restore. emit() records then forwards to transport.
  const state = {};
  function emit(channel, value) { state[channel] = value; send(channel, value); }

  function setStatus(t, cls) { statusEl.textContent = t; statusEl.className = cls || ''; }

  if (CFG.useWebMidi && navigator.requestMIDIAccess) initWebMidi();
  else initBridge();

  function resolveBridgeURL() {
    if (CFG.bridge) return normalize(CFG.bridge);
    const q = new URLSearchParams(location.search).get('bridge');
    if (q) return normalize(q);
    // code-server / PikaPods style path proxy: /proxy/<port>/
    const m = location.pathname.match(/\/proxy\/(\d+)\//);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (m) return `${proto}//${location.host}/proxy/${m[1]}/`;
    return `${proto}//${location.hostname}:8084`;
  }
  function normalize(s) {
    if (/^wss?:\/\//.test(s)) return s;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${s}`;
  }

  function initBridge() {
    let ws, retry = 0;
    function connect() {
      ws = new WebSocket(resolveBridgeURL());
      ws.onopen = () => { retry = 0; setStatus('connected', 'ok'); };
      ws.onclose = () => { setStatus('reconnecting…', 'err'); setTimeout(connect, Math.min(2000, 250 * ++retry)); };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'hello') {
          setStatus(`connected · ${m.backend}`, 'ok');
          if (m.ports) renderPorts(m.ports);
          if (m.presets) renderPresets(m.presets);
        }
        if (m.type === 'ports') { renderPorts(m); setStatus(`connected · ${m.backend}`, 'ok'); }
        if (m.type === 'presets') renderPresets(m.presets);
      };
    }
    connect();
    send = (channel, value) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ channel, value })); };
  }

  function initWebMidi() {
    const D = MAP.defaults;
    function midiChannelFor(def) {
      switch (def.scope) {
        case 'track': return D.trackChannels[def.track - 1];
        case 'auto':  return D.autoChannel;
        case 'fx':    return D.fxChannel;
        case 'perf':  return D.perfChannel;
        default:      return D.autoChannel;
      }
    }
    navigator.requestMIDIAccess({ sysex: false }).then((access) => {
      const outs = [...access.outputs.values()];
      if (!outs.length) { setStatus('no MIDI output', 'err'); return; }
      const out = outs[0];
      setStatus(`Web MIDI · ${out.name}`, 'ok');
      send = (channel, value) => {
        const def = outChannels[channel];
        if (!def) return;
        const midiCh = midiChannelFor(def) - 1;
        const v = Math.max(0, Math.min(127, Math.round(value * 127)));
        out.send([0xB0 | midiCh, def.cc, v]);
      };
    }, () => setStatus('Web MIDI denied', 'err'));
  }

  // ---- UI build ----
  const tabsEl = document.getElementById('tabs');
  const surfaceEl = document.getElementById('surface');
  const pinnedEl = document.getElementById('pinned');
  let activeTab = CFG.tabs[0];

  function tabLabel(t) {
    if (t === 'auto') return 'AUTO';
    if (t === 'fx') return 'FX';
    if (t === 'perf') return 'PERF';
    return `${t} ${MAP.VOICES[t - 1] || ''}`.trim();
  }

  // params + channel-id prefix for a given tab
  function tabSpec(t) {
    if (t === 'fx')   return { params: MAP.FX_PARAMS,   prefix: 'fx/' };
    if (t === 'perf') return { params: MAP.PERF_PARAMS, prefix: 'perf/' };
    if (t === 'auto') return { params: MAP.TRACK_PARAMS, prefix: 'auto/' };
    return { params: MAP.TRACK_PARAMS, prefix: `t${t}/` };
  }

  function makeControl(channel, def, label) {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    if (def.toggle) {
      const b = document.createElement('button');
      b.className = 'btn'; b.textContent = label;
      let on = (state[channel] ?? 0) >= 0.5;
      b.classList.toggle('on', on);
      b.onclick = () => { on = !on; b.classList.toggle('on', on); emit(channel, on ? 1 : 0); };
      wrap.appendChild(b);
    } else {
      const lab = document.createElement('label');
      const init = state[channel] ?? (def.bipolar ? 0.5 : 0);   // restore prior position
      const cc0 = Math.round(init * 127);
      lab.innerHTML = `<span>${label}</span><span class="val">${def.bipolar ? cc0 - 64 : cc0}</span>`;
      const r = document.createElement('input');
      r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.0079;
      r.value = init;
      const valEl = lab.querySelector('.val');
      r.oninput = () => {
        const cc = Math.round(r.value * 127);
        valEl.textContent = def.bipolar ? (cc - 64) : cc;
        emit(channel, parseFloat(r.value));
      };
      wrap.appendChild(lab); wrap.appendChild(r);
    }
    return wrap;
  }

  function renderTab(t) {
    surfaceEl.innerHTML = '';
    const { params, prefix } = tabSpec(t);
    const groups = {};
    for (const p of params) (groups[p.group] = groups[p.group] || []).push(p);
    for (const g of Object.keys(groups)) {
      const section = document.createElement('div');
      section.className = 'group';
      section.innerHTML = `<h2>${g}</h2>`;
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const p of groups[g]) grid.appendChild(makeControl(prefix + p.id, p, p.label));
      section.appendChild(grid);
      surfaceEl.appendChild(section);
    }
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const t of CFG.tabs) {
      const b = document.createElement('button');
      b.className = 'tab' + (t === activeTab ? ' active' : '');
      b.textContent = tabLabel(t);
      b.onclick = () => { activeTab = t; renderTabs(); renderTab(t); };
      tabsEl.appendChild(b);
    }
  }

  function renderPinned() {
    pinnedEl.innerHTML = '';
    for (const ch of CFG.pinned) {
      const def = outChannels[ch];
      if (!def) continue;
      const el = makeControl(ch, def, def.label);
      el.classList.add('pin');
      pinnedEl.appendChild(el);
    }
  }

  renderTabs(); renderTab(activeTab); renderPinned();

  // ---- MIDI output port picker (bridge mode only) ----
  const selOut = document.getElementById('sel-out');
  function fillSelect(sel, names, current) {
    if (!sel) return;
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '__none__'; none.textContent = '— none —';
    sel.appendChild(none);
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      if (n === current) o.selected = true;
      sel.appendChild(o);
    }
    if (!current) none.selected = true;
  }
  function renderPorts(p) { fillSelect(selOut, p.outputs || [], p.outName); }
  if (selOut) {
    selOut.addEventListener('change', async () => {
      const st = await (await fetch('/ports', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ out: selOut.value }),
      })).json();
      renderPorts(st); setStatus(`connected · ${st.backend}`, 'ok');
    });
  }
  const portsRefresh = document.getElementById('ports-refresh');
  if (portsRefresh) portsRefresh.addEventListener('click', async () => {
    renderPorts(await (await fetch('/ports')).json());
  });

  // ---- presets (server-side; snapshot/restore every touched channel) ----
  const selPreset = document.getElementById('sel-preset');
  const presetName = document.getElementById('preset-name');
  function renderPresets(names) {
    if (!selPreset) return;
    const prev = selPreset.value;
    selPreset.innerHTML = '';
    if (!names.length) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = '— no presets —'; o.disabled = true;
      selPreset.appendChild(o);
    }
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      selPreset.appendChild(o);
    }
    if (names.includes(prev)) selPreset.value = prev;
  }
  const pBtn = (id) => document.getElementById(id);
  if (pBtn('preset-save')) pBtn('preset-save').addEventListener('click', async () => {
    const name = (presetName.value || (selPreset && selPreset.value) || '').trim();
    if (!name) { presetName.focus(); return; }
    await fetch('/presets/' + encodeURIComponent(name), {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { ...state } }),
    });
    presetName.value = '';
    const list = await (await fetch('/presets')).json();
    renderPresets(list.presets); if (selPreset) selPreset.value = name;
  });
  if (pBtn('preset-load')) pBtn('preset-load').addEventListener('click', async () => {
    if (!selPreset || !selPreset.value) return;
    const r = await fetch('/presets/' + encodeURIComponent(selPreset.value));
    if (!r.ok) return;
    const rec = await r.json();
    for (const [channel, value] of Object.entries(rec.values || {})) emit(channel, value);
    renderTab(activeTab); renderPinned();   // reflect restored values on visible controls
  });
  if (pBtn('preset-del')) pBtn('preset-del').addEventListener('click', async () => {
    if (!selPreset || !selPreset.value) return;
    await fetch('/presets/' + encodeURIComponent(selPreset.value), { method: 'DELETE' });
    renderPresets((await (await fetch('/presets')).json()).presets);
  });

  // ---- performer admin bar (?admin or ?admin=<token>) ----
  const adminParam = new URLSearchParams(location.search).get('admin');
  if (adminParam !== null) {
    const bar = document.getElementById('admin'); bar.classList.add('show');
    const token = adminParam ? `&token=${encodeURIComponent(adminParam)}` : '';
    const base = (location.origin) + '/admin/crowd?';
    let live = true;
    const killBtn = document.getElementById('killBtn');
    killBtn.onclick = () => {
      live = !live;
      killBtn.textContent = live ? 'LIVE' : 'MUTED';
      killBtn.classList.toggle('muted', !live);
      fetch(`${base}enabled=${live ? 1 : 0}${token}`).catch(() => {});
    };
    document.getElementById('crowdGain').oninput = (e) => {
      fetch(`${base}gain=${e.target.value}${token}`).catch(() => {});
    };
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(() => {});
})();

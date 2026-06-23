// app.js — auto-renders the Octatrack control surface from midi-map.js and
// streams {channel, value} to the bridge (or straight to Web MIDI).
(function () {
  const CFG = window.OT_CONFIG;
  const MAP = window.OT_MIDI_MAP;
  const statusEl = document.getElementById('status');

  // ---- transport: bridge WebSocket, or Web MIDI directly ----
  let send = () => {};
  let outChannels = MAP.expandChannels();

  // Per-channel value memory (normalised 0..1). Survives tab switches and is
  // what presets snapshot/restore. emit() records then forwards to transport.
  const state = {};
  function emit(channel, value) { state[channel] = value; send(channel, value); }

  function setStatus(t, cls) { statusEl.textContent = t; statusEl.className = cls || ''; }

  if (CFG.useWebMidi && navigator.requestMIDIAccess) {
    initWebMidi();
  } else {
    initBridge();
  }

  function resolveBridgeURL() {
    if (CFG.bridge) return normalize(CFG.bridge);
    const q = new URLSearchParams(location.search).get('bridge');
    if (q) return normalize(q);
    // code-server / PikaPods style path proxy: /proxy/<port>/
    const m = location.pathname.match(/\/proxy\/(\d+)\//);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (m) return `${proto}//${location.host}/proxy/${m[1]}/`;
    return `${proto}//${location.hostname}:8082`;
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
    const AUTO = MAP.defaults.autoChannel, CH = MAP.defaults.audioChannels;
    navigator.requestMIDIAccess({ sysex: false }).then((access) => {
      const outs = [...access.outputs.values()];
      if (!outs.length) { setStatus('no MIDI output', 'err'); return; }
      const out = outs[0];
      setStatus(`Web MIDI · ${out.name}`, 'ok');
      send = (channel, value) => {
        const def = outChannels[channel];
        if (!def) return;
        const midiCh = (def.scope === 'audio' ? CH[def.track - 1] : AUTO) - 1;
        const v = Math.max(0, Math.min(127, Math.round(value * 127)));
        out.send([0xB0 | midiCh, def.cc, v]);
      };
    }, () => setStatus('Web MIDI denied', 'err'));
  }

  // ---- UI build ----
  const tabsEl = document.getElementById('tabs');
  const surfaceEl = document.getElementById('surface');
  const pinnedEl = document.getElementById('pinned');
  let activeTrack = CFG.tracks[0];

  function trackLabel(t) { return t === 'auto' ? 'AUTO' : 'T' + t; }
  function channelId(t, paramId) { return t === 'auto' ? `auto/${paramId}` : `t${t}/${paramId}`; }

  // relabel FX faders if the user declared what effect is loaded
  function fxLabel(t, p) {
    const types = CFG.fxTypes[t] || {};
    const m = p.id.match(/^fx([12])p([1-6])$/);
    if (!m) return p.label;
    const legend = MAP.FX_LEGENDS[types['fx' + m[1]]];
    if (legend && legend[m[2] - 1] && legend[m[2] - 1] !== '—') return `FX${m[1]} ${legend[m[2] - 1]}`;
    return p.label;
  }

  function makeControl(channel, def, label) {
    const wrap = document.createElement('div');
    if (def.toggle) {
      wrap.className = 'ctl';
      const b = document.createElement('button');
      b.className = 'btn'; b.textContent = label;
      let on = (state[channel] ?? 0) >= 0.5;
      b.classList.toggle('on', on);
      b.onclick = () => { on = !on; b.classList.toggle('on', on); emit(channel, on ? 1 : 0); };
      wrap.appendChild(b);
    } else {
      wrap.className = 'ctl';
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

  function renderTrack(t) {
    surfaceEl.innerHTML = '';
    const groups = {};
    for (const p of MAP.AUDIO_TRACK_PARAMS) {
      if (p.hidden) continue;
      (groups[p.group] = groups[p.group] || []).push(p);
    }
    for (const g of Object.keys(groups)) {
      const section = document.createElement('div');
      section.className = 'group';
      section.innerHTML = `<h2>${g}</h2>`;
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const p of groups[g]) {
        grid.appendChild(makeControl(channelId(t, p.id), p, fxLabel(t, p)));
      }
      section.appendChild(grid);
      surfaceEl.appendChild(section);
    }
    // MIDI-track mutes/solos shown on every tab (they're global)
    const mt = document.createElement('div');
    mt.className = 'group';
    mt.innerHTML = '<h2>MIDI Tracks (global)</h2>';
    const grid = document.createElement('div'); grid.className = 'grid';
    for (const p of MAP.MIDI_TRACK_CONTROLS) grid.appendChild(makeControl(`global/${p.id}`, p, p.label));
    mt.appendChild(grid); surfaceEl.appendChild(mt);
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const t of CFG.tracks) {
      const b = document.createElement('button');
      b.className = 'tab' + (t === activeTrack ? ' active' : '');
      b.textContent = trackLabel(t);
      b.onclick = () => { activeTrack = t; renderTabs(); renderTrack(t); };
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

  renderTabs(); renderTrack(activeTrack); renderPinned();

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
    renderTrack(activeTrack); renderPinned();   // reflect restored values on visible controls
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

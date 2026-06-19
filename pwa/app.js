// ============================================================
// APP LOGIC -- generally no need to edit this file.
// To change controls, edit config.js instead.
//
// Transport: this is the dspm-archive audience controller. Unlike the
// standalone barcode_web build (which POSTed /osc to a local Python relay),
// every control here is sent as a {channel, value} message over the bridge's
// WebSocket. The bridge (bridge/bridge-server.js) averages continuous channels
// across all connected phones, edge-fires the transport buttons, forwards OSC
// to norns, and logs the whole session. `channel` IS the OSC path; values are
// normalised 0..1 (norns maps to each param's real range).
// ============================================================

const app = document.getElementById("app");
const statusEl = document.getElementById("status");

// ---- page nav: show PERFORMER link only when ?admin or ?token is present ----
{
  const _p = new URLSearchParams(location.search);
  const nav = document.getElementById("page-nav");
  const navLink = document.getElementById("nav-performer");
  if (nav && navLink && (_p.has("admin") || _p.has("token"))) {
    navLink.href = "performer.html" + location.search;
    nav.style.display = "";
  }
}

// ---- connect banner: show actual URL, allow dismiss -------------------
{
  const urlEl = document.getElementById("connect-url");
  if (urlEl) urlEl.textContent = location.origin + location.pathname;

  const hideBtn = document.getElementById("hide-banner");
  const banner = document.getElementById("connect-banner");
  if (hideBtn && banner) {
    hideBtn.addEventListener("click", () => banner.classList.add("hidden"));
  }
}

// ---- bridge WebSocket ----------------------------------------------------
// Resolution order, matching the rest of the PWA:
//   1. ?bridge=... override -- full ws(s):// URL or a bare host:port.
//   2. behind a /proxy/<port>/ path proxy (code-server / PikaPods): reuse the
//      page's host+path, swapping the port segment to the bridge port.
//   3. fallback: same hostname, bridge port.
// wss:// is used automatically whenever the page itself is served over https.
const params = new URLSearchParams(location.search);
const proto = location.protocol === "https:" ? "wss://" : "ws://";
const BRIDGE_PORT = "8081";
function resolveBridgeUrl() {
  const override = params.get("bridge");
  if (override) {
    return /^wss?:\/\//.test(override) ? override : proto + override;
  }
  if (location.pathname.includes("/proxy/")) {
    return proto + location.host +
      location.pathname.replace(/\/proxy\/\d+\/.*/, "/proxy/" + BRIDGE_PORT + "/");
  }
  return proto + location.hostname + ":" + BRIDGE_PORT;
}
const bridgeUrl = resolveBridgeUrl();

let ws = null;
const wsListeners = []; // (path, args) => void  -- for optional feedback sync

// ---- send a control message to the bridge --------------------------------
// Kept named sendOSC so the render code below is unchanged; `args` is the
// single-element array the controls already build.
function sendOSC(path, args) {
  const value = Array.isArray(args) ? Number(args[0]) : Number(args);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ channel: path, value }));
  }
}

function connectWS() {
  try {
    ws = new WebSocket(bridgeUrl);
  } catch (e) {
    statusEl.textContent = "no bridge";
    return;
  }
  ws.onopen = () => {
    statusEl.textContent = "connected";
    statusEl.classList.add("connected");
  };
  ws.onclose = () => {
    statusEl.textContent = "reconnecting...";
    statusEl.classList.remove("connected");
    setTimeout(connectWS, 1500);
  };
  ws.onerror = () => {};
  ws.onmessage = (evt) => {
    // The bridge sends {type:'hello',...} on connect and does not echo control
    // values, so feedback listeners stay dormant unless a future bridge echoes
    // {path,args}. Handling both shapes keeps that forward-compatible.
    try {
      const msg = JSON.parse(evt.data);
      if (msg && msg.type === "hello") return;
      if (msg && msg.path) for (const fn of wsListeners) fn(msg.path, msg.args);
    } catch (e) {}
  };
}
connectWS();

// ---- helpers -----------------------------------------------------------
function el(tag, className, children) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (children) {
    for (const c of children) {
      if (typeof c === "string") e.appendChild(document.createTextNode(c));
      else e.appendChild(c);
    }
  }
  return e;
}

// ============================================================
// BUTTONS
// ============================================================
function renderButtons(section) {
  if (!section || !section.items || section.items.length === 0) return null;

  const group = el("section", "group");
  group.appendChild(el("h2", null, [section.title || "BUTTONS"]));
  const row = el("div", "button-row");

  for (const item of section.items) {
    const btn = el("div", "btn" + (item.type === "momentary" ? " momentary" : ""), [item.label]);
    let active = false;

    if (item.type === "toggle") {
      btn.addEventListener("click", () => {
        active = !active;
        btn.classList.toggle("active", active);
        sendOSC(item.path, [active ? 1 : 0]);
      });
      // sync from feedback
      wsListeners.push((path, args) => {
        if (path === item.path) {
          active = !!args[0];
          btn.classList.toggle("active", active);
        }
      });
    } else {
      // momentary
      const press = (e) => { e.preventDefault(); sendOSC(item.path, [1]); };
      const release = (e) => { e.preventDefault(); sendOSC(item.path, [0]); };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
    }

    row.appendChild(btn);
  }

  group.appendChild(row);
  return group;
}

// ============================================================
// SLIDERS
// ============================================================
function renderSliders(section) {
  if (!section || !section.items || section.items.length === 0) return null;

  const group = el("section", "group");
  group.appendChild(el("h2", null, [section.title || "SLIDERS"]));

  for (const item of section.items) {
    const block = el("div", "slider-block");
    const labelRow = el("div", "slider-label");
    const labelText = el("span", null, [item.label]);
    const valText = el("span", "val", [String(item.default ?? 0.5)]);
    labelRow.appendChild(labelText);
    labelRow.appendChild(valText);

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(item.default ?? 0.5);

    const update = (v) => {
      valText.textContent = Number(v).toFixed(2);
    };
    update(input.value);

    input.addEventListener("input", () => {
      update(input.value);
      sendOSC(item.path, [parseFloat(input.value)]);
    });

    wsListeners.push((path, args) => {
      if (path === item.path) {
        input.value = args[0];
        update(args[0]);
      }
    });

    block.appendChild(labelRow);
    block.appendChild(input);
    group.appendChild(block);
  }

  return group;
}

// ============================================================
// XY PADS
// ============================================================
function renderXYPads(section) {
  if (!section || !section.items || section.items.length === 0) return null;

  const group = el("section", "group");
  group.appendChild(el("h2", null, [section.title || "XY PADS"]));
  const grid = el("div", "xy-grid");

  for (const item of section.items) {
    const wrap = el("div", "xy-pad-wrap");

    // Flatten grouped options into a single ordered list, remembering
    // group boundaries for <optgroup> rendering.
    const flat = [];
    for (const grp of item.axisGroups) {
      for (const opt of grp.options) {
        flat.push({ group: grp.group, ...opt });
      }
    }

    const findIndexByPath = (path) =>
      flat.findIndex((o) => o.paths.includes(path));

    const defaultXIndex = Math.max(0, findIndexByPath(item.defaultXPath));
    const defaultYIndex = Math.max(0, findIndexByPath(item.defaultYPath));

    // header with axis selectors
    const header = el("div", "xy-pad-header");
    header.appendChild(el("span", null, [item.label]));

    const buildSelect = (prefix, defaultIndex) => {
      const select = document.createElement("select");
      let flatIdx = 0;
      for (const grp of item.axisGroups) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = grp.group;
        for (const opt of grp.options) {
          const o = document.createElement("option");
          o.value = String(flatIdx);
          o.textContent = prefix + ": " + opt.label;
          optgroup.appendChild(o);
          flatIdx++;
        }
        select.appendChild(optgroup);
      }
      select.value = String(defaultIndex);
      return select;
    }

    const xSelect = buildSelect("X", defaultXIndex);
    const ySelect = buildSelect("Y", defaultYIndex);

    header.appendChild(xSelect);
    header.appendChild(ySelect);

    // pad
    const pad = el("div", "xy-pad");
    const crosshair = el("div", "crosshair");
    const xLabel = el("div", "axis-label x-label", [flat[defaultXIndex].label]);
    const yLabel = el("div", "axis-label y-label", [flat[defaultYIndex].label]);
    pad.appendChild(crosshair);
    pad.appendChild(xLabel);
    pad.appendChild(yLabel);

    xSelect.addEventListener("change", () => {
      xLabel.textContent = flat[parseInt(xSelect.value)].label;
    });
    ySelect.addEventListener("change", () => {
      yLabel.textContent = flat[parseInt(ySelect.value)].label;
    });

    let dragging = false;

    function setPosition(clientX, clientY) {
      const rect = pad.getBoundingClientRect();
      let nx = (clientX - rect.left) / rect.width;
      let ny = (clientY - rect.top) / rect.height;
      nx = Math.min(1, Math.max(0, nx));
      ny = Math.min(1, Math.max(0, ny));

      crosshair.style.left = (nx * 100) + "%";
      crosshair.style.top = (ny * 100) + "%";

      const xOpt = flat[parseInt(xSelect.value)];
      // Y axis inverted: top of pad = 1, bottom = 0 (typical synth convention)
      const yVal = 1 - ny;
      const yOpt = flat[parseInt(ySelect.value)];

      for (const p of xOpt.paths) sendOSC(p, [nx]);
      for (const p of yOpt.paths) sendOSC(p, [yVal]);
    }

    pad.addEventListener("pointerdown", (e) => {
      dragging = true;
      pad.setPointerCapture(e.pointerId);
      setPosition(e.clientX, e.clientY);
    });
    pad.addEventListener("pointermove", (e) => {
      if (dragging) setPosition(e.clientX, e.clientY);
    });
    pad.addEventListener("pointerup", () => { dragging = false; });
    pad.addEventListener("pointercancel", () => { dragging = false; });

    // feedback: if norns reports a new value for whatever this pad's X or Y is
    // currently pointed at, move the crosshair to match (UI only, no send).
    wsListeners.push((path, args) => {
      if (dragging) return; // don't fight the finger while it's on the pad
      const v = Number(args && args[0]);
      if (!Number.isFinite(v)) return;
      const clamped = Math.max(0, Math.min(1, v));
      if (flat[parseInt(xSelect.value)].paths.includes(path)) {
        crosshair.style.left = (clamped * 100) + "%";
      }
      if (flat[parseInt(ySelect.value)].paths.includes(path)) {
        crosshair.style.top = ((1 - clamped) * 100) + "%"; // Y inverted: top = 1
      }
    });

    wrap.appendChild(header);
    wrap.appendChild(pad);
    grid.appendChild(wrap);
  }

  group.appendChild(grid);
  return group;
}

// ============================================================
// GYRO TILT
// ============================================================
function buildGyroSelect(defaultIndex) {
  const select = document.createElement("select");
  select.className = "gyro-axis-select";
  let flatIdx = 0;
  for (const grp of ALL_AXIS_GROUPS) {
    const og = document.createElement("optgroup");
    og.label = grp.group;
    for (const opt of grp.options) {
      const o = document.createElement("option");
      o.value = String(flatIdx++);
      o.textContent = opt.label;
      og.appendChild(o);
    }
    select.appendChild(og);
  }
  select.value = String(defaultIndex);
  return select;
}

function renderGyro(cfg) {
  if (!cfg) return null;

  const dead = cfg.deadzoneDeg ?? 8;
  const intervalMs = Math.round(1000 / (cfg.rateHz ?? 15));

  const flat = [];
  for (const grp of ALL_AXIS_GROUPS) {
    for (const opt of grp.options) flat.push({ ...opt });
  }
  const findIdx = (path) =>
    Math.max(0, flat.findIndex((o) => o.paths && o.paths.includes(path)));

  const group = el("section", "group");
  group.appendChild(el("h2", null, ["GYRO TILT"]));

  const enableRow = el("div", "gyro-enable-row");
  const enableBtn = el("div", "gyro-enable-btn", ["ENABLE GYRO"]);
  const statusTxt = el("span", "gyro-status-txt", ["tap to activate · tilt controls selected param"]);
  enableRow.appendChild(enableBtn);
  enableRow.appendChild(statusTxt);
  group.appendChild(enableRow);

  function makeAxisRow(axisLabel, defaultPath) {
    const row = el("div", "gyro-axis-row");
    row.appendChild(el("span", "gyro-axis-label", [axisLabel]));
    const select = buildGyroSelect(findIdx(defaultPath));
    const track = el("div", "gyro-track");
    track.appendChild(el("div", "gyro-center-mark"));
    const dot = el("div", "gyro-dot");
    track.appendChild(dot);
    row.appendChild(select);
    row.appendChild(track);
    return { row, select, dot };
  }

  const betaAxis  = makeAxisRow("PITCH", cfg.betaDefaultPath  || "");
  const gammaAxis = makeAxisRow("ROLL",  cfg.gammaDefaultPath || "");
  group.appendChild(betaAxis.row);
  group.appendChild(gammaAxis.row);

  let enabled = false, timerId = null;
  let betaNorm = 0.5, gammaNorm = 0.5;

  function normTilt(deg, maxDeg) {
    const raw = deg ?? 0;
    const abs = Math.abs(raw);
    if (abs < dead) return 0.5;
    const sign = raw >= 0 ? 1 : -1;
    return 0.5 + sign * Math.min(1, (abs - dead) / (maxDeg - dead)) * 0.5;
  }

  function startGyro() {
    let gotRealData = false;
    let hasOrientation = false;

    function updateDots(beta, gamma) {
      if (beta == null && gamma == null) return;
      gotRealData = true;
      betaNorm  = normTilt(beta,  90);
      gammaNorm = normTilt(gamma, 90);
      betaAxis.dot.style.left  = (betaNorm  * 100) + "%";
      gammaAxis.dot.style.left = (gammaNorm * 100) + "%";
      const b = beta  != null ? beta.toFixed(1)  + "°" : "–";
      const g = gamma != null ? gamma.toFixed(1) + "°" : "–";
      statusTxt.textContent = "β " + b + "  γ " + g;
    }

    // Primary: DeviceOrientationEvent — direct tilt angles, preferred when available.
    function orientHandler(e) {
      hasOrientation = true;
      updateDots(e.beta, e.gamma);
    }

    // Fallback: DeviceMotionEvent — derives pitch/roll from the gravity vector.
    // Fires on accelerometer-only devices (Fire 7, Fire HD 8, no-gyro Androids)
    // where deviceorientation never fires. Uses atan2 on accelerationIncludingGravity.
    function motionHandler(e) {
      if (hasOrientation) return;
      const ag = e.accelerationIncludingGravity;
      if (!ag || ag.x === null) return;
      const ax = ag.x || 0, ay = ag.y || 0, az = ag.z || 0;
      const beta  = -Math.atan2(ay, Math.sqrt(ax * ax + az * az)) * (180 / Math.PI);
      const gamma =  Math.atan2(ax, az) * (180 / Math.PI);
      updateDots(beta, gamma);
    }

    betaAxis._handlers = [
      ["deviceorientation", orientHandler],
      ["devicemotion",      motionHandler],
    ];
    for (const [evt, fn] of betaAxis._handlers) window.addEventListener(evt, fn);

    timerId = setInterval(() => {
      const bOpt = flat[parseInt(betaAxis.select.value)];
      const gOpt = flat[parseInt(gammaAxis.select.value)];
      if (bOpt) for (const p of bOpt.paths) sendOSC(p, [betaNorm]);
      if (gOpt) for (const p of gOpt.paths) sendOSC(p, [gammaNorm]);
    }, intervalMs);

    setTimeout(() => {
      if (enabled && !gotRealData)
        statusTxt.textContent = "no sensor data — check Sensors Permission in OS settings";
    }, 3000);

    enabled = true;
    enableBtn.classList.add("active");
    enableBtn.textContent = "GYRO ON";
    statusTxt.textContent = "waiting for first event…";
  }

  function stopGyro() {
    if (betaAxis._handlers) {
      for (const [evt, fn] of betaAxis._handlers) window.removeEventListener(evt, fn);
      betaAxis._handlers = null;
    }
    clearInterval(timerId);
    timerId = null;
    enabled = false;
    enableBtn.classList.remove("active");
    enableBtn.textContent = "ENABLE GYRO";
    statusTxt.textContent = "off";
    betaAxis.dot.style.left  = "50%";
    gammaAxis.dot.style.left = "50%";
  }

  enableBtn.addEventListener("click", () => {
    if (enabled) { stopGyro(); return; }
    // iOS 13+ requires explicit permission from a user gesture
    const needsPerm = typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function";
    if (needsPerm) {
      DeviceOrientationEvent.requestPermission()
        .then((s) => {
          if (s === "granted") startGyro();
          else statusTxt.textContent = "permission denied by iOS";
        })
        .catch(() => { statusTxt.textContent = "permission error"; });
    } else {
      startGyro();
    }
  });

  return group;
}

// ============================================================
// RENDER ALL
// ============================================================
const btnSection    = renderButtons(CONFIG.buttons);
const sliderSection = renderSliders(CONFIG.sliders);
const xySection     = renderXYPads(CONFIG.xyPads);
const gyroSection   = renderGyro(CONFIG.gyro);

if (btnSection)    app.appendChild(btnSection);
if (xySection)     app.appendChild(xySection);
if (gyroSection)   app.appendChild(gyroSection);
if (sliderSection) app.appendChild(sliderSection);

// ============================================================
// PERFORMER ADMIN BAR  (kill-switch / dimmer)
// Only rendered when the page URL carries ?admin=<token> -- audience phones
// never see it. Hits the bridge's /admin/crowd endpoint (see
// docs/remote-webhooks.md). The endpoint lives on the same server as the
// WebSocket bridge, so we derive its http(s) URL from the same resolution.
//   - performer on the bridge machine itself: ?admin  (no token needed; the
//     endpoint is loopback-open by default)
//   - performer remote / via tunnel: ?admin=<BRIDGE_ADMIN_TOKEN>
// ============================================================
function setupAdminBar() {
  if (!params.has("admin")) return;
  const token = params.get("admin"); // may be "" for loopback use

  // bridgeUrl is ws(s)://...; the admin route is http(s):// on the same host.
  const adminBase = (bridgeUrl.replace(/^ws/, "http").replace(/\/+$/, "")) + "/admin/crowd";
  function adminFetch(setObj) {
    const sp = new URLSearchParams();
    if (setObj) for (const k in setObj) sp.set(k, setObj[k]);
    if (token) sp.set("token", token);
    const qs = sp.toString();
    // POST with no enabled/gain params is a safe read (the bridge only mutates
    // when those keys are present), so the same call inits and updates.
    return fetch(adminBase + (qs ? "?" + qs : ""), { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  const bar = el("div", "admin-bar");

  const muteBtn = el("div", "admin-mute", ["LIVE"]);

  const gainWrap = el("div", "admin-gain");
  const gainLabel = el("label", null, [
    el("span", null, ["CROWD"]),
    el("span", "gval", ["100%"]),
  ]);
  const gainInput = document.createElement("input");
  gainInput.type = "range";
  gainInput.min = "0"; gainInput.max = "1"; gainInput.step = "0.01"; gainInput.value = "1";
  gainWrap.appendChild(gainLabel);
  gainWrap.appendChild(gainInput);

  const stateEl = el("div", "admin-state", ["…"]);

  let enabled = true;
  function applyState(s) {
    enabled = !!s.enabled;
    muteBtn.textContent = enabled ? "LIVE" : "MUTED";
    muteBtn.classList.toggle("muted", !enabled);
    if (typeof s.gain === "number") {
      gainInput.value = String(s.gain);
      gainLabel.lastChild.textContent = Math.round(s.gain * 100) + "%";
    }
    stateEl.textContent = enabled ? "crowd → norns" : "crowd muted";
  }

  muteBtn.addEventListener("click", () => {
    adminFetch({ enabled: enabled ? 0 : 1 })
      .then(applyState)
      .catch((e) => { stateEl.textContent = "admin: " + e.message; });
  });

  gainInput.addEventListener("input", () => {
    gainLabel.lastChild.textContent = Math.round(parseFloat(gainInput.value) * 100) + "%";
  });
  gainInput.addEventListener("change", () => {
    adminFetch({ gain: gainInput.value })
      .then(applyState)
      .catch((e) => { stateEl.textContent = "admin: " + e.message; });
  });

  bar.appendChild(muteBtn);
  bar.appendChild(gainWrap);
  bar.appendChild(stateEl);
  document.body.appendChild(bar);

  // initial read
  adminFetch().then(applyState).catch((e) => { stateEl.textContent = "admin: " + e.message; });
}
setupAdminBar();

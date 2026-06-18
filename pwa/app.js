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

    function buildSelect(prefix, defaultIndex) {
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

    wrap.appendChild(header);
    wrap.appendChild(pad);
    grid.appendChild(wrap);
  }

  group.appendChild(grid);
  return group;
}

// ============================================================
// RENDER ALL
// ============================================================
const btnSection = renderButtons(CONFIG.buttons);
const sliderSection = renderSliders(CONFIG.sliders);
const xySection = renderXYPads(CONFIG.xyPads);

if (btnSection) app.appendChild(btnSection);
if (xySection) app.appendChild(xySection);
if (sliderSection) app.appendChild(sliderSection);

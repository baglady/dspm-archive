-- feedback.lua -- push parameter changes made ON norns back out to the phone
-- bridge, so the web controller's sliders / buttons / pads track the device.
--
-- The bridge fans these out to every connected phone. Values are sent
-- NORMALISED 0..1 on the SAME OSC paths the phones send, so the web side needs
-- no extra mapping (it already listens on those paths).
--
-- Design: rather than instrument every encoder / param action, poll the core
-- controls at a fixed low rate and push only what changed since last time. That
-- catches changes from ANY source (E1/E2/E3, the PARAMS menu, MIDI map, pset
-- load) and is naturally rate-limited. The bridge's IP is learned from inbound
-- OSC (set_bridge), so nothing here is hardcoded to a venue -- only the port.

local Feedback = {}

local FEEDBACK_PORT = 10112
local EPS = 0.004 -- ~1/255: smallest change worth a packet

Feedback.bridge_ip = nil
local last = {}
local poll_metro = nil

-- call from osc.event with the sender address {host, port}; we reply to host
function Feedback.set_bridge(from)
  if from and from[1] then Feedback.bridge_ip = from[1] end
end

-- start the change-poller (idempotent). `ctx` is { state = state, voice = voice }
-- from the main script. Safe to call on every osc.event -- it only inits once,
-- so polling begins the moment the bridge first talks to norns.
function Feedback.start(ctx)
  if poll_metro ~= nil then return end
  poll_metro = metro.init()
  if poll_metro == nil then return end -- no free metro; skip feedback
  poll_metro.time = 1 / 15
  poll_metro.event = function() Feedback.poll(ctx) end
  poll_metro:start()
end

local function push(path, value)
  if Feedback.bridge_ip == nil or value == nil then return end
  value = util.clamp(value, 0, 1)
  if last[path] ~= nil and math.abs(last[path] - value) < EPS then return end
  last[path] = value
  osc.send({ Feedback.bridge_ip, FEEDBACK_PORT }, path, { value })
end

-- sample the core controls and push whatever changed. `ctx` carries the live
-- state the main script owns: { state = state, voice = voice }.
function Feedback.poll(ctx)
  -- master output level: state.level is already 0..1
  push("/barcode/output_level", ctx.state.level)

  -- global filter params: normalise through their controlspecs
  local ff = params:lookup_param("filter_frequency")
  if ff and ff.controlspec then
    push("/param/filter_frequency", ff.controlspec:unmap(params:get("filter_frequency")))
  end
  local fr = params:lookup_param("filter_reso")
  if fr and fr.controlspec then
    push("/param/filter_reso", fr.controlspec:unmap(params:get("filter_reso")))
  end

  -- per-voice level / pan bias. Inbound mapping is linlin(0,1,-2,2), so invert.
  for i = 1, 6 do
    push("/barcode/v" .. i .. "/level", util.linlin(-2, 2, 0, 1, ctx.voice[i].level.adj))
    push("/barcode/v" .. i .. "/pan", util.linlin(-2, 2, 0, 1, ctx.voice[i].pan.adj))
  end
end

function Feedback.port() return FEEDBACK_PORT end

return Feedback

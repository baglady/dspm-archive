-- lib/perf_logger.lua
--
-- Logs param changes, softcut/transport events, and voice-state (osc-driven)
-- changes to a timestamped JSONL file in the script's data directory, for
-- later assembly into a session-capture bundle (see
-- docs/control-surface-mapping.md and docs/architecture.md in dspm-archive).
--
-- Every line is one JSON object with at least {type=..., t=...}, where t is
-- seconds since logger.start() was called (the session's local clock --
-- the bridge and backend align this against their own clocks using the
-- session manifest's t0 / offsets_sec).

local json = include("dspm_archive/lib/json")

local logger = {}
local log_file
local t0
local enabled = false

function logger.start(script_name)
  local ts = os.date("%Y%m%d_%H%M%S")
  local dir = _path.data .. script_name .. "/"
  os.execute("mkdir -p " .. dir .. "logs")
  log_file = io.open(dir .. "logs/perflog_" .. ts .. ".jsonl", "w")
  t0 = util.time()
  enabled = true
  logger.write("session_start", { wall_time = os.time(), script = script_name })
end

function logger.write(kind, data)
  if not enabled or not log_file then return end
  data = data or {}
  data.type = kind
  data.t = util.time() - t0
  log_file:write(json.encode(data), "\n")
  log_file:flush()
end

-- Wrap every param's existing action so every change gets logged, whether
-- it came from the encoder, a script call, or OSC -- without clobbering
-- whatever action the script already assigned. Call once, after all
-- params:add calls in init() have run.
function logger.hook_params()
  for i = 1, #params.params do
    local p = params.params[i]
    if p.id then
      local existing = p.action
      local pid = p.id
      p.action = function(value)
        logger.write("param", { id = pid, value = value })
        if existing then existing(value) end
      end
    end
  end
end

function logger.stop()
  if log_file then
    logger.write("session_end", {})
    log_file:close()
    log_file = nil
  end
  enabled = false
end

return logger

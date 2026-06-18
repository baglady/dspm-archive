-- lib/json.lua
--
-- Minimal JSON encoder (encode-only, no decode needed for logging).
-- Handles nil, boolean, number, string, and tables (array or map).
-- Not spec-complete (no unicode escapes beyond the basics) but sufficient
-- for writing perf_logger's JSONL lines.

local json = {}

local escapes = {
  ['\\'] = '\\\\',
  ['"']  = '\\"',
  ['\n'] = '\\n',
  ['\r'] = '\\r',
  ['\t'] = '\\t',
}

local function escape_str(s)
  return (s:gsub('[\\"\n\r\t]', escapes))
end

local function is_array(t)
  local n = 0
  for k, _ in pairs(t) do
    if type(k) ~= "number" then return false end
    n = n + 1
  end
  return n == #t
end

function json.encode(v)
  local t = type(v)
  if v == nil then
    return "null"
  elseif t == "boolean" then
    return v and "true" or "false"
  elseif t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    return tostring(v)
  elseif t == "string" then
    return '"' .. escape_str(v) .. '"'
  elseif t == "table" then
    if is_array(v) then
      local parts = {}
      for i = 1, #v do
        parts[i] = json.encode(v[i])
      end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      local parts = {}
      for k, val in pairs(v) do
        parts[#parts + 1] = '"' .. escape_str(tostring(k)) .. '":' .. json.encode(val)
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return "null"
end

return json

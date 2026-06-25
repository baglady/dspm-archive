// Send a line of Lua to the running matron REPL (norns-desktop ws on :5555) and
// print whatever it echoes back. Default action loads dspm_archive.
//   node matron-eval.js                       # load dspm_archive
//   node matron-eval.js 'print(#params.params)'
// Needs `ws` -- run with NODE_PATH=/opt/dspm-archive/bridge/node_modules
const WebSocket = require("ws");
const code = process.argv[2] ||
  'norns.script.load("/home/we/dust/code/dspm_archive/dspm_archive.lua")';
const ws = new WebSocket("ws://127.0.0.1:5555", ["bus.sp.nanomsg.org"]);
let buf = "";
ws.on("open", () => { ws.send(code + "\n"); setTimeout(() => { process.stdout.write(buf); ws.close(); process.exit(0); }, 2500); });
ws.on("message", (d) => { buf += d.toString(); });
ws.on("error", (e) => { console.error("WS ERR", e.message); process.exit(1); });

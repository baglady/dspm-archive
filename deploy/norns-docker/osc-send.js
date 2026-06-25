// Send one OSC float message to the dockerized norns (matron) on udp/10111,
// independent of the bridge -- for testing the control path directly.
//   node osc-send.js /param/filter_frequency 0.5
//   node osc-send.js /barcode/v3/level 0.9
const dgram = require("dgram");
const path = process.argv[2] || "/param/filter_frequency";
const val  = process.argv[3] !== undefined ? parseFloat(process.argv[3]) : 0.5;
function pad(b){ const p=4-(b.length%4||4); return Buffer.concat([b,Buffer.alloc(p===4?4:p)]); }
function ostr(s){ return pad(Buffer.from(s+"\0")); }
const addr = ostr(path);
const types = ostr(",f");
const arg = Buffer.alloc(4); arg.writeFloatBE(val,0);
const msg = Buffer.concat([addr,types,arg]);
const s = dgram.createSocket("udp4");
s.send(msg,0,msg.length,10111,"127.0.0.1",(e)=>{ console.log(e?("ERR "+e.message):("sent "+path+" "+val+" -> 127.0.0.1:10111")); s.close(); });

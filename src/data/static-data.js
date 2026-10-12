/* =====================================================================
   eToy Football — PHASE 1 FOUNDATION
   Real clubs data → Event Bus → Config → Data Models → State Machine →
   Save/Settings → Audio → Input → Camera → Match Engine → UI wiring
   All existing gameplay values preserved exactly; only reorganized.
   ===================================================================== */

/* ---------- STATIC DATA (unchanged) ---------- */
const TEAMS = [
  { id:'mufc', name:'Man United', abbr:'MUN', primary:'#da291c', secondary:'#fbe122' },
  { id:'liv',  name:'Liverpool', abbr:'LIV', primary:'#c8102e', secondary:'#00b2a9' },
  { id:'mci',  name:'Man City', abbr:'MCI', primary:'#6cabdd', secondary:'#1c2c5b' },
  { id:'ars',  name:'Arsenal', abbr:'ARS', primary:'#ef0107', secondary:'#063672' },
  { id:'che',  name:'Chelsea', abbr:'CHE', primary:'#034694', secondary:'#dbA72a' },
  { id:'tot',  name:'Tottenham', abbr:'TOT', primary:'#132257', secondary:'#ffffff' },
  { id:'rma',  name:'Real Madrid', abbr:'RMA', primary:'#ffffff', secondary:'#00529f' },
  { id:'bar',  name:'Barcelona', abbr:'BAR', primary:'#a50044', secondary:'#004d98' },
  { id:'atm',  name:'Atletico', abbr:'ATM', primary:'#cb3524', secondary:'#272e61' },
  { id:'bay',  name:'Bayern', abbr:'BAY', primary:'#dc052d', secondary:'#0066b2' },
  { id:'bvb',  name:'Dortmund', abbr:'BVB', primary:'#fde100', secondary:'#000000' },
  { id:'psg',  name:'PSG', abbr:'PSG', primary:'#004170', secondary:'#da291c' },
  { id:'juv',  name:'Juventus', abbr:'JUV', primary:'#000000', secondary:'#ffffff' },
  { id:'int',  name:'Inter', abbr:'INT', primary:'#010e80', secondary:'#000000' },
  { id:'acm',  name:'AC Milan', abbr:'MIL', primary:'#fb090b', secondary:'#000000' },
  { id:'aja',  name:'Ajax', abbr:'AJA', primary:'#d2122e', secondary:'#ffffff' },
];

const ALL_PLAYERS = [
  { id:1,  name:'Alisson', pos:'GK', speed:55, power:50, tackle:70, skill:78 },
  { id:2,  name:'Ederson', pos:'GK', speed:58, power:52, tackle:68, skill:80 },
  { id:3,  name:'Courtois', pos:'GK', speed:52, power:48, tackle:72, skill:82 },
  { id:4,  name:'Van Dijk', pos:'DF', speed:72, power:88, tackle:92, skill:78 },
  { id:5,  name:'Saliba', pos:'DF', speed:74, power:82, tackle:88, skill:76 },
  { id:6,  name:'Dias', pos:'DF', speed:70, power:84, tackle:90, skill:80 },
  { id:7,  name:'Robertson', pos:'DF', speed:82, power:70, tackle:84, skill:80 },
  { id:8,  name:'Walker', pos:'DF', speed:90, power:72, tackle:82, skill:74 },
  { id:9,  name:'Rodri', pos:'MF', speed:70, power:78, tackle:88, skill:90 },
  { id:10, name:'De Bruyne', pos:'MF', speed:76, power:86, tackle:70, skill:94 },
  { id:11, name:'Bellingham', pos:'MF', speed:82, power:84, tackle:78, skill:90 },
  { id:12, name:'Pedri', pos:'MF', speed:78, power:68, tackle:72, skill:92 },
  { id:13, name:'Valverde', pos:'MF', speed:88, power:82, tackle:80, skill:86 },
  { id:14, name:'Salah', pos:'FW', speed:92, power:86, tackle:48, skill:92 },
  { id:15, name:'Haaland', pos:'FW', speed:90, power:96, tackle:45, skill:88 },
  { id:16, name:'Vinicius', pos:'FW', speed:96, power:82, tackle:42, skill:93 },
  { id:17, name:'Mbappe', pos:'FW', speed:97, power:88, tackle:40, skill:94 },
  { id:18, name:'Saka', pos:'FW', speed:88, power:80, tackle:55, skill:88 },
  { id:19, name:'Kane', pos:'FW', speed:78, power:92, tackle:50, skill:90 },
  { id:20, name:'Odegaard', pos:'MF', speed:76, power:74, tackle:68, skill:91 },
  // Phase 4, Step 4: squad depth so both sides can field a real bench
  // (11v11 needs 11 starters + up to 7 subs per side). These are
  // generic reserve-squad entries, not real athletes.
  { id:21, name:'Reserve GK A', pos:'GK', speed:50, power:46, tackle:66, skill:70 },
  { id:22, name:'Reserve GK B', pos:'GK', speed:53, power:44, tackle:64, skill:72 },
  { id:23, name:'Squad CB A', pos:'DF', speed:68, power:80, tackle:84, skill:70 },
  { id:24, name:'Squad CB B', pos:'DF', speed:66, power:78, tackle:82, skill:68 },
  { id:25, name:'Squad LB A', pos:'DF', speed:78, power:66, tackle:76, skill:72 },
  { id:26, name:'Squad RB A', pos:'DF', speed:80, power:68, tackle:78, skill:74 },
  { id:27, name:'Squad CB C', pos:'DF', speed:64, power:76, tackle:80, skill:66 },
  { id:28, name:'Squad WB A', pos:'DF', speed:82, power:64, tackle:74, skill:76 },
  { id:29, name:'Squad DM A', pos:'MF', speed:66, power:74, tackle:82, skill:80 },
  { id:30, name:'Squad CM A', pos:'MF', speed:74, power:70, tackle:70, skill:82 },
  { id:31, name:'Squad CM B', pos:'MF', speed:72, power:68, tackle:68, skill:80 },
  { id:32, name:'Squad AM A', pos:'MF', speed:80, power:66, tackle:60, skill:84 },
  { id:33, name:'Squad WM A', pos:'MF', speed:84, power:64, tackle:58, skill:78 },
  { id:34, name:'Squad DM B', pos:'MF', speed:64, power:72, tackle:80, skill:76 },
  { id:35, name:'Squad ST A', pos:'FW', speed:86, power:80, tackle:40, skill:80 },
  { id:36, name:'Squad ST B', pos:'FW', speed:84, power:82, tackle:38, skill:78 },
  { id:37, name:'Squad WF A', pos:'FW', speed:90, power:70, tackle:36, skill:82 },
  { id:38, name:'Squad WF B', pos:'FW', speed:88, power:68, tackle:34, skill:80 },
  { id:39, name:'Squad ST C', pos:'FW', speed:80, power:84, tackle:42, skill:76 },
  { id:40, name:'Squad CM C', pos:'MF', speed:70, power:66, tackle:66, skill:74 },
];

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');


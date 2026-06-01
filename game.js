// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ROOM_SIZE   = 4;
const ROOM_HEIGHT = 2.8;
const MAZE_ROOMS  = 60;
const MOVE_SPEED  = 0.055;
const ECHO_DURATION = 280; // frames
const MAZE_SEED   = 20260101; // semente fixa — mesmo mapa pra todo mundo

// ─── SEEDED RNG (mulberry32) ──────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(MAZE_SEED);

// ─── STATE ────────────────────────────────────────────────────────────────────
let playerName   = '';
let playerId     = null;
let scene, camera, renderer;
let yaw = 0, pitch = 0;
let pointerLocked = false;
let noclipActive  = false;
let frame = 0;
let sanity = 100; // 0-100
let echoTimer = 0;
let lastEchoRoom = '';
let isGraving = false;

const keys = {};
const mobileState = { f: false, b: false, l: false, r: false };
const roomSet  = new Set();
const edgeSet  = new Set();
const roomThoughtsCache = {}; // roomKey -> [{text, author}]

// ─── LOADING ──────────────────────────────────────────────────────────────────
function setLoadingStatus(msg, pct) {
  document.getElementById('loading-status').textContent = msg;
  document.getElementById('loading-bar').style.width = pct + '%';
}

// ─── NAME SCREEN ──────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const ls = document.getElementById('loading-screen');
  const ns = document.getElementById('name-screen');

  setLoadingStatus('calibrando lâmpadas...', 20);
  setTimeout(() => {
    setLoadingStatus('construindo corredores...', 55);
    setTimeout(() => {
      setLoadingStatus('a mente está acordando...', 90);
      setTimeout(() => {
        ls.style.opacity = '0';
        setTimeout(() => {
          ls.style.display = 'none';
          ns.style.display = 'flex';
          document.getElementById('name-input').focus();
        }, 800);
      }, 600);
    }, 500);
  }, 600);

  document.getElementById('name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') startGame();
  });
});

window.startGame = function () {
  const val = document.getElementById('name-input').value.trim();
  const key = document.getElementById('key-input').value.trim();
  playerName = val || 'anônimo';
  playerId   = 'player_' + Math.random().toString(36).slice(2, 10);
  if (key) window.__ANTHROPIC_KEY__ = key;

  document.getElementById('name-screen').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  document.getElementById('player-name-hud').textContent = playerName;

  initThree();
  buildMaze();
  setupInput();
  animate();
};

// ─── THREE.JS INIT ────────────────────────────────────────────────────────────
function initThree() {
  const canvas = document.getElementById('c');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120f00);
  scene.fog = new THREE.Fog(0x120f00, 6, 22);

  camera = new THREE.PerspectiveCamera(72, 1, 0.05, 40);
  camera.position.set(0, ROOM_HEIGHT * 0.42, 0);
  camera.rotation.order = 'YXZ';

  resizeRenderer();
  window.addEventListener('resize', resizeRenderer);
}

function resizeRenderer() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ─── TEXTURES ────────────────────────────────────────────────────────────────
function makeNoiseTexture(baseHex, gridLines = false) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = (baseHex >> 16) & 255;
  const g = (baseHex >> 8)  & 255;
  const b =  baseHex        & 255;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = (Math.random() - 0.5) * 22;
      ctx.fillStyle = `rgb(${(r+n)|0},${(g+n)|0},${(b+n)|0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  if (gridLines) {
    ctx.strokeStyle = 'rgba(0,0,0,.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i < size; i += 10) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

const MAT_FLOOR = new THREE.MeshLambertMaterial({ map: makeNoiseTexture(0xb89010, true) });
const MAT_WALL  = new THREE.MeshLambertMaterial({ map: makeNoiseTexture(0xc8a828, false) });
const MAT_CEIL  = new THREE.MeshLambertMaterial({ map: makeNoiseTexture(0x7a6408, false) });

const GEO_FLOOR = new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE);
const GEO_WALL  = new THREE.PlaneGeometry(ROOM_SIZE, ROOM_HEIGHT);
const GEO_CEIL  = new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE);

// ─── MAZE GENERATION ─────────────────────────────────────────────────────────
function buildMaze() {
  const visited = new Set();
  const stack = [[0, 0]];
  const edges = [];
  const DIRS = [[0,1],[0,-1],[1,0],[-1,0]];

  visited.add('0,0');
  while (stack.length && visited.size < MAZE_ROOMS) {
    const [cx, cy] = stack[stack.length - 1];
    const avail = DIRS.filter(([dx, dy]) => !visited.has(`${cx+dx},${cy+dy}`));
    if (avail.length) {
      const [dx, dy] = avail[Math.floor(rng() * avail.length)];
      const nx = cx + dx, ny = cy + dy;
      visited.add(`${nx},${ny}`);
      edges.push([[cx,cy],[nx,ny]]);
      stack.push([nx, ny]);
    } else {
      stack.pop();
    }
  }

  for (const k of visited) roomSet.add(k);
  for (const [[ax,ay],[bx,by]] of edges) {
    edgeSet.add([`${ax},${ay}`,`${bx},${by}`].sort().join('|'));
  }

  buildGeometry([...visited].map(s => s.split(',').map(Number)));
  scene.add(new THREE.AmbientLight(0x302800, 0.35));
}

function hasEdge(ax, ay, bx, by) {
  return edgeSet.has([`${ax},${ay}`,`${bx},${by}`].sort().join('|'));
}

function buildGeometry(rooms) {
  const S = ROOM_SIZE, H = ROOM_HEIGHT;
  for (const [gx, gy] of rooms) {
    const wx = gx * S, wz = gy * S;

    const floor = new THREE.Mesh(GEO_FLOOR, MAT_FLOOR);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(wx, 0, wz);
    scene.add(floor);

    const ceil = new THREE.Mesh(GEO_CEIL, MAT_CEIL);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(wx, H, wz);
    scene.add(ceil);

    const wallDefs = [
      { dx: 0,      dz: -S/2, ry: 0,            nx: gx,   ny: gy-1 },
      { dx: 0,      dz:  S/2, ry: Math.PI,       nx: gx,   ny: gy+1 },
      { dx: -S/2,   dz: 0,    ry: Math.PI/2,     nx: gx-1, ny: gy   },
      { dx:  S/2,   dz: 0,    ry: -Math.PI/2,    nx: gx+1, ny: gy   },
    ];
    for (const { dx, dz, ry, nx, ny } of wallDefs) {
      const isOpen = roomSet.has(`${nx},${ny}`) || hasEdge(gx, gy, nx, ny);
      if (!isOpen) {
        const w = new THREE.Mesh(GEO_WALL, MAT_WALL);
        w.position.set(wx + dx, H / 2, wz + dz);
        w.rotation.y = ry;
        scene.add(w);
      }
    }

    // light
    const light = new THREE.PointLight(0xffe880, 0.65, 8);
    light.position.set(wx, H - 0.25, wz);
    scene.add(light);

    // occasional flicker light
    if (rng() > 0.65) {
      const fl = new THREE.PointLight(0xffcc20, 0.2, 5);
      fl.position.set(wx + (rng() - .5) * 2, H - .4, wz + (rng() - .5) * 2);
      fl.userData.flicker = true;
      scene.add(fl);
    }
  }
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
function setupInput() {
  document.addEventListener('keydown', e => { keys[e.code] = true; });
  document.addEventListener('keyup',   e => { keys[e.code] = false; });

  const canvas = document.getElementById('c');
  canvas.addEventListener('click', () => {
    if (!pointerLocked) canvas.requestPointerLock && canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    document.getElementById('hint-overlay').style.display = pointerLocked ? 'none' : 'block';
  });
  document.addEventListener('mousemove', e => {
    if (!pointerLocked) return;
    yaw   -= e.movementX * 0.0022;
    pitch  = Math.max(-1.1, Math.min(1.1, pitch - e.movementY * 0.0022));
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  });

  // touch look
  let tx = 0, ty = 0;
  canvas.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  canvas.addEventListener('touchmove',  e => {
    const dx = e.touches[0].clientX - tx;
    const dy = e.touches[0].clientY - ty;
    yaw   -= dx * 0.003;
    pitch  = Math.max(-1.1, Math.min(1.1, pitch - dy * 0.003));
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
  }, { passive: true });

  // mobile move buttons
  const mb = id => document.getElementById(id);
  const bindMb = (id, key) => {
    mb(id).addEventListener('touchstart', e => { e.preventDefault(); mobileState[key] = true; },  { passive: false });
    mb(id).addEventListener('touchend',   () => mobileState[key] = false);
  };
  bindMb('mb-f', 'f'); bindMb('mb-b', 'b');
  bindMb('mb-l', 'l'); bindMb('mb-r', 'r');
}

// ─── MOVEMENT ────────────────────────────────────────────────────────────────
const _dir   = new THREE.Vector3();
const _right = new THREE.Vector3();

function movePlayer() {
  const fwd = keys['KeyW'] || keys['ArrowUp']    || mobileState.f;
  const bwd = keys['KeyS'] || keys['ArrowDown']  || mobileState.b;
  const lft = keys['KeyA'] || keys['ArrowLeft']  || mobileState.l;
  const rgt = keys['KeyD'] || keys['ArrowRight'] || mobileState.r;
  if (!fwd && !bwd && !lft && !rgt) return;

  camera.getWorldDirection(_dir);
  _dir.y = 0; _dir.normalize();
  _right.crossVectors(_dir, new THREE.Vector3(0, 1, 0));

  const vel = new THREE.Vector3();
  if (fwd) vel.addScaledVector(_dir, MOVE_SPEED);
  if (bwd) vel.addScaledVector(_dir, -MOVE_SPEED);
  if (lft) vel.addScaledVector(_right, -MOVE_SPEED);
  if (rgt) vel.addScaledVector(_right, MOVE_SPEED);

  const np = camera.position.clone().add(vel);
  const gx = Math.round(np.x / ROOM_SIZE);
  const gy = Math.round(np.z / ROOM_SIZE);
  const inRoom = roomSet.has(`${gx},${gy}`);

  if (inRoom || noclipActive) {
    camera.position.add(vel);
    camera.position.y = ROOM_HEIGHT * 0.42;
  }
}

// ─── ROOM KEY ────────────────────────────────────────────────────────────────
function getCurrentRoomKey() {
  const gx = Math.round(camera.position.x / ROOM_SIZE);
  const gy = Math.round(camera.position.z / ROOM_SIZE);
  return `${gx},${gy}`;
}

function roomDisplayId(key) {
  const [a, b] = key.split(',').map(Number);
  return String(Math.abs(a * 31 + b * 17 + 1337) % 9999).padStart(4, '0');
}

// ─── ECHO UI ─────────────────────────────────────────────────────────────────
function showEcho(text, author) {
  document.getElementById('echo-text').textContent   = text;
  document.getElementById('echo-author').textContent = author ? `[ ${author} ]` : '';
  document.getElementById('echo-box').style.opacity  = '1';
  echoTimer = ECHO_DURATION;
}
function hideEcho() {
  document.getElementById('echo-box').style.opacity = '0';
}

// ─── THOUGHTS API ─────────────────────────────────────────────────────────────
// ─── CREDENCIAIS (direto no browser — anon key é pública por design) ──────────
const SUPABASE_URL      = "https://egfslhfevswjzmohrljm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnZnNsaGZldnN3anptb2hybGptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzU0NzksImV4cCI6MjA5NTg1MTQ3OX0.sq9Dswanc9npNGMLSUTQ6Z7l5pv9ZRoBTKBWBkHy6ko";

async function fetchThoughtsForRoom(roomKey) {
  if (roomThoughtsCache[roomKey]) return roomThoughtsCache[roomKey];
  try {
    const url = `${SUPABASE_URL}/rest/v1/thoughts`
      + `?room_key=eq.${encodeURIComponent(roomKey)}`
      + `&select=distorted_text,author_name`
      + `&order=created_at.desc&limit=20`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const rows = await res.json();
    roomThoughtsCache[roomKey] = (rows || []).map(r => ({
      text: r.distorted_text,
      author: r.author_name
    }));
    return roomThoughtsCache[roomKey];
  } catch {
    return [];
  }
}

async function distortWithClaude(text) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": window.__ANTHROPIC_KEY__ || "",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        messages: [{
          role: "user",
          content: `Você é a MENTE DAS BACKROOMS — uma entidade que absorve pensamentos humanos e os regurgita de forma levemente errada, como uma cópia imperfeita feita por algo que quase entende o que é ser humano, mas erra nos detalhes sutis.\n\nPensamento original: "${text}"\n\nReescreva como um eco perturbador. Uma ou duas frases curtas. Sem aspas. Sem explicações. Apenas o eco.`
        }]
      })
    });
    const data = await res.json();
    return data.content?.find(b => b.type === "text")?.text?.trim() || text;
  } catch {
    return text;
  }
}

async function saveToSupabase(roomKey, originalText, distortedText) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/thoughts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        room_key: roomKey,
        original_text: originalText,
        distorted_text: distortedText,
        author_name: playerName || "anônimo",
        player_id: playerId || null
      })
    });
  } catch (e) {
    console.error("Supabase save error:", e);
  }
}

async function distortAndSave(originalText, roomKey) {
  const distorted = await distortWithClaude(originalText);
  await saveToSupabase(roomKey, originalText, distorted);
  if (!roomThoughtsCache[roomKey]) roomThoughtsCache[roomKey] = [];
  roomThoughtsCache[roomKey].push({ text: distorted, author: playerName });
  return distorted;
}

window.leaveThought = async function () {
  const inp = document.getElementById('thought-in');
  const val = inp.value.trim();
  if (!val || isGraving) return;
  isGraving = true;
  inp.value = '';

  const btn = document.getElementById('btn-grave');
  btn.disabled = true;
  btn.textContent = '...';

  const roomKey = getCurrentRoomKey();
  const distorted = await distortAndSave(val, roomKey);

  // atualiza cache local imediatamente
  if (!roomThoughtsCache[roomKey]) roomThoughtsCache[roomKey] = [];
  roomThoughtsCache[roomKey].push({ text: distorted, author: playerName });

  // força o echo aparecer agora
  showEcho(distorted, 'seu eco');
  // reseta lastEchoRoom pra quando sair e voltar buscar de novo
  lastEchoRoom = '';

  btn.disabled = false;
  btn.textContent = 'GRAVAR';
  isGraving = false;
};

window.triggerNoclip = function () {
  noclipActive = !noclipActive;
  document.getElementById('btn-noclip').textContent = noclipActive ? 'VOLTAR' : 'NOCLIP';
  if (noclipActive) showEcho('você atravessou as paredes. mas algo te acompanhou.', '');
};

// ─── SANITY ───────────────────────────────────────────────────────────────────
function updateSanity() {
  sanity = Math.max(0, sanity - 0.003);
  const pct = sanity;
  document.getElementById('sanity-fill').style.width = pct + '%';
  const flicker = document.getElementById('flicker-overlay');
  if (sanity < 40) {
    flicker.style.opacity = ((40 - sanity) / 40 * 0.12 * Math.sin(frame * 0.08)).toFixed(3);
  }
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  frame++;

  if (frame % 2 === 0) movePlayer();

  // flicker lights
  if (frame % 5 === 0) {
    scene.children.forEach(obj => {
      if (obj.userData.flicker) {
        obj.intensity = 0.05 + Math.random() * 0.35;
      }
    });
  }

  // echo timer
  if (echoTimer > 0) {
    echoTimer--;
    if (echoTimer === 0) hideEcho();
  }

  // room change — fetch echoes
  if (frame % 30 === 0) {
    const rk = getCurrentRoomKey();
    if (rk !== lastEchoRoom && roomSet.has(rk)) {
      lastEchoRoom = rk;
      fetchThoughtsForRoom(rk).then(thoughts => {
        if (thoughts.length > 0) {
          const t = thoughts[Math.floor(Math.random() * thoughts.length)];
          showEcho(t.text, t.author);
        }
      });
    }
  }

  // HUD
  if (frame % 10 === 0) {
    const rk = getCurrentRoomKey();
    document.getElementById('coords').textContent = `SALA ${roomDisplayId(rk)}`;
    const a = ((-yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const DIRS = ['N','NE','L','SE','S','SO','O','NO'];
    document.getElementById('compass').textContent = DIRS[Math.round(a / (Math.PI / 4)) % 8];
  }

  updateSanity();
  renderer.render(scene, camera);
}

import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";

const canvas = document.querySelector("#game");
const hud = document.querySelector("#hud");
const loadout = document.querySelector("#loadout");
const playerNameInput = document.querySelector("#player-name");
const hpEl = document.querySelector("#hp");
const ammoEl = document.querySelector("#ammo");
const reloadEl = document.querySelector("#reload");
const revealPill = document.querySelector("#reveal-pill");
const scoreboardEl = document.querySelector("#scoreboard");
const feedEl = document.querySelector("#feed");
const minimap = document.querySelector("#minimap");
const resumeButton = document.querySelector("#resume");
const hitmarker = document.querySelector("#hitmarker");
const damageVignette = document.querySelector("#damage-vignette");
const scopeOverlay = document.querySelector("#scope");
const aimAssistInput = document.querySelector("#aim-assist");
const autoAimInput = document.querySelector("#auto-aim");
const assistIntensityInput = document.querySelector("#assist-intensity");
const mapCtx = minimap.getContext("2d");

const BASE_SPEED = 6.25;
const NORMAL_FOV = 74;
const SCOPE_FOV = 32;
const CHUNK_SIZE = 18;
const PLAYER_HEIGHT = 1.7;
const EYE_HEIGHT = 1.45;
const LOCAL_WEAPONS = {
  assault: { id: "assault", damage: 8, cooldown: 0.1, magazine: 15, reload: 1.34, headshot: 1.5, speed: 0.9, range: 30, dropStart: 10, dropDamageStart: 7.9, dropDamageEnd: 2, burst: 1, burstGap: 0 },
  burst: { id: "burst", damage: 14, cooldown: 0.6, magazine: 12, reload: 0.92, headshot: 1, speed: 0.95, range: 45, dropStart: 15, dropDamageStart: 13.9, dropDamageEnd: 3.5, burst: 3, burstGap: 0.15 },
  sniper: { id: "sniper", damage: 40, cooldown: 1.6, magazine: 4, reload: 2.5, headshot: 2.5, speed: 1, range: 120, dropStart: null, dropDamageStart: null, dropDamageEnd: null, burst: 1, burstGap: 0 }
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec7df);
scene.fog = new THREE.Fog(0x9cced5, 42, 150);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
camera.rotation.order = "YXZ";

const sun = new THREE.DirectionalLight(0xfff1cf, 2.35);
sun.position.set(36, 52, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -90;
sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90;
sun.shadow.camera.bottom = -90;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 180;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbde9ff, 0x617241, 1.45));

const root = new THREE.Group();
const chunkRoot = new THREE.Group();
const playerRoot = new THREE.Group();
const tracerRoot = new THREE.Group();
const boundaryRoot = new THREE.Group();
scene.add(root, chunkRoot, playerRoot, tracerRoot, boundaryRoot);

const materials = {
  grass: new THREE.MeshStandardMaterial({ color: 0x6f9856, roughness: 0.96 }),
  grass2: new THREE.MeshStandardMaterial({ color: 0x86aa62, roughness: 0.98 }),
  road: new THREE.MeshStandardMaterial({ color: 0x4c5047, roughness: 0.9 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0x93734f, roughness: 0.95 }),
  wallA: new THREE.MeshStandardMaterial({ color: 0xcaa980, roughness: 0.78 }),
  wallB: new THREE.MeshStandardMaterial({ color: 0xd7c2a0, roughness: 0.78 }),
  wallC: new THREE.MeshStandardMaterial({ color: 0xaeb7ae, roughness: 0.78 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x8d3f34, roughness: 0.86 }),
  roofDark: new THREE.MeshStandardMaterial({ color: 0x4e4c49, roughness: 0.86 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4f34, roughness: 0.9 }),
  leaves: new THREE.MeshStandardMaterial({ color: 0x2f6f48, roughness: 0.86 }),
  leavesLight: new THREE.MeshStandardMaterial({ color: 0x4f9c5d, roughness: 0.86 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x8b938a, roughness: 0.82 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x98d0e5, roughness: 0.28, metalness: 0.02 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x101716, transparent: true, opacity: 0.28 }),
  boundary: new THREE.MeshBasicMaterial({ color: 0xe9c46a, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
};

const state = {
  ws: null,
  connected: false,
  joined: false,
  offline: false,
  pendingJoin: false,
  selfId: null,
  seed: 1,
  worldRadius: 52,
  weaponDefs: {},
  players: new Map(),
  playerMeshes: new Map(),
  chunks: new Map(),
  revealUntil: 0,
  selectedWeapon: "assault",
  lastHp: 100,
  pointerLocked: false,
  yaw: 0,
  pitch: 0,
  keys: new Set(),
  shooting: false,
  aiming: false,
  aimAssist: false,
  autoAim: false,
  assistIntensity: 0.45,
  feed: [],
  tracers: [],
  lastStateAt: 0,
  startedAt: performance.now(),
  weaponKick: 0,
  reloadAnim: 0,
  walkPhase: 0,
  offlineNextShotAt: 0,
  offlineShots: [],
  offlineRevealAt: 0,
  offlineBotGoal: { x: 8, z: 8 },
  offlineBotThinkAt: 0,
  localPos: new THREE.Vector3(0, EYE_HEIGHT, 0)
};

const clock = new THREE.Clock();
const forwardVector = new THREE.Vector3();
const rightVector = new THREE.Vector3();
const tempVector = new THREE.Vector3();
const rayDir = new THREE.Vector3();
let weaponView = null;
let audio = null;

connect();
buildSkyDetails();
buildWeaponView("assault");
rebuildWorld();

document.querySelectorAll(".weapon-card").forEach((button) => {
  button.addEventListener("click", () => {
    state.selectedWeapon = button.dataset.weapon;
    joinGame();
  });
});

resumeButton.addEventListener("click", requestPointerLockSafe);
aimAssistInput.addEventListener("change", () => {
  state.aimAssist = aimAssistInput.checked;
  syncAssistControls();
});
autoAimInput.addEventListener("change", () => {
  state.autoAim = autoAimInput.checked;
  syncAssistControls();
});
assistIntensityInput.addEventListener("input", () => {
  state.assistIntensity = Number(assistIntensityInput.value) / 100;
  syncAssistControls();
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.addEventListener("pointerlockchange", () => {
  state.pointerLocked = document.pointerLockElement === canvas;
  resumeButton.classList.toggle("hidden", state.pointerLocked || !state.joined);
});

document.addEventListener("mousemove", (event) => {
  if (!state.pointerLocked || !state.joined) return;
  const self = state.players.get(state.selfId);
  const scoped = self && self.weapon === "sniper" && state.aiming;
  const sensitivity = scoped ? 0.0009 : 0.0021;
  state.yaw -= event.movementX * sensitivity;
  state.pitch -= event.movementY * sensitivity * 0.92;
  state.pitch = clamp(state.pitch, -1.22, 1.22);
});

document.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  const code = event.code.toLowerCase();
  state.keys.add(code);
  if (code === "keyr") send({ type: "reload" });
  if (code === "keyq") {
    state.aimAssist = !state.aimAssist;
    syncAssistControls();
    pushFeed(`Aim assist ${state.aimAssist ? "on" : "off"}.`);
  }
  if (code === "keye") {
    state.autoAim = !state.autoAim;
    if (state.autoAim) state.aimAssist = true;
    syncAssistControls();
    pushFeed(`Auto aim ${state.autoAim ? "on" : "off"}.`);
  }
  if (code === "minus") {
    state.assistIntensity = clamp(state.assistIntensity - 0.1, 0, 1);
    syncAssistControls();
  }
  if (code === "equal") {
    state.assistIntensity = clamp(state.assistIntensity + 0.1, 0, 1);
    syncAssistControls();
  }
  if (code === "escape") {
    try {
      document.exitPointerLock();
    } catch {
      // Pointer lock may be unavailable in embedded browser previews.
    }
  }
});

document.addEventListener("keyup", (event) => {
  state.keys.delete(event.code.toLowerCase());
});

document.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("mousedown", (event) => {
  if (!state.joined) return;
  if (event.target.closest("#assist-panel")) return;
  ensureAudio();
  if (!state.pointerLocked) {
    requestPointerLockSafe();
    return;
  }
  if (event.button === 2) {
    state.aiming = true;
    return;
  }
  if (event.button !== 0) return;
  state.shooting = true;
  sendShot();
});

document.addEventListener("mouseup", (event) => {
  if (event.button === 2) state.aiming = false;
  if (event.button === 0) state.shooting = false;
});

setInterval(sendInput, 1000 / 30);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
});

function connect() {
  const ws = new WebSocket(resolveGameServerUrl());
  state.ws = ws;

  ws.addEventListener("open", () => {
    state.connected = true;
    pushFeed("Connected to arena.");
  });

  ws.addEventListener("close", () => {
    state.connected = false;
    state.offline = true;
    if (state.pendingJoin && !state.joined) startOfflineMatch();
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    handleServerMessage(message);
  });
}

function resolveGameServerUrl() {
  const query = new URLSearchParams(location.search);
  const requestedUrl = query.get("server");
  if (requestedUrl) {
    const normalized = normalizeWebSocketUrl(requestedUrl);
    localStorage.setItem("ffaGameServerUrl", normalized);
    return normalized;
  }

  const savedUrl = localStorage.getItem("ffaGameServerUrl");
  if (savedUrl) return normalizeWebSocketUrl(savedUrl);

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}`;
}

function normalizeWebSocketUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/$/, "");
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice(8)}`;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice(7)}`;
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed;
  return `wss://${trimmed}`;
}

function handleServerMessage(message) {
  if (message.type === "hello") {
    state.selfId = message.id;
    state.seed = message.seed || state.seed;
    state.weaponDefs = message.weapons || {};
    return;
  }

  if (message.type === "joined") {
    state.selfId = message.id;
    state.seed = message.seed || state.seed;
    state.worldRadius = message.worldRadius || state.worldRadius;
    state.joined = true;
    loadout.classList.add("hidden");
    hud.classList.remove("hidden");
    requestPointerLockSafe();
    rebuildWorld();
    return;
  }

  if (message.type === "state") {
    state.lastStateAt = performance.now();
    state.seed = message.seed || state.seed;
    if (Math.abs((message.worldRadius || state.worldRadius) - state.worldRadius) > 0.5) {
      state.worldRadius = message.worldRadius;
      rebuildWorld();
    }
    state.revealUntil = message.revealUntil || 0;
    updatePlayers(message.players || []);
    return;
  }

  if (message.type === "shot") {
    onShot(message);
    return;
  }

  if (message.type === "reload") {
    if (message.id === state.selfId) {
      state.reloadAnim = 1;
      playReload(message.weapon);
    }
    return;
  }

  if (message.type === "reveal") {
    state.revealUntil = message.revealUntil || 0;
    playReveal();
    return;
  }

  if (message.type === "feed") {
    pushFeed(message.text);
  }
}

function joinGame() {
  ensureAudio();
  buildWeaponView(state.selectedWeapon);
  state.pendingJoin = true;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    startOfflineMatch();
    return;
  }
  send({
    type: "join",
    name: playerNameInput.value || "",
    weapon: state.selectedWeapon
  });
}

function send(message) {
  if (state.offline) {
    if (message.type === "reload") startOfflineReload();
    return;
  }
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify(message));
}

function requestPointerLockSafe() {
  try {
    const request = canvas.requestPointerLock();
    if (request && typeof request.catch === "function") request.catch(() => {});
  } catch {
    // Some embedded preview surfaces reject pointer lock; gameplay still works in a normal browser tab.
  }
}

function syncAssistControls() {
  aimAssistInput.checked = state.aimAssist;
  autoAimInput.checked = state.autoAim;
  assistIntensityInput.value = String(Math.round(state.assistIntensity * 100));
}

function sendInput() {
  if (!state.joined) return;
  getAimDirection(rayDir);
  const rawDir = { x: rayDir.x, y: rayDir.y, z: rayDir.z };
  getAssistedAimDirection(rayDir);

  if (state.offline) return;

  send({
    type: "input",
    forward: (state.keys.has("keyw") ? 1 : 0) + (state.keys.has("keys") ? -1 : 0),
    strafe: (state.keys.has("keyd") ? 1 : 0) + (state.keys.has("keya") ? -1 : 0),
    shooting: state.shooting,
    yaw: state.yaw,
    pitch: state.pitch,
    dir: rawDir,
    shotDir: { x: rayDir.x, y: rayDir.y, z: rayDir.z }
  });
}

function sendShot() {
  if (!state.joined) return;
  if (state.offline) {
    tryOfflineFire(performance.now());
    return;
  }
  getAssistedAimDirection(rayDir);
  send({ type: "shoot", dir: { x: rayDir.x, y: rayDir.y, z: rayDir.z } });
}

function startOfflineMatch() {
  if (state.joined) return;
  state.offline = true;
  state.joined = true;
  state.pendingJoin = false;
  state.selfId = "offline-player";
  state.weaponDefs = LOCAL_WEAPONS;
  state.worldRadius = 52;

  const weapon = LOCAL_WEAPONS[state.selectedWeapon] || LOCAL_WEAPONS.assault;
  const self = makeOfflinePlayer(state.selfId, playerNameInput.value.trim() || "Player", false, 0, 8, weapon.id);
  const movingBot = makeOfflinePlayer("offline-bot", "Target Bot", true, 8, -8, "assault");
  const dummy = makeOfflinePlayer("offline-dummy", "Training Dummy", true, -10, -6, "assault");
  dummy.isTrainingDummy = true;
  dummy.hp = 300;
  dummy.maxHp = 300;
  dummy.color = "#70e1a1";

  state.players.clear();
  state.players.set(self.id, self);
  state.players.set(movingBot.id, movingBot);
  state.players.set(dummy.id, dummy);
  state.localPos.set(self.x, EYE_HEIGHT, self.z);
  state.offlineNextShotAt = 0;
  state.offlineShots.length = 0;
  state.offlineRevealAt = Date.now() + 10000;

  loadout.classList.add("hidden");
  hud.classList.remove("hidden");
  updatePlayers(Array.from(state.players.values()));
  pushFeed("Training mode active. Multiplayer server is offline.");
  requestPointerLockSafe();
  rebuildWorld();
}

function makeOfflinePlayer(id, name, isBot, x, z, weaponId) {
  const weapon = LOCAL_WEAPONS[weaponId];
  return {
    id,
    name,
    isBot,
    isTrainingDummy: false,
    color: isBot ? "#f0b94b" : "#4cc9f0",
    x,
    z,
    renderX: x,
    renderZ: z,
    yaw: 0,
    pitch: 0,
    hp: 100,
    maxHp: 100,
    score: 0,
    deaths: 0,
    weapon: weapon.id,
    ammo: weapon.magazine,
    magazine: weapon.magazine,
    reloading: false,
    reloadEnd: 0,
    deadUntil: 0
  };
}

function updateOfflineGame(dt, now) {
  const self = state.players.get(state.selfId);
  if (!self) return;

  moveOfflinePlayer(self, dt);
  updateOfflineBots(dt);

  if (self.reloading && Date.now() >= self.reloadEnd) {
    const weapon = LOCAL_WEAPONS[self.weapon];
    self.ammo = weapon.magazine;
    self.reloading = false;
    self.reloadEnd = 0;
  }

  if (state.shooting) tryOfflineFire(now);
  processOfflineShots(now);

  if (Date.now() >= state.offlineRevealAt) {
    state.revealUntil = Date.now() + 3000;
    state.offlineRevealAt = Date.now() + 10000;
    playReveal();
  }

  updateSelfHud(self);
  updateScoreboard();
}

function moveOfflinePlayer(player, dt) {
  if (player.hp <= 0) return;
  const forward = (state.keys.has("keyw") ? 1 : 0) + (state.keys.has("keys") ? -1 : 0);
  const strafe = (state.keys.has("keyd") ? 1 : 0) + (state.keys.has("keya") ? -1 : 0);
  const length = Math.hypot(forward, strafe);
  if (!length) return;

  getRawAimDirection(rayDir);
  const flatLength = Math.hypot(rayDir.x, rayDir.z) || 1;
  const fx = rayDir.x / flatLength;
  const fz = rayDir.z / flatLength;
  const rx = -fz;
  const rz = fx;
  const speed = BASE_SPEED * LOCAL_WEAPONS[player.weapon].speed;
  player.x += (fx * (forward / length) + rx * (strafe / length)) * speed * dt;
  player.z += (fz * (forward / length) + rz * (strafe / length)) * speed * dt;

  const distance = Math.hypot(player.x, player.z);
  const limit = state.worldRadius - 2;
  if (distance > limit) {
    player.x *= limit / distance;
    player.z *= limit / distance;
  }
}

function updateOfflineBots(dt) {
  const now = Date.now();
  const movingBot = state.players.get("offline-bot");
  const dummy = state.players.get("offline-dummy");

  for (const bot of [movingBot, dummy]) {
    if (bot && bot.hp <= 0 && now >= bot.deadUntil) {
      bot.hp = bot.maxHp;
      bot.deadUntil = 0;
    }
  }

  if (!movingBot || movingBot.hp <= 0) return;
  if (now >= state.offlineBotThinkAt || Math.hypot(state.offlineBotGoal.x - movingBot.x, state.offlineBotGoal.z - movingBot.z) < 1.5) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 7 + Math.random() * 18;
    state.offlineBotGoal = { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
    state.offlineBotThinkAt = now + 2200;
  }

  const dx = state.offlineBotGoal.x - movingBot.x;
  const dz = state.offlineBotGoal.z - movingBot.z;
  const length = Math.hypot(dx, dz) || 1;
  movingBot.x += (dx / length) * 1.45 * dt;
  movingBot.z += (dz / length) * 1.45 * dt;
  movingBot.yaw = Math.atan2(dx, -dz);
}

function tryOfflineFire(now) {
  const self = state.players.get(state.selfId);
  if (!self || self.hp <= 0 || self.reloading || now < state.offlineNextShotAt) return;
  const weapon = LOCAL_WEAPONS[self.weapon];
  if (self.ammo <= 0) {
    startOfflineReload();
    return;
  }

  const shots = Math.min(weapon.burst, self.ammo);
  self.ammo -= shots;
  state.offlineNextShotAt = now + weapon.cooldown * 1000;
  for (let i = 0; i < shots; i += 1) {
    state.offlineShots.push({ due: now + weapon.burstGap * 1000 * i, weapon: weapon.id });
  }
  if (self.ammo <= 0) startOfflineReload();
}

function startOfflineReload() {
  const self = state.players.get(state.selfId);
  if (!self || self.reloading) return;
  const weapon = LOCAL_WEAPONS[self.weapon];
  if (self.ammo >= weapon.magazine) return;
  self.reloading = true;
  self.reloadEnd = Date.now() + weapon.reload * 1000;
  state.reloadAnim = 1;
  playReload(weapon.id);
}

function processOfflineShots(now) {
  state.offlineShots.sort((a, b) => a.due - b.due);
  while (state.offlineShots.length && state.offlineShots[0].due <= now) {
    const shot = state.offlineShots.shift();
    resolveOfflineShot(LOCAL_WEAPONS[shot.weapon]);
  }
}

function resolveOfflineShot(weapon) {
  const self = state.players.get(state.selfId);
  if (!self) return;
  getAssistedAimDirection(rayDir);
  const origin = new THREE.Vector3(self.x, EYE_HEIGHT, self.z);
  let closest = null;

  for (const target of state.players.values()) {
    if (target.id === self.id || target.hp <= 0) continue;
    const range = target.isTrainingDummy ? Math.max(weapon.range, 140) : weapon.range;
    const headDistance = raySphereDistance(origin, rayDir, new THREE.Vector3(target.x, 1.52, target.z), 0.34, range);
    const bodyDistance = raySphereDistance(origin, rayDir, new THREE.Vector3(target.x, 0.78, target.z), 0.62, range);
    const distance = headDistance !== null && (bodyDistance === null || headDistance <= bodyDistance) ? headDistance : bodyDistance;
    if (distance === null || (closest && distance >= closest.distance)) continue;
    closest = { target, distance, headshot: distance === headDistance };
  }

  if (!closest) {
    const to = origin.clone().add(rayDir.clone().multiplyScalar(Math.min(weapon.range, 70)));
    onShot({ type: "shot", shooterId: self.id, weapon: weapon.id, from: origin, to, hit: false });
    return;
  }

  const damageDistance = closest.target.isTrainingDummy ? Math.min(closest.distance, weapon.range) : closest.distance;
  const damage = calculateOfflineDamage(weapon, damageDistance, closest.headshot);
  closest.target.hp = clamp(closest.target.hp - damage, 0, closest.target.maxHp);
  closest.target.lastHitAt = performance.now();
  const to = origin.clone().add(rayDir.clone().multiplyScalar(closest.distance));
  onShot({ type: "shot", shooterId: self.id, targetId: closest.target.id, weapon: weapon.id, from: origin, to, hit: true, headshot: closest.headshot, damage });

  if (closest.target.hp <= 0) {
    self.score += 1;
    closest.target.deaths += 1;
    closest.target.deadUntil = Date.now() + 1300;
    pushFeed(`${self.name} eliminated ${closest.target.name}.`);
  }
}

function raySphereDistance(origin, direction, center, radius, range) {
  const offset = origin.clone().sub(center);
  const b = offset.dot(direction);
  const c = offset.lengthSq() - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const distance = -b - root > 0 ? -b - root : -b + root;
  return distance > 0 && distance <= range ? distance : null;
}

function calculateOfflineDamage(weapon, distance, headshot) {
  let damage = weapon.damage;
  if (weapon.dropStart !== null && distance > weapon.dropStart) {
    const t = clamp((distance - weapon.dropStart) / (weapon.range - weapon.dropStart), 0, 1);
    damage = lerp(weapon.dropDamageStart, weapon.dropDamageEnd, t);
  }
  if (headshot) damage *= weapon.headshot;
  return Math.round(damage * 10) / 10;
}

function getAssistedAimDirection(out) {
  getRawAimDirection(out);
  if (!state.aimAssist && !state.autoAim) return out;

  const target = findAimTarget(out, state.autoAim ? "auto" : "assist");
  if (!target) return out;

  const strength = state.autoAim ? 1 : clamp(0.25 + state.assistIntensity * 0.72, 0, 0.96);
  out.lerp(target.direction, strength).normalize();
  return out;
}

function getRawAimDirection(out) {
  out.set(
    -Math.sin(state.yaw) * Math.cos(state.pitch),
    Math.sin(state.pitch),
    -Math.cos(state.yaw) * Math.cos(state.pitch)
  ).normalize();
  return out;
}

function findAimTarget(baseDir, mode = "assist") {
  const self = state.players.get(state.selfId);
  if (!self) return null;

  const origin = new THREE.Vector3(self.x, EYE_HEIGHT, self.z);
  const autoCone = lerp(0.88, 0.22, state.assistIntensity);
  const assistCone = lerp(0.985, 0.74, state.assistIntensity);
  const cone = mode === "auto" ? autoCone : assistCone;
  let best = null;

  for (const player of state.players.values()) {
    if (player.id === state.selfId || player.hp <= 0) continue;
    const targetY = player.isTrainingDummy ? 1.0 : 1.2;
    const toTarget = new THREE.Vector3(player.x, targetY, player.z).sub(origin);
    const distance = toTarget.length();
    if (distance < 0.1 || distance > 80) continue;
    const direction = toTarget.multiplyScalar(1 / distance);
    const dot = baseDir.dot(direction);
    if (dot < cone) continue;
    const priority = dot * 2 + (player.isTrainingDummy ? 0.08 : 0) - distance * 0.0012;
    if (!best || priority > best.priority) {
      best = { direction: direction.clone(), priority, player };
    }
  }

  return best;
}

function updatePlayers(players) {
  const seen = new Set();
  for (const player of players) {
    seen.add(player.id);
    const previous = state.players.get(player.id);
    state.players.set(player.id, {
      ...previous,
      ...player,
      renderX: previous ? previous.renderX : player.x,
      renderZ: previous ? previous.renderZ : player.z,
      lastSeen: performance.now()
    });

    if (player.id === state.selfId) {
      updateSelfHud(player);
    }

    if (!state.playerMeshes.has(player.id)) {
      state.playerMeshes.set(player.id, createPlayerMesh(player));
    }
  }

  for (const [id, mesh] of state.playerMeshes.entries()) {
    if (!seen.has(id)) {
      playerRoot.remove(mesh);
      disposeObject(mesh);
      state.playerMeshes.delete(id);
      state.players.delete(id);
    }
  }

  updateScoreboard();
}

function updateSelfHud(player) {
  hpEl.textContent = `${Math.ceil(player.hp)} HP`;
  hpEl.classList.toggle("low", player.hp <= 35);
  ammoEl.textContent = `${player.ammo} / ${player.magazine}`;

  if (player.reloading) {
    reloadEl.textContent = `Reload ${Math.max(0, (player.reloadEnd - Date.now()) / 1000).toFixed(1)}s`;
  } else if (player.hp <= 0) {
    reloadEl.textContent = "Respawning";
  } else {
    reloadEl.textContent = "";
  }

  if (player.hp < state.lastHp && player.hp > 0) {
    damageVignette.classList.add("active");
    setTimeout(() => damageVignette.classList.remove("active"), 130);
    playHurt();
  }
  state.lastHp = player.hp;
}

function updateScoreboard() {
  const rows = Array.from(state.players.values())
    .sort((a, b) => b.score - a.score || a.deaths - b.deaths || a.name.localeCompare(b.name))
    .slice(0, 8);

  scoreboardEl.innerHTML = rows.map((player) => {
    const dot = `<span style="color:${player.color}">●</span>`;
    const type = player.isBot ? "BOT" : "PLAYER";
    const typeClass = player.isBot ? "bot" : "player";
    const name = `${dot} <span class="type-tag ${typeClass}">${type}</span> ${escapeHtml(player.name)}`;
    return `<div class="score-row"><span class="score-name">${name}</span><span class="score-chip">${player.score} K</span><span class="score-chip">${player.deaths} D</span></div>`;
  }).join("");
}

function update(dt) {
  const now = performance.now();
  const self = state.players.get(state.selfId);

  if (state.offline) updateOfflineGame(dt, now);
  updateAutoAim(self, dt);
  updateCamera(self, dt);
  updateRemotePlayers(dt, now);
  updateWeapon(dt, self);
  updateTracers(dt);
  drawMinimap();

  const revealActive = Date.now() < state.revealUntil;
  revealPill.classList.toggle("active", revealActive);
  const scoped = self && self.weapon === "sniper" && state.aiming && self.hp > 0;
  scopeOverlay.classList.toggle("active", Boolean(scoped));
  camera.fov = lerp(camera.fov, scoped ? SCOPE_FOV : NORMAL_FOV, 1 - Math.pow(0.0003, dt));
  camera.updateProjectionMatrix();

  // Held-fire is scheduled server-side from input state so fast weapons do not skip shots between network messages.
}

function updateAutoAim(self, dt) {
  if (!self || self.hp <= 0 || !state.autoAim) return;
  getRawAimDirection(rayDir);
  const target = findAimTarget(rayDir, "auto");
  if (!target) return;

  const desiredYaw = Math.atan2(-target.direction.x, -target.direction.z);
  const desiredPitch = Math.asin(clamp(target.direction.y, -1, 1));
  const pull = clamp(0.18 + state.assistIntensity * 0.72, 0, 0.94);
  const t = 1 - Math.pow(1 - pull, dt * 10);
  state.yaw += shortestAngleDelta(state.yaw, desiredYaw) * t;
  state.pitch = lerp(state.pitch, desiredPitch, t);
  state.pitch = clamp(state.pitch, -1.22, 1.22);
}

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function updateCamera(self, dt) {
  if (!self) {
    camera.position.set(0, EYE_HEIGHT, 8);
    camera.lookAt(0, EYE_HEIGHT, 0);
    return;
  }

  if (!state.offline) predictLocalMovement(self, dt);
  const target = tempVector.set(self.x, EYE_HEIGHT, self.z);
  state.localPos.lerp(target, 1 - Math.pow(0.00002, dt));
  camera.position.copy(state.localPos);
  camera.rotation.set(state.pitch, state.yaw, 0);

  const moving = Math.abs((state.keys.has("keyw") ? 1 : 0) - (state.keys.has("keys") ? 1 : 0)) > 0 ||
    Math.abs((state.keys.has("keyd") ? 1 : 0) - (state.keys.has("keya") ? 1 : 0)) > 0;

  if (moving && self.hp > 0) {
    const weapon = state.weaponDefs[self.weapon];
    state.walkPhase += dt * BASE_SPEED * (weapon ? weapon.speed : 1) * 7;
    camera.position.y += Math.sin(state.walkPhase) * 0.018;
  }
}

function predictLocalMovement(self, dt) {
  if (!self || self.hp <= 0) return;
  const forward = (state.keys.has("keyw") ? 1 : 0) + (state.keys.has("keys") ? -1 : 0);
  const strafe = (state.keys.has("keyd") ? 1 : 0) + (state.keys.has("keya") ? -1 : 0);
  const length = Math.hypot(forward, strafe);
  if (!length) return;

  const weapon = state.weaponDefs[self.weapon];
  const speed = BASE_SPEED * (weapon ? weapon.speed : 1);
  const f = forward / length;
  const s = strafe / length;
  getAimDirection(rayDir);
  const flatLength = Math.hypot(rayDir.x, rayDir.z) || 1;
  const fx = rayDir.x / flatLength;
  const fz = rayDir.z / flatLength;
  const rx = -fz;
  const rz = fx;
  state.localPos.x += (fx * f + rx * s) * speed * dt;
  state.localPos.z += (fz * f + rz * s) * speed * dt;

  const distance = Math.hypot(state.localPos.x, state.localPos.z);
  const limit = Math.max(4, state.worldRadius - 2);
  if (distance > limit) {
    state.localPos.x *= limit / distance;
    state.localPos.z *= limit / distance;
  }
}

function updateRemotePlayers(dt, now) {
  for (const [id, mesh] of state.playerMeshes.entries()) {
    const player = state.players.get(id);
    if (!player) continue;

    const isSelf = id === state.selfId;
    mesh.visible = !isSelf && player.hp > 0;
    if (isSelf) continue;

    player.renderX = lerp(player.renderX, player.x, 1 - Math.pow(0.02, dt));
    player.renderZ = lerp(player.renderZ, player.z, 1 - Math.pow(0.02, dt));
    mesh.position.set(player.renderX, 0, player.renderZ);
    mesh.rotation.y = player.yaw;

    const speed = Math.hypot(player.x - player.renderX, player.z - player.renderZ);
    const bob = Math.sin(now * 0.008 + id.length) * (speed > 0.02 ? 0.055 : 0.018);
    mesh.userData.body.position.y = 0.74 + bob;
    mesh.userData.head.position.y = 1.43 + bob * 0.5;
    mesh.userData.shadow.scale.setScalar(1 + Math.abs(bob) * 1.5);

    if (now - (player.lastHitAt || 0) < 160) {
      mesh.userData.body.material.emissive.setHex(0x5d1018);
      mesh.userData.head.material.emissive.setHex(0x5d1018);
    } else {
      mesh.userData.body.material.emissive.setHex(0x000000);
      mesh.userData.head.material.emissive.setHex(0x000000);
    }
  }
}

function updateWeapon(dt, self) {
  if (!weaponView) return;

  state.weaponKick = Math.max(0, state.weaponKick - dt * 9);
  state.reloadAnim = Math.max(0, state.reloadAnim - dt * 1.8);

  const moving = self && self.hp > 0 && (
    state.keys.has("keyw") || state.keys.has("keys") || state.keys.has("keya") || state.keys.has("keyd")
  );
  const bob = moving ? Math.sin(state.walkPhase * 1.4) * 0.025 : Math.sin(performance.now() * 0.002) * 0.008;
  const kick = state.weaponKick;
  const reload = state.reloadAnim;

  const scoped = self && self.weapon === "sniper" && state.aiming && self.hp > 0;
  weaponView.visible = !scoped;
  weaponView.position.set(0.32, -0.32 - reload * 0.18 + bob, -0.62 + kick * 0.16);
  weaponView.rotation.set(-0.08 - kick * 0.45 + reload * 0.52, -0.16 + kick * 0.06, 0.02 + reload * 0.6);
}

function createPlayerMesh(player) {
  const group = new THREE.Group();
  const color = new THREE.Color(player.color || "#ffffff");
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.74, metalness: 0.02 });
  const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const limbMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.72), roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.72, 5, 10), bodyMat);
  body.position.y = 0.74;
  body.castShadow = true;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 12), headMat);
  head.position.y = 1.43;
  head.castShadow = true;

  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.5, 4, 8), limbMat);
  const armR = armL.clone();
  armL.position.set(-0.34, 0.88, -0.02);
  armR.position.set(0.34, 0.88, -0.02);
  armL.rotation.z = -0.12;
  armR.rotation.z = 0.12;
  armL.castShadow = true;
  armR.castShadow = true;

  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.52, 4, 8), limbMat);
  const legR = legL.clone();
  legL.position.set(-0.13, 0.28, 0);
  legR.position.set(0.13, 0.28, 0);
  legL.castShadow = true;
  legR.castShadow = true;

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.12), materials.roofDark);
  gun.position.set(0.04, 0.92, -0.36);
  gun.castShadow = true;

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.48, 20), materials.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;

  const label = createLabelSprite(player.isBot ? "BOT" : "PLAYER", player.isBot ? "#e9c46a" : "#4cc9f0");
  label.position.y = 2.02;

  group.add(shadow, body, head, armL, armR, legL, legR, gun, label);
  group.userData = { body, head, shadow, label };
  group.position.set(player.x, 0, player.z);
  playerRoot.add(group);
  return group;
}

function createLabelSprite(text, color) {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 256;
  labelCanvas.height = 72;
  const ctx = labelCanvas.getContext("2d");
  ctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  ctx.fillStyle = "rgba(10, 15, 14, 0.78)";
  roundRect(ctx, 42, 14, 172, 40, 8);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "900 25px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 35);

  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.65, 0.46, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function buildWeaponView(weaponId) {
  if (weaponView) {
    camera.remove(weaponView);
    disposeObject(weaponView);
  }

  weaponView = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2e3733, roughness: 0.58, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121817, roughness: 0.7, metalness: 0.12 });
  const accent = new THREE.MeshStandardMaterial({ color: weaponId === "burst" ? 0x9ad1bb : weaponId === "sniper" ? 0xc3d9e8 : 0xd3c39a, roughness: 0.52, metalness: 0.18 });

  const addBox = (size, pos, mat, rot = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.castShadow = true;
    weaponView.add(mesh);
    return mesh;
  };

  if (weaponId === "assault") {
    addBox([0.72, 0.12, 0.16], [0, 0, 0], metal);
    addBox([0.28, 0.09, 0.15], [-0.38, -0.01, 0.02], dark);
    addBox([0.38, 0.055, 0.085], [0.55, 0.01, 0], accent);
    addBox([0.12, 0.34, 0.12], [0.06, -0.23, 0.02], dark, [0.18, 0, 0]);
    addBox([0.18, 0.28, 0.1], [-0.23, -0.18, 0.02], accent, [-0.25, 0, 0]);
  } else if (weaponId === "burst") {
    addBox([0.66, 0.13, 0.17], [0, 0, 0], accent);
    addBox([0.28, 0.1, 0.15], [-0.36, 0, 0.02], dark);
    addBox([0.36, 0.06, 0.08], [0.52, 0.02, 0], metal);
    addBox([0.12, 0.25, 0.1], [-0.02, -0.2, 0.03], dark, [0.18, 0, 0]);
    addBox([0.22, 0.05, 0.13], [0.08, 0.11, 0], dark);
  } else {
    addBox([0.9, 0.1, 0.13], [0.08, 0, 0], metal);
    addBox([0.46, 0.06, 0.07], [0.74, 0.02, 0], accent);
    addBox([0.3, 0.12, 0.14], [-0.38, 0.02, 0], dark);
    addBox([0.12, 0.32, 0.1], [-0.08, -0.22, 0.02], dark, [0.16, 0, 0]);

    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 16), accent);
    scope.rotation.z = Math.PI / 2;
    scope.position.set(0.14, 0.16, 0);
    scope.castShadow = true;
    weaponView.add(scope);
  }

  weaponView.position.set(0.32, -0.32, -0.62);
  camera.add(weaponView);
  scene.add(camera);
}

function onShot(message) {
  const from = new THREE.Vector3(message.from.x, message.from.y, message.from.z);
  const to = new THREE.Vector3(message.to.x, message.to.y, message.to.z);
  const color = message.hit ? (message.headshot ? 0xfff3a1 : 0xff6f7d) : 0xf4e3a2;
  const tracer = createTracer(from, to, color, message.weapon);
  tracerRoot.add(tracer);
  state.tracers.push(tracer);

  if (message.shooterId === state.selfId) {
    state.weaponKick = 1;
    playShot(message.weapon);
    if (message.hit) {
      flashHitmarker(message.headshot);
      playHit(message.headshot);
    }
  } else {
    playDistantShot(message.weapon, from);
  }
}

function createTracer(from, to, color, weapon) {
  const direction = to.clone().sub(from);
  const length = Math.max(0.01, direction.length());
  const radius = weapon === "sniper" ? 0.045 : weapon === "burst" ? 0.034 : 0.028;
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.55, length, 8, 1, true);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: weapon === "sniper" ? 1 : 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.userData.life = weapon === "sniper" ? 0.18 : 0.13;
  mesh.userData.maxLife = mesh.userData.life;
  return mesh;
}

function updateTracers(dt) {
  for (let i = state.tracers.length - 1; i >= 0; i -= 1) {
    const line = state.tracers[i];
    line.userData.life -= dt;
    line.material.opacity = Math.max(0, line.userData.life / line.userData.maxLife);
    if (line.userData.life <= 0) {
      tracerRoot.remove(line);
      line.geometry.dispose();
      line.material.dispose();
      state.tracers.splice(i, 1);
    }
  }
}

function flashHitmarker(headshot) {
  hitmarker.textContent = headshot ? "X" : "x";
  hitmarker.classList.add("active");
  setTimeout(() => hitmarker.classList.remove("active"), 115);
}

function drawMinimap() {
  const size = minimap.width;
  const half = size / 2;
  const radius = state.worldRadius || 52;
  const self = state.players.get(state.selfId);
  const reveal = Date.now() < state.revealUntil;
  mapCtx.clearRect(0, 0, size, size);
  mapCtx.save();
  mapCtx.translate(half, half);

  mapCtx.strokeStyle = "rgba(233,196,106,0.7)";
  mapCtx.lineWidth = 2;
  mapCtx.beginPath();
  mapCtx.arc(0, 0, half - 9, 0, Math.PI * 2);
  mapCtx.stroke();

  mapCtx.strokeStyle = "rgba(255,255,255,0.12)";
  mapCtx.lineWidth = 1;
  for (let i = -2; i <= 2; i += 1) {
    mapCtx.beginPath();
    mapCtx.moveTo(i * 28, -half + 10);
    mapCtx.lineTo(i * 28, half - 10);
    mapCtx.stroke();
    mapCtx.beginPath();
    mapCtx.moveTo(-half + 10, i * 28);
    mapCtx.lineTo(half - 10, i * 28);
    mapCtx.stroke();
  }

  for (const player of state.players.values()) {
    if (player.hp <= 0) continue;
    const isSelf = player.id === state.selfId;
    if (!isSelf && !reveal && !player.isBot) continue;
    const x = (player.x / radius) * (half - 11);
    const y = (player.z / radius) * (half - 11);
    mapCtx.fillStyle = isSelf ? "#eef7f2" : player.isBot ? "#f0b94b" : "#ff5c7a";
    mapCtx.beginPath();
    mapCtx.arc(x, y, isSelf ? 4.5 : 3.5, 0, Math.PI * 2);
    mapCtx.fill();
  }

  if (self) {
    mapCtx.rotate(self.yaw);
    mapCtx.fillStyle = "rgba(238,247,242,0.8)";
    mapCtx.beginPath();
    mapCtx.moveTo(0, -12);
    mapCtx.lineTo(5, -2);
    mapCtx.lineTo(-5, -2);
    mapCtx.closePath();
    mapCtx.fill();
  }
  mapCtx.restore();
}

function pushFeed(text) {
  if (!text) return;
  state.feed.unshift({ text, at: Date.now() });
  state.feed = state.feed.slice(0, 5);
  feedEl.innerHTML = state.feed.map((item) => `<div class="feed-line">${escapeHtml(item.text)}</div>`).join("");
}

function rebuildWorld() {
  for (const group of state.chunks.values()) {
    chunkRoot.remove(group);
    disposeObject(group);
  }
  state.chunks.clear();
  boundaryRoot.clear();

  const chunkLimit = Math.ceil(state.worldRadius / CHUNK_SIZE);
  for (let cx = -chunkLimit; cx <= chunkLimit; cx += 1) {
    for (let cz = -chunkLimit; cz <= chunkLimit; cz += 1) {
      const x = cx * CHUNK_SIZE;
      const z = cz * CHUNK_SIZE;
      if (Math.hypot(x, z) <= state.worldRadius + CHUNK_SIZE) {
        const key = `${cx},${cz}`;
        const group = buildChunk(cx, cz);
        state.chunks.set(key, group);
        chunkRoot.add(group);
      }
    }
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(state.worldRadius - 0.35, state.worldRadius + 0.35, 160),
    materials.boundary
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  boundaryRoot.add(ring);
}

function buildChunk(cx, cz) {
  const group = new THREE.Group();
  group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

  const baseColor = hash2(cx, cz, state.seed) > 0.48 ? materials.grass : materials.grass2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 1, 1), baseColor);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  if (cx === 0 || cz === 0) {
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(cx === 0 ? 4.6 : CHUNK_SIZE, cz === 0 ? 4.6 : CHUNK_SIZE),
      materials.road
    );
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.012;
    road.receiveShadow = true;
    group.add(road);
  }

  const nearCenter = Math.hypot(cx, cz) < 1.5;
  const density = nearCenter ? 0.42 : 0.7;
  const value = hash2(cx * 13, cz * 17, state.seed);

  if (!nearCenter && value < 0.28 && Math.abs(cx) + Math.abs(cz) < 9) {
    addHouse(group, randRange(cx, cz, 1, -3.5, 3.5), randRange(cx, cz, 2, -3.5, 3.5), value);
  } else {
    const count = Math.floor(randRange(cx, cz, 3, 1, 4) * density);
    for (let i = 0; i < count; i += 1) {
      addTree(group, randRange(cx, cz, 10 + i, -7.5, 7.5), randRange(cx, cz, 20 + i, -7.5, 7.5), randRange(cx, cz, 30 + i, 0.8, 1.35));
    }
    if (value > 0.83) {
      addRock(group, randRange(cx, cz, 40, -6, 6), randRange(cx, cz, 41, -6, 6));
    }
  }

  return group;
}

function addHouse(group, x, z, value) {
  const w = 4.5 + value * 2.4;
  const d = 4 + hash2(x, z, state.seed) * 2.2;
  const h = 2.3 + hash2(z, x, state.seed) * 1.1;
  const wallMat = value < 0.1 ? materials.wallA : value < 0.2 ? materials.wallB : materials.wallC;

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  body.position.set(x, h / 2, z);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 1.05, 4), value > 0.18 ? materials.roof : materials.roofDark);
  roof.position.set(x, h + 0.52, z);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.35, 0.04), materials.roofDark);
  door.position.set(x, 0.68, z - d / 2 - 0.025);
  group.add(door);

  for (const sx of [-1, 1]) {
    const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.54, 0.045), materials.glass);
    windowMesh.position.set(x + sx * w * 0.24, h * 0.58, z - d / 2 - 0.03);
    group.add(windowMesh);
  }
}

function addTree(group, x, z, scale) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * scale, 0.2 * scale, 1.25 * scale, 8), materials.trunk);
  trunk.position.set(x, 0.62 * scale, z);
  trunk.castShadow = true;
  group.add(trunk);

  const leavesA = new THREE.Mesh(new THREE.ConeGeometry(0.85 * scale, 1.45 * scale, 9), materials.leaves);
  leavesA.position.set(x, 1.55 * scale, z);
  leavesA.castShadow = true;
  group.add(leavesA);

  const leavesB = new THREE.Mesh(new THREE.ConeGeometry(0.66 * scale, 1.2 * scale, 9), materials.leavesLight);
  leavesB.position.set(x, 2.1 * scale, z);
  leavesB.castShadow = true;
  group.add(leavesB);
}

function addRock(group, x, z) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(randRange(x, z, 50, 0.45, 0.95), 0), materials.stone);
  rock.position.set(x, 0.32, z);
  rock.rotation.set(hash2(x, z, state.seed) * 2, hash2(z, x, state.seed) * 2, 0);
  rock.castShadow = true;
  rock.receiveShadow = true;
  group.add(rock);
}

function buildSkyDetails() {
  const hillMat = new THREE.MeshBasicMaterial({ color: 0x5e7650, transparent: true, opacity: 0.95 });
  for (let i = 0; i < 20; i += 1) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(15 + (i % 5) * 5, 16 + (i % 4) * 4, 5), hillMat);
    const angle = (i / 20) * Math.PI * 2;
    hill.position.set(Math.cos(angle) * 130, 0, Math.sin(angle) * 130);
    hill.rotation.y = angle;
    root.add(hill);
  }
}

function getAimDirection(out) {
  out.set(0, 0, -1).applyEuler(camera.rotation).normalize();
  return out;
}

function ensureAudio() {
  if (audio) {
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    return audio;
  }

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  audio = { ctx, master };
  return audio;
}

function makeNoise(duration, filterFreq, gainValue) {
  const { ctx, master } = ensureAudio();
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq;
  filter.Q.value = 0.85;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start();
}

function tone(freq, duration, gainValue, type = "sine", bend = 1) {
  const { ctx, master } = ensureAudio();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), ctx.currentTime + duration);
  gain.gain.setValueAtTime(gainValue, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playShot(weapon) {
  if (weapon === "sniper") {
    makeNoise(0.18, 620, 0.42);
    tone(86, 0.18, 0.15, "sawtooth", 0.45);
  } else if (weapon === "burst") {
    makeNoise(0.08, 1050, 0.28);
    tone(160, 0.08, 0.09, "square", 0.7);
  } else {
    makeNoise(0.055, 1250, 0.24);
    tone(210, 0.045, 0.055, "square", 0.64);
  }
}

function playDistantShot(weapon, from) {
  const distance = camera.position.distanceTo(from);
  if (distance > 65) return;
  const volume = clamp(1 - distance / 70, 0.08, 0.5);
  if (weapon === "sniper") {
    makeNoise(0.15, 420, 0.22 * volume);
  } else {
    makeNoise(0.06, 850, 0.16 * volume);
  }
}

function playReload() {
  tone(280, 0.05, 0.08, "square", 0.8);
  setTimeout(() => tone(520, 0.05, 0.06, "triangle", 1.1), 130);
}

function playHit(headshot) {
  tone(headshot ? 880 : 520, 0.065, headshot ? 0.16 : 0.11, "triangle", 1.25);
}

function playHurt() {
  tone(130, 0.12, 0.11, "sawtooth", 0.7);
}

function playReveal() {
  tone(660, 0.06, 0.08, "triangle", 1.6);
  setTimeout(() => tone(990, 0.08, 0.07, "triangle", 0.9), 90);
}

function hash2(x, z, seed = 1) {
  let n = Math.imul(Math.floor(x) + seed, 374761393) ^ Math.imul(Math.floor(z) - seed, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function randRange(x, z, salt, min, max) {
  return min + hash2(Math.floor(x * 31 + salt), Math.floor(z * 29 - salt), state.seed) * (max - min);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((mat) => mat.dispose());
      else child.material.dispose();
    }
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

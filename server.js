"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const TICK_RATE = 60;
const STATE_RATE = 30;
const BASE_SPEED = 6.25;
const GRAVITY = 13;
const JUMP_SPEED = 5.6;
const SLIDE_DURATION = 750;
const STALE_PLAYER_TIMEOUT = 15000;
const WORLD_SEED = Math.floor(Math.random() * 1_000_000_000);

const WEAPONS = {
  assault: {
    id: "assault",
    name: "Assault Rifle",
    damage: 8,
    cooldown: 0.1,
    magazine: 15,
    reload: 1.34,
    headshot: 1.5,
    speed: 0.9,
    range: 30,
    dropStart: 10,
    dropDamageStart: 7.9,
    dropDamageEnd: 2,
    burst: 1,
    burstGap: 0
  },
  burst: {
    id: "burst",
    name: "Burst Rifle",
    damage: 14,
    cooldown: 0.6,
    magazine: 12,
    reload: 0.92,
    headshot: 1,
    speed: 0.95,
    range: 45,
    dropStart: 15,
    dropDamageStart: 13.9,
    dropDamageEnd: 3.5,
    burst: 3,
    burstGap: 0.15
  },
  sniper: {
    id: "sniper",
    name: "Sniper",
    damage: 40,
    cooldown: 1.6,
    magazine: 4,
    reload: 2.5,
    headshot: 2.5,
    speed: 1,
    range: 120,
    dropStart: null,
    dropDamageStart: null,
    dropDamageEnd: null,
    burst: 1,
    burstGap: 0
  }
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const clients = new Map();
const players = new Map();
const pendingShots = [];
let lastTick = Date.now();
let revealUntil = 0;
let botThinkAt = 0;
let botGoal = { x: 0, z: 0 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(5).toString("hex")}`;
}

function humanCount() {
  let count = 0;
  for (const player of players.values()) {
    if (!player.isBot) count += 1;
  }
  return count;
}

function worldRadius() {
  const humans = Math.max(1, humanCount());
  return clamp(34 + Math.ceil(Math.sqrt(humans)) * 18, 48, 190);
}

function randomSpawn() {
  const radius = worldRadius() * 0.72;
  const angle = Math.random() * Math.PI * 2;
  const distance = 8 + Math.random() * Math.max(8, radius - 8);
  return {
    x: Math.cos(angle) * distance,
    z: Math.sin(angle) * distance
  };
}

function makePlayer(id, name, weaponId, isBot = false) {
  const spawn = randomSpawn();
  const weapon = WEAPONS[weaponId] || WEAPONS.assault;
  return {
    id,
    name: name || (isBot ? "Target Bot" : "Player"),
    isBot,
    color: isBot ? "#f0b94b" : randomColor(),
    x: spawn.x,
    y: 0,
    z: spawn.z,
    velocityY: 0,
    slideUntil: 0,
    slideCooldownUntil: 0,
    slideDir: { x: 0, z: -1 },
    yaw: Math.random() * Math.PI * 2,
    pitch: 0,
    hp: 100,
    score: 0,
    deaths: 0,
    weapon: weapon.id,
    ammo: weapon.magazine,
    reloadUntil: 0,
    nextFireAt: 0,
    deadUntil: 0,
    input: { forward: 0, strafe: 0, shooting: false, jumpHeld: false, jumpQueued: false, slideHeld: false, slideQueued: false, dir: { x: 0, y: 0, z: -1 }, shotDir: { x: 0, y: 0, z: -1 } },
    lastInputAt: Date.now()
  };
}

function randomColor() {
  const palette = ["#4cc9f0", "#f72585", "#80ed99", "#ffd166", "#b8f2e6", "#c77dff", "#ff8fab", "#90dbf4"];
  return palette[Math.floor(Math.random() * palette.length)];
}

const bot = makePlayer("bot-1", "Target Bot", "assault", true);
bot.x = 8;
bot.z = -8;
players.set(bot.id, bot);

const trainingBot = makePlayer("bot-dummy", "Training Dummy", "assault", true);
trainingBot.x = -10;
trainingBot.z = -6;
trainingBot.yaw = Math.PI * 0.35;
trainingBot.hp = 300;
trainingBot.maxHp = 300;
trainingBot.isTrainingDummy = true;
trainingBot.color = "#70e1a1";
players.set(trainingBot.id, trainingBot);

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const requestPath = urlPath === "/" ? "index.html" : urlPath.replace(/^[/\\]+/, "");
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade !== "websocket") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));

  const id = randomId("p");
  const client = { id, socket, buffer: Buffer.alloc(0), joined: false };
  clients.set(id, client);

  socket.on("data", (chunk) => receiveSocketData(client, chunk));
  socket.on("close", () => disconnectClient(id));
  socket.on("error", () => disconnectClient(id));

  send(client, { type: "hello", id, seed: WORLD_SEED, weapons: WEAPONS });
});

function receiveSocketData(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < offset + 2) return;
      length = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (client.buffer.length < offset + 8) return;
      const high = client.buffer.readUInt32BE(offset);
      const low = client.buffer.readUInt32BE(offset + 4);
      length = high * 2 ** 32 + low;
      offset += 8;
    }

    const maskOffset = offset;
    if (masked) offset += 4;
    if (client.buffer.length < offset + length) return;

    const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
    if (masked) {
      const mask = client.buffer.subarray(maskOffset, maskOffset + 4);
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }
    }

    client.buffer = client.buffer.subarray(offset + length);

    if (opcode === 0x8) {
      disconnectClient(client.id);
      return;
    }
    if (opcode === 0x1) {
      try {
        handleMessage(client, JSON.parse(payload.toString("utf8")));
      } catch {
        send(client, { type: "warning", message: "Bad message ignored." });
      }
    }
  }
}

function disconnectClient(id) {
  const client = clients.get(id);
  if (!client) return;
  const player = players.get(id);
  clients.delete(id);
  players.delete(id);
  try {
    client.socket.destroy();
  } catch {
    // Socket is already closed.
  }
  if (player && !player.isBot) {
    broadcast({ type: "feed", text: `${player.name} left the fight.` });
  }
}

function handleMessage(client, message) {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "join") {
    const weapon = WEAPONS[message.weapon] ? message.weapon : "assault";
    const rawName = typeof message.name === "string" ? message.name : "";
    const name = rawName.trim().slice(0, 18) || `Player ${client.id.slice(-3)}`;
    const player = makePlayer(client.id, name, weapon, false);
    players.set(client.id, player);
    client.joined = true;
    send(client, { type: "joined", id: client.id, seed: WORLD_SEED, worldRadius: worldRadius() });
    broadcast({ type: "feed", text: `${player.name} joined the fight.` });
    return;
  }

  const player = players.get(client.id);
  if (!player || player.isBot) return;

  if (message.type === "input") {
    player.input.forward = clamp(Number(message.forward) || 0, -1, 1);
    player.input.strafe = clamp(Number(message.strafe) || 0, -1, 1);
    player.input.shooting = Boolean(message.shooting);
    const jumpHeld = Boolean(message.jump);
    const slideHeld = Boolean(message.slide);
    if (jumpHeld && !player.input.jumpHeld) player.input.jumpQueued = true;
    if (slideHeld && !player.input.slideHeld) player.input.slideQueued = true;
    player.input.jumpHeld = jumpHeld;
    player.input.slideHeld = slideHeld;
    player.yaw = Number.isFinite(message.yaw) ? Number(message.yaw) : player.yaw;
    player.pitch = clamp(Number(message.pitch) || 0, -1.35, 1.35);
    player.input.dir = normalizeDir(message.dir, player.yaw, player.pitch);
    player.input.shotDir = normalizeDir(message.shotDir || message.dir, player.yaw, player.pitch);
    player.lastInputAt = Date.now();
    return;
  }

  if (message.type === "shoot") {
    player.input.shotDir = normalizeDir(message.dir, player.yaw, player.pitch);
    tryFire(player, Date.now(), player.input.shotDir);
    return;
  }

  if (message.type === "reload") {
    startReload(player, Date.now());
  }
}

function normalizeDir(dir, yaw, pitch) {
  let x = Number(dir && dir.x);
  let y = Number(dir && dir.y);
  let z = Number(dir && dir.z);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    x = Math.sin(yaw) * Math.cos(pitch);
    y = Math.sin(pitch);
    z = -Math.cos(yaw) * Math.cos(pitch);
  }

  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function startReload(player, now) {
  const weapon = WEAPONS[player.weapon];
  if (!weapon || player.hp <= 0 || player.reloadUntil > now || player.ammo >= weapon.magazine) return;
  player.reloadUntil = now + weapon.reload * 1000;
  broadcast({ type: "reload", id: player.id, weapon: weapon.id });
}

function tryFire(player, now, dir, catchUp = false) {
  const weapon = WEAPONS[player.weapon];
  if (!weapon || player.hp <= 0 || player.deadUntil > now) return;

  if (player.reloadUntil > now) return;
  if (player.reloadUntil && player.reloadUntil <= now) {
    player.ammo = weapon.magazine;
    player.reloadUntil = 0;
  }

  if (player.ammo <= 0) {
    startReload(player, now);
    return;
  }
  if (now < player.nextFireAt) return;

  const maxQueuedShots = catchUp && weapon.id === "assault" ? 3 : 1;
  let queuedShots = 0;

  while (queuedShots < maxQueuedShots && now >= player.nextFireAt) {
    const fireAt = catchUp && player.nextFireAt > 0 ? player.nextFireAt : now;
    queueWeaponShot(player, weapon, dir, fireAt);
    queuedShots += 1;

    if (player.ammo <= 0) {
      startReload(player, now);
      break;
    }
    if (!catchUp || weapon.id !== "assault") break;
  }
}

function queueWeaponShot(player, weapon, dir, fireAt) {
  const shots = Math.min(weapon.burst, player.ammo);
  player.ammo -= shots;
  player.nextFireAt = fireAt + weapon.cooldown * 1000;

  for (let i = 0; i < shots; i += 1) {
    pendingShots.push({
      fireAt: fireAt + weapon.burstGap * 1000 * i,
      shooterId: player.id,
      weaponId: weapon.id,
      dir: { ...dir },
      dynamicAim: weapon.burst > 1 && i > 0
    });
  }
}

function tick() {
  const now = Date.now();
  const dt = clamp((now - lastTick) / 1000, 0, 0.08);
  lastTick = now;
  const radius = worldRadius();

  updateBot(now, dt, radius);

  for (const player of players.values()) {
    if (!player.isBot && now - player.lastInputAt > STALE_PLAYER_TIMEOUT) {
      disconnectClient(player.id);
      continue;
    }
    const weapon = WEAPONS[player.weapon];

    if (player.hp <= 0) {
      if (player.deadUntil && now >= player.deadUntil) respawn(player);
      continue;
    }

    if (player.reloadUntil && now >= player.reloadUntil) {
      player.ammo = weapon.magazine;
      player.reloadUntil = 0;
    }

    if (!player.isBot) {
      movePlayer(player, dt, radius, now);
      if (player.input.shooting) {
        tryFire(player, now, player.input.shotDir, true);
      }
    }
  }

  flushPendingShots(now);
}

function movePlayer(player, dt, radius, now) {
  const weapon = WEAPONS[player.weapon];
  const speed = BASE_SPEED * (weapon ? weapon.speed : 1);
  const forward = clamp(player.input.forward, -1, 1);
  const strafe = clamp(player.input.strafe, -1, 1);
  const length = Math.hypot(forward, strafe) || 1;

  const f = forward / length;
  const s = strafe / length;
  const aim = player.input.dir || normalizeDir(null, player.yaw, player.pitch);
  const flatLength = Math.hypot(aim.x, aim.z) || 1;
  const fx = aim.x / flatLength;
  const fz = aim.z / flatLength;
  const rx = -fz;
  const rz = fx;

  if (player.input.jumpQueued && player.y <= 0.001 && now >= player.slideUntil) {
    player.velocityY = JUMP_SPEED;
    player.y = 0.01;
  }
  player.input.jumpQueued = false;

  const moveX = fx * f + rx * s;
  const moveZ = fz * f + rz * s;
  if (player.input.slideQueued && player.y <= 0.001 && now >= player.slideCooldownUntil) {
    const moveLength = Math.hypot(moveX, moveZ);
    player.slideDir = moveLength > 0.01
      ? { x: moveX / moveLength, z: moveZ / moveLength }
      : { x: fx, z: fz };
    player.slideUntil = now + SLIDE_DURATION;
    player.slideCooldownUntil = now + SLIDE_DURATION + 500;
  }
  player.input.slideQueued = false;

  let dx;
  let dz;
  if (now < player.slideUntil && player.y <= 0.001) {
    const remaining = clamp((player.slideUntil - now) / SLIDE_DURATION, 0, 1);
    const slideSpeed = lerp(speed * 1.05, speed * 1.75, remaining);
    dx = player.slideDir.x * slideSpeed * dt;
    dz = player.slideDir.z * slideSpeed * dt;
  } else {
    dx = moveX * speed * dt;
    dz = moveZ * speed * dt;
  }

  player.x += dx;
  player.z += dz;
  player.velocityY -= GRAVITY * dt;
  player.y += player.velocityY * dt;
  if (player.y <= 0) {
    player.y = 0;
    player.velocityY = 0;
  }
  clampToWorld(player, radius);
}

function updateBot(now, dt, radius) {
  if (bot.hp <= 0) {
    if (now >= bot.deadUntil) respawn(bot);
    return;
  }

  if (now > botThinkAt || Math.hypot(botGoal.x - bot.x, botGoal.z - bot.z) < 1.8) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 8 + Math.random() * radius * 0.55;
    botGoal = { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
    botThinkAt = now + 1800 + Math.random() * 2600;
  }

  const dx = botGoal.x - bot.x;
  const dz = botGoal.z - bot.z;
  const length = Math.hypot(dx, dz) || 1;
  bot.yaw = Math.atan2(dx, -dz);
  bot.x += (dx / length) * 1.45 * dt;
  bot.z += (dz / length) * 1.45 * dt;
  clampToWorld(bot, radius);
}

function clampToWorld(player, radius) {
  const distance = Math.hypot(player.x, player.z);
  if (distance > radius - 2) {
    const scale = (radius - 2) / distance;
    player.x *= scale;
    player.z *= scale;
  }
}

function flushPendingShots(now) {
  pendingShots.sort((a, b) => a.fireAt - b.fireAt);
  while (pendingShots.length && pendingShots[0].fireAt <= now) {
    const shot = pendingShots.shift();
    const shooter = players.get(shot.shooterId);
    const weapon = WEAPONS[shot.weaponId];
    if (!shooter || !weapon || shooter.hp <= 0) continue;
    const dir = shot.dynamicAim ? shooter.input.shotDir : shot.dir;
    resolveShot(shooter, weapon, dir);
  }
}

function resolveShot(shooter, weapon, dir) {
  const eyeHeight = Date.now() < shooter.slideUntil ? 0.88 : 1.45;
  const origin = { x: shooter.x, y: shooter.y + eyeHeight, z: shooter.z };
  let closest = null;

  for (const target of players.values()) {
    if (target.id === shooter.id || target.hp <= 0) continue;
    const effectiveRange = target.isTrainingDummy ? Math.max(weapon.range, 140) : weapon.range;
    const hit = intersectPlayer(origin, dir, target, effectiveRange);
    if (!hit) continue;
    if (!closest || hit.distance < closest.distance) {
      closest = { target, ...hit };
    }
  }

  const fallbackTo = {
    x: origin.x + dir.x * Math.min(weapon.range, 70),
    y: origin.y + dir.y * Math.min(weapon.range, 70),
    z: origin.z + dir.z * Math.min(weapon.range, 70)
  };

  if (!closest) {
    broadcast({
      type: "shot",
      shooterId: shooter.id,
      weapon: weapon.id,
      from: origin,
      to: fallbackTo,
      hit: false
    });
    return;
  }

  const damage = calculateDamage(weapon, closest.distance, closest.part === "head");
  const maxHp = closest.target.maxHp || 100;
  closest.target.hp = clamp(closest.target.hp - damage, 0, maxHp);
  closest.target.lastHitAt = Date.now();
  closest.target.lastHitPart = closest.part;

  broadcast({
    type: "shot",
    shooterId: shooter.id,
    targetId: closest.target.id,
    weapon: weapon.id,
    from: origin,
    to: closest.point,
    hit: true,
    headshot: closest.part === "head",
    damage
  });

  if (closest.target.hp <= 0) {
    shooter.score += 1;
    closest.target.deaths += 1;
    closest.target.deadUntil = Date.now() + (closest.target.isBot ? 1300 : 2800);
    const label = closest.part === "head" ? "headshot" : "eliminated";
    broadcast({
      type: "feed",
      text: `${shooter.name} ${label} ${closest.target.name}.`
    });
  }
}

function calculateDamage(weapon, distance, headshot) {
  if (distance > weapon.range) return 0;

  let damage = weapon.damage;
  if (weapon.dropStart !== null && distance > weapon.dropStart) {
    const t = clamp((distance - weapon.dropStart) / (weapon.range - weapon.dropStart), 0, 1);
    damage = lerp(weapon.dropDamageStart, weapon.dropDamageEnd, t);
  }

  if (headshot) damage *= weapon.headshot;
  return Math.round(damage * 10) / 10;
}

function intersectPlayer(origin, dir, target, range) {
  const crouchOffset = Date.now() < target.slideUntil ? -0.45 : 0;
  const baseY = target.y + crouchOffset;
  const head = raySphere(origin, dir, { x: target.x, y: baseY + 1.52, z: target.z }, 0.34, range);
  const body = rayCylinder(origin, dir, { x: target.x, z: target.z }, 0.48, baseY + 0.08, baseY + 1.28, range);

  if (head && (!body || head.distance <= body.distance)) {
    return { ...head, part: "head" };
  }
  if (body) {
    return { ...body, part: "body" };
  }
  return null;
}

function raySphere(origin, dir, center, radius, range) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t = -b - root > 0 ? -b - root : -b + root;
  if (t <= 0 || t > range) return null;
  return {
    distance: t,
    point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t }
  };
}

function rayCylinder(origin, dir, center, radius, yMin, yMax, range) {
  const ox = origin.x - center.x;
  const oz = origin.z - center.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (Math.abs(a) < 0.00001) return null;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const candidates = [t1, t2].filter((t) => t > 0 && t <= range).sort((aValue, bValue) => aValue - bValue);

  for (const t of candidates) {
    const y = origin.y + dir.y * t;
    if (y >= yMin && y <= yMax) {
      return {
        distance: t,
        point: { x: origin.x + dir.x * t, y, z: origin.z + dir.z * t }
      };
    }
  }
  return null;
}

function respawn(player) {
  const weapon = WEAPONS[player.weapon];
  if (!player.isTrainingDummy) {
    const spawn = randomSpawn();
    player.x = spawn.x;
    player.z = spawn.z;
  }
  player.y = 0;
  player.velocityY = 0;
  player.slideUntil = 0;
  player.hp = player.maxHp || 100;
  player.ammo = weapon.magazine;
  player.reloadUntil = 0;
  player.nextFireAt = Date.now() + 350;
  player.deadUntil = 0;
}

function broadcastState() {
  broadcast({
    type: "state",
    time: Date.now(),
    seed: WORLD_SEED,
    worldRadius: worldRadius(),
    revealUntil,
    players: Array.from(players.values()).map(serializePlayer)
  });
}

function serializePlayer(player) {
  const weapon = WEAPONS[player.weapon];
  return {
    id: player.id,
    name: player.name,
    isBot: player.isBot,
    isTrainingDummy: Boolean(player.isTrainingDummy),
    color: player.color,
    x: Math.round(player.x * 100) / 100,
    y: Math.round(player.y * 100) / 100,
    z: Math.round(player.z * 100) / 100,
    yaw: Math.round(player.yaw * 1000) / 1000,
    pitch: Math.round(player.pitch * 1000) / 1000,
    hp: Math.round(player.hp * 10) / 10,
    maxHp: player.maxHp || 100,
    score: player.score,
    deaths: player.deaths,
    weapon: player.weapon,
    ammo: player.ammo,
    magazine: weapon.magazine,
    reloading: player.reloadUntil > Date.now(),
    reloadEnd: player.reloadUntil,
    deadUntil: player.deadUntil,
    sliding: player.slideUntil > Date.now()
  };
}

function broadcast(message) {
  for (const client of clients.values()) {
    send(client, message);
  }
}

function send(client, message) {
  if (!client || client.socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(message));
  client.socket.write(encodeFrame(payload));
}

function encodeFrame(payload) {
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeUInt32BE(0, 2);
  header.writeUInt32BE(length, 6);
  return Buffer.concat([header, payload]);
}

setInterval(tick, 1000 / TICK_RATE);
setInterval(broadcastState, 1000 / STATE_RATE);
setInterval(() => {
  revealUntil = Date.now() + 3000;
  broadcast({ type: "reveal", revealUntil });
}, 10000);

server.listen(PORT, () => {
  console.log(`FFA Guns running at http://localhost:${PORT}`);
});

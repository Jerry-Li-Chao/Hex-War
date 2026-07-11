const MAX_CELLS = 259;
const FIRST_BRANCH_LENGTH = 250;
const FRACTAL_SCALE = .32;
const GROWTH_INTERVALS = { 1: 1500, 2: 750, 3: 375 };
const MEMBRANE_TEMPLATE_COUNTS = [1, 7, 43, 259];
const ACTIVE_COLORS = ['#ff735d', '#f48667', '#ed9875', '#e4aa86'];
const INACTIVE_COLOR = '#747873';
const CONNECTION_BUILD_CELLS = 10;

const canvas = document.querySelector('#gameCanvas');
const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
const stage = document.querySelector('#stage');
const countEl = document.querySelector('#cellCount');
const generationEl = document.querySelector('#generationCount');
const fpsEl = document.querySelector('#fpsCount');
const growthStatus = document.querySelector('#growthStatus');
const panHint = document.querySelector('#panHint');
const coordinates = document.querySelector('#coordinates');

let viewport = { width: 1, height: 1, dpr: 1 };
let camera = { x: 0, y: 0, zoom: 1 };
let cameraTouched = false;
let pointerInteraction = null;
let selectedColony = null;
let connection = null;
let transferParticles = [];
let fpsSample = { started: performance.now(), frames: 0 };
let averageRenderMs = 0;
const birthTimes = new Map();

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function smoothstep(value) { const t = clamp(value); return t * t * (3 - 2 * t); }
function easeOutBack(value) {
  const t = clamp(value) - 1;
  return 1 + 2.70158 * t * t * t + 1.70158 * t * t;
}
function lerp(a, b, amount) { return a + (b - a) * amount; }
function birthKey(colony, nodeId) { return `${colony.id}:${nodeId}`; }

class OrganismWorld {
  constructor(limit) { this.nodes = this.generate(limit); }

  generate(limit) {
    const nodes = [{ id: 0, parent: null, depth: 0, radius: 38, x: 0, y: 0 }];
    const queue = [0];
    while (nodes.length < limit && queue.length) {
      const parentId = queue.shift();
      const parent = nodes[parentId];
      const branchLength = FIRST_BRANCH_LENGTH * Math.pow(FRACTAL_SCALE, parent.depth);
      const rotation = -Math.PI / 2 + parent.depth * Math.PI / 6;
      for (let childIndex = 0; childIndex < 6 && nodes.length < limit; childIndex += 1) {
        const id = nodes.length;
        const depth = parent.depth + 1;
        const angle = rotation + childIndex * Math.PI / 3;
        nodes.push({
          id,
          parent: parentId,
          depth,
          radius: Math.max(3.8, 23 * Math.pow(.47, depth - 1)),
          x: parent.x + Math.cos(angle) * branchLength,
          y: parent.y + Math.sin(angle) * branchLength
        });
        queue.push(id);
      }
    }
    return nodes;
  }
}

function convexHull(points) {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower = [];
  const upper = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function smoothClosedPolygon(points, passes = 2) {
  let result = points;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [];
    for (let index = 0; index < result.length; index += 1) {
      const current = result[index];
      const following = result[(index + 1) % result.length];
      next.push({ x: current.x * .75 + following.x * .25, y: current.y * .75 + following.y * .25 });
      next.push({ x: current.x * .25 + following.x * .75, y: current.y * .25 + following.y * .75 });
    }
    result = next;
  }
  return result;
}

function buildMembrane(world, count) {
  const visible = world.nodes.slice(0, count);
  const padding = 20 + Math.min(18, Math.log2(count + 1) * 2.2);
  const samples = [];
  const sampleCount = count === 1 ? 32 : 10;
  for (const node of visible) {
    const radius = node.radius + padding;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const angle = sample / sampleCount * Math.PI * 2;
      samples.push({ x: node.x + Math.cos(angle) * radius, y: node.y + Math.sin(angle) * radius });
    }
  }
  return smoothClosedPolygon(convexHull(samples), 2);
}

const world = new OrganismWorld(MAX_CELLS);
const membraneTemplates = new Map(MEMBRANE_TEMPLATE_COUNTS.map(count => [count, buildMembrane(world, count)]));

function membraneTemplateForCount(count) {
  return MEMBRANE_TEMPLATE_COUNTS.find(templateCount => count <= templateCount) ?? MAX_CELLS;
}

function createColony({ id, x, y, active }) {
  const colony = {
    id, x, y, active, count: 1, maxCount: 1, maxGeneration: 0,
    membraneTemplate: 1, growthTimer: null
  };
  birthTimes.set(birthKey(colony, 0), performance.now());
  return colony;
}

const colonies = [
  createColony({ id: 'origin', x: -500, y: 0, active: true }),
  createColony({ id: 'dormant', x: 500, y: 0, active: false })
];
const originColony = colonies[0];
const dormantColony = colonies[1];

function localMembranePoints(colony) {
  return membraneTemplates.get(colony.membraneTemplate);
}

function worldMembranePoints(colony) {
  return localMembranePoints(colony).map(point => ({ x: point.x + colony.x, y: point.y + colony.y }));
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function supportPoint(colony, directionX, directionY) {
  const length = Math.hypot(directionX, directionY) || 1;
  const dx = directionX / length;
  const dy = directionY / length;
  let best = localMembranePoints(colony)[0];
  let bestProjection = -Infinity;
  for (const point of localMembranePoints(colony)) {
    const projection = point.x * dx + point.y * dy;
    if (projection > bestProjection) {
      bestProjection = projection;
      best = point;
    }
  }
  return { x: best.x + colony.x, y: best.y + colony.y };
}

function connectionEndpoints(source, target) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  return {
    start: supportPoint(source, dx, dy),
    end: supportPoint(target, -dx, -dy)
  };
}

function updateReadout() {
  const total = colonies.reduce((sum, colony) => sum + colony.count, 0);
  const generation = Math.max(...colonies.filter(colony => colony.active).map(colony => colony.maxGeneration), 0);
  countEl.textContent = String(total).padStart(2, '0');
  generationEl.textContent = String(generation).padStart(2, '0');
}

function changeColonyCount(colony, delta) {
  const previous = colony.count;
  const next = clamp(previous + delta, 1, MAX_CELLS);
  if (next === previous) return false;
  const now = performance.now();
  if (next > previous) {
    for (let nodeId = previous; nodeId < next; nodeId += 1) {
      birthTimes.set(birthKey(colony, nodeId), now);
    }
  }
  colony.count = next;
  colony.maxCount = Math.max(colony.maxCount, next);
  colony.maxGeneration = Math.max(colony.maxGeneration, world.nodes[colony.maxCount - 1].depth);
  const previousTemplate = colony.membraneTemplate;
  colony.membraneTemplate = membraneTemplateForCount(colony.maxCount);
  updateReadout();
  if (colony.membraneTemplate !== previousTemplate && !cameraTouched && viewport.width > 1) {
    requestAnimationFrame(() => fitAllColonies(true));
  }
  return true;
}

function scheduleColonyGrowth(colony) {
  clearTimeout(colony.growthTimer);
  if (!colony.active || colony.count >= MAX_CELLS) return;
  const generation = Math.max(1, colony.maxGeneration || world.nodes[colony.count].depth);
  const interval = GROWTH_INTERVALS[generation] ?? GROWTH_INTERVALS[3];
  colony.growthTimer = setTimeout(() => {
    changeColonyCount(colony, 1);
    scheduleColonyGrowth(colony);
  }, interval);
}

function activateColony(colony) {
  if (colony.active) return;
  colony.active = true;
  selectedColony = colony;
  growthStatus.textContent = '目标已激活 · 链路输送 1 细胞 / 秒';
  scheduleColonyGrowth(colony);
}

function buildConnectionStep() {
  if (!connection || connection.state !== 'building') return;
  if (connection.source.count <= 1) {
    growthStatus.textContent = '源细胞不足 · 等待自我增殖';
    connection.buildTimer = setTimeout(buildConnectionStep, 220);
    return;
  }
  changeColonyCount(connection.source, -1);
  connection.builtCells += 1;
  growthStatus.textContent = `建立连接 · ${connection.builtCells} / ${CONNECTION_BUILD_CELLS}`;
  if (connection.builtCells >= CONNECTION_BUILD_CELLS) {
    connection.state = 'established';
    growthStatus.textContent = '已建立连接 · 链路输送 1 细胞 / 秒';
    scheduleTransfer();
    return;
  }
  connection.buildTimer = setTimeout(buildConnectionStep, 160);
}

function establishConnection(source, target) {
  if (connection) return;
  connection = { source, target, state: 'building', builtCells: 0, buildTimer: null, transferTimer: null };
  selectedColony = source;
  growthStatus.textContent = `建立连接 · 0 / ${CONNECTION_BUILD_CELLS}`;
  buildConnectionStep();
}

function launchTransfer() {
  if (!connection || connection.state !== 'established') return;
  const { source, target } = connection;
  if (source.count <= 1 || target.count >= MAX_CELLS) return;
  changeColonyCount(source, -1);
  transferParticles.push({ source, target, started: performance.now(), duration: 820 });
}

function scheduleTransfer() {
  if (!connection || connection.state !== 'established') return;
  connection.transferTimer = setTimeout(() => {
    launchTransfer();
    scheduleTransfer();
  }, 1000);
}

function updateTransfers(now) {
  const remaining = [];
  for (const particle of transferParticles) {
    if (now - particle.started >= particle.duration) {
      activateColony(particle.target);
      changeColonyCount(particle.target, 1);
    } else {
      remaining.push(particle);
    }
  }
  transferParticles = remaining;
}

function isWorldPointInView(x, y, padding = 0) {
  const halfWidth = viewport.width / camera.zoom / 2 + padding;
  const halfHeight = viewport.height / camera.zoom / 2 + padding;
  return Math.abs(x - camera.x) <= halfWidth && Math.abs(y - camera.y) <= halfHeight;
}

class CanvasRenderer {
  constructor(ctx) { this.ctx = ctx; }

  render(now) {
    const ctx = this.ctx;
    ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    ctx.fillStyle = '#0d0f0d';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    ctx.save();
    ctx.translate(viewport.width / 2, viewport.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    for (const colony of colonies) this.drawMembrane(ctx, colony);
    this.drawConnection(ctx, now);
    for (const colony of colonies) {
      this.drawBranches(ctx, colony, now);
      this.drawCells(ctx, colony, now);
    }
    this.drawDragPreview(ctx);
    ctx.restore();
  }

  drawMembrane(ctx, colony) {
    const points = localMembranePoints(colony);
    const active = colony.active;
    const selected = colony === selectedColony;
    ctx.save();
    ctx.translate(colony.x, colony.y);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
    ctx.closePath();
    ctx.strokeStyle = active
      ? `rgba(255, 115, 93, ${selected ? .16 : .08})`
      : 'rgba(150, 155, 151, .09)';
    ctx.lineWidth = (selected ? 4 : 3) / camera.zoom;
    ctx.stroke();
    ctx.strokeStyle = active
      ? `rgba(255, 160, 136, ${selected ? .78 : .48})`
      : 'rgba(174, 180, 175, .42)';
    ctx.lineWidth = (selected ? 1.25 : .8) / camera.zoom;
    ctx.stroke();
    ctx.restore();
  }

  drawBranches(ctx, colony, now) {
    if (!colony.active && colony.count === 1) return;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.15 / camera.zoom;
    ctx.strokeStyle = colony.active ? 'rgba(246, 169, 135, .52)' : 'rgba(150, 155, 151, .4)';
    for (let nodeId = 1; nodeId < colony.count; nodeId += 1) {
      const node = world.nodes[nodeId];
      const parent = world.nodes[node.parent];
      const nodeX = node.x + colony.x;
      const nodeY = node.y + colony.y;
      if (!isWorldPointInView(nodeX, nodeY, 80)) continue;
      const progress = smoothstep((now - birthTimes.get(birthKey(colony, nodeId))) / 360);
      const dx = node.x - parent.x;
      const dy = node.y - parent.y;
      const length = Math.hypot(dx, dy);
      const ux = dx / length;
      const uy = dy / length;
      const sx = colony.x + parent.x + ux * (parent.radius + 4);
      const sy = colony.y + parent.y + uy * (parent.radius + 4);
      const ex = colony.x + node.x - ux * (node.radius + 4);
      const ey = colony.y + node.y - uy * (node.radius + 4);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(lerp(sx, ex, progress), lerp(sy, ey, progress));
      ctx.stroke();
    }
  }

  drawCells(ctx, colony, now) {
    for (let nodeId = 0; nodeId < colony.count; nodeId += 1) {
      const node = world.nodes[nodeId];
      const x = colony.x + node.x;
      const y = colony.y + node.y;
      if (!isWorldPointInView(x, y, 50)) continue;
      const raw = clamp((now - birthTimes.get(birthKey(colony, nodeId))) / 430, 0, 1);
      const scale = easeOutBack(raw);
      const color = colony.active ? ACTIVE_COLORS[Math.min(node.depth, ACTIVE_COLORS.length - 1)] : INACTIVE_COLOR;
      const pulse = nodeId === 0 && colony.active ? 1 + Math.sin(now * .0025) * .025 : 1;
      const radius = node.radius * scale * pulse;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#0d0f0d';
      ctx.strokeStyle = color;
      ctx.lineWidth = (nodeId === 0 ? 2 : 1.4) / camera.zoom;
      ctx.shadowColor = nodeId === 0 && colony.active ? color : 'transparent';
      ctx.shadowBlur = nodeId === 0 && colony.active ? 10 : 0;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (node.depth <= 1) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = colony.active ? .28 : .18;
        ctx.lineWidth = .65 / camera.zoom;
        ctx.setLineDash([3 / camera.zoom, 4 / camera.zoom]);
        ctx.lineDashOffset = -now * .004;
        ctx.beginPath();
        ctx.arc(0, 0, radius * .69, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = colony.active ? .78 : .55;
      ctx.fillStyle = color;
      ctx.shadowBlur = nodeId === 0 && colony.active ? 7 : 0;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1.6 / camera.zoom, radius * .085), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawConnection(ctx, now) {
    if (!connection) return;
    const { start, end } = connectionEndpoints(connection.source, connection.target);
    const progress = connection.state === 'building' ? connection.builtCells / CONNECTION_BUILD_CELLS : 1;
    const lineEnd = { x: lerp(start.x, end.x, progress), y: lerp(start.y, end.y, progress) };
    ctx.strokeStyle = 'rgba(255, 142, 115, .42)';
    ctx.lineWidth = 1.2 / camera.zoom;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(lineEnd.x, lineEnd.y);
    ctx.stroke();
    for (let index = 1; index <= connection.builtCells; index += 1) {
      const amount = index / CONNECTION_BUILD_CELLS;
      ctx.fillStyle = '#f49a77';
      ctx.beginPath();
      ctx.arc(lerp(start.x, end.x, amount), lerp(start.y, end.y, amount), 3 / camera.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const particle of transferParticles) {
      const amount = smoothstep((now - particle.started) / particle.duration);
      const x = lerp(start.x, end.x, amount);
      const y = lerp(start.y, end.y, amount);
      ctx.save();
      ctx.fillStyle = '#ff735d';
      ctx.shadowColor = '#ff735d';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(x, y, 5 / camera.zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawDragPreview(ctx) {
    if (!pointerInteraction || pointerInteraction.type !== 'colony' || !pointerInteraction.dragging) return;
    const source = pointerInteraction.source;
    const target = pointerInteraction.current;
    const start = supportPoint(source, target.x - source.x, target.y - source.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 115, 93, .7)';
    ctx.lineWidth = 1.2 / camera.zoom;
    ctx.setLineDash([6 / camera.zoom, 6 / camera.zoom]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.restore();
  }
}

const renderer = new CanvasRenderer(context);

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  viewport = { width: rect.width, height: rect.height, dpr: Math.min(1.35, window.devicePixelRatio || 1) };
  canvas.width = Math.round(rect.width * viewport.dpr);
  canvas.height = Math.round(rect.height * viewport.dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
}

function allColonyBounds() {
  const points = colonies.flatMap(worldMembranePoints);
  return {
    left: Math.min(...points.map(point => point.x)),
    right: Math.max(...points.map(point => point.x)),
    top: Math.min(...points.map(point => point.y)),
    bottom: Math.max(...points.map(point => point.y))
  };
}

function fitAllColonies(animate = false) {
  const bounds = allColonyBounds();
  const target = {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
    zoom: clamp(Math.min((viewport.width - 180) / Math.max(300, bounds.right - bounds.left), (viewport.height - 160) / Math.max(260, bounds.bottom - bounds.top)), .25, 1.55)
  };
  if (!animate) {
    camera = target;
    updateCoordinates();
    return;
  }
  const origin = { ...camera };
  const started = performance.now();
  function transition(now) {
    const amount = 1 - Math.pow(1 - clamp((now - started) / 420), 3);
    camera.x = lerp(origin.x, target.x, amount);
    camera.y = lerp(origin.y, target.y, amount);
    camera.zoom = lerp(origin.zoom, target.zoom, amount);
    updateCoordinates();
    if (amount < .999) requestAnimationFrame(transition);
  }
  requestAnimationFrame(transition);
}

function updateCoordinates() {
  const format = value => `${value < 0 ? '−' : ''}${Math.abs(Math.round(value)).toString().padStart(3, '0')}`;
  coordinates.textContent = `X ${format(camera.x)} · Y ${format(camera.y)} · ${Math.round(camera.zoom * 100)}%`;
}

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: camera.x + (clientX - rect.left - viewport.width / 2) / camera.zoom,
    y: camera.y + (clientY - rect.top - viewport.height / 2) / camera.zoom
  };
}

function zoomAt(factor, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX ?? rect.left + viewport.width / 2;
  const y = clientY ?? rect.top + viewport.height / 2;
  const before = screenToWorld(x, y);
  camera.zoom = clamp(camera.zoom * factor, .2, 2.8);
  const after = screenToWorld(x, y);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  cameraTouched = true;
  panHint.classList.add('hidden');
  updateCoordinates();
}

function colonyAtPoint(point, predicate = () => true) {
  return colonies.find(colony => predicate(colony) && pointInPolygon(point, worldMembranePoints(colony)));
}

canvas.addEventListener('pointerdown', event => {
  const worldPoint = screenToWorld(event.clientX, event.clientY);
  const activeHit = colonyAtPoint(worldPoint, colony => colony.active);
  canvas.setPointerCapture(event.pointerId);
  if (activeHit && !connection) {
    selectedColony = activeHit;
    pointerInteraction = { type: 'colony', source: activeHit, startX: event.clientX, startY: event.clientY, current: worldPoint, dragging: false };
    stage.classList.add('connecting');
    return;
  }
  pointerInteraction = { type: 'pan', startX: event.clientX, startY: event.clientY, cameraX: camera.x, cameraY: camera.y };
  stage.classList.add('dragging');
});

canvas.addEventListener('pointermove', event => {
  if (!pointerInteraction) return;
  if (pointerInteraction.type === 'colony') {
    pointerInteraction.current = screenToWorld(event.clientX, event.clientY);
    pointerInteraction.dragging = pointerInteraction.dragging || Math.hypot(event.clientX - pointerInteraction.startX, event.clientY - pointerInteraction.startY) > 6;
    return;
  }
  camera.x = pointerInteraction.cameraX - (event.clientX - pointerInteraction.startX) / camera.zoom;
  camera.y = pointerInteraction.cameraY - (event.clientY - pointerInteraction.startY) / camera.zoom;
  cameraTouched = true;
  panHint.classList.add('hidden');
  updateCoordinates();
});

function finishPointerInteraction(event) {
  if (!pointerInteraction) return;
  if (pointerInteraction.type === 'colony' && pointerInteraction.dragging) {
    const dropPoint = screenToWorld(event.clientX, event.clientY);
    const target = colonyAtPoint(dropPoint, colony => !colony.active && colony !== pointerInteraction.source);
    if (target) establishConnection(pointerInteraction.source, target);
  }
  pointerInteraction = null;
  stage.classList.remove('dragging', 'connecting');
}

canvas.addEventListener('pointerup', finishPointerInteraction);
canvas.addEventListener('pointercancel', () => {
  pointerInteraction = null;
  stage.classList.remove('dragging', 'connecting');
});
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  zoomAt(event.deltaY > 0 ? .9 : 1.1, event.clientX, event.clientY);
}, { passive: false });

document.querySelector('#zoomIn').addEventListener('click', () => zoomAt(1.2));
document.querySelector('#zoomOut').addEventListener('click', () => zoomAt(.82));
document.querySelector('#resetView').addEventListener('click', () => { cameraTouched = false; fitAllColonies(true); });
window.addEventListener('resize', () => { resizeCanvas(); fitAllColonies(false); });

function gameLoop(now) {
  const renderStarted = performance.now();
  updateTransfers(now);
  renderer.render(now);
  const renderDuration = performance.now() - renderStarted;
  averageRenderMs = averageRenderMs ? averageRenderMs * .94 + renderDuration * .06 : renderDuration;
  fpsSample.frames += 1;
  const elapsed = now - fpsSample.started;
  if (elapsed >= 500) {
    fpsEl.textContent = String(Math.round(fpsSample.frames * 1000 / elapsed));
    canvas.dataset.renderMs = averageRenderMs.toFixed(2);
    canvas.dataset.connectionState = connection?.state ?? 'none';
    canvas.dataset.originCells = String(originColony.count);
    canvas.dataset.targetCells = String(dormantColony.count);
    canvas.dataset.targetActive = String(dormantColony.active);
    fpsSample = { started: now, frames: 0 };
  }
  requestAnimationFrame(gameLoop);
}

resizeCanvas();
updateReadout();
fitAllColonies(false);
selectedColony = originColony;
growthStatus.textContent = '在珊瑚色细胞膜内按下并拖向灰色核心';
scheduleColonyGrowth(originColony);
requestAnimationFrame(gameLoop);

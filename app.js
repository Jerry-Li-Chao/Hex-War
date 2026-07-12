const MAX_CELLS = 259;
const FIRST_BRANCH_LENGTH = 250;
const FRACTAL_SCALE = .32;
const GROWTH_INTERVALS = { 1: 2000, 2: 1250, 3: 750, 4: 500 };
const GROWTH_BATCHES = { 1: 1, 2: 1, 3: 2, 4: 2 };
const TRANSFER_INTERVALS = { 1: 1750, 2: 1500, 3: 1250, 4: 1000 };
const MEMBRANE_TEMPLATE_COUNTS = [1, 7, 43, 259];
const PLAYER_COLORS = ['#ff735d', '#f48667', '#ed9875', '#e4aa86'];
const ENEMY_COLORS = ['#9be83f', '#aaf05a', '#baf477', '#cdf79a'];
const INACTIVE_COLOR = '#747873';
const CONNECTION_CELL_SPACING = 70;

const canvas = document.querySelector('#gameCanvas');
const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
const stage = document.querySelector('#stage');
const countEl = document.querySelector('#cellCount');
const generationEl = document.querySelector('#generationCount');
const fpsEl = document.querySelector('#fpsCount');
const selectedFactionEl = document.querySelector('#selectedFaction');
const replicationRateEl = document.querySelector('#replicationRate');
const transferRateEl = document.querySelector('#transferRate');
const colonyInspector = document.querySelector('#colonyInspector');
const factionBalanceEl = document.querySelector('#factionBalance');
const playerBalanceFill = document.querySelector('#playerBalanceFill');
const enemyBalanceFill = document.querySelector('#enemyBalanceFill');
const playerBalanceCount = document.querySelector('#playerBalanceCount');
const enemyBalanceCount = document.querySelector('#enemyBalanceCount');
const growthStatus = document.querySelector('#growthStatus');
const layoutModeButton = document.querySelector('#layoutModeButton');
const panHint = document.querySelector('#panHint');
const coordinates = document.querySelector('#coordinates');

let viewport = { width: 1, height: 1, dpr: 1 };
let camera = { x: 0, y: 0, zoom: 1 };
let cameraTouched = false;
let pointerInteraction = null;
let selectedColony = null;
let hoveredColony = null;
let connections = [];
let transferParticles = [];
let simulationPaused = false;
let simulationTime = 0;
let previousFrameTime = performance.now();
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

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function createGrowthOrder(nodes) {
  const order = [0];
  const maxDepth = Math.max(...nodes.map(node => node.depth));
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    order.push(...shuffle(nodes.filter(node => node.depth === depth).map(node => node.id)));
  }
  return order;
}

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
    // Preserve generation boundaries, but randomize births inside each generation.
    // Since every parent is always in the previous generation, the fractal remains valid.
    const ordered = [nodes[0]];
    const maxDepth = Math.max(...nodes.map(node => node.depth));
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      ordered.push(...shuffle(nodes.filter(node => node.depth === depth)));
    }
    const newIdByOldId = new Map(ordered.map((node, id) => [node.id, id]));
    return ordered.map((node, id) => ({
      ...node,
      id,
      parent: node.parent === null ? null : newIdByOldId.get(node.parent)
    }));
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

function createColony({ id, x, y, faction }) {
  const colony = {
    id, x, y, faction, active: faction !== null, count: 1, maxCount: 1, maxGeneration: 0,
    membraneTemplate: 1, growthTimer: null, nodeOrder: createGrowthOrder(world.nodes)
  };
  birthTimes.set(birthKey(colony, 0), simulationTime);
  return colony;
}

const colonies = [
  createColony({ id: 'player-1', x: -1550, y: -700, faction: 'player' }),
  createColony({ id: 'player-2', x: -1550, y: 700, faction: 'player' }),
  createColony({ id: 'dormant-1', x: 0, y: -1150, faction: null }),
  createColony({ id: 'dormant-2', x: 0, y: 0, faction: null }),
  createColony({ id: 'dormant-3', x: 0, y: 1150, faction: null }),
  createColony({ id: 'enemy-1', x: 1550, y: -700, faction: 'enemy' }),
  createColony({ id: 'enemy-2', x: 1550, y: 700, faction: 'enemy' })
];
const originColony = colonies[0];
const dormantColony = colonies[2];
const enemyColony = colonies[5];

function factionPalette(colony) {
  if (colony.faction === 'enemy') return ENEMY_COLORS;
  if (colony.faction === 'player') return PLAYER_COLORS;
  return [INACTIVE_COLOR, INACTIVE_COLOR, INACTIVE_COLOR, INACTIVE_COLOR];
}

function factionColor(colony) {
  return factionPalette(colony)[0];
}

function runWhenSimulationActive(callback) {
  if (simulationPaused) {
    setTimeout(() => runWhenSimulationActive(callback), 100);
    return;
  }
  callback();
}

function localMembranePoints(colony) {
  return membraneTemplates.get(colony.membraneTemplate);
}

function membraneLayerCount(colony) {
  return colony.active ? colonyLevel(colony) : 1;
}

function membranePointsForLayer(colony, layerIndex) {
  const offset = layerIndex * 15;
  if (!offset) return localMembranePoints(colony);
  return localMembranePoints(colony).map(point => {
    const distance = Math.hypot(point.x, point.y) || 1;
    const scale = (distance + offset) / distance;
    return { x: point.x * scale, y: point.y * scale };
  });
}

function outerMembranePoints(colony) {
  return membranePointsForLayer(colony, membraneLayerCount(colony) - 1);
}

function worldMembranePoints(colony) {
  return outerMembranePoints(colony).map(point => ({ x: point.x + colony.x, y: point.y + colony.y }));
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
  const membranePoints = outerMembranePoints(colony);
  let best = membranePoints[0];
  let bestProjection = -Infinity;
  for (const point of membranePoints) {
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

function displayedConnectionEndpoints(activeConnection) {
  const endpoints = connectionEndpoints(activeConnection.source, activeConnection.target);
  const reverseExists = connections.some(item => item !== activeConnection
    && item.source === activeConnection.target
    && item.target === activeConnection.source
    && item.state !== 'retracting');
  if (!reverseExists) return endpoints;
  const dx = endpoints.end.x - endpoints.start.x;
  const dy = endpoints.end.y - endpoints.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = 7 / camera.zoom;
  return {
    start: { x: endpoints.start.x - dy / length * offset, y: endpoints.start.y + dx / length * offset },
    end: { x: endpoints.end.x - dy / length * offset, y: endpoints.end.y + dx / length * offset }
  };
}

function snakeGeometry(activeConnection, now) {
  const { start, end } = displayedConnectionEndpoints(activeConnection);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  const waves = clamp(Math.round(length / 280), 2, 7);
  const amplitude = Math.min(48, Math.max(14, length * .055));
  const motionRate = activeConnection.state === 'established' ? .00035 : .003;
  const phase = activeConnection.wavePhase + now * motionRate;
  return {
    start,
    end,
    pointAt(amount) {
      const t = clamp(amount);
      const envelope = Math.sin(Math.PI * t);
      const offset = Math.sin(t * waves * Math.PI * 2 - phase) * amplitude * envelope;
      return {
        x: lerp(start.x, end.x, t) + normalX * offset,
        y: lerp(start.y, end.y, t) + normalY * offset
      };
    }
  };
}

function drawSnakeSegment(ctx, geometry, fromAmount, toAmount) {
  const from = clamp(fromAmount);
  const to = clamp(toAmount);
  if (to - from < .0001) return;
  const steps = Math.max(3, Math.ceil((to - from) * 44));
  const first = geometry.pointAt(from);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let step = 1; step <= steps; step += 1) {
    const point = geometry.pointAt(lerp(from, to, step / steps));
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

function colonyLevel(colony) {
  if (!colony?.active) return 0;
  if (colony.count >= 259) return 4;
  if (colony.count >= 44) return 3;
  if (colony.count >= 8) return 2;
  return 1;
}

function connectionCapacity(colony) {
  const level = colonyLevel(colony);
  if (level >= 4) return 3;
  if (level >= 2) return 2;
  return level === 1 ? 1 : 0;
}

function replicationProfileLevel(colony) {
  return colony.maxCount >= MAX_CELLS ? 4 : colonyLevel(colony);
}

function outgoingConnectionCount(colony) {
  return connections.filter(connection => connection.source === colony
    && ['building', 'established'].includes(connection.state)).length;
}

function formatSeconds(milliseconds) {
  return `${Number((milliseconds / 1000).toFixed(2))}s`;
}

function updateFactionBalance() {
  const playerCells = colonies
    .filter(colony => colony.faction === 'player')
    .reduce((sum, colony) => sum + colony.count, 0);
  const enemyCells = colonies
    .filter(colony => colony.faction === 'enemy')
    .reduce((sum, colony) => sum + colony.count, 0);
  const activeCells = playerCells + enemyCells;
  const playerShare = activeCells ? playerCells / activeCells * 100 : 50;
  playerBalanceFill.style.width = `${playerShare}%`;
  enemyBalanceFill.style.width = `${100 - playerShare}%`;
  playerBalanceCount.textContent = `我方 ${playerCells}`;
  enemyBalanceCount.textContent = `敌方 ${enemyCells}`;
  factionBalanceEl.setAttribute('aria-label', `我方 ${playerCells} 个细胞，敌方 ${enemyCells} 个细胞`);
}

function updateReadout() {
  updateFactionBalance();
  updateInspectorContent(hoveredColony);
  if (!selectedColony) {
    selectedFactionEl.textContent = '未选择群落';
    selectedFactionEl.style.color = INACTIVE_COLOR;
    countEl.textContent = `-- / ${MAX_CELLS}`;
    return;
  }
  selectedFactionEl.textContent = selectedColony.faction === 'player'
    ? '我方群落'
    : selectedColony.faction === 'enemy' ? '敌方群落' : '失活群落';
  selectedFactionEl.style.color = selectedColony.faction === 'player'
    ? PLAYER_COLORS[0]
    : selectedColony.faction === 'enemy' ? ENEMY_COLORS[0] : INACTIVE_COLOR;
  countEl.textContent = `${selectedColony.count} / ${MAX_CELLS}`;
}

function updateInspectorContent(colony) {
  if (!colony) {
    colonyInspector.classList.remove('active');
    return;
  }
  const level = colonyLevel(colony);
  const replicationLevel = colony.active ? replicationProfileLevel(colony) : 0;
  colonyInspector.classList.add('active');
  colonyInspector.style.setProperty('--inspector-accent', colony.faction === 'player'
    ? PLAYER_COLORS[0]
    : colony.faction === 'enemy' ? ENEMY_COLORS[0] : INACTIVE_COLOR);
  generationEl.textContent = level ? `LEVEL ${level}` : 'DORMANT';
  replicationRateEl.textContent = colony.active
    ? `${formatSeconds(GROWTH_INTERVALS[replicationLevel])} × ${GROWTH_BATCHES[replicationLevel]}${colony.count >= MAX_CELLS ? ' · 已满' : ''}`
    : '暂停';
  transferRateEl.textContent = colony.active ? formatSeconds(TRANSFER_INTERVALS[level]) : '不可用';
}

function setHoveredColony(colony) {
  if (hoveredColony === colony) return;
  hoveredColony = colony;
  updateInspectorContent(hoveredColony);
}

function changeColonyCount(colony, delta) {
  const previous = colony.count;
  const previousLevel = colonyLevel(colony);
  const next = clamp(previous + delta, 1, MAX_CELLS);
  if (next === previous) return false;
  const now = simulationTime;
  if (next > previous) {
    for (let slot = previous; slot < next; slot += 1) {
      const nodeId = colony.nodeOrder[slot];
      birthTimes.set(birthKey(colony, nodeId), now);
    }
  }
  colony.count = next;
  colony.maxCount = Math.max(colony.maxCount, next);
  colony.maxGeneration = Math.max(colony.maxGeneration, world.nodes[colony.nodeOrder[colony.maxCount - 1]].depth);
  const previousTemplate = colony.membraneTemplate;
  colony.membraneTemplate = membraneTemplateForCount(colony.maxCount);
  updateReadout();
  if (colony.membraneTemplate !== previousTemplate && !cameraTouched && viewport.width > 1) {
    requestAnimationFrame(() => fitAllColonies(true));
  }
  const levelChanged = colonyLevel(colony) !== previousLevel;
  if (levelChanged) {
    for (const activeConnection of connections.filter(item => item.state === 'established' && item.source === colony)) {
      clearTimeout(activeConnection.transferTimer);
      updateEstablishedConnectionStatus(activeConnection, delta > 0 ? '源群落升级' : '源群落降级');
      scheduleTransfer(activeConnection);
    }
  }
  if (delta < 0 && levelChanged && colony.active) scheduleColonyGrowth(colony);
  if (delta < 0 && colony.active && !colony.growthTimer) scheduleColonyGrowth(colony);
  return true;
}

function scheduleColonyGrowth(colony) {
  clearTimeout(colony.growthTimer);
  colony.growthTimer = null;
  if (!colony.active || colony.count >= MAX_CELLS) return;
  const generation = replicationProfileLevel(colony);
  const interval = GROWTH_INTERVALS[generation] ?? GROWTH_INTERVALS[4];
  colony.growthTimer = setTimeout(() => {
    runWhenSimulationActive(() => {
      colony.growthTimer = null;
      changeColonyCount(colony, GROWTH_BATCHES[generation] ?? 1);
      scheduleColonyGrowth(colony);
    });
  }, interval);
}

function activateColony(colony, faction, activeConnection) {
  if (colony.active) return;
  colony.active = true;
  colony.faction = faction;
  selectedColony = colony;
  updateEstablishedConnectionStatus(activeConnection, '目标已激活');
  scheduleColonyGrowth(colony);
}

function destroyOutgoingConnections(colony) {
  const outgoing = connections.filter(connection => connection.source === colony);
  if (!outgoing.length) return 0;
  const outgoingSet = new Set(outgoing);
  for (const connection of outgoing) {
    clearTimeout(connection.buildTimer);
    clearTimeout(connection.transferTimer);
  }
  transferParticles = transferParticles.filter(particle => !outgoingSet.has(particle.connection));
  connections = connections.filter(connection => !outgoingSet.has(connection));
  return outgoing.length;
}

function captureColony(colony, faction, activeConnection) {
  clearTimeout(colony.growthTimer);
  const destroyedConnections = destroyOutgoingConnections(colony);
  colony.faction = faction;
  colony.active = true;
  colony.count = 1;
  colony.maxCount = 1;
  colony.maxGeneration = 0;
  colony.membraneTemplate = 1;
  birthTimes.set(birthKey(colony, 0), simulationTime);
  selectedColony = colony;
  updateReadout();
  updateEstablishedConnectionStatus(activeConnection, destroyedConnections
    ? `核心已占领 · 原有 ${destroyedConnections} 条连接已摧毁`
    : '核心已占领');
  scheduleColonyGrowth(colony);
}

function buildConnectionStep(activeConnection) {
  if (!connections.includes(activeConnection) || activeConnection.state !== 'building') return;
  if (simulationPaused) {
    activeConnection.buildTimer = setTimeout(() => buildConnectionStep(activeConnection), 100);
    return;
  }
  if (activeConnection.source.count <= 1) {
    growthStatus.textContent = '源细胞不足 · 等待自我增殖';
    activeConnection.buildTimer = setTimeout(() => buildConnectionStep(activeConnection), 220);
    return;
  }
  changeColonyCount(activeConnection.source, -1);
  activeConnection.builtCells += 1;
  growthStatus.textContent = `建立连接 · ${activeConnection.builtCells} / ${activeConnection.requiredCells}`;
  if (activeConnection.builtCells >= activeConnection.requiredCells) {
    activeConnection.state = 'established';
    updateEstablishedConnectionStatus(activeConnection, '已建立连接');
    scheduleTransfer(activeConnection);
    return;
  }
  activeConnection.buildTimer = setTimeout(() => buildConnectionStep(activeConnection), 160);
}

function establishConnection(source, target) {
  if (connections.some(item => item.source === source && item.target === target && item.state !== 'retracting')) return;
  const capacity = connectionCapacity(source);
  if (outgoingConnectionCount(source) >= capacity) {
    growthStatus.textContent = `连接槽已满 · LEVEL ${colonyLevel(source)} 最多 ${capacity} 条连接`;
    return;
  }
  const { start, end } = connectionEndpoints(source, target);
  const surfaceDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const requiredCells = Math.max(2, Math.round(surfaceDistance / CONNECTION_CELL_SPACING) - 1);
  const activeConnection = { id: `${source.id}-${target.id}-${Date.now()}`, source, target, state: 'building', builtCells: 0, requiredCells, surfaceDistance, wavePhase: Math.random() * Math.PI * 2, buildTimer: null, transferTimer: null };
  connections.push(activeConnection);
  selectedColony = source;
  growthStatus.textContent = `建立连接 · 0 / ${requiredCells}`;
  buildConnectionStep(activeConnection);
}

function connectionDirectionLabel(activeConnection) {
  if (!activeConnection) return '';
  return activeConnection.source.x <= activeConnection.target.x ? '左 → 右' : '右 → 左';
}

function transferIntervalForConnection(activeConnection) {
  if (!activeConnection) return TRANSFER_INTERVALS[1];
  const generation = colonyLevel(activeConnection.source);
  return TRANSFER_INTERVALS[generation];
}

function transferRateLabel(activeConnection) {
  const seconds = transferIntervalForConnection(activeConnection) / 1000;
  return `${String(seconds).replace(/0+$/, '').replace(/\.$/, '')}s / 细胞`;
}

function updateEstablishedConnectionStatus(activeConnection, prefix = '已建立连接') {
  if (!activeConnection) return;
  growthStatus.textContent = `${prefix} · ${connectionDirectionLabel(activeConnection)} · ${transferRateLabel(activeConnection)}`;
}

function launchTransfer(activeConnection) {
  if (!connections.includes(activeConnection) || activeConnection.state !== 'established') return;
  const { source, target } = activeConnection;
  const sameFaction = source.faction === target.faction;
  if (sameFaction && target.count >= MAX_CELLS) return;
  transferParticles.push({ connection: activeConnection, source, target, faction: source.faction, started: simulationTime, duration: 820 });
}

function scheduleTransfer(activeConnection) {
  if (!connections.includes(activeConnection) || activeConnection.state !== 'established') return;
  const interval = transferIntervalForConnection(activeConnection);
  activeConnection.transferInterval = interval;
  activeConnection.transferTimer = setTimeout(() => {
    runWhenSimulationActive(() => {
      if (!connections.includes(activeConnection) || activeConnection.state !== 'established') return;
      launchTransfer(activeConnection);
      scheduleTransfer(activeConnection);
    });
  }, interval);
}

function segmentIntersectionAmount(lineStart, lineEnd, cutStart, cutEnd) {
  const rx = lineEnd.x - lineStart.x;
  const ry = lineEnd.y - lineStart.y;
  const sx = cutEnd.x - cutStart.x;
  const sy = cutEnd.y - cutStart.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < .0001) return null;
  const qpx = cutStart.x - lineStart.x;
  const qpy = cutStart.y - lineStart.y;
  const lineAmount = (qpx * sy - qpy * sx) / denominator;
  const cutAmount = (qpx * ry - qpy * rx) / denominator;
  if (lineAmount < 0 || lineAmount > 1 || cutAmount < 0 || cutAmount > 1) return null;
  return lineAmount;
}

function snakeIntersectionAmount(activeConnection, cutStart, cutEnd, now, maxAmount = 1) {
  const geometry = snakeGeometry(activeConnection, now);
  const steps = 48;
  let previous = geometry.pointAt(0);
  for (let step = 1; step <= steps; step += 1) {
    const previousAmount = (step - 1) / steps * maxAmount;
    const currentAmount = step / steps * maxAmount;
    const current = geometry.pointAt(currentAmount);
    const localAmount = segmentIntersectionAmount(previous, current, cutStart, cutEnd);
    if (localAmount !== null) return lerp(previousAmount, currentAmount, localAmount);
    previous = current;
  }
  return null;
}

function receiveFactionCells(target, faction, amount, activeConnection) {
  const result = { added: 0, destroyed: 0, captured: false, activated: false };
  if (amount <= 0) return result;
  if (!target.active) {
    activateColony(target, faction, activeConnection);
    changeColonyCount(target, amount);
    result.added = amount;
    result.activated = true;
    return result;
  }
  if (target.faction === faction) {
    changeColonyCount(target, amount);
    result.added = amount;
    return result;
  }
  const destroyed = Math.min(amount, Math.max(0, target.count - 1));
  if (destroyed > 0) changeColonyCount(target, -destroyed);
  result.destroyed = destroyed;
  let remaining = amount - destroyed;
  if (remaining > 0) {
    captureColony(target, faction, activeConnection);
    result.captured = true;
    remaining -= 1;
    if (remaining > 0) {
      changeColonyCount(target, remaining);
      result.added = remaining;
    }
  }
  return result;
}

function finishConnectionRetraction(activeConnection) {
  if (!connections.includes(activeConnection) || activeConnection.state !== 'retracting') return;
  changeColonyCount(activeConnection.source, activeConnection.sourceRefund);
  if (activeConnection.returnToSource) {
    growthStatus.textContent = `建桥已取消 · ${activeConnection.sourceRefund} 个细胞全部返回源群落`;
    connections = connections.filter(item => item !== activeConnection);
    return;
  }
  const targetResult = receiveFactionCells(
    activeConnection.target,
    activeConnection.source.faction,
    activeConnection.targetRefund,
    activeConnection
  );
  growthStatus.textContent = targetResult.captured
    ? `连接已切断 · 目标被桥梁细胞占领 · 可重新建链`
    : targetResult.destroyed > 0
      ? `连接已切断 · 目标损失 ${targetResult.destroyed} 个细胞 · 可重新建链`
      : `连接已切断 · 左侧返还 ${activeConnection.leftRefund} · 右侧返还 ${activeConnection.rightRefund} · 可重新建链`;
  connections = connections.filter(item => item !== activeConnection);
}

function cutConnection(activeConnection, amount) {
  if (!connections.includes(activeConnection) || !['building', 'established'].includes(activeConnection.state)) return;
  const wasBuilding = activeConnection.state === 'building';
  clearTimeout(activeConnection.transferTimer);
  clearTimeout(activeConnection.buildTimer);
  transferParticles = transferParticles.filter(particle => particle.connection !== activeConnection);
  const sourceRefund = wasBuilding
    ? activeConnection.builtCells
    : clamp(Math.round(amount * activeConnection.requiredCells), 0, activeConnection.requiredCells);
  const targetRefund = wasBuilding ? 0 : activeConnection.requiredCells - sourceRefund;
  const sourceIsLeft = activeConnection.source.x <= activeConnection.target.x;
  const leftRefund = sourceIsLeft ? sourceRefund : targetRefund;
  const rightRefund = sourceIsLeft ? targetRefund : sourceRefund;
  activeConnection.state = 'retracting';
  activeConnection.returnToSource = wasBuilding;
  activeConnection.cutAmount = amount;
  activeConnection.sourceRefund = sourceRefund;
  activeConnection.targetRefund = targetRefund;
  activeConnection.leftRefund = leftRefund;
  activeConnection.rightRefund = rightRefund;
  activeConnection.retractStarted = simulationTime;
  activeConnection.retractDuration = wasBuilding ? 980 : 1440;
  canvas.dataset.cutLeft = String(leftRefund);
  canvas.dataset.cutRight = String(rightRefund);
  growthStatus.textContent = wasBuilding
    ? `取消建桥 · ${sourceRefund} 个细胞正在返回源群落`
    : `正在撤回 · 左侧 ${leftRefund} · 右侧 ${rightRefund}`;
}

function updateConnectionRetractions(now) {
  for (const activeConnection of [...connections]) {
    if (activeConnection.state === 'retracting' && now - activeConnection.retractStarted >= activeConnection.retractDuration) {
      finishConnectionRetraction(activeConnection);
    }
  }
}

function updateTransfers(now) {
  const remaining = [];
  for (const particle of transferParticles) {
    if (!connections.includes(particle.connection)) continue;
    if (now - particle.started >= particle.duration) {
      const result = receiveFactionCells(particle.target, particle.faction, 1, particle.connection);
      if (result.destroyed > 0) growthStatus.textContent = `交战 · ${particle.source.faction === 'enemy' ? '敌人' : '玩家'}消灭目标 1 个细胞`;
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
    for (const activeConnection of connections) this.drawConnection(ctx, now, activeConnection);
    for (const colony of colonies) {
      this.drawBranches(ctx, colony, now);
      this.drawCells(ctx, colony, now);
      this.drawConnectionSlots(ctx, colony);
    }
    this.drawDragPreview(ctx);
    this.drawCutPreview(ctx);
    ctx.restore();
  }

  drawMembrane(ctx, colony) {
    const active = colony.active;
    const selected = colony === selectedColony;
    ctx.save();
    ctx.translate(colony.x, colony.y);
    for (let layer = 0; layer < membraneLayerCount(colony); layer += 1) {
      const points = membranePointsForLayer(colony, layer);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
      ctx.closePath();
      ctx.strokeStyle = active ? factionColor(colony) : INACTIVE_COLOR;
      ctx.globalAlpha = (selected ? .15 : .065) * (1 - layer * .08);
      ctx.lineWidth = (selected ? 4 : 3) / camera.zoom;
      ctx.stroke();
      ctx.globalAlpha = (active ? (selected ? .78 : .52) : .42) * (1 - layer * .1);
      ctx.lineWidth = (selected ? 1.2 : .78) / camera.zoom;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawConnectionSlots(ctx, colony) {
    if (!colony.active) return;
    const capacity = connectionCapacity(colony);
    const used = Math.min(capacity, outgoingConnectionCount(colony));
    const top = Math.min(...outerMembranePoints(colony).map(point => point.y));
    const spacing = 14 / camera.zoom;
    const radius = 3.5 / camera.zoom;
    const y = colony.y + top - 18 / camera.zoom;
    const startX = colony.x - (capacity - 1) * spacing / 2;
    const color = factionColor(colony);
    ctx.save();
    ctx.lineWidth = 1.1 / camera.zoom;
    ctx.strokeStyle = color;
    for (let slot = 0; slot < capacity; slot += 1) {
      const x = startX + slot * spacing;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      if (slot < used) {
        ctx.globalAlpha = .92;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 7;
        ctx.fill();
      } else {
        ctx.globalAlpha = .62;
        ctx.shadowBlur = 0;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawBranches(ctx, colony, now) {
    if (!colony.active && colony.count === 1) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.15 / camera.zoom;
    ctx.strokeStyle = colony.active ? factionColor(colony) : INACTIVE_COLOR;
    ctx.globalAlpha = colony.active ? .52 : .4;
    for (let slot = 1; slot < colony.count; slot += 1) {
      const nodeId = colony.nodeOrder[slot];
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
    ctx.restore();
  }

  drawCells(ctx, colony, now) {
    for (let slot = 0; slot < colony.count; slot += 1) {
      const nodeId = colony.nodeOrder[slot];
      const node = world.nodes[nodeId];
      const x = colony.x + node.x;
      const y = colony.y + node.y;
      if (!isWorldPointInView(x, y, 50)) continue;
      const raw = clamp((now - birthTimes.get(birthKey(colony, nodeId))) / 430, 0, 1);
      const scale = easeOutBack(raw);
      const color = factionPalette(colony)[Math.min(node.depth, 3)];
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

  drawConnection(ctx, now, activeConnection) {
    ctx.save();
    const geometry = snakeGeometry(activeConnection, now);
    const linkColor = factionColor(activeConnection.source);
    ctx.strokeStyle = linkColor;
    ctx.globalAlpha = .42;
    ctx.lineWidth = 1.2 / camera.zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (activeConnection.state === 'retracting') {
      const retractProgress = smoothstep((now - activeConnection.retractStarted) / activeConnection.retractDuration);
      const leftEndAmount = lerp(activeConnection.cutAmount, 0, retractProgress);
      if (activeConnection.returnToSource) {
        drawSnakeSegment(ctx, geometry, 0, leftEndAmount);
        for (let index = 1; index <= activeConnection.builtCells; index += 1) {
          const initialAmount = index / (activeConnection.requiredCells + 1);
          const point = geometry.pointAt(lerp(initialAmount, 0, retractProgress));
          ctx.fillStyle = linkColor;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3 / camera.zoom, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        return;
      }
      const rightStartAmount = lerp(activeConnection.cutAmount, 1, retractProgress);
      drawSnakeSegment(ctx, geometry, 0, leftEndAmount);
      drawSnakeSegment(ctx, geometry, rightStartAmount, 1);
      for (let index = 1; index <= activeConnection.requiredCells; index += 1) {
        const initialAmount = index / (activeConnection.requiredCells + 1);
        const destination = index <= activeConnection.sourceRefund ? 0 : 1;
        const amount = lerp(initialAmount, destination, retractProgress);
        const point = geometry.pointAt(amount);
        ctx.fillStyle = linkColor;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3 / camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    const progress = activeConnection.state === 'building' ? activeConnection.builtCells / (activeConnection.requiredCells + 1) : 1;
    drawSnakeSegment(ctx, geometry, 0, progress);
    for (let index = 1; index <= activeConnection.builtCells; index += 1) {
      const amount = index / (activeConnection.requiredCells + 1);
      const point = geometry.pointAt(amount);
      ctx.fillStyle = linkColor;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3 / camera.zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    if (activeConnection.state === 'building' && progress > 0) {
      const head = geometry.pointAt(progress);
      ctx.save();
      ctx.globalAlpha = .92;
      ctx.fillStyle = linkColor;
      ctx.shadowColor = linkColor;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 4.5 / camera.zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (const particle of transferParticles.filter(item => item.connection === activeConnection)) {
      const amount = smoothstep((now - particle.started) / particle.duration);
      const point = geometry.pointAt(amount);
      ctx.save();
      ctx.fillStyle = factionColor(particle.source);
      ctx.shadowColor = factionColor(particle.source);
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5 / camera.zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  drawDragPreview(ctx) {
    if (!pointerInteraction || pointerInteraction.type !== 'colony' || !pointerInteraction.dragging) return;
    const source = pointerInteraction.source;
    const target = pointerInteraction.current;
    const start = supportPoint(source, target.x - source.x, target.y - source.y);
    ctx.save();
    ctx.strokeStyle = factionColor(source);
    ctx.globalAlpha = .7;
    ctx.lineWidth = 1.2 / camera.zoom;
    ctx.setLineDash([6 / camera.zoom, 6 / camera.zoom]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.restore();
  }

  drawCutPreview(ctx) {
    if (!pointerInteraction || pointerInteraction.type !== 'cut' || !pointerInteraction.dragging) return;
    const { start, current } = pointerInteraction;
    ctx.save();
    ctx.strokeStyle = 'rgba(220, 236, 232, .92)';
    ctx.lineWidth = 1.35 / camera.zoom;
    ctx.shadowColor = '#dcece8';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(current.x, current.y);
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
    zoom: clamp(Math.min((viewport.width - 180) / Math.max(300, bounds.right - bounds.left), (viewport.height - 160) / Math.max(260, bounds.bottom - bounds.top)), .12, 1.55)
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

function updateInspectorPosition() {
  if (!hoveredColony || !Number.isFinite(camera.x) || !Number.isFinite(camera.y)) {
    colonyInspector.classList.remove('active');
    return;
  }
  const points = outerMembranePoints(hoveredColony);
  let right = -Infinity;
  let lower = -Infinity;
  for (const point of points) {
    if (point.x > right) right = point.x;
    if (point.y > lower) lower = point.y;
  }
  const anchorX = viewport.width / 2 + (hoveredColony.x + right - camera.x) * camera.zoom;
  const anchorY = viewport.height / 2 + (hoveredColony.y + lower * .45 - camera.y) * camera.zoom;
  const panelWidth = viewport.width <= 650 ? 132 : 144;
  const panelHeight = 82;
  colonyInspector.style.left = `${clamp(anchorX + 14, 14, Math.max(14, viewport.width - panelWidth - 14))}px`;
  colonyInspector.style.top = `${clamp(anchorY, 14, Math.max(14, viewport.height - panelHeight - 14))}px`;
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
  camera.zoom = clamp(camera.zoom * factor, .1, 2.8);
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
  const anyHit = colonyAtPoint(worldPoint);
  canvas.setPointerCapture(event.pointerId);
  if (simulationPaused && anyHit && event.button === 0) {
    selectedColony = anyHit;
    updateReadout();
    pointerInteraction = { type: 'move-colony', colony: anyHit, offsetX: worldPoint.x - anyHit.x, offsetY: worldPoint.y - anyHit.y };
    stage.classList.add('layout-mode');
    return;
  }
  if (activeHit && event.button === 0) {
    selectedColony = activeHit;
    updateReadout();
    pointerInteraction = { type: 'colony', source: activeHit, startX: event.clientX, startY: event.clientY, current: worldPoint, dragging: false };
    stage.classList.add('connecting');
    return;
  }
  if (anyHit && event.button === 0) {
    selectedColony = anyHit;
    updateReadout();
    pointerInteraction = { type: 'selection' };
    return;
  }
  if (event.button === 0 && connections.some(item => ['building', 'established'].includes(item.state)) && !anyHit) {
    pointerInteraction = { type: 'cut', startX: event.clientX, startY: event.clientY, start: worldPoint, current: worldPoint, dragging: false };
    stage.classList.add('cutting');
    return;
  }
  pointerInteraction = { type: 'pan', startX: event.clientX, startY: event.clientY, cameraX: camera.x, cameraY: camera.y };
  stage.classList.add('dragging');
});

canvas.addEventListener('pointermove', event => {
  if (!pointerInteraction) {
    setHoveredColony(colonyAtPoint(screenToWorld(event.clientX, event.clientY)) ?? null);
    return;
  }
  if (pointerInteraction.type === 'selection') return;
  if (pointerInteraction.type === 'colony') {
    pointerInteraction.current = screenToWorld(event.clientX, event.clientY);
    pointerInteraction.dragging = pointerInteraction.dragging || Math.hypot(event.clientX - pointerInteraction.startX, event.clientY - pointerInteraction.startY) > 6;
    return;
  }
  if (pointerInteraction.type === 'move-colony') {
    const worldPoint = screenToWorld(event.clientX, event.clientY);
    pointerInteraction.colony.x = worldPoint.x - pointerInteraction.offsetX;
    pointerInteraction.colony.y = worldPoint.y - pointerInteraction.offsetY;
    return;
  }
  if (pointerInteraction.type === 'cut') {
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
canvas.addEventListener('pointerleave', () => {
  if (!pointerInteraction) setHoveredColony(null);
});

function finishPointerInteraction(event) {
  if (!pointerInteraction) return;
  if (pointerInteraction.type === 'colony' && pointerInteraction.dragging) {
    const dropPoint = screenToWorld(event.clientX, event.clientY);
    const target = colonyAtPoint(dropPoint, colony => colony !== pointerInteraction.source);
    if (target) establishConnection(pointerInteraction.source, target);
  } else if (pointerInteraction.type === 'cut' && pointerInteraction.dragging) {
    for (const activeConnection of connections.filter(item => ['building', 'established'].includes(item.state))) {
      const maxAmount = activeConnection.state === 'building'
        ? activeConnection.builtCells / (activeConnection.requiredCells + 1)
        : 1;
      const amount = snakeIntersectionAmount(activeConnection, pointerInteraction.start, pointerInteraction.current, simulationTime, maxAmount);
      if (amount !== null) cutConnection(activeConnection, amount);
    }
  }
  pointerInteraction = null;
  stage.classList.remove('dragging', 'connecting', 'cutting');
  const rect = canvas.getBoundingClientRect();
  const insideCanvas = event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
  setHoveredColony(insideCanvas ? colonyAtPoint(screenToWorld(event.clientX, event.clientY)) ?? null : null);
}

canvas.addEventListener('pointerup', finishPointerInteraction);
canvas.addEventListener('pointercancel', () => {
  pointerInteraction = null;
  stage.classList.remove('dragging', 'connecting', 'cutting');
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  zoomAt(event.deltaY > 0 ? .99 : 1.01, event.clientX, event.clientY);
}, { passive: false });

document.querySelector('#zoomIn').addEventListener('click', () => zoomAt(1.2));
document.querySelector('#zoomOut').addEventListener('click', () => zoomAt(.82));
document.querySelector('#resetView').addEventListener('click', () => { cameraTouched = false; fitAllColonies(true); });
layoutModeButton.addEventListener('click', () => {
  simulationPaused = !simulationPaused;
  layoutModeButton.classList.toggle('active', simulationPaused);
  layoutModeButton.setAttribute('aria-pressed', String(simulationPaused));
  stage.classList.toggle('layout-mode', simulationPaused);
  pointerInteraction = null;
  previousFrameTime = performance.now();
  growthStatus.textContent = simulationPaused
    ? '拖动模式 · 模拟已暂停 · 可移动任意群落'
    : (connections.length ? `模拟继续 · ${connections.length} 条连接` : '模拟继续 · 可建立连接');
});
window.addEventListener('resize', () => { resizeCanvas(); fitAllColonies(false); });

function gameLoop(realNow) {
  const renderStarted = performance.now();
  const frameDelta = Math.min(50, Math.max(0, realNow - previousFrameTime));
  previousFrameTime = realNow;
  if (!simulationPaused) simulationTime += frameDelta;
  updateConnectionRetractions(simulationTime);
  updateTransfers(simulationTime);
  renderer.render(simulationTime);
  updateInspectorPosition();
  const renderDuration = performance.now() - renderStarted;
  averageRenderMs = averageRenderMs ? averageRenderMs * .94 + renderDuration * .06 : renderDuration;
  fpsSample.frames += 1;
  const elapsed = realNow - fpsSample.started;
  if (elapsed >= 500) {
    fpsEl.textContent = String(Math.round(fpsSample.frames * 1000 / elapsed));
    canvas.dataset.renderMs = averageRenderMs.toFixed(2);
    const primaryConnection = connections[0];
    canvas.dataset.connectionState = primaryConnection?.state ?? 'none';
    canvas.dataset.connectionCount = String(connections.length);
    canvas.dataset.connections = connections.map(item => `${item.source.id}>${item.target.id}:${item.state}`).join(',');
    canvas.dataset.originCells = String(originColony.count);
    canvas.dataset.targetCells = String(dormantColony.count);
    canvas.dataset.targetActive = String(dormantColony.active);
    canvas.dataset.enemyCells = String(enemyColony.count);
    canvas.dataset.originFaction = originColony.faction ?? 'neutral';
    canvas.dataset.dormantFaction = dormantColony.faction ?? 'neutral';
    canvas.dataset.enemyFaction = enemyColony.faction ?? 'neutral';
    canvas.dataset.originPosition = `${originColony.x.toFixed(1)},${originColony.y.toFixed(1)}`;
    canvas.dataset.dormantPosition = `${dormantColony.x.toFixed(1)},${dormantColony.y.toFixed(1)}`;
    canvas.dataset.enemyPosition = `${enemyColony.x.toFixed(1)},${enemyColony.y.toFixed(1)}`;
    canvas.dataset.connectionSource = primaryConnection?.source.id ?? 'none';
    canvas.dataset.connectionTarget = primaryConnection?.target.id ?? 'none';
    canvas.dataset.requiredCells = String(primaryConnection?.requiredCells ?? 0);
    canvas.dataset.transferInterval = String(primaryConnection?.transferInterval ?? 0);
    canvas.dataset.simulationPaused = String(simulationPaused);
    fpsSample = { started: realNow, frames: 0 };
  }
  requestAnimationFrame(gameLoop);
}

selectedColony = originColony;
resizeCanvas();
updateReadout();
fitAllColonies(false);
growthStatus.textContent = '选择群落查看状态 · 拖动活性群落建立连接';
for (const colony of colonies.filter(colony => colony.active)) scheduleColonyGrowth(colony);
requestAnimationFrame(gameLoop);

const MAX_CELLS = 259;
const FIRST_BRANCH_LENGTH = 250;
const FRACTAL_SCALE = .32;
const canvas = document.querySelector('#gameCanvas');
const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
const stage = document.querySelector('#stage');
const slider = document.querySelector('#cellSlider');
const countEl = document.querySelector('#cellCount');
const generationEl = document.querySelector('#generationCount');
const fpsEl = document.querySelector('#fpsCount');
const rangeOutput = document.querySelector('#rangeOutput');
const playButton = document.querySelector('#playButton');
const playLabel = document.querySelector('#playLabel');
const panHint = document.querySelector('#panHint');
const coordinates = document.querySelector('#coordinates');

const COLORS = ['#ff735d', '#f48667', '#ed9875', '#e4aa86'];
const birthTimes = new Map();
let viewport = { width: 1, height: 1, dpr: 1 };
let camera = { x: 0, y: 0, zoom: 1 };
let currentCount = 0;
let timer = null;
let dragging = null;
let fpsSample = { started: performance.now(), frames: 0 };

class OrganismWorld {
  constructor(limit) {
    this.nodes = this.generate(limit);
  }

  generate(limit) {
    const nodes = [{ id: 0, parent: null, depth: 0, childIndex: 0, radius: 38, x: 0, y: 0 }];
    const queue = [0];

    while (nodes.length < limit && queue.length) {
      const parentId = queue.shift();
      const parent = nodes[parentId];
      const branchLength = FIRST_BRANCH_LENGTH * Math.pow(FRACTAL_SCALE, parent.depth);
      const rotation = -Math.PI / 2 + parent.depth * Math.PI / 6;

      // Every node repeats the complete six-point hexagonal motif.
      for (let childIndex = 0; childIndex < 6; childIndex += 1) {
        if (nodes.length >= limit) break;
        const id = nodes.length;
        const depth = parent.depth + 1;
        const angle = rotation + childIndex * Math.PI / 3;
        const radius = Math.max(3.8, 23 * Math.pow(.47, depth - 1));
        nodes.push({
          id,
          parent: parentId,
          depth,
          childIndex,
          radius,
          x: parent.x + Math.cos(angle) * branchLength,
          y: parent.y + Math.sin(angle) * branchLength
        });
        queue.push(id);
      }
    }
    return nodes;
  }

  bounds(count) {
    const visible = this.nodes.slice(0, count);
    return {
      left: Math.min(...visible.map(node => node.x - node.radius)),
      right: Math.max(...visible.map(node => node.x + node.radius)),
      top: Math.min(...visible.map(node => node.y - node.radius)),
      bottom: Math.max(...visible.map(node => node.y + node.radius))
    };
  }
}

class CanvasRenderer {
  constructor(ctx, world) {
    this.ctx = ctx;
    this.world = world;
  }

  render(now) {
    const ctx = this.ctx;
    ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    ctx.fillStyle = '#0d0f0d';
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    ctx.save();
    ctx.translate(viewport.width / 2, viewport.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    this.drawLinks(ctx, now);
    this.drawCells(ctx, now);
    ctx.restore();
  }

  drawLinks(ctx, now) {
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.25 / camera.zoom;
    ctx.strokeStyle = 'rgba(246, 169, 135, .56)';

    for (let id = 1; id < currentCount; id += 1) {
      const node = this.world.nodes[id];
      const parent = this.world.nodes[node.parent];
      if (!isInView(node, 80) && !isInView(parent, 80)) continue;
      const progress = smoothstep((now - birthTimes.get(id)) / 360);
      if (progress <= 0) continue;
      const dx = node.x - parent.x;
      const dy = node.y - parent.y;
      const length = Math.hypot(dx, dy);
      const ux = dx / length;
      const uy = dy / length;
      const sx = parent.x + ux * (parent.radius + 4);
      const sy = parent.y + uy * (parent.radius + 4);
      const ex = node.x - ux * (node.radius + 4);
      const ey = node.y - uy * (node.radius + 4);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (ex - sx) * progress, sy + (ey - sy) * progress);
      ctx.stroke();
    }
  }

  drawCells(ctx, now) {
    for (let id = 0; id < currentCount; id += 1) {
      const node = this.world.nodes[id];
      if (!isInView(node, 50)) continue;
      const raw = clamp((now - birthTimes.get(id)) / 430, 0, 1);
      if (raw <= 0) continue;
      const scale = easeOutBack(raw);
      const color = COLORS[Math.min(node.depth, COLORS.length - 1)];
      const pulse = id === 0 ? 1 + Math.sin(now * .0025) * .025 : 1;
      const radius = node.radius * scale * pulse;

      ctx.save();
      ctx.translate(node.x, node.y);
      ctx.fillStyle = '#0d0f0d';
      ctx.strokeStyle = color;
      ctx.lineWidth = (id === 0 ? 2 : 1.5) / camera.zoom;
      ctx.shadowColor = id === 0 ? color : 'transparent';
      ctx.shadowBlur = id === 0 ? 10 : 0;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Keep the membrane detail on larger cells only; hundreds of animated
      // dashed paths are disproportionately expensive on high-DPI canvases.
      if (node.depth <= 1) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = .28;
        ctx.lineWidth = .65 / camera.zoom;
        ctx.setLineDash([3 / camera.zoom, 4 / camera.zoom]);
        ctx.lineDashOffset = -now * .004;
        ctx.beginPath();
        ctx.arc(0, 0, radius * .69, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = id === 0 ? .95 : .72;
      ctx.fillStyle = color;
      ctx.shadowColor = id === 0 ? color : 'transparent';
      ctx.shadowBlur = id === 0 ? 7 : 0;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1.6 / camera.zoom, radius * .085), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function smoothstep(value) { const t = clamp(value); return t * t * (3 - 2 * t); }
function easeOutBack(value) {
  const t = clamp(value) - 1;
  return 1 + 2.70158 * t * t * t + 1.70158 * t * t;
}

function isInView(node, padding = 0) {
  const halfWidth = viewport.width / camera.zoom / 2 + padding;
  const halfHeight = viewport.height / camera.zoom / 2 + padding;
  return Math.abs(node.x - camera.x) <= halfWidth && Math.abs(node.y - camera.y) <= halfHeight;
}

const world = new OrganismWorld(MAX_CELLS);
const renderer = new CanvasRenderer(context, world);

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  viewport = { width: rect.width, height: rect.height, dpr: Math.min(1.35, window.devicePixelRatio || 1) };
  canvas.width = Math.round(rect.width * viewport.dpr);
  canvas.height = Math.round(rect.height * viewport.dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
}

function fitVisible(animate = false) {
  const bounds = world.bounds(currentCount);
  const width = Math.max(240, bounds.right - bounds.left);
  const height = Math.max(220, bounds.bottom - bounds.top);
  const target = {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
    zoom: clamp(Math.min((viewport.width - 220) / width, (viewport.height - 220) / height), .28, 1.7)
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
    camera.x = origin.x + (target.x - origin.x) * amount;
    camera.y = origin.y + (target.y - origin.y) * amount;
    camera.zoom = origin.zoom + (target.zoom - origin.zoom) * amount;
    updateCoordinates();
    if (amount < .999) requestAnimationFrame(transition);
  }
  requestAnimationFrame(transition);
}

function setCount(value) {
  const next = clamp(Number(value), 1, MAX_CELLS);
  const now = performance.now();
  if (next > currentCount) {
    for (let id = currentCount; id < next; id += 1) {
      birthTimes.set(id, now + Math.min((id - currentCount) * 18, 360));
    }
  }
  currentCount = next;
  slider.value = next;
  slider.style.setProperty('--progress', `${((next - 1) / (MAX_CELLS - 1)) * 100}%`);
  countEl.textContent = String(next).padStart(2, '0');
  generationEl.textContent = String(Math.max(...world.nodes.slice(0, next).map(node => node.depth))).padStart(2, '0');
  rangeOutput.value = `${String(next).padStart(2, '0')} / ${MAX_CELLS}`;
  rangeOutput.textContent = rangeOutput.value;
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
  camera.zoom = clamp(camera.zoom * factor, .25, 2.8);
  const after = screenToWorld(x, y);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  panHint.classList.add('hidden');
  updateCoordinates();
}

function stopGrowth() {
  clearInterval(timer);
  timer = null;
  playButton.classList.remove('playing');
  playLabel.textContent = '自动生长';
}

function toggleGrowth() {
  if (timer) return stopGrowth();
  if (currentCount >= MAX_CELLS) {
    setCount(1);
    fitVisible(true);
  }
  playButton.classList.add('playing');
  playLabel.textContent = '暂停生长';
  timer = setInterval(() => {
    if (currentCount >= MAX_CELLS) return stopGrowth();
    setCount(currentCount + 1);
  }, 130);
}

canvas.addEventListener('pointerdown', event => {
  canvas.setPointerCapture(event.pointerId);
  dragging = { x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y };
  stage.classList.add('dragging');
});
canvas.addEventListener('pointermove', event => {
  if (!dragging) return;
  camera.x = dragging.cameraX - (event.clientX - dragging.x) / camera.zoom;
  camera.y = dragging.cameraY - (event.clientY - dragging.y) / camera.zoom;
  panHint.classList.add('hidden');
  updateCoordinates();
});
canvas.addEventListener('pointerup', () => { dragging = null; stage.classList.remove('dragging'); });
canvas.addEventListener('pointercancel', () => { dragging = null; stage.classList.remove('dragging'); });
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  zoomAt(event.deltaY > 0 ? .9 : 1.1, event.clientX, event.clientY);
}, { passive: false });

slider.addEventListener('input', event => { stopGrowth(); setCount(event.target.value); });
playButton.addEventListener('click', toggleGrowth);
document.querySelector('#zoomIn').addEventListener('click', () => zoomAt(1.2));
document.querySelector('#zoomOut').addEventListener('click', () => zoomAt(.82));
document.querySelector('#resetView').addEventListener('click', () => fitVisible(true));
window.addEventListener('resize', () => { resizeCanvas(); fitVisible(false); });

function gameLoop(now) {
  renderer.render(now);
  fpsSample.frames += 1;
  const elapsed = now - fpsSample.started;
  if (elapsed >= 500) {
    fpsEl.textContent = String(Math.round(fpsSample.frames * 1000 / elapsed));
    fpsSample = { started: now, frames: 0 };
  }
  requestAnimationFrame(gameLoop);
}

resizeCanvas();
setCount(24);
fitVisible(false);
requestAnimationFrame(gameLoop);

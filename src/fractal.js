(() => {
const { FIRST_BRANCH_LENGTH, FRACTAL_SCALE } = window.HexWarConfig;
const { shuffle } = window.HexWarMath;

function createGrowthOrder(nodes) {
  const order = [0];
  const maxDepth = Math.max(...nodes.map(node => node.depth));
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    order.push(...shuffle(nodes.filter(node => node.depth === depth).map(node => node.id)));
  }
  return order;
}

class OrganismWorld {
  constructor(limit) {
    this.nodes = this.generate(limit);
  }

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

    // Preserve generation boundaries while randomizing births within each generation.
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

window.HexWarFractal = Object.freeze({ createGrowthOrder, OrganismWorld, buildMembrane });
})();

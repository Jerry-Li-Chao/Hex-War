(() => {
function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function easeOutBack(value) {
  const t = clamp(value) - 1;
  return 1 + 2.70158 * t * t * t + 1.70158 * t * t;
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

window.HexWarMath = Object.freeze({ clamp, smoothstep, easeOutBack, lerp, shuffle });
})();

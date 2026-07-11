# Hex War

Hex War is an early gameplay and rendering prototype for a cellular strategy game built around recursive hexagonal growth.

Instead of expanding across a flat grid, every cell becomes the center of a new six-node structure. Each generation repeats the same geometric rule at a smaller scale, producing a true recursive organism:

- Generation 0: 1 core cell
- Generation 1: 7 total cells
- Generation 2: 43 total cells
- Generation 3: 259 total cells

## MVP

This first version focuses on proving the visual language, growth model, and camera interaction that can support a future bacteria-war game.

### Included

- Recursive six-branch cellular growth
- A slider for exploring any population from 1 to 259 cells
- Animated cell births and branch formation
- Multiple cell sizes that communicate hierarchy
- An infinite-feeling, draggable world camera
- Cursor-centered wheel zoom and full-world framing
- Automatic growth playback
- Real-time cell count, generation, camera position, zoom, and FPS
- Canvas 2D rendering with viewport culling and high-DPI performance limits
- Responsive desktop and mobile interface

### Performance

The prototype keeps the central glow and large-cell membrane details while simplifying small third-generation cells. Background dots are rendered by CSS, off-screen cells are culled, and the canvas pixel ratio is capped to reduce high-DPI rendering cost.

On the development machine, the complete 259-cell third generation reached the display's 120 FPS limit in the full-world view.

## Run locally

Requirements: Node.js 18 or newer.

```bash
node server.js
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

No package installation or build step is required.

## Controls

- Drag the canvas to explore the world
- Scroll to zoom around the cursor
- Use `+` and `−` for stepped zoom
- Use `全览` to frame the complete organism
- Drag the population slider to grow or rewind the structure
- Use `自动生长` to play the growth sequence

## Architecture

- `OrganismWorld` generates the recursive cell hierarchy and world positions
- `CanvasRenderer` draws cells, branches, birth animation, and visibility-culls the scene
- Camera utilities translate between screen and world coordinates
- The animation loop renders the world and measures frame rate
- HTML/CSS provide the interface independently from the game renderer

## Next milestones

- Cell selection and direct manipulation
- Resource collection and energy transfer through branches
- Territory, collision, and growth constraints
- Enemy organisms and simple AI
- Cell health, damage, splitting, and consumption
- WebGL rendering through PixiJS when simulation scale requires it
- Deterministic simulation state for saves and multiplayer synchronization

## Status

MVP v0.1 — visual growth, rendering, performance, and camera prototype.

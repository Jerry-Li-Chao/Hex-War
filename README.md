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
- Autonomous growth from a single core to the complete 259-cell organism
- Generation-specific birth timing: 1.5s, 1s, and 0.75s per cell
- Dormant gray colonies that can be captured by an active colony
- Drag-to-connect interaction from any point inside an active membrane
- Distance-scaled cell-chain construction that consumes cells from the source colony
- Animated generation-scaled transfer across established links (1.5s, 1s, and 0.75s)
- Converted colonies combine autonomous growth with incoming link growth
- Active colonies can reconnect in either direction after a link is cut
- Drag-to-cut gestures that split and return chain cells to both colonies
- Animated cell births and branch formation
- Multiple cell sizes that communicate hierarchy
- An infinite-feeling, draggable world camera
- Cursor-centered wheel zoom and full-world framing
- Real-time cell count, generation, camera position, zoom, and FPS
- Four cached organism-membrane templates for the core and three complete generations
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
- Press inside an active membrane and drag onto a gray colony to establish a link
- After a link is established, drag across it from empty space to cut it
- Use right- or middle-button drag to pan while a connection exists
- Observe the organism grow autonomously; growth cannot be paused or scrubbed

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

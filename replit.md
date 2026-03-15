# Never Dead

A first-person shooter (FPS) prototype demonstrating high-performance 3D rendering in the browser using 3D Gaussian Splatting combined with traditional polygonal collision.

## Tech Stack

- **Language:** TypeScript
- **Build Tool:** Vite (port 5000)
- **Rendering:** Three.js + @sparkjsdev/spark (3D Gaussian Splatting)
- **Physics/Collision:** three-mesh-bvh (capsule-based character collisions)
- **Testing:** Vitest
- **Package Manager:** npm

## Project Structure

- `index.html` — Main HTML entry point
- `src/` — TypeScript source code
  - `main.ts` — Entry point; UI/HUD, app state, game lifecycle
  - `game/` — Core game logic
    - `FpsGame.ts` — Main game engine (rendering, movement, systems)
    - `CollisionWorld.ts` — Environment collisions and raycasting
    - `ZombieActor.ts` — Zombie enemy logic and state
    - `CharacterAnimator.ts` — GLTF animation management
    - `controls.ts` — Input handling (WASD, arrow keys)
    - `combat.ts` — Damage and scoring logic
    - `worlds.ts` — Level configurations (.spz splats + .glb colliders)
- `assets/` — 3D models (.glb), Gaussian Splat files (.spz), concept art
- `public/` — Static assets (Draco mesh decoder)

## Development

```bash
npm run dev    # Start Vite dev server on port 5000
npm run build  # Type-check + production build
npm run test   # Run Vitest unit tests
```

## Deployment

Configured as a static site deployment. Build output goes to `dist/`.

# Voxel Sandbox

A Minecraft-like voxel sandbox for the browser, built with Three.js and TypeScript.

```bash
npm install
npm run dev
```

Open http://localhost:5173 and click to play.

| Input | Action |
| --- | --- |
| Mouse | Look |
| W A S D | Walk (or fly) |
| Space | Jump; in water: swim up; flying: up |
| Shift | Crouch (won't walk off edges); flying: down |
| Ctrl (tap) | Sprint until you stop moving forward; flying: faster |
| F, or Space twice | Start or stop flying |
| Left click | Break block |
| Right click | Place block |
| 1–9 or wheel | Pick a block |
| Esc | Release the mouse |

Add `?seed=123` to the URL for a different world.

Measuring: `?stats` shows the performance overlay (F3 toggles it), `?autofly` flies a fixed
path at sprint speed for 30 s and prints a frame-time report, `?radius=12` sets the view
radius (8 by default), `?workers=1` the number of chunk workers. `npm run bench` times
generation and meshing headless.

Play it at https://tanakriteuro.github.io/voxel-sandbox/ (try
https://tanakriteuro.github.io/voxel-sandbox/?autofly&stats on your own machine).

See `CLAUDE.md` for the engine design, architecture and roadmap.

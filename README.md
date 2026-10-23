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
| W A S D | Move |
| Space / Shift | Up / down |
| Ctrl | Fly faster |
| Left click | Break block |
| Right click | Place block |
| 1–9 or wheel | Pick a block |
| Esc | Release the mouse |

Add `?seed=123` to the URL for a different world.

Measuring: `?stats` shows the performance overlay (F3 toggles it), `?autofly` flies a fixed
path at sprint speed for 30 s and prints a frame-time report, `?radius=12` sets the view
radius (8 by default), `?workers=1` the number of chunk workers. `npm run bench` times generation and meshing headless.

See `CLAUDE.md` for the engine design, architecture and roadmap.

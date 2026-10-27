# Voxel Sandbox

A Minecraft-like voxel sandbox for the browser, built with Three.js and TypeScript.

```bash
npm install
npm run dev
```

Open http://localhost:5173, pick a world or make a new one (a name, and a seed: a number, any
word, or nothing for a random one), and press Play. Worlds are saved in your browser as you
play: what you build, where you are and the time of day.

| Input | Action |
| --- | --- |
| Mouse | Look |
| W A S D | Walk (or fly) |
| Space | Jump; in water: swim up; flying: up |
| Shift | Crouch (won't walk off edges); flying: down |
| Ctrl (tap) | Sprint until you stop moving forward; flying: faster |
| F, or Space twice | Start or stop flying |
| Left button (hold) | Break block (stone takes longest) |
| Right click | Place block |
| 1–9 or wheel | Pick a block |
| E or Tab | Block picker: click a block to put it in the selected slot |
| Esc | Pause (play on, or save and go back to the world list) |
| M | Mute or unmute |

Torches (4) and lamps (7) light caves and nights. A day lasts 20 minutes.

To look around without the world list or saving: `?seed=123` plays that world, `?at=x,z`
starts somewhere else (with the default seed: desert `?at=384,0`, snowy mountains
`?at=0,192`, forest `?at=-121,-226`, a cave `?at=-48,71`). `?time=0.5` holds the time of day
(0 midnight, 0.5 noon), `?daylength=60` makes a day last a minute, `?light` shows light as grey.

Measuring: `?stats` shows the performance overlay (F3 toggles it), `?autofly` flies a fixed
path at sprint speed for 30 s and prints a frame-time report, `?radius=12` sets the view
radius (8 by default), `?workers=1` the number of chunk workers. `npm run bench` times
generation and meshing headless.

Play it at https://tanakriteuro.github.io/voxel-sandbox/ (try
https://tanakriteuro.github.io/voxel-sandbox/?autofly&stats on your own machine).

See `CLAUDE.md` for the engine design, architecture and roadmap.

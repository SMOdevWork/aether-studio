# AETHER_STUDIO

> **Modular, browser-based spatial computing engine.**
> Translates fluid human movement into precise, production-ready physical data.

---

## What it is

AETHER_STUDIO bridges the gap between raw artistic expression and rigid mechanical engineering. Instead of clicking a mouse or typing coordinates, your physical body becomes the primary interface.

No installation. No build step. Runs in any modern browser with a webcam.

---

## Architecture

| Module | Role |
|---|---|
| `ViewportEngine` | Three.js WebGL scene — real-time 3D rendering, lighting, grid |
| `TelemetryEngine` | MediaPipe Hands → 3D coordinate matrix (optical telemetry) |
| `GestureInterpreter` | State machine — Pinch, Spread, Point, Fist, Sweep |
| `ConstraintLayer` | Snapping, mm tolerances, angle + distance math |
| `ExportEngine` | ASCII STL compiler — drop directly into slicer/CAD |
| `HUD` | Live coordinate readout, gesture status, tracking indicator |

---

## Gesture Vocabulary (v0.1)

| Gesture | Action |
|---|---|
| **Pinch** | Grab point in space / start profile recording |
| **Spread** | Generate cylinder at current position |
| **Point** | Place spatial point marker |
| **Sweep** | Extrude selected geometry |

---

## Running locally

```bash
cd public
python3 -m http.server 8080
# open http://localhost:8080
```

> Camera requires a served origin (not `file://`). Use VS Code Live Server or any local HTTP server.

---

## Keyboard Fallback

| Key | Action |
|---|---|
| Arrow keys | Move spatial cursor (XZ plane) |
| Shift + Arrow Up/Down | Move cursor on Y axis |
| Space | Place point at cursor |
| `S` | Toggle snap-to-grid |
| `E` | Export scene as STL |

---

## Roadmap

- [ ] Phase 2: AI geometry intent interpretation
- [ ] Phase 2: Parametric constraint propagation  
- [ ] Phase 2: G-code compiler (3D print / CNC ready)
- [ ] Phase 3: Multi-hand input
- [ ] Phase 3: Augmented reality overlay (WebXR)
- [ ] Phase 3: Cloud scene persistence

---

## Tech Stack

- [Three.js](https://threejs.org/) — WebGL 3D engine
- [MediaPipe Hands](https://mediapipe.dev/) — Hand landmark detection
- Vanilla JS (zero build tooling)

---

*AETHER_STUDIO v0.1 — Core Foundation*

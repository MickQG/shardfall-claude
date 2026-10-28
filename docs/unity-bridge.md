# Unity bridge protocol (v1)

How the TypeScript game and the Unity WebGL player talk. Read `docs/adr/0005-unity-as-world-renderer.md` first. TypeScript owns the simulation, AI, HUD, input and fog; Unity only draws the 3D world. Both sides must follow this file exactly; change it in a PR that updates both.

## Page layout

The Unity player's `<canvas id="unity-canvas">` sits at the bottom of the page and fills the viewport. The existing transparent Pixi canvas (fog, selection brackets, bars, scaffolds, rally line, placement ghost, effects) sits on top of it, and the DOM HUD on top of that. Unity never receives mouse or keyboard input (the canvas has `pointer-events: none`); all picking is done in TypeScript.

The Unity instance is created with the standard Unity loader (`createUnityInstance`). The GameObject that receives messages is named **`SFBridge`**.

## World coordinates and units

- Tile coordinates `(tx, ty)` are the simulation's (a tile is 1 by 1; fractional values are positions inside a tile).
- **Unity position = `(tx, height, -ty)`**: `X = tx`, `Z = -ty`, `Y` up, in tile units. (Unity is left-handed; the `-ty` mirror makes `+tx` run right-down and `+ty` left-down on screen exactly like the web renderer.)
- A voxel is `scale / 8` tile units on each edge. Unit and building models are authored at `scale = 0.5` (so 16 voxels per tile edge); props use the same.
- Model voxel `(x, y, z)` maps to the model-local Unity point `(x * v, z * v, -y * v)` with `v = scale / 8`, measured from the model's footprint centre `(sx/2, sy/2)` on the ground. This mapping is a reflection, so triangle winding must be reversed when building meshes.
- Model `+x` is the unit's forward direction. A heading `phi` (radians, `atan2(dy, dx)` in tile space) corresponds to `Quaternion.Euler(0, phi * Rad2Deg, 0)` applied to the model.

## Camera

Orthographic, looking at the ground point `(camTileX, 0, -camTileY)`.

- Rotation `Quaternion.Euler(30, -45, 0)` (pitch 30 degrees down, yaw -45).
- Position = target - forward * 100 (any distance large enough to include the whole map and tallest building; set near/far clip to match).
- `orthographicSize = ortho` from the frame header (TypeScript computes it; see below).
- At zoom 1 one tile is 64 px wide and 32 px tall on screen. `PX_PER_UNIT = 64 / sqrt(2) = 45.2548`. `ortho = (viewportHeightPx / 2) / (zoom * PX_PER_UNIT)`.

The Unity canvas is resized by the page to the viewport size in CSS pixels times `devicePixelRatio`; the camera `aspect` follows the canvas.

## Light and look (Unity side)

Directional light from the upper left matching the sprite baker (towards-light vector in tile space about `(0.2, 0.55, 0.81)`), soft shadows, ambient occlusion and bloom (URP volume created in code). Fog of war is drawn by the Pixi overlay, not by Unity.

## Messages JavaScript to Unity

All through `unityInstance.SendMessage("SFBridge", method, string)`.

| Method | Payload | When |
|---|---|---|
| `OnModels` | JSON, the model library (below) | once, before `OnWorld` |
| `OnWorld` | JSON `{ "version": 1, "width": 96, "height": 96, "heights": [int...], "shards": [int...] }`, row-major `y * width + x`; `shards` are shard amounts | once per game |
| `OnShards` | JSON `[[index, amount], ...]` | when a tile's crystal level (0 to 4) changes |
| `OnFrame` | empty string | every rendered frame, after the frame buffer is written |
| `OnQuality` | `"high"` or `"low"` | when the setting changes |

## The shared frame buffer

At start Unity allocates a pinned `float[]` of capacity `FRAME_CAPACITY = 8 + 8 * (1024 + 256)` floats and calls the jslib function `SF_RegisterFrameBuffer(ptr, capacity)`, which stores `{ ptr, capacity }` in `Module.sfFrame`. Each frame JavaScript writes the packed frame at byte offset `ptr` into `Module.HEAPF32` (re-read `HEAPF32` every time, the heap can grow) and then sends `OnFrame`. Unity reads the counts from the header and then the records.

Layout (all `float32`):

```
header, 8 floats
  [0] version = 1
  [1] camTileX      camera look-at point, tile units
  [2] camTileY
  [3] ortho         orthographic size in Unity units
  [4] aspect        canvas width / height
  [5] unitCount     n
  [6] buildingCount m
  [7] timeMs        page clock, for animation

unit record, 8 floats, n of them, starting at index 8
  [0] id
  [1] kind          index into models.kinds
  [2] owner         0 or 1 (team colour index)
  [3] tileX         interpolated position
  [4] tileY
  [5] heading       radians, atan2(dy, dx), hull facing
  [6] aim           radians, turret / weapon facing
  [7] hp            0..1

building record, 8 floats, m of them, following the units
  [0] id
  [1] kind          index into models.kinds
  [2] owner
  [3] tileX         top-left tile of the footprint
  [4] tileY
  [5] reveal        0..1 build-up progress (1 = finished)
  [6] damage        0 intact, 1 damaged, 2 critical
  [7] hp            0..1
```

Ids are the simulation ids; Unity keeps a dictionary id to GameObject and destroys objects whose id is no longer present in a frame.

## Model library (`OnModels`)

```
{
  "version": 1,
  "kinds": ["hum_rifleman", ..., "hum_hq", ...],      // units first, then buildings; the index used in frames
  "teamColors": [16556287, 16747050],                   // 0xRRGGBB integers, one per owner
  "models": {
    "<kind>": {
      "hull": Model,
      "turret": { "model": Model, "pivot": { "x": n, "y": n, "z": n } },   // optional; pivot in voxels from the hull centre, z up
      "overlayY": n                                                       // optional, px
    }
  },
  "props": { "crystal1": Model, ..., "crystal4": Model, "rock0_1": Model, ... }   // added in milestone M4
}

Model = {
  "sx": n, "sy": n, "sz": n, "scale": 0.5,
  "materials": [ { "color": 0xRRGGBB, "metal": bool, "glow": bool, "team": bool } ],   // id 1 is materials[0]; id 0 is empty
  "cells": [count, id, count, id, ...]    // run-length encoded, x fastest, then y, then z; total = sx * sy * sz
}
```

For a building the entry has only `"hull"`. A `team` material takes `teamColors[owner]`. A `glow` material is unlit (emissive). A `metal` material gets a specular highlight.

## Versioning

`version` bumps on any incompatible change. Unity ignores messages with a version it does not know and logs the mismatch; TypeScript falls back to the Pixi renderer if Unity does not report ready within 30 seconds (Unity calls `window.sfUnityReady()` from `SFBridge.Start`, a jslib function).

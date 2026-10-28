# 010 Voxel art

Render layer only. Models and the baker are pure data and arithmetic: no `Math.random`, `Date` or DOM in the baker, so a sprite is a function of (model, team colour, facing).

## Engine

- **VOX-1**: A voxel model is a dense grid of material ids (0 = empty) built with box, cylinder and sphere primitives; writes outside the grid are ignored, and the model reports its voxel count and its highest occupied layer.
- **VOX-2**: Baking is deterministic: the same model, team colour and facing produce byte-identical pixels.
- **VOX-3**: Facing index `k` of `N` rotates the model by `k * 360 / N` degrees around its centre; a full turn equals facing 0, different facings give different images, and a tile-space heading maps to the nearest facing with 0 meaning the model's forward (+x) direction.
- **VOX-4**: Lighting comes from a fixed light: top faces are brighter than left faces, which are brighter than right faces; glow materials are unshaded; the team material takes the team colour; metal materials add a highlight on top faces.
- **VOX-5**: A baked sprite has a transparent background, anchors the model's ground centre at the same pixel for every facing, and carries a soft ground shadow that never covers the model itself.
- **VOX-6**: Faces hidden by neighbouring voxels, and faces turned away from the camera, are not drawn; a solid block draws only its visible outer faces.

## Units

- **VOX-7**: A model's scale sets the pixels per voxel: the same shape built from twice as many half-size voxels bakes to the same on-screen size.
- **VOX-8**: A model that hovers above the ground casts a detached shadow on the ground, below the model, not a shadow joined to it.
- **VOX-9**: Every unit kind has a voxel model, each kind's silhouette is distinct, and each model bakes in all 16 facings with its anchor inside the sprite.
- **VOX-10**: A unit with a turret is drawn as a hull that faces its movement heading and a turret that faces its aim heading independently; the turret sits at the hull's pivot, turned with the hull.
- **VOX-11**: The renderer picks the sprite for a unit from its kind, owner and facing (heading, or aim while firing) and reuses cached sprites, so a facing is baked at most once per kind and team colour.

## Buildings

- **VOX-12**: Every building kind has a voxel model whose footprint is exactly its tile footprint (16 voxels per tile edge), each with a distinct silhouette, and the model's own height (not a table) decides where overlays, bars and picking put the roof.
- **VOX-13**: A building placed during play is revealed bottom-up over its build-up time, damaged buildings are tinted darker as they weaken, and finished full-health buildings are untinted.
- **VOX-14**: Picking a building works anywhere on its drawn body, not only its footprint: the roof of a tall building selects it, and when buildings overlap on screen the nearer one wins.

## Terrain and effects

- **VOX-15**: Shard fields are drawn as voxel crystal clusters whose size follows the amount left (four levels, none when empty); a depleted tile loses its crystals, and the crystal sprites change only when a tile's level changes, not every few ticks.
- **VOX-16**: Rock tiles are drawn as voxel rock chunks, taller on higher ground, with a variant chosen only from the tile's coordinates, so the same map always looks the same and neighbouring rocks differ.
- **VOX-17**: Ground props (pebbles, alien sprouts, bone spires) are placed from tile coordinates alone, at a few percent of free open ground, never on occupied tiles, and not at all on the low-quality preset.
- **VOX-18**: Debris from destroyed units and buildings is drawn as small shaded cubes (a lit top, a lighter left face and a darker right face), not flat dots.

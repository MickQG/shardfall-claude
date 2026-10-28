# 010 Voxel art

Render layer only. Models and the baker are pure data and arithmetic: no `Math.random`, `Date` or DOM in the baker, so a sprite is a function of (model, team colour, facing).

## Engine

- **VOX-1**: A voxel model is a dense grid of material ids (0 = empty) built with box, cylinder and sphere primitives; writes outside the grid are ignored, and the model reports its voxel count and its highest occupied layer.
- **VOX-2**: Baking is deterministic: the same model, team colour and facing produce byte-identical pixels.
- **VOX-3**: Facing index `k` of `N` rotates the model by `k * 360 / N` degrees around its centre; a full turn equals facing 0, different facings give different images, and a tile-space heading maps to the nearest facing with 0 meaning the model's forward (+x) direction.
- **VOX-4**: Lighting comes from a fixed light: top faces are brighter than left faces, which are brighter than right faces; glow materials are unshaded; the team material takes the team colour; metal materials add a highlight on top faces.
- **VOX-5**: A baked sprite has a transparent background, anchors the model's ground centre at the same pixel for every facing, and carries a soft ground shadow that never covers the model itself.
- **VOX-6**: Faces hidden by neighbouring voxels, and faces turned away from the camera, are not drawn; a solid block draws only its visible outer faces.

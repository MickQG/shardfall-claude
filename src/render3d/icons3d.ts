import { OWNER_COLORS } from '../render/colors';
import { IconCache } from '../render/menuPlan';

/**
 * Build-button pictures (UI-17): each sidebar button shows its unit or building drawn from the in-game 3D model in the
 * player's team colour. They are drawn once, while the game loads (inside the loading screen, UI-12), with a temporary
 * `UnitPreview` that is disposed afterwards, so no second WebGL context outlives the loading screen. Pictures are cached
 * per kind and team colour. Render-only.
 */

/** Picture size in CSS px; drawn at twice that, for the sidebar's 40 px slot on dense screens. */
export const ICON_PX = 88;

/** The shared cache of pictures for this page. */
export const icons = new IconCache();

/**
 * Draw the pictures that are missing for `kinds` in the colour of `owner`, and return all of them as a map from kind to
 * PNG data URL. A kind that cannot be drawn is left out (its button stays text only); no WebGL gives an empty map.
 */
export async function drawIcons(kinds: readonly string[], owner: number): Promise<Map<string, string>> {
  const team = OWNER_COLORS[owner] ?? 0xffffff;
  const need = icons.missing(kinds, team);
  if (need.length > 0) {
    try {
      const { UnitPreview } = await import('./preview3d');
      const preview = UnitPreview.create();
      if (preview) {
        try {
          for (const kind of need) {
            try {
              icons.set(kind, team, preview.picture(kind, owner, ICON_PX, ICON_PX));
            } catch {
              // no model for this kind
            }
          }
        } finally {
          preview.dispose();
        }
      }
    } catch {
      // the pictures are decoration: the buttons work without them
    }
  }
  const out = new Map<string, string>();
  for (const k of kinds) {
    const u = icons.get(k, team);
    if (u) out.set(k, u);
  }
  return out;
}

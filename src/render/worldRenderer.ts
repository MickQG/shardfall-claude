import type { SimEvent, Snapshot } from '../sim';
import type { Camera, Viewport } from './camera';
import type { ViewState } from './gameView';
import type { RenderUnit } from './interp';
import type { Projector } from './projector';

/** Map data a renderer needs beyond the snapshot: blocked tiles (low ones are water) and shard fields. */
export interface MapLook {
  blocked?: readonly number[];
  shards?: readonly number[];
}

/** What the game asks of a world renderer: the classic isometric GameView and the three.js View3D both provide it. */
export interface WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly viewport: Viewport;
  mount(host: HTMLElement, snap: Snapshot, look?: MapLook): Promise<void>;
  update(units: readonly RenderUnit[], cam: Camera, vs: ViewState, snap: Snapshot | null): void;
  /** A simulation event to show (effects, turret aim). */
  spawn(e: SimEvent, now: number): void;
  /** Extra figures for the frame-time readout (draw calls, CPU time), if the renderer has any. */
  readout?(): string;
  /** Screen and ground mapping for the current camera (R3D-5). */
  projector(cam: Camera): Projector;
}

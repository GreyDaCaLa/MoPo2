// Board geometry. Space 0 is the bottom-right corner (+x, +z); play runs
// clockwise when viewed from above: along the bottom toward -x, up the left
// side, across the top, then down the right side.
export const CORNER = 1.6;
export const TILE_W = 0.9;
export const BOARD_SIZE = CORNER * 2 + TILE_W * 9; // 11.3
export const HALF = BOARD_SIZE / 2;
export const SLAB_TOP = 0.12; // top face of the board slab
export const TILE_TOP = SLAB_TOP + 0.01; // y of tile surfaces (above slab to avoid z-fighting)

const C = HALF - CORNER / 2;
const CORNERS = [[C, C], [-C, C], [-C, -C], [C, -C]];

/** Center [x, z] of a space. */
export function tileCenter(i) {
  const side = Math.floor(i / 10);
  const k = i % 10;
  if (k === 0) return CORNERS[side];
  const d = HALF - CORNER - (k - 0.5) * TILE_W;
  return [[d, C], [-C, d], [-d, -C], [C, -d]][side];
}

/** Y-rotation so the tile's "inner" edge (color band) faces the board center. */
export const tileRotation = (i) => -Math.floor(i / 10) * (Math.PI / 2);

export const tileSize = (i) => (i % 10 === 0 ? [CORNER, CORNER] : [TILE_W, CORNER]);

/** Unit vector pointing from the tile toward the board's center. */
export function inward(i) {
  return [[0, -1], [1, 0], [0, 1], [-1, 0]][Math.floor(i / 10)];
}

/** Spot for player `slot` (0-5) standing on space i, so tokens don't overlap. */
export function tokenSpot(i, slot) {
  const [x, z] = tileCenter(i);
  const corner = i % 10 === 0;
  const col = slot % 2;
  const row = Math.floor(slot / 2);
  const along = (col - 0.5) * (corner ? 0.6 : 0.36);
  const across = (row - 1) * 0.36 + (corner ? 0 : 0.15); // shift away from the color band
  const [ix, iz] = inward(i);
  // "along" is perpendicular to inward
  return [x + -iz * along - ix * across, z + ix * along - iz * across];
}

// Head-portrait crop rectangles for class sprites. Used to render only
// the character's face (no body) wherever we need a compact portrait —
// JourneyScene markers, lobby NPC dialogue modal, etc.
//
// Each entry is in the class sprite's NATIVE canvas coords. Callers
// scale to their target display size.

export interface HeadCrop {
  x: number;
  y: number;
  w: number;
  h: number;
  canvas: number;
}

export const HEAD_CROP_DEFAULT: HeadCrop = { x: 14, y: 4, w: 40, h: 28, canvas: 68 };

export const HEAD_CROP_BY_CLASS: Record<string, HeadCrop> = {
  vanguard: { x: 30, y: 20, w: 36, h: 22, canvas: 96 },
  medic: { x: 35, y: 21, w: 34, h: 28, canvas: 104 },
};

export function getHeadCrop(classKey: string): HeadCrop {
  return HEAD_CROP_BY_CLASS[classKey] ?? HEAD_CROP_DEFAULT;
}

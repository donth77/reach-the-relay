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
  /** Optional extra zoom factor applied on top of the box-fit in the
   *  dialogue portrait. Defaults to 1.2 when unset (modest zoom so the
   *  face fills the frame). Set to 1.0 when the crop is already close
   *  to the portrait box's size and the 1.2× would overflow. */
  fitMultiplier?: number;
}

export const HEAD_CROP_DEFAULT: HeadCrop = { x: 14, y: 4, w: 40, h: 28, canvas: 68 };

export const HEAD_CROP_BY_CLASS: Record<string, HeadCrop> = {
  // Vanguard crops are narrow vertically (small h relative to the
  // dialogue box) so the default 1.2× zoom pushes the sprite past the
  // portrait frame edges. Lock fitMultiplier to 1.0 for both Vanguard
  // variants so they box-fit exactly without overflow.
  vanguard: { x: 30, y: 20, w: 36, h: 22, canvas: 96, fitMultiplier: 1.0 },
  // Vanguard's shield-less "world walking" sprite (136 canvas). Used
  // for portraits anywhere we don't want the raised shield to cover
  // half the character's face — lobby NPC dialogue, journey markers,
  // etc. Character bbox on the world sprite is (51, 41, 85, 105);
  // this crop isolates roughly the helmet + face region.
  'vanguard-world': { x: 52, y: 40, w: 30, h: 26, canvas: 136, fitMultiplier: 1.0 },
  medic: { x: 35, y: 21, w: 34, h: 28, canvas: 104 },
};

export function getHeadCrop(classKey: string): HeadCrop {
  return HEAD_CROP_BY_CLASS[classKey] ?? HEAD_CROP_DEFAULT;
}

/**
 * Portrait info for a class — full texture key to render + crop rect.
 * Prefers a class's shield-less "world" variant when available (keeps
 * combat gear out of the face shot). Falls back to the canonical
 * `<classId>-south` + its head crop otherwise.
 */
export interface PortraitInfo {
  textureKey: string;
  crop: HeadCrop;
}

export function getPortraitInfo(classKey: string): PortraitInfo {
  const worldCrop = HEAD_CROP_BY_CLASS[`${classKey}-world`];
  if (worldCrop) {
    return { textureKey: `${classKey}-world-south`, crop: worldCrop };
  }
  const crop = HEAD_CROP_BY_CLASS[classKey] ?? HEAD_CROP_DEFAULT;
  return { textureKey: `${classKey}-south`, crop };
}

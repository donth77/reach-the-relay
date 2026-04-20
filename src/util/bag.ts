// Grab-bag / shuffle-bag randomness. Each `tag` gets its own bag that cycles
// through the provided pool without repeats. When the bag empties it's
// reshuffled; if the first item of the fresh shuffle equals the previous draw,
// it swaps with a random other entry to prevent consecutive repeats across
// refills.
//
// Module-scoped state persists across scene transitions — scenes just call
// `drawFromBag(tag, pool)` each time they need a pick.

type Bag<T> = {
  remaining: T[];
  lastDrawn: T | null;
};

const bags = new Map<string, Bag<unknown>>();

export function drawFromBag<T>(tag: string, pool: readonly T[]): T | undefined {
  if (pool.length === 0) return undefined;

  let bag = bags.get(tag) as Bag<T> | undefined;
  if (!bag) {
    bag = { remaining: [], lastDrawn: null };
    bags.set(tag, bag as Bag<unknown>);
  }

  if (bag.remaining.length === 0) {
    bag.remaining = shuffle([...pool]);
    // If the refill would cause a consecutive repeat, swap its first element
    // with a random other one.
    if (bag.remaining.length > 1 && bag.remaining[0] === bag.lastDrawn) {
      const swapIdx = 1 + Math.floor(Math.random() * (bag.remaining.length - 1));
      [bag.remaining[0], bag.remaining[swapIdx]] = [bag.remaining[swapIdx], bag.remaining[0]];
    }
  }

  const pick = bag.remaining.shift() as T;
  bag.lastDrawn = pick;
  return pick;
}

export function resetBag(tag: string): void {
  bags.delete(tag);
}

export function resetAllBags(): void {
  bags.clear();
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

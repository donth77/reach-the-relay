import * as Phaser from 'phaser';

// Every non-boot, non-title scene key in the game. Used by the scene-cleanup
// helpers below to ensure no scene is forgotten when sweeping leftover state
// during a hard transition (Abandon / Return-to-title / RunComplete entry).
// Keep this list in sync with src/main.ts when scenes are added or removed.
const RUN_AND_LOBBY_SCENE_KEYS = [
  'Lobby',
  'LeaderSelect',
  'PartySelect',
  'PartySelectTerminal',
  'Route',
  'RouteMap',
  'Journey',
  'Combat',
  'Rest',
  'RunComplete',
  'RelayCutscene',
  'Leaderboard',
] as const;

/**
 * Force-stop every active / paused / sleeping non-boot scene EXCEPT the keys
 * passed in `except`. Used at "this transition is final" moments to make sure
 * no leftover paused scene leaks under the destination (visual / audio /
 * memory leak).
 *
 * `except` should include the scene we're about to start (so we don't kill it
 * before it mounts) and any scene we're keeping alive intentionally (e.g.
 * Lobby on the Abandon path, since we're heading back there).
 */
export function stopOtherScenes(
  sceneManager: Phaser.Scenes.SceneManager,
  except: readonly string[] = [],
): void {
  const exceptSet = new Set(except);
  for (const key of RUN_AND_LOBBY_SCENE_KEYS) {
    if (exceptSet.has(key)) continue;
    if (sceneManager.isActive(key) || sceneManager.isPaused(key) || sceneManager.isSleeping(key)) {
      sceneManager.stop(key);
    }
  }
}

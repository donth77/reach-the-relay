// Side-effect module: exposes Phaser as `window.Phaser` for phaser3-rex-plugins.
//
// The rex plugins were built for Phaser 3's UMD bundle where `Phaser` is a
// runtime global. In our ESM/Vite build there's no such global, so the
// plugin's top-level code throws `ReferenceError: Phaser is not defined`.
//
// Import this file BEFORE any `phaser3-rex-plugins/...` import so the global
// is in place when the rex module evaluates. ES imports are evaluated in
// source-order, so:
//
//   import './util/rexGlobal';  // side-effect: window.Phaser = Phaser
//   import VirtualJoyStick from 'phaser3-rex-plugins/plugins/virtualjoystick';

import * as Phaser from 'phaser';

(window as unknown as { Phaser: typeof Phaser }).Phaser = Phaser;

# Ashen Hollow

A third-person soulslike action game that runs in the browser, built with
[Three.js](https://threejs.org/) and TypeScript.

The game ships with no image, model or audio files. The characters, animation,
textures, sky, level, effects, sound effects and boss music are all generated
in code when the game loads.

> Fight through a ruined castle courtyard full of hollows, light the bonfires,
> and face **Vorhal, the Ashen Warden** beyond the white fog.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm test           # unit tests (vitest)
npm run typecheck
```

Click the title screen to start. The game captures the mouse; press <kbd>Esc</kbd> to pause.

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> | Left stick |
| Camera | Mouse | Right stick |
| Light attack (3-hit combo) | Left mouse | R1 |
| Heavy attack | <kbd>Shift</kbd> + left mouse, or <kbd>C</kbd> | R2 |
| Block (hold) | Right mouse | L1 |
| Parry | <kbd>F</kbd> | L2 |
| Roll / backstep (tap), sprint (hold) | <kbd>Space</kbd> | B / Circle |
| Lock on / off | <kbd>Tab</kbd>, <kbd>Q</kbd> or middle mouse | R3 |
| Switch target | Mouse wheel, <kbd>Z</kbd> / <kbd>X</kbd> | Flick right stick |
| Drink flask | <kbd>R</kbd> | X / Square |
| Interact | <kbd>E</kbd> | A / Cross |
| Menu | <kbd>Esc</kbd> | Start |

## Features

**Combat**
- Stamina governs attacks, rolls, blocking, parries and sprinting.
- Rolls have invincibility frames, and a roll with no direction becomes a backstep.
- A light attack pressed late in a roll becomes a roll attack. A sprint attack is a lunging thrust.
- A three-hit light combo, a heavy overhead strike, and input buffering so your next action queues up during recovery.
- Shield blocking drains stamina; when your stamina runs out, your guard breaks.
- Parry an enemy's swing in a short timing window, then press light attack for a riposte that does critical damage.
- Approach an unaware enemy from behind and attack for a backstab.
- Poise and stagger: heavy enemies have hyper armour during their swings.
- Hitstop, camera shake, weapon trails, sparks, blood and impact flashes.

**Enemies**
- **Hollow soldiers** and **spearmen**: aggressive, chain their attacks, circle and back off. Some sit slumped until you get close.
- **Ashbound brute**: a slow, hyper-armoured club smasher whose slam has a shockwave.
- Only two enemies press the attack at once; the rest circle and wait.
- Enemies notice you by sight and by the sound of you sprinting, chase within a leash range, and walk home to heal if you escape.

**Boss: Vorhal, the Ashen Warden**
- A 2.15× scale greataxe wielder who sits kneeling until you cross the fog gate.
- Moveset: cleave with a shockwave, a delayed cleave, a left/right sweep combo, and a leaping slam.
- At 50% HP he enters phase two: faster, wreathed in fire, with a spinning flurry, a fire nova (with a visible charge-up) and new music.

**Progression and world**
- Bonfires: resting heals you, refills flasks and respawns enemies. Lighting a new bonfire lets you level up and travel between bonfires.
- Souls are the currency for levelling Vigor, Endurance and Strength. When you die you drop them as a bloodstain; die again before recovering it and they are gone.
- Items to find, and orange ground messages with hints.
- Five areas: Shrine of Embers, Ruined Gatehouse, Hollow Courtyard, Bridge of Cinders and Warden's Pyre.
- Progress auto-saves to `localStorage`. Settings: volume, camera sensitivity, invert Y.

**Presentation**
- Shadows and ACES tone mapping, followed by bloom, colour grading, vignette and film grain.
- An eclipse sky shader with clouds and stars, distance fog, flickering torches and braziers, and falling ash.
- Synthesized audio through a convolution reverb: sword swings, impacts, shield clangs, footsteps, ambient wind, bonfire crackle, and boss music for both phases.
- HUD: health with damage-lag bars, stamina, flask count, a souls counter that rolls up, the boss bar, enemy health bars, a lock-on reticle, area titles and the "YOU DIED" screen.

## Project layout

```
src/
  main.ts              entry point (also hosts the dev-only pose viewer)
  Game.ts              game loop, modes, lock-on, interaction, menus, saving
  core/                input (keyboard/mouse/gamepad), audio synth, camera rig, math
  anim/                Pose maths, procedural humanoid Rig, animation clips
  combat/              attack data (frame timings, hitboxes, AoE) and hit resolution
  entities/            Actor base state machine, Player, Enemy AI, Boss
  world/               level construction, collision, procedural textures, sky
  fx/                  particles, weapon trails, shockwaves, post-processing
  ui/                  DOM HUD and menus
  systems/             stats/levelling formulas, save data
tests/                 vitest unit tests
```

### Pose viewer (development)

While `npm run dev` is running, open
`http://localhost:5173/?viewer=<clip>&style=<player|hollow|brute|boss>&n=6&yaw=60`
to see an animation clip sampled across time. Valid `<clip>` values include
`GUARD`, `BLOCK`, `ROLL`, `DEATH`, `RUN`, `SPRINT`, `STRAFE`, and any attack id
such as `light1`, `heavy`, `slash`, `smash`, `sweepR` or `leap`.

### Testing hooks

The running game is exposed as `window.game`. Set `game.manual = true` to stop
the render loop, then call `game.advance(seconds)` to step the simulation
deterministically. This is how the automated playtests drive the game.

## Browser support

Needs a WebGL2-capable desktop browser; it was developed against current
Chromium. Gamepads use the standard mapping. Touch controls are not implemented.

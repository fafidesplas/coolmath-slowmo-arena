# Slowsteel (coolmath-slowmo-arena)

First-person medieval slow-motion arena prototype: **time moves only when you move**.
Three.js + TypeScript + Vite, all geometry procedural and all sound synthesized with Web Audio. The only external asset is the
enemy skeleton and animation clips, taken from Quaternius' [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) (CC0).

**Play:** https://fafidesplas.github.io/coolmath-slowmo-arena/

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173/coolmath-slowmo-arena/
npm run build    # type-check (tsc) + production build in dist/
npm run preview  # serve the build
```

## The run

Pick a first weapon (longsword, war hammer or bow). It will not last: every weapon breaks after a few uses, so the run is
about taking the next one — out of the air, off the ground, or out of a knight's hands.

- **Hands** – left click attacks or uses what you hold, right click throws it where you aim, `E` grabs or swaps the thing
  you are looking at (a prompt under the crosshair says what). With empty hands you punch: it staggers and disarms.
- **Knights drop what they carry** when hit or broken: swords, shields, bows (2 arrows) and elemental staffs (3 charges).
  The weapon arcs toward you and can be caught mid-air. A disarmed knight comes at you with its fists.
- **Shields** – a knight with its shield up stops anything from the front. Throw something to stagger it, strike while it
  attacks, or split the shield with a hammer. A shield in your own hand stops frontal shots and blows.
- **Flasks** (fire / frost / storm) lie around the yard: throw one for an elemental burst, or break it over your weapon
  to coat it for a few hits.
- **Elements** – elemental knights are immune to their own element; fire melts frost, frost quenches fire and grounds
  storm. Fire burns, frost freezes (frozen knights take double damage), storm stuns and arcs to a second knight.
- **Levels** – every few kills you pick one of three passive upgrades (hearts, speed, sturdier weapons, deeper quivers,
  catching arrows in flight, stronger throws…). Three hearts; when they are gone the run ends.

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move | WASD / arrows | Left-thumb virtual joystick |
| Look | Mouse (pointer lock) | Drag on the right half |
| Attack / use | Left click | ATTACK |
| Throw what you hold | Right click (or F / Q) | THROW |
| Grab / swap / catch | E | GRAB (appears when something is in reach) |
| Break a flask over your weapon | Left click while aiming at it | ATTACK while aiming at it |
| Choose an upgrade | Click or 1 / 2 / 3 | Tap |

Tip: standing still nearly freezes time; turning the camera advances it a little; walking runs it at full speed.

## Structure

- `src/main.ts` – game loop, time scale, spawning, levels, damage rules, player, HUD
- `src/skills.ts` – the passive upgrades offered on level-up
- `src/items.ts` – everything that can be held, dropped, caught and thrown (weapons, shields, flasks, arrows)
- `src/elements.ts` – element colours and the damage table
- `src/effects.ts` – lightning arcs, ground rings, floating combat text
- `src/enemies.ts` – archer / mage / swordsman AI, elemental variants, crystal pieces hung on the animated skeleton
- `src/rig.ts` – loads the shared skeleton + clips (`public/anim/rig.*`); rebuild them with `node tools/build-anims.mjs`
  after placing `UAL1_Standard.glb` (Standard pack, `Unreal-Godot/`) in `tools/src-assets/`
- `src/projectiles.ts` – arrows, magic orbs, fireballs, trails, deflection
- `src/particles.ts` – instanced crystal shards & sparks (world time)
- `src/sword.ts` – the first-person hand: whatever is held, its swing poses and glow
- `src/post.ts` – full-screen grading pass (desaturation, vignette, flash)
- `src/audio.ts` – synthesized SFX with time-scaled pitch/filter
- `src/world.ts` – castle courtyard
- `src/input.ts` – keyboard/mouse + touch controls

Deployed automatically to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

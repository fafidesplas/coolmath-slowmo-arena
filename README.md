# Slowsteel (coolmath-slowmo-arena)

First-person medieval slow-motion arena prototype: **time moves only when you move**.
Three.js + TypeScript + Vite, all geometry procedural and all sound synthesized with Web Audio — no external assets.

**Play:** https://fafidesplas.github.io/coolmath-slowmo-arena/

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173/coolmath-slowmo-arena/
npm run build    # type-check (tsc) + production build in dist/
npm run preview  # serve the build
```

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move | WASD / arrows | Left-thumb virtual joystick |
| Look | Mouse (pointer lock) | Drag on the right half |
| Sword slash | Left click (or F) | SWORD |
| Block / parry | Right click (or Shift), hold | BLOCK (hold) |
| Fireball | Q | FIRE |
| Force push | E | PUSH |
| Restart wave | R | Tap after death |

Tip: standing still nearly freezes time; turning the camera advances it a little; walking runs it at full speed.
Swinging or blocking just as an arrow arrives sends it back at your enemies.

## Structure

- `src/main.ts` – game loop, time scale, waves, player, HUD
- `src/enemies.ts` – archer / mage / swordsman AI + low-poly bodies
- `src/projectiles.ts` – arrows, magic orbs, fireballs, trails, deflection
- `src/particles.ts` – instanced crystal shards & sparks (world time)
- `src/sword.ts` – first-person sword, swing/block poses, swing arc
- `src/post.ts` – full-screen grading pass (desaturation, vignette, flash)
- `src/audio.ts` – synthesized SFX with time-scaled pitch/filter
- `src/world.ts` – castle courtyard
- `src/input.ts` – keyboard/mouse + touch controls

Deployed automatically to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

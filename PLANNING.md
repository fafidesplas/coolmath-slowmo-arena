# Slowsteel — Planning

**Pitch:** first-person medieval arena where *time moves only when you move*. Crystal knights, frozen arrows, one hit and you shatter.

## Core pillar: the slow-motion feel
- `timeScale` target = max(0.04 idle, walk speed, camera turn × 0.32, short action boost).
- Exponential smoothing (faster up than down) → no abrupt jumps.
- Player moves/animates on real time; enemies, projectiles, shards, sparks on world time.
- Feedback tied to `1 - timeScale`: desaturation (reds kept), vignette, chromatic fringe, heartbeat, master low-pass, echo, pitch-down of every SFX. Hit-stop + flash on kills/parries.

## Prototype scope (done)
- Castle courtyard, 5 waves, archers / mages / swordsmen, glass shatter deaths.
- Sword slash (cuts enemies + deflects projectiles), block/parry (deflects arrows & orbs, staggers swordsmen).
- Spells: Fireball (Q, 30 mana) and Force Push (E, 50 mana). Mana regenerates on world time and on kills.
- Desktop (pointer lock) + touch (joystick, look drag, buttons). GitHub Pages deploy.

## Next steps
1. Tuning pass on real devices (time curve, enemy timings, aim assist).
2. Level variety (2–3 arenas), more enemy types (shield bearer, crossbow volley).
3. Throwable weapons (SUPERHOT-like pick-up/throw), replay of the run at real speed.
4. Mobile: auto-quality, haptics, orientation lock.
5. Coolmath integration (no-ads safe UI, progress save).

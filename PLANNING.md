# Slowsteel — Planning

**Pitch:** first-person medieval arena where *time moves only when you move*. Crystal knights, frozen arrows, one hit and you shatter.

## Core pillar: the slow-motion feel
- `timeScale` target = max(0.04 idle, walk speed, camera turn × 0.32, short action boost).
- Exponential smoothing (faster up than down) → no abrupt jumps.
- Player moves/animates on real time; enemies, projectiles, shards, sparks on world time.
- Feedback tied to `1 - timeScale`: desaturation (reds kept), vignette, chromatic fringe, heartbeat, master low-pass, echo, pitch-down of every SFX. Hit-stop + flash on kills/parries.

## Prototype scope (done)
- Castle courtyard, endless arrivals of archers / mages / swordsmen, glass shatter deaths.
- SUPERHOT-style hands: use, throw, grab/swap, catch in mid-air, bare fists; every weapon has durability and breaks.
- Knights drop their weapon when hit or broken; shields block from the front (theirs and yours); disarmed knights brawl.
- Magic comes from things, not from a mana bar: elemental staffs with charges, flasks to throw or to coat a weapon.
- Items seeded in the yard and re-offered over time; spent arrows stay where they land and can be reused.
- Elemental knights (fire / frost / storm) with immunities, weaknesses, status effects and death bursts.
- Incremental run: first weapon choice, XP per kill, passive upgrade on level-up (1 of 3), 3 hearts.
- Enemies animated with clips from Quaternius' Universal Animation Library (CC0); the archer's draw and the shield guard are posed procedurally.
- Desktop (pointer lock) + touch (joystick, look drag, ATTACK / THROW / GRAB). GitHub Pages deploy.

## Next steps
1. Tuning pass on real devices (time curve, enemy timings, aim assist).
2. Level variety (2–3 arenas), more enemy types (shield bearer, crossbow volley).
3. Throwable weapons (SUPERHOT-like pick-up/throw), replay of the run at real speed.
4. Mobile: auto-quality, haptics, orientation lock.
5. Coolmath integration (no-ads safe UI, progress save).

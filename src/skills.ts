/** Passive upgrades offered on level-up. Weapons and magic are found in the yard, not learned. */
export type SkillId = 'vitality' | 'swift' | 'sturdy' | 'pockets' | 'catch' | 'arm' | 'quick' | 'stillness' | 'fists' | 'alchemist';

export interface SkillDef {
  id: SkillId;
  name: string;
  desc: string;
  max: number;
}

export const SKILLS: SkillDef[] = [
  { id: 'vitality', name: 'Vitality', max: 3, desc: '+1 heart, and heal fully.' },
  { id: 'swift', name: 'Swift Feet', max: 2, desc: 'Move 12% faster.' },
  { id: 'sturdy', name: 'Careful Hands', max: 2, desc: 'Weapons you pick up last 40% longer before breaking.' },
  { id: 'pockets', name: 'Deep Quiver', max: 2, desc: 'Bows come with +1 arrow and staffs with +1 charge.' },
  { id: 'catch', name: 'Arrow Catch', max: 1, desc: 'Grab arrows out of the air when they pass within reach.' },
  { id: 'arm', name: 'Strong Arm', max: 2, desc: 'Thrown weapons fly faster and hit for +2.' },
  { id: 'quick', name: 'Quick Hands', max: 2, desc: 'Attack 18% faster.' },
  { id: 'stillness', name: 'Deep Stillness', max: 1, desc: 'Standing still slows time twice as much.' },
  { id: 'fists', name: 'Iron Fists', max: 2, desc: 'Bare hands hit for +1 and stagger for longer.' },
  { id: 'alchemist', name: 'Alchemist', max: 1, desc: 'A flask coats your weapon for twice as many hits, and bursts wider.' },
];

export const SKILL: Record<SkillId, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<SkillId, SkillDef>;

export function emptySkills(): Record<SkillId, number> {
  return Object.fromEntries(SKILLS.map((s) => [s.id, 0])) as Record<SkillId, number>;
}

/** Pick up to `n` distinct upgrades that can still be taken. */
export function rollChoices(owned: Record<SkillId, number>, n: number): SkillDef[] {
  const pool = SKILLS.filter((s) => owned[s.id] < s.max);
  const out: SkillDef[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

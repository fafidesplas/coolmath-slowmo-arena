import * as THREE from 'three';

export type Element = 'none' | 'fire' | 'ice' | 'storm';

export const ELEMENTS: Element[] = ['fire', 'ice', 'storm'];

export const EL_HEX: Record<Element, number> = {
  none: 0x58c8ff,
  fire: 0xff7a1a,
  ice: 0x9fe8ff,
  storm: 0xb07cff,
};
export const EL_CSS: Record<Element, string> = {
  none: '#ffffff',
  fire: '#ff9a3a',
  ice: '#9fe8ff',
  storm: '#c9a4ff',
};
export const EL_COLOR: Record<Element, THREE.Color> = {
  none: new THREE.Color(0xfff0b0),
  fire: new THREE.Color(0xff8a2a),
  ice: new THREE.Color(0xaeeaff),
  storm: new THREE.Color(0xc09aff),
};
export const EL_NAME: Record<Element, string> = { none: 'Steel', fire: 'Fire', ice: 'Frost', storm: 'Storm' };

/**
 * Damage multiplier of an attack element against an enemy element.
 * Same element = immune. Fire melts ice, frost quenches fire and grounds storm.
 */
const MULT: Record<Element, Record<Element, number>> = {
  none: { none: 1, fire: 1, ice: 1, storm: 1 },
  fire: { none: 1, fire: 0, ice: 2, storm: 1 },
  ice: { none: 1, fire: 2, ice: 0, storm: 2 },
  storm: { none: 1, fire: 1, ice: 1, storm: 0 },
};

export function elementMult(attack: Element, target: Element): number {
  return MULT[attack][target];
}

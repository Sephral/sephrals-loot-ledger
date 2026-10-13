/**
 * The adapter registry. The module picks the adapter of the running system; other modules can register an adapter for
 * their system before the "ready" hook through the module API.
 */

import {CrucibleAdapter} from "./crucible.mjs";
import {Dnd5eAdapter} from "./dnd5e.mjs";
import {GenericAdapter} from "./generic.mjs";

export {BaseAdapter} from "./base.mjs";

const adapters = new Map([
  ["crucible", new CrucibleAdapter()],
  ["dnd5e", new Dnd5eAdapter()]
]);

const generic = new GenericAdapter();

/**
 * Register an adapter for a system.
 * @param {string} systemId
 * @param {import("./base.mjs").BaseAdapter} adapter
 */
export function registerAdapter(systemId, adapter) {
  if ( !systemId || !adapter ) throw new Error("registerAdapter needs a system id and an adapter");
  adapters.set(systemId, adapter);
}

/**
 * Does the running system have an own adapter?
 * @param {string} [systemId]
 * @returns {boolean}
 */
export function hasAdapter(systemId=game.system.id) {
  return adapters.has(systemId);
}

/**
 * The adapter of the running system.
 * @returns {import("./base.mjs").BaseAdapter}
 */
export function adapter() {
  return adapters.get(game.system.id) ?? generic;
}

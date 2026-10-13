/**
 * Document changes as one unit. Foundry 14 can apply a batch of changes all or nothing. Foundry 13 cannot, and neither
 * can changes on unlinked tokens, so there the changes run one after another: first everything that adds, then
 * everything that takes away, and if a step fails the steps before it are rolled back.
 */

import {generation} from "./config.mjs";

/** While the module changes documents itself (see the edit detection in service.mjs). */
let busy = 0;

/**
 * Is the module changing documents right now?
 * @returns {boolean}
 */
export function isBusy() {
  return busy > 0;
}

/**
 * @typedef Operation
 * @property {"create"|"update"|"delete"} action
 * @property {"Item"|"Actor"} documentName
 * @property {Actor} [parent]       The actor of embedded items
 * @property {object[]} [data]      Create data
 * @property {object[]} [updates]   Updates with _id
 * @property {string[]} [ids]       Ids to delete
 * @property {object} [options]     Extra operation options (for example keepId)
 */

/**
 * Apply operations, in the order given (adding steps first is the caller's job).
 * @param {Operation[]} operations
 * @returns {Promise<void>}
 */
export async function applyOperations(operations) {
  operations = operations.filter(o => (o.data?.length || o.updates?.length || o.ids?.length));
  if ( !operations.length ) return;
  busy++;
  try {
    const batchable = (generation() >= 14) && (typeof foundry.documents?.modifyBatch === "function")
      && operations.every(o => !o.parent?.isToken);
    if ( batchable ) {
      await foundry.documents.modifyBatch(operations.map(o => {
        const op = {action: o.action, documentName: o.documentName, ...(o.options ?? {})};
        if ( o.parent ) op.parent = o.parent;
        if ( o.action === "create" ) op.data = o.data;
        else if ( o.action === "update" ) op.updates = o.updates;
        else op.ids = o.ids;
        return op;
      }));
      return;
    }
    await sequential(operations);
  }
  finally {
    busy--;
  }
}

/**
 * Apply operations one after another and roll back on failure.
 * @param {Operation[]} operations
 * @returns {Promise<void>}
 */
async function sequential(operations) {
  const undo = [];
  try {
    for ( const o of operations ) {
      const cls = CONFIG[o.documentName].documentClass;
      const context = {...(o.options ?? {})};
      if ( o.parent ) context.parent = o.parent;
      if ( o.action === "create" ) {
        const created = await cls.createDocuments(o.data, context);
        undo.push(() => cls.deleteDocuments(created.map(d => d.id), {parent: o.parent}));
      }
      else if ( o.action === "update" ) {
        const collection = o.parent ? o.parent.getEmbeddedCollection(o.documentName) : game.collections.get(o.documentName);
        const before = o.updates.map(u => {
          const doc = collection.get(u._id);
          const flat = foundry.utils.flattenObject(foundry.utils.deepClone(u));
          const prior = {_id: u._id};
          for ( const key of Object.keys(flat) ) if ( key !== "_id" ) prior[key] = foundry.utils.getProperty(doc?._source ?? {}, key);
          return prior;
        });
        await cls.updateDocuments(o.updates, context);
        undo.push(() => cls.updateDocuments(before, {parent: o.parent}));
      }
      else {
        const collection = o.parent.getEmbeddedCollection(o.documentName);
        const data = o.ids.map(id => collection.get(id)?.toObject()).filter(Boolean);
        await cls.deleteDocuments(o.ids, context);
        undo.push(() => cls.createDocuments(data, {parent: o.parent, keepId: true}));
      }
    }
  } catch(err) {
    for ( const step of undo.reverse() ) {
      try {
        await step();
      } catch(rollbackError) {
        console.error("sephrals-loot-ledger | Rollback failed", rollbackError);
      }
    }
    throw err;
  }
}

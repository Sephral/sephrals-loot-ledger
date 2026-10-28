/**
 * The recent requests to the GM, for debug files: who asked for what, which way the request travelled and how it
 * ended. Payloads can carry whole items, so the trace keeps only ids, short values and sizes.
 */

import {DebugTrace} from "./debug-file.mjs";

/** The trace of this client: requests it sent and, on the active GM's client, requests it handled. */
export const debugTrace = new DebugTrace();

/** Values kept as they are: ids, uuids, areas, claims and other single words. */
const SHORT_VALUE = /^[A-Za-z0-9._-]{1,120}$/;

/**
 * The parts of a request payload a debug file may hold.
 * @param {object} [payload]
 * @returns {object}
 */
export function payloadInfo(payload) {
  const info = {};
  for ( const [key, value] of Object.entries(payload ?? {}) ) {
    if ( (value === null) || (typeof value === "number") || (typeof value === "boolean") ) info[key] = value;
    else if ( typeof value === "string" ) info[key] = SHORT_VALUE.test(value) ? value : `(${value.length} characters)`;
    else if ( Array.isArray(value) ) {
      const ids = value.every(v => (typeof v === "string") && SHORT_VALUE.test(v));
      info[key] = ids ? value.slice(0, 20) : `(${value.length} entries)`;
    }
    else if ( typeof value === "object" ) info[key] = `(${Object.keys(value).length} keys)`;
  }
  return info;
}

/**
 * The outcome of a request for the trace.
 * @param {object} result
 * @returns {{ok: boolean, error?: string}}
 */
export function resultInfo(result) {
  return result?.ok ? {ok: true} : {ok: false, error: result?.error ?? "SLL.Error.requestFailed"};
}

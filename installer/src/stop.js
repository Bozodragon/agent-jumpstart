/** A problem to tell the person in plain words before stopping the run. */
export class Stop extends Error {}

/** @param {unknown} error */
export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

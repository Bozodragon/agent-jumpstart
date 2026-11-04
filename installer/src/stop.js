/** A problem to tell the person in plain words before stopping the run. */
export class Stop extends Error {}

/**
 * The run ending early because the person chose to, before anything was changed: not a problem,
 * so it ends as a finished run does, with what to do next.
 */
export class End extends Error {}

/** @param {unknown} error */
export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

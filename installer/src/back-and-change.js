// Back and Change on the Installer page (see FrontEnd's `questions`): which answers may be gone
// back to, the answers given again without asking after going back, and the defaults a question
// then starts with. They last from the questions' `begin` until they're fixed. The page front end
// (installer-page.js) asks this what to do; only it talks to the page, through `send`.

/**
 * A question answered while Back and Change last: what it was, by the id the page knows it by,
 * and the answer.
 * @typedef {{ id: number, key?: string, kind: string, answer: unknown }} Answered
 */

/**
 * @param {(event: Record<string, unknown>) => number} send sends the page an event
 */
export function backAndChange(send) {
  let open = false;
  let fixed = false;
  /** The questions answered since the last `begin`, in order. @type {Answered[]} */
  let pass = [];
  /** The answers before the question gone back to, given again without asking. @type {Answered[]} */
  let replay = [];
  /**
   * After going back, until a question is put to the page again: what's shown then was shown the
   * first time through, and the page still has it.
   */
  let quiet = false;
  /** Whether the person has gone back, after which every question starts with their last answer to it. */
  let wentBack = false;
  /** The last answer given to each question, by its kind and key. @type {Map<string, unknown>} */
  const given = new Map();
  /** @param {{ kind?: unknown, key?: unknown }} question */
  const named = ({ kind, key }) => `${kind}:${key}`;

  return {
    /** Whether a question asked now may be gone back to once it's answered. */
    get open() {
      return open;
    },
    /** Whether what the run shows now was shown the first time through (see `quiet` above). */
    get quiet() {
      return quiet;
    },
    begin() {
      pass = [];
      open = !fixed;
    },
    /** Back and Change are gone for good. */
    fix() {
      open = false;
      replay = [];
      quiet = false;
      if (fixed) return;
      fixed = true;
      send({ type: 'fixed' });
    },
    /** The run is stopping: nothing is asked again, so there's no going back either. */
    close() {
      open = false;
      replay = [];
    },
    /**
     * Where in this pass the question the page calls `to` was answered, if it may be gone back
     * to; -1 if not.
     * @param {unknown} to
     */
    find(to) {
      return pass.findIndex((answered) => answered.id === to && answered.key !== undefined);
    },
    /**
     * Goes back to the question answered at `at` in this pass: the answers before it are given
     * again, and it and everything since are asked again.
     * @param {number} at as `find` gave it
     * @returns {string} its key
     */
    goBack(at) {
      replay = pass.slice(0, at);
      wentBack = true;
      quiet = true;
      send({ type: 'back', to: pass[at].id });
      return /** @type {string} */ (pass[at].key);
    },
    /**
     * After going back, the answer a question before the one gone back to had, if it's asked as
     * it was and its answer still does; then it isn't put to the page. A question asked
     * differently this time (something on the laptop changed meanwhile, such as Google Drive
     * signed in) ends the replay: from there, it's asked, and the page takes off what it had.
     * @param {Record<string, any>} question
     * @param {(answer: unknown) => Promise<{ value: unknown } | { refused: string }>} check
     * @returns {Promise<{ value: unknown } | undefined>}
     */
    async replayed(question, check) {
      const [again] = replay;
      if (!again) return undefined;
      replay = replay.slice(1);
      const checked = again.key === question.key && again.kind === question.kind ? await check(again.answer) : undefined;
      if (checked && 'value' in checked) {
        pass.push({ ...again, answer: checked.value });
        return { value: checked.value };
      }
      replay = [];
      send({ type: 'back', to: again.id });
      return undefined;
    },
    /** A question is put to the page: what's shown from now on is new. */
    asking() {
      quiet = false;
    },
    /**
     * A question was answered.
     * @param {number} id @param {Record<string, any>} question @param {unknown} value
     * @param {boolean} inPass whether Back and Change lasted when it was asked
     */
    answered(id, question, value, inPass) {
      given.set(named(question), value);
      if (inPass && open) pass.push({ id, key: question.key, kind: question.kind, answer: value });
    },
    /**
     * A question's default once the person has gone back: the answer they last gave it, if it
     * would still do, otherwise its own.
     * @param {Record<string, any>} question
     */
    defaultOf(question) {
      const before = given.get(named(question));
      if (!wentBack || before === undefined) return question.initial;
      /** @type {string[]} */
      const values = (question.options ?? []).map((/** @type {{ value: string }} */ { value }) => value);
      switch (question.kind) {
        case 'choose':
          return values.includes(/** @type {string} */ (before)) ? before : question.initial;
        case 'pick':
          return Array.isArray(before) ? values.filter((value) => before.includes(value)) : question.initial;
        case 'confirm':
          return typeof before === 'boolean' ? before : question.initial;
        case 'folder':
          return typeof before === 'string' ? before : question.initial;
        default:
          return question.initial;
      }
    },
  };
}

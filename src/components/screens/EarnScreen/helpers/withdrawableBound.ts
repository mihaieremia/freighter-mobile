/**
 * The bound the withdraw screen should show, given what the positions fetch
 * has produced so far.
 *
 * The rule is "fall back only when there is nothing to fall back on". A
 * background poll fails roughly as often as the XOXNO routes are flaky, and it
 * fires under a screen the user is already working in: treating that failure
 * as "no bound" disabled the percentage buttons, raised the withdrawal-
 * unavailable block, and — through the withdrawAll effect — silently cleared
 * an amount the user had typed, all of which undid itself on the next poll.
 *
 * Only a failure with no list behind it leaves the screen genuinely without a
 * bound. Until the screen's own fetch resolves, the figure the positions list
 * was opened with stands in, so the first render is never boundless.
 */
export const withdrawableBound = ({
  positions,
  positionsError,
  routeBound,
  legBound,
}: {
  /** null until this screen's own fetch has ever produced a list. */
  positions: unknown[] | null;
  positionsError: string | null;
  /** The bound carried in from the positions list this screen was opened from. */
  routeBound: string | null;
  /** The bound on the matching leg of the freshest list, if it is still there. */
  legBound: string | null;
}): string | null => {
  if (positions === null) {
    return positionsError ? null : routeBound;
  }
  return legBound;
};

/**
 * Build a once-only finalizer so both the normal and error completion paths can
 * preserve a development log without creating duplicate commits.
 */
export const createDevelopmentLogFinalizer = ({ collect, getParams }) => {
  let resultPromise = null;
  return () => {
    if (!resultPromise) resultPromise = Promise.resolve().then(() => collect(getParams()));
    return resultPromise;
  };
};

/**
 * The languages a task container can actually build and run.
 *
 * Issue #2247 (H9). On 2026-09-13 `create-test-repo.mjs` picked Scala for a
 * `solve --model formal-ai --tool agent` task. The AI wrote `Main.scala`, tried
 * to compile and run it, and the container answered:
 *
 *     /bin/sh: 1: scalac: not found        (Scala draft log, line 4367)
 *     /bin/sh: 1: scala: not found         (line 5548)
 *
 * The task image is built `FROM ghcr.io/link-foundation/box:2.10.2`
 * (`Dockerfile`), and box has no Scala toolchain: its language stages are
 * assembly, cpp, dotnet, go, java, js, kotlin, lean, perl, php, python, r,
 * rocq, ruby, rust and swift (one `ubuntu/24.04` Dockerfile each in
 * link-foundation/box), with .NET, R, cmake/clang/llvm and nasm added by apt in
 * the full-box Dockerfile - plus OCaml, which arrives with the `rocq` stage's
 * opam switch, and gfortran, which comes with gcc. Twenty-three of the forty
 * languages in the old pool were in the same position as Scala - the task could
 * not have succeeded whichever tool or model ran it.
 *
 * Both sides now read this list: the pool `create-test-repo.mjs` draws from is
 * this list, so a task is only ever created for a toolchain the image ships.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 */

/** The base image the task container is built from (`Dockerfile`). */
export const TASK_IMAGE_BASE = 'ghcr.io/link-foundation/box:2.10.2';

/**
 * Languages the task image can compile and run, each with the command that
 * proves it. `experiments/verify-task-image-languages.sh` runs every probe
 * inside the image; `experiments/verify-task-image-hello-world.sh` goes further
 * and requires each one to actually compile and print `Hello, World!`, which is
 * how OCaml and Fortran - present in box, absent from box's own language-stage
 * list - were found and kept.
 */
export const TASK_IMAGE_LANGUAGES = [
  { name: 'JavaScript', probe: 'node --version' },
  { name: 'TypeScript', probe: 'bun --version' },
  { name: 'Python', probe: 'python3 --version' },
  { name: 'Go', probe: 'go version' },
  { name: 'Rust', probe: 'rustc --version' },
  { name: 'Ruby', probe: 'ruby --version' },
  { name: 'Java', probe: 'java -version' },
  { name: 'Kotlin', probe: 'kotlinc -version' },
  { name: 'C', probe: 'gcc --version' },
  { name: 'C++', probe: 'g++ --version' },
  { name: 'C#', probe: 'dotnet --version' },
  { name: 'F#', probe: 'dotnet fsi --help' },
  { name: 'Swift', probe: 'swift --version' },
  { name: 'PHP', probe: 'php --version' },
  { name: 'Perl', probe: 'perl --version' },
  { name: 'R', probe: 'Rscript --version' },
  { name: 'OCaml', probe: 'ocaml -version' },
  { name: 'Fortran', probe: 'gfortran --version' },
];

/**
 * Languages removed from the pool, and the reason. Kept as data rather than
 * deleted so the next reader can see that the omission is deliberate and what
 * would have to change in box for the language to come back.
 */
export const LANGUAGES_WITHOUT_TASK_IMAGE_TOOLCHAIN = ['Scala', 'Haskell', 'Elixir', 'Clojure', 'Erlang', 'Julia', 'Lua', 'Dart', 'Zig', 'Nim', 'Crystal', 'V', 'D', 'Pascal', 'COBOL', 'Ada', 'Prolog', 'Scheme', 'Racket', 'Common Lisp', 'Elm', 'PureScript', 'ReasonML'];

/** Just the names, in pool order. */
export const listTaskImageLanguages = () => TASK_IMAGE_LANGUAGES.map(language => language.name);

/**
 * @param {string} name
 * @returns {boolean} whether the task image ships a toolchain for it
 */
export const isLanguageSupportedByTaskImage = name =>
  TASK_IMAGE_LANGUAGES.some(
    language =>
      language.name.toLowerCase() ===
      String(name ?? '')
        .trim()
        .toLowerCase()
  );

/**
 * Pick a language for a new test repository.
 *
 * @param {Object} [options]
 * @param {() => number} [options.random] - injectable for tests
 * @returns {string}
 */
export const pickTaskImageLanguage = ({ random = Math.random } = {}) => {
  const names = listTaskImageLanguages();
  // A draw outside [0, 1) - or a random source that returns nothing usable -
  // must still yield a language the image ships, never `undefined`.
  const draw = random();
  const index = Number.isFinite(draw) ? Math.min(names.length - 1, Math.max(0, Math.floor(draw * names.length))) : 0;
  return names[index];
};

export default { isLanguageSupportedByTaskImage, LANGUAGES_WITHOUT_TASK_IMAGE_TOOLCHAIN, listTaskImageLanguages, pickTaskImageLanguage, TASK_IMAGE_BASE, TASK_IMAGE_LANGUAGES };

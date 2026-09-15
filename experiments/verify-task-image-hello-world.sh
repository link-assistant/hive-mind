#!/usr/bin/env bash
# Issue #2247 (H9), the strong form of experiments/verify-task-image-languages.sh:
# for every language the pool offers, write a Hello World inside the task image,
# compile it, run it, and require `Hello, World!` on stdout. A `--version` probe
# only proves a binary exists; the acceptance criterion of issue #2247 is a
# program that compiles and runs.
#
#   experiments/verify-task-image-hello-world.sh [image]
set -uo pipefail
IMAGE="${1:-ghcr.io/link-foundation/box:2.10.2}"
echo "Image: $IMAGE"
echo

docker run --rm --entrypoint bash "$IMAGE" -lc '
set -uo pipefail
work=$(mktemp -d); cd "$work"
export HOME="${HOME:-/root}" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
expected="Hello, World!"
failed=0

check() { # check <label> <file> <contents> <build-and-run command>
  local label="$1" file="$2" body="$3" command="$4" out status
  local dir="$work/$label"; mkdir -p "$dir"; cd "$dir"
  # %b so the \n in a body becomes a newline and \\n stays an escape for the compiler.
  [ -n "$file" ] && printf "%b\n" "$body" > "$file"
  out=$(eval "$command" 2>&1); status=$?
  if [ $status -eq 0 ] && printf "%s" "$out" | grep -qF "$expected"; then
    printf "  %-12s ok\n" "$label"
  else
    printf "  %-12s FAIL  %s\n" "$label" "$(printf "%s" "$out" | tr "\n" " " | cut -c1-160)"
    failed=$((failed + 1))
  fi
  cd "$work"
}

check JavaScript hello.js       "console.log(\"Hello, World!\");"                                    "node hello.js"
check TypeScript hello.ts       "const greeting: string = \"Hello, World!\"; console.log(greeting);" "bun run hello.ts"
check Python     hello.py       "print(\"Hello, World!\")"                                           "python3 hello.py"
check Go         hello.go       "package main\nimport \"fmt\"\nfunc main() { fmt.Println(\"Hello, World!\") }" "go run hello.go"
check Rust       hello.rs       "fn main() { println!(\"Hello, World!\"); }"                         "rustc hello.rs -o hello && ./hello"
check Ruby       hello.rb       "puts \"Hello, World!\""                                             "ruby hello.rb"
check Java       Hello.java     "public class Hello { public static void main(String[] a) { System.out.println(\"Hello, World!\"); } }" "java Hello.java"
check Kotlin     hello.kt       "fun main() { println(\"Hello, World!\") }"                           "kotlinc hello.kt -include-runtime -d hello.jar 2>/dev/null && java -jar hello.jar"
check C          hello.c        "#include <stdio.h>\nint main(void) { printf(\"Hello, World!\\\\n\"); return 0; }" "gcc hello.c -o hello && ./hello"
check C++        hello.cpp      "#include <iostream>\nint main() { std::cout << \"Hello, World!\" << std::endl; }"  "g++ hello.cpp -o hello && ./hello"
check C#         ""             ""                                                                   "dotnet new console -o app >/dev/null && sed -i \"s/Hello, World!*/Hello, World!/\" app/Program.cs && dotnet run --project app"
check F#         Program.fs     "printfn \"Hello, World!\""                                          "dotnet new console -lang \"F#\" -o fsapp >/dev/null && cp Program.fs fsapp/Program.fs && dotnet run --project fsapp"
check Swift      hello.swift    "print(\"Hello, World!\")"                                            "swiftc hello.swift -o hello && ./hello"
check PHP        hello.php      "<?php echo \"Hello, World!\\\\n\";"                                  "php hello.php"
check Perl       hello.pl       "print \"Hello, World!\\\\n\";"                                       "perl hello.pl"
check R          hello.R        "cat(\"Hello, World!\\\\n\")"                                         "Rscript hello.R"
check OCaml      hello.ml       "let () = print_endline \"Hello, World!\""                            "ocamlfind ocamlopt hello.ml -o hello 2>/dev/null && ./hello || ocaml hello.ml"
check Fortran    hello.f90      "program hello\n  print *, \"Hello, World!\"\nend program hello"      "gfortran hello.f90 -o hello && ./hello"

echo
echo "languages that could not print Hello, World!: $failed"
exit $failed
'

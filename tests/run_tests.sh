#!/bin/sh
# Runs the test suite with whichever JavaScript engine is available.
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
for f in js/logic.js js/app.js data/syllabus.js data/evidence.js data/stats.js data/questions.js data/news.js data/config.js; do
  if [ -x "$JSC" ]; then "$JSC" -e "checkSyntax('$f')" || { echo "Syntax error in $f"; exit 1; }; fi
done
if [ -x "$JSC" ]; then
  exec "$JSC" tests/run_tests.js
elif command -v node >/dev/null 2>&1; then
  exec node -e 'const fs=require("fs");globalThis.print=console.log;globalThis.read=(f)=>fs.readFileSync(f,"utf8");globalThis.load=(f)=>require("vm").runInThisContext(read(f),{filename:f});load("tests/run_tests.js");'
else
  echo "No JavaScript engine found (need macOS JavaScriptCore or Node.js)"; exit 1
fi

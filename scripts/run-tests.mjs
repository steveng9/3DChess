/*
 * Headless runner for the rules tests — the same suites tests.html shows in the
 * browser.
 *
 *   node scripts/run-tests.mjs
 *   jsc -m scripts/run-tests.mjs     (jsc ships with macOS; no install needed)
 *
 * This works only because js/rules/ has no DOM, network or Three.js imports.
 * Keep it that way.
 */

import { results } from '../js/test/tests.js';

// jsc exposes `print`; node exposes `console` and `process`.
const hasProcess = typeof process !== 'undefined' && process.stdout;
const say = hasProcess ? (s) => console.log(s) : (s) => print(s);

const colour = hasProcess && process.stdout.isTTY;
const GREEN = colour ? '\x1b[32m' : '';
const RED = colour ? '\x1b[31m' : '';
const DIM = colour ? '\x1b[2m' : '';
const RESET = colour ? '\x1b[0m' : '';

let pass = 0;
let fail = 0;

for (const suite of results) {
  say(`\n${DIM}${suite.name}${RESET}`);
  for (const t of suite.tests) {
    if (t.pass) {
      pass++;
      say(`  ${GREEN}✓${RESET} ${t.name}`);
    } else {
      fail++;
      say(`  ${RED}✗ ${t.name}${RESET}`);
      say(`      ${RED}${t.error}${RESET}`);
    }
  }
}

say(
  fail
    ? `\n${RED}${fail} failing${RESET}, ${pass} passing\n`
    : `\n${GREEN}All ${pass} tests passing${RESET}\n`,
);

if (hasProcess) process.exit(fail ? 1 : 0);

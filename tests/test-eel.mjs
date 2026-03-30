/**
 * EEL Expression Language Unit Tests
 *
 * Tests the compiler + stdlib against known-correct values
 * based on the original ns-eel behavior from vis_avs.
 *
 * Usage: node tests/test-eel.mjs
 */

import { compileEEL, createState } from '../js/avs/eel/nseel-compiler.js';
import { createStdlib } from '../js/avs/eel/nseel-stdlib.js';

const EPSILON = 0.0001;
let passed = 0, failed = 0, errors = [];

function test(name, expr, expected, setupCode) {
  try {
    const regs = new Float64Array(100);
    const megabuf = {};
    const state = createState(regs, megabuf);
    const lib = createStdlib({
      waveform: new Uint8Array(576).fill(128), // silence
      spectrum: new Float32Array(512).fill(-100),
      fftSize: 1024,
      time: 1.0,
    });

    if (setupCode) {
      const setupFn = compileEEL(setupCode);
      setupFn(state, lib);
    }

    const fn = compileEEL(expr);
    const result = fn(state, lib);

    // Check the last variable assigned, or the return value
    let actual;
    if (expected !== undefined && typeof expected === 'object' && expected._var) {
      actual = state[expected._var];
      expected = expected._val;
    } else {
      actual = result;
    }

    if (typeof expected === 'number') {
      if (Math.abs(actual - expected) < EPSILON) {
        passed++;
      } else {
        failed++;
        errors.push(`FAIL: ${name} — expected ${expected}, got ${actual}`);
      }
    } else if (expected === true || expected === false) {
      const boolResult = Math.abs(actual) >= EPSILON;
      if (boolResult === expected) {
        passed++;
      } else {
        failed++;
        errors.push(`FAIL: ${name} — expected ${expected}, got ${actual} (bool: ${boolResult})`);
      }
    }
  } catch (e) {
    failed++;
    errors.push(`ERROR: ${name} — ${e.message}`);
  }
}

function testVar(name, code, varName, expected) {
  test(name, code, { _var: varName, _val: expected });
}

// ── Arithmetic ──────────────────────────────────────────────────────

test('addition', 'x=3+4', { _var: 'x', _val: 7 });
test('subtraction', 'x=10-3', { _var: 'x', _val: 7 });
test('multiplication', 'x=3*4', { _var: 'x', _val: 12 });
test('division', 'x=10/4', { _var: 'x', _val: 2.5 });
test('modulo', 'x=10%3', { _var: 'x', _val: 1 });
test('power', 'x=2^10', { _var: 'x', _val: 1024 });
test('negative', 'x=-5', { _var: 'x', _val: -5 });
test('order of operations', 'x=3+4*2', { _var: 'x', _val: 11 });
test('parentheses', 'x=(3+4)*2', { _var: 'x', _val: 14 });

// ── Assignment ──────────────────────────────────────────────────────

testVar('simple assign', 'x=5', 'x', 5);
testVar('chain assign', 'x=5; y=x*2', 'y', 10);
testVar('compound +=', 'x=10; x+=5', 'x', 15);
testVar('compound -=', 'x=10; x-=3', 'x', 7);
testVar('compound *=', 'x=10; x*=2', 'x', 20);

// ── Constants ───────────────────────────────────────────────────────

testVar('PI', 'x=$PI', 'x', Math.PI);
testVar('E', 'x=$E', 'x', Math.E);
testVar('PHI', 'x=$PHI', 'x', 1.6180339887498948);

// ── Math functions ──────────────────────────────────────────────────

testVar('sin', 'x=sin($PI/2)', 'x', 1);
testVar('cos', 'x=cos(0)', 'x', 1);
testVar('tan', 'x=tan(0)', 'x', 0);
testVar('asin', 'x=asin(1)', 'x', Math.PI / 2);
testVar('sqrt', 'x=sqrt(9)', 'x', 3);
testVar('sqr', 'x=sqr(5)', 'x', 25);
testVar('pow', 'x=pow(2,8)', 'x', 256);
testVar('exp', 'x=exp(0)', 'x', 1);
testVar('log', 'x=log($E)', 'x', 1);
testVar('log10', 'x=log10(100)', 'x', 2);
testVar('floor', 'x=floor(3.7)', 'x', 3);
testVar('ceil', 'x=ceil(3.2)', 'x', 4);
testVar('abs', 'x=abs(-7)', 'x', 7);
testVar('min', 'x=min(3,7)', 'x', 3);
testVar('max', 'x=max(3,7)', 'x', 7);
testVar('sign positive', 'x=sign(5)', 'x', 1);
testVar('sign negative', 'x=sign(-5)', 'x', -1);
testVar('sign zero', 'x=sign(0)', 'x', 0);
testVar('invsqrt', 'x=invsqrt(4)', 'x', 0.5);

// ── Logic functions ─────────────────────────────────────────────────

testVar('if true', 'x=if(1, 5, 10)', 'x', 5);
testVar('if false', 'x=if(0, 5, 10)', 'x', 10);
testVar('above true', 'x=above(5, 3)', 'x', 1);
testVar('above false', 'x=above(3, 5)', 'x', 0);
testVar('below true', 'x=below(3, 5)', 'x', 1);
testVar('below false', 'x=below(5, 3)', 'x', 0);
testVar('equal true', 'x=equal(5, 5)', 'x', 1);
testVar('equal false', 'x=equal(5, 6)', 'x', 0);
testVar('band true', 'x=band(1, 1)', 'x', 1);
testVar('band false', 'x=band(1, 0)', 'x', 0);
testVar('bor true', 'x=bor(0, 1)', 'x', 1);
testVar('bor false', 'x=bor(0, 0)', 'x', 0);
testVar('bnot true', 'x=bnot(0)', 'x', 1);
testVar('bnot false', 'x=bnot(1)', 'x', 0);

// ── Bitwise operators ───────────────────────────────────────────────

testVar('bitwise OR', 'x=8|3', 'x', 11);
testVar('bitwise AND', 'x=255&15', 'x', 15);
testVar('bitwise negative', 'x=-5&255', 'x', -5 & 255); // Math.trunc(-5) & Math.trunc(255)

// ── Control flow ────────────────────────────────────────────────────

testVar('loop', 'x=0; loop(5, x=x+1)', 'x', 5);
testVar('exec2', 'x=exec2(5, 10)', 'x', 10);
testVar('multi-statement', 'a=1; b=2; x=a+b', 'x', 3);

// ── Registers ───────────────────────────────────────────────────────

testVar('reg00 write/read', 'reg00=42; x=reg00', 'x', 42);
testVar('reg99', 'reg99=99; x=reg99', 'x', 99);

// ── Audio functions (with silence) ──────────────────────────────────

testVar('getosc silence', 'x=getosc(0.5, 0, 0)', 'x', 0);
testVar('getspec silence', 'x=getspec(0.5, 0, 0)', 'x', 0);
testVar('gettime', 'x=gettime(0)', 'x', 1.0); // time=1.0 in our setup

// ── Complex expressions ─────────────────────────────────────────────

testVar('complex 1', 'x=sin($PI/4)*cos($PI/4)', 'x', Math.sin(Math.PI/4)*Math.cos(Math.PI/4));
testVar('complex 2', 'n=100; x=0; loop(n, x=x+1); y=x/n', 'y', 1);
testVar('ternary-style if', 'x=if(above(5,3), 100, 200)', 'x', 100);

// ── Results ─────────────────────────────────────────────────────────

console.log(`\n=== EEL Tests: ${passed} passed, ${failed} failed ===`);
if (errors.length) {
  for (const e of errors) console.log(`  ${e}`);
}
process.exit(failed > 0 ? 1 : 0);

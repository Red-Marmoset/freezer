// NSEEL Compiler — compiles EEL AST to JavaScript functions
// Ported from original ns-eel compiler concepts.
// Instead of emitting x86 assembly, emits JS function bodies via new Function().

import { parse } from './nseel-parser.js';
import { STDLIB_MATH, STDLIB_INLINE } from './nseel-stdlib.js';

const CLOSEFACT = 0.00001; // ns-eel epsilon for truthiness/equality

// Compile an AST node to a JS expression string
function compileExpr(node) {
  if (!node) return '0';

  switch (node.type) {
    case 'number':
      return String(node.value);

    case 'id':
      return compileIdentifier(node.name);

    case 'unary':
      if (node.op === '-') return `(-(${compileExpr(node.arg)}))`;
      if (node.op === '+') return `(+(${compileExpr(node.arg)}))`;
      if (node.op === '!') return `((${compileExpr(node.arg)}) === 0 ? 1 : 0)`;
      return compileExpr(node.arg);

    case 'binary':
      return compileBinary(node);

    case 'ternary':
      return `((${compileExpr(node.test)}) !== 0 ? (${compileExpr(node.cons)}) : (${compileExpr(node.alt)}))`;

    case 'call':
      return compileCall(node);

    case 'program':
      // Multi-statement: use comma operator, value is last expression
      return `(${node.body.map(compileExpr).join(', ')})`;

    default:
      return '0';
  }
}

// Compile an AST node to a JS statement string
function compileStmt(node) {
  if (!node) return '';

  if (node.type === 'program') {
    return node.body.map(compileStmt).join('\n');
  }

  // Special handling for loop/while calls as top-level statements
  if (node.type === 'call') {
    if (node.name === 'loop' && node.args.length >= 2) {
      return compileLoopStmt(node);
    }
    if (node.name === 'while' && node.args.length >= 1) {
      return compileWhileStmt(node);
    }
  }

  return `${compileExpr(node)};`;
}

// Compile variable/register/constant identifier
function compileIdentifier(name) {
  // Constants
  if (name === '$pi') return 'Math.PI';
  if (name === '$e') return 'Math.E';
  if (name === '$phi') return '1.6180339887498948';

  // Registers: reg00 - reg99
  const regMatch = name.match(/^reg(\d{2})$/);
  if (regMatch) {
    const idx = parseInt(regMatch[1], 10);
    if (idx >= 0 && idx <= 99) return `s._reg[${idx}]`;
  }

  // Regular variable on state object
  return `s.${sanitizeName(name)}`;
}

// Sanitize variable name for use as JS property
function sanitizeName(name) {
  // Replace dots with underscores, ensure valid JS identifier
  return name.replace(/\./g, '_').replace(/[^a-z0-9_$]/gi, '_');
}

// Compile LHS for assignment — returns the JS lvalue string
function compileLHS(node) {
  if (node.type === 'id') {
    return compileIdentifier(node.name);
  }
  // megabuf(idx) = value, gmegabuf(idx) = value
  if (node.type === 'call' && (node.name === 'megabuf' || node.name === 'gmegabuf')) {
    const bufName = node.name === 'megabuf' ? '_megabuf' : '_gmegabuf';
    return `s.${bufName}[Math.floor(${compileExpr(node.args[0])}) & 1048575]`;
  }
  // Fallback: treat as expression (assignment will still work if JS allows it)
  return compileExpr(node);
}

// Compile binary operator
function compileBinary(node) {
  const { op, left, right } = node;

  // Assignment operators
  if (op === '=') {
    const lhs = compileLHS(left);
    return `(${lhs} = ${compileExpr(right)})`;
  }
  if (op === '+=' || op === '-=' || op === '*=' || op === '/=' ||
      op === '%=' || op === '^=' || op === '|=' || op === '&=') {
    const lhs = compileLHS(left);
    if (op === '^=') return `(${lhs} = Math.pow(${lhs}, ${compileExpr(right)}))`;
    if (op === '|=') return `(${lhs} = ((${lhs}) !== 0 || (${compileExpr(right)}) !== 0) ? 1 : 0)`;
    if (op === '&=') return `(${lhs} = ((${lhs}) !== 0 && (${compileExpr(right)}) !== 0) ? 1 : 0)`;
    return `(${lhs} ${op} ${compileExpr(right)})`;
  }

  // Arithmetic
  if (op === '+' || op === '-' || op === '*' || op === '/' || op === '%') {
    return `(${compileExpr(left)} ${op} ${compileExpr(right)})`;
  }

  // Power
  if (op === '^') {
    return `Math.pow(${compileExpr(left)}, ${compileExpr(right)})`;
  }

  // Logical OR (ns-eel: | and ||)
  if (op === '|' || op === '||') {
    return `(((${compileExpr(left)}) !== 0 || (${compileExpr(right)}) !== 0) ? 1 : 0)`;
  }

  // Logical AND (ns-eel: & and &&)
  if (op === '&' || op === '&&') {
    return `(((${compileExpr(left)}) !== 0 && (${compileExpr(right)}) !== 0) ? 1 : 0)`;
  }

  // Comparison operators (return 0 or 1)
  if (op === '==') return `(Math.abs((${compileExpr(left)}) - (${compileExpr(right)})) < ${CLOSEFACT} ? 1 : 0)`;
  if (op === '!=') return `(Math.abs((${compileExpr(left)}) - (${compileExpr(right)})) >= ${CLOSEFACT} ? 1 : 0)`;
  if (op === '<')  return `((${compileExpr(left)}) < (${compileExpr(right)}) ? 1 : 0)`;
  if (op === '>')  return `((${compileExpr(left)}) > (${compileExpr(right)}) ? 1 : 0)`;
  if (op === '<=') return `((${compileExpr(left)}) <= (${compileExpr(right)}) ? 1 : 0)`;
  if (op === '>=') return `((${compileExpr(left)}) >= (${compileExpr(right)}) ? 1 : 0)`;

  return `(${compileExpr(left)} ${op} ${compileExpr(right)})`;
}

// Compile function call
function compileCall(node) {
  const { name, args } = node;

  // Special forms: if, loop, while, select, assign, exec2, exec3
  if (name === 'if' && args.length >= 3) {
    return `((${compileExpr(args[0])}) !== 0 ? (${compileExpr(args[1])}) : (${compileExpr(args[2])}))`;
  }
  if (name === 'if' && args.length === 2) {
    return `((${compileExpr(args[0])}) !== 0 ? (${compileExpr(args[1])}) : 0)`;
  }

  if (name === 'loop' && args.length >= 2) {
    return compileLoopExpr(node);
  }
  if (name === 'while' && args.length >= 1) {
    return compileWhileExpr(node);
  }

  if (name === 'exec2' && args.length >= 2) {
    return `(${compileExpr(args[0])}, ${compileExpr(args[1])})`;
  }
  if (name === 'exec3' && args.length >= 3) {
    return `(${compileExpr(args[0])}, ${compileExpr(args[1])}, ${compileExpr(args[2])})`;
  }

  if (name === 'assign' && args.length >= 2) {
    return `(${compileLHS(args[0])} = ${compileExpr(args[1])})`;
  }

  // select(n, v0, v1, v2, ...) — index into args
  if (name === 'select' && args.length >= 2) {
    const idx = compileExpr(args[0]);
    const vals = args.slice(1).map(compileExpr);
    return `([${vals.join(', ')}][Math.max(0, Math.min(${vals.length - 1}, (${idx}) | 0))] || 0)`;
  }

  // Comparison functions (ns-eel originals)
  if (name === 'above' && args.length >= 2) {
    return `((${compileExpr(args[0])}) > (${compileExpr(args[1])}) ? 1 : 0)`;
  }
  if (name === 'below' && args.length >= 2) {
    return `((${compileExpr(args[0])}) < (${compileExpr(args[1])}) ? 1 : 0)`;
  }
  if (name === 'equal' && args.length >= 2) {
    return `(Math.abs((${compileExpr(args[0])}) - (${compileExpr(args[1])})) < ${CLOSEFACT} ? 1 : 0)`;
  }

  // Logical functions
  if (name === 'band' && args.length >= 2) {
    return `(((${compileExpr(args[0])}) !== 0 && (${compileExpr(args[1])}) !== 0) ? 1 : 0)`;
  }
  if (name === 'bor' && args.length >= 2) {
    return `(((${compileExpr(args[0])}) !== 0 || (${compileExpr(args[1])}) !== 0) ? 1 : 0)`;
  }
  if (name === 'bnot' && args.length >= 1) {
    return `((${compileExpr(args[0])}) === 0 ? 1 : 0)`;
  }

  // Math inlines
  if (name === 'sqr' && args.length >= 1) {
    const a = compileExpr(args[0]);
    return `((${a}) * (${a}))`;
  }
  if (name === 'invsqrt' && args.length >= 1) {
    return `(1 / Math.sqrt(${compileExpr(args[0])}))`;
  }
  if (name === 'sigmoid' || name === 'sig') {
    const a = compileExpr(args[0]);
    const b = args.length >= 2 ? compileExpr(args[1]) : '1';
    return `(1 / (1 + Math.exp(-(${a}) * (${b}))))`;
  }
  if (name === 'sign' && args.length >= 1) {
    return `Math.sign(${compileExpr(args[0])})`;
  }
  if (name === 'rand' && args.length >= 1) {
    return `(Math.random() * (${compileExpr(args[0])}) | 0)`;
  }

  // megabuf / gmegabuf — read access
  if (name === 'megabuf' && args.length >= 1) {
    return `(s._megabuf[Math.floor(${compileExpr(args[0])}) & 1048575] || 0)`;
  }
  if (name === 'gmegabuf' && args.length >= 1) {
    return `(s._gmegabuf[Math.floor(${compileExpr(args[0])}) & 1048575] || 0)`;
  }

  // Direct Math.* mappings
  if (STDLIB_MATH[name]) {
    const fn = STDLIB_MATH[name];
    const compiledArgs = args.map(compileExpr).join(', ');
    return `${fn}(${compiledArgs})`;
  }

  // Audio functions — delegated to lib
  if (name === 'getosc' || name === 'getspec' || name === 'gettime') {
    const compiledArgs = args.map(compileExpr).join(', ');
    return `lib.${name}(${compiledArgs})`;
  }

  // Unknown function — delegate to lib, fall back to 0
  const compiledArgs = args.map(compileExpr).join(', ');
  return `(lib.${name} ? lib.${name}(${compiledArgs}) : 0)`;
}

// Compile loop as expression (returns value of last iteration)
function compileLoopExpr(node) {
  const n = compileExpr(node.args[0]);
  const body = compileExpr(node.args[1]);
  return `(()=>{let _v=0;const _n=(${n})|0;for(let _i=0;_i<_n&&_i<1048576;_i++){_v=(${body});}return _v;})()`;
}

// Compile while as expression
function compileWhileExpr(node) {
  const body = compileExpr(node.args[0]);
  return `(()=>{let _c=0;while((${body})!==0&&++_c<1048576){}return 0;})()`;
}

// Compile loop as statement
function compileLoopStmt(node) {
  const n = compileExpr(node.args[0]);
  const body = compileStmt(node.args[1]);
  return `{const _n=(${n})|0;for(let _i=0;_i<_n&&_i<1048576;_i++){${body}}}`;
}

// Compile while as statement
function compileWhileStmt(node) {
  const body = compileExpr(node.args[0]);
  return `{let _c=0;while((${body})!==0&&++_c<1048576){}}`;
}

// ---- Public API ----

/**
 * Compile EEL source code to a callable JS function.
 * @param {string} code — EEL source code
 * @returns {Function} — function(s, lib) where s is state object, lib is stdlib
 */
export function compileEEL(code) {
  if (!code || !code.trim()) return function() {};
  try {
    const ast = parse(code);
    const jsBody = compileStmt(ast);
    return new Function('s', 'lib', jsBody);
  } catch (e) {
    console.warn('EEL compile error:', e.message, 'in:', code);
    return function() {};
  }
}

/**
 * Create an EEL execution state object with all default variables.
 * @param {Float64Array} globalRegisters — shared reg00-reg99
 * @returns {object} — state object for compiled functions
 */
export function createState(globalRegisters, globalMegabuf) {
  const state = {
    _reg: globalRegisters || new Float64Array(100),
    _megabuf: {},
    _gmegabuf: globalMegabuf || {},
    // Common variables initialized to 0 by default via Proxy
  };
  // Use Proxy to auto-initialize undefined variables to 0
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop[0] !== '_') {
        target[prop] = 0;
        return 0;
      }
      return undefined;
    }
  });
}

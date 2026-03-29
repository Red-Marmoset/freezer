// NSEEL Expression Parser — ported from original ns-eel C source
// Tokenizer + Recursive Descent Parser for EEL (Expression Evaluation Language)
// Produces AST from EEL source code.

// ---- Tokenizer ----

const T = {
  NUM: 'NUM',     // numeric literal
  ID: 'ID',       // identifier (variable, function, constant, register)
  OP: 'OP',       // operator
  LPAREN: '(',
  RPAREN: ')',
  COMMA: ',',
  SEMI: ';',
  EOF: 'EOF'
};

// Multi-char operators (checked before single-char)
const MULTI_OPS = ['==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '^=', '|=', '&=', '&&', '||'];

function tokenize(code) {
  const tokens = [];
  let pos = 0;

  while (pos < code.length) {
    const ch = code[pos];

    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      pos++;
      continue;
    }

    // Skip // line comments
    if (ch === '/' && code[pos + 1] === '/') {
      pos += 2;
      while (pos < code.length && code[pos] !== '\n') pos++;
      continue;
    }

    // Skip /* block comments */
    if (ch === '/' && code[pos + 1] === '*') {
      pos += 2;
      while (pos < code.length && !(code[pos] === '*' && code[pos + 1] === '/')) pos++;
      pos += 2;
      continue;
    }

    // Numbers: decimal, float, hex (0xNN or NNh)
    if (ch >= '0' && ch <= '9' || (ch === '.' && code[pos + 1] >= '0' && code[pos + 1] <= '9')) {
      let start = pos;

      // Hex with 0x prefix
      if (ch === '0' && (code[pos + 1] === 'x' || code[pos + 1] === 'X')) {
        pos += 2;
        while (pos < code.length && /[0-9a-fA-F]/.test(code[pos])) pos++;
        tokens.push({ type: T.NUM, value: parseInt(code.slice(start, pos), 16) });
        continue;
      }

      // Decimal / float
      while (pos < code.length && code[pos] >= '0' && code[pos] <= '9') pos++;
      if (pos < code.length && code[pos] === '.') {
        pos++;
        while (pos < code.length && code[pos] >= '0' && code[pos] <= '9') pos++;
      }
      // Scientific notation
      if (pos < code.length && (code[pos] === 'e' || code[pos] === 'E')) {
        pos++;
        if (pos < code.length && (code[pos] === '+' || code[pos] === '-')) pos++;
        while (pos < code.length && code[pos] >= '0' && code[pos] <= '9') pos++;
      }

      // Check for hex suffix 'h' (e.g., 0FFh) — reparse as hex if present
      if (pos < code.length && (code[pos] === 'h' || code[pos] === 'H')) {
        const hexStr = code.slice(start, pos);
        pos++; // skip 'h'
        tokens.push({ type: T.NUM, value: parseInt(hexStr, 16) });
      } else {
        tokens.push({ type: T.NUM, value: parseFloat(code.slice(start, pos)) });
      }
      continue;
    }

    // Identifiers (and $constants, regNN)
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$') {
      let start = pos;
      pos++;
      while (pos < code.length && /[a-zA-Z0-9_.]/.test(code[pos])) pos++;
      const name = code.slice(start, pos).toLowerCase();
      // Check for $XX hex literals (e.g. $FF, $00, $1A)
      if (name[0] === '$' && name.length > 1 && /^\$[0-9a-f]+$/.test(name)) {
        tokens.push({ type: T.NUM, value: parseInt(name.slice(1), 16) });
      } else {
        tokens.push({ type: T.ID, value: name });
      }
      continue;
    }

    // Semicolons
    if (ch === ';') {
      tokens.push({ type: T.SEMI });
      pos++;
      continue;
    }

    // Commas
    if (ch === ',') {
      tokens.push({ type: T.COMMA });
      pos++;
      continue;
    }

    // Parentheses
    if (ch === '(') {
      tokens.push({ type: T.LPAREN });
      pos++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: T.RPAREN });
      pos++;
      continue;
    }

    // Multi-char operators
    let matched = false;
    for (const op of MULTI_OPS) {
      if (code.slice(pos, pos + op.length) === op) {
        tokens.push({ type: T.OP, value: op });
        pos += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Single-char operators
    if ('+-*/%^&|=<>!?:~'.includes(ch)) {
      tokens.push({ type: T.OP, value: ch });
      pos++;
      continue;
    }

    // Unknown character — skip
    pos++;
  }

  tokens.push({ type: T.EOF });
  return tokens;
}

// ---- Parser ----
// Recursive descent, producing AST nodes.
// Grammar (precedence low to high):
//   program       = exprList
//   exprList      = assignment (';' assignment)*
//   assignment    = ternary (assignOp assignment)?        [right-assoc]
//   ternary       = logicOr ('?' exprList ':' ternary)?   [right-assoc]
//   logicOr       = logicAnd (('|'|'||') logicAnd)*
//   logicAnd      = comparison (('&'|'&&') comparison)*
//   comparison    = addition (compOp addition)*
//   addition      = multiplication (('+' | '-') multiplication)*
//   multiplication = power (('*' | '/' | '%') power)*
//   power         = unary ('^' power)?                    [right-assoc]
//   unary         = ('+' | '-' | '!') unary | primary
//   primary       = NUMBER | funcCall | IDENTIFIER | '(' exprList ')'
//   funcCall      = IDENTIFIER '(' (exprList (',' exprList)*)? ')'

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }

  is(type, value) {
    const t = this.peek();
    if (t.type !== type) return false;
    if (value !== undefined && t.value !== value) return false;
    return true;
  }

  eat(type, value) {
    if (this.is(type, value)) return this.advance();
    return null;
  }

  // program = exprList
  parseProgram() {
    const body = this.parseExprList();
    return body;
  }

  // exprList = assignment (';' assignment)*
  parseExprList() {
    const stmts = [this.parseAssignment()];
    while (this.eat(T.SEMI)) {
      // Skip trailing/empty semicolons
      if (this.is(T.EOF) || this.is(T.RPAREN) || this.is(T.COMMA)) break;
      stmts.push(this.parseAssignment());
    }
    if (stmts.length === 1) return stmts[0];
    return { type: 'program', body: stmts };
  }

  // assignment = ternary (assignOp assignment)?
  parseAssignment() {
    const left = this.parseTernary();
    const t = this.peek();
    if (t.type === T.OP && (t.value === '=' || t.value === '+=' || t.value === '-=' ||
        t.value === '*=' || t.value === '/=' || t.value === '%=' || t.value === '^=' ||
        t.value === '|=' || t.value === '&=')) {
      const op = this.advance().value;
      const right = this.parseAssignment();
      return { type: 'binary', op, left, right };
    }
    return left;
  }

  // ternary = logicOr ('?' exprList ':' ternary)?
  parseTernary() {
    const test = this.parseLogicOr();
    if (this.eat(T.OP, '?')) {
      const cons = this.parseExprList();
      // ':' might be parsed as OP
      if (!this.eat(T.OP, ':')) {
        // Missing colon — treat as if false branch is 0
        return { type: 'ternary', test, cons, alt: { type: 'number', value: 0 } };
      }
      const alt = this.parseTernary();
      return { type: 'ternary', test, cons, alt };
    }
    return test;
  }

  // logicOr = logicAnd (('|'|'||') logicAnd)*
  parseLogicOr() {
    let left = this.parseLogicAnd();
    while (this.is(T.OP, '|') || this.is(T.OP, '||')) {
      const op = this.advance().value;
      const right = this.parseLogicAnd();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // logicAnd = comparison (('&'|'&&') comparison)*
  parseLogicAnd() {
    let left = this.parseComparison();
    while (this.is(T.OP, '&') || this.is(T.OP, '&&')) {
      const op = this.advance().value;
      const right = this.parseComparison();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // comparison = addition (compOp addition)*
  parseComparison() {
    let left = this.parseAddition();
    while (this.is(T.OP, '==') || this.is(T.OP, '!=') ||
           this.is(T.OP, '<') || this.is(T.OP, '>') ||
           this.is(T.OP, '<=') || this.is(T.OP, '>=')) {
      const op = this.advance().value;
      const right = this.parseAddition();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // addition = multiplication (('+' | '-') multiplication)*
  parseAddition() {
    let left = this.parseMultiplication();
    while (this.is(T.OP, '+') || this.is(T.OP, '-')) {
      const op = this.advance().value;
      const right = this.parseMultiplication();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // multiplication = power (('*' | '/' | '%') power)*
  parseMultiplication() {
    let left = this.parsePower();
    while (this.is(T.OP, '*') || this.is(T.OP, '/') || this.is(T.OP, '%')) {
      const op = this.advance().value;
      const right = this.parsePower();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  // power = unary ('^' power)?  [right-assoc]
  parsePower() {
    const left = this.parseUnary();
    if (this.eat(T.OP, '^')) {
      const right = this.parsePower();
      return { type: 'binary', op: '^', left, right };
    }
    return left;
  }

  // unary = ('+' | '-' | '!') unary | primary
  parseUnary() {
    if (this.is(T.OP, '-') || this.is(T.OP, '+') || this.is(T.OP, '!')) {
      const op = this.advance().value;
      const arg = this.parseUnary();
      // Optimize: fold unary minus/plus on number literals
      if (op === '-' && arg.type === 'number') return { type: 'number', value: -arg.value };
      if (op === '+' && arg.type === 'number') return arg;
      return { type: 'unary', op, arg };
    }
    return this.parsePrimary();
  }

  // primary = NUMBER | funcCall | IDENTIFIER | '(' exprList ')'
  parsePrimary() {
    // Number literal
    if (this.is(T.NUM)) {
      return { type: 'number', value: this.advance().value };
    }

    // Identifier or function call
    if (this.is(T.ID)) {
      const name = this.advance().value;
      // Function call: identifier followed by '('
      if (this.eat(T.LPAREN)) {
        const args = [];
        if (!this.is(T.RPAREN)) {
          args.push(this.parseExprList());
          while (this.eat(T.COMMA)) {
            args.push(this.parseExprList());
          }
        }
        this.eat(T.RPAREN); // consume ')', tolerate missing
        return { type: 'call', name, args };
      }
      return { type: 'id', name };
    }

    // Parenthesized expression
    if (this.eat(T.LPAREN)) {
      const expr = this.parseExprList();
      this.eat(T.RPAREN);
      return expr;
    }

    // Unexpected token — return 0
    this.advance();
    return { type: 'number', value: 0 };
  }
}

// ---- Preprocessor ----
// Strips comments and normalizes the code. Constants ($PI etc.)
// are handled as identifiers by the parser and resolved by the compiler.

function preprocess(code) {
  if (!code || typeof code !== 'string') return '';
  // Normalize line endings
  let s = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Process #define macros (EelTrans feature)
  const defines = new Map();
  const funcDefines = new Map();
  const lines = s.split('\n');
  const output = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip EelTrans directive comments
    if (trimmed.startsWith('//$$')) continue;

    // #define NAME(args) body — function-like macro
    const funcMatch = trimmed.match(/^#define\s+(\w+)\(([^)]*)\)\s+(.+)$/i);
    if (funcMatch) {
      const name = funcMatch[1].toLowerCase();
      const params = funcMatch[2].split(',').map(p => p.trim());
      funcDefines.set(name, { params, body: funcMatch[3] });
      continue;
    }

    // #define NAME value — simple macro
    const simpleMatch = trimmed.match(/^#define\s+(\w+)\s+(.+)$/i);
    if (simpleMatch) {
      defines.set(simpleMatch[1].toLowerCase(), simpleMatch[2]);
      continue;
    }

    // Skip #include (not supported in browser)
    if (trimmed.startsWith('#include')) continue;

    output.push(line);
  }

  s = output.join('\n');

  // Apply function-like macros (before simple defines)
  for (const [name, def] of funcDefines) {
    const regex = new RegExp(name + '\\s*\\(', 'gi');
    let match;
    while ((match = regex.exec(s)) !== null) {
      // Find matching closing paren
      let depth = 1, pos = match.index + match[0].length;
      const argStart = pos;
      const args = [];
      let argBegin = pos;
      while (pos < s.length && depth > 0) {
        if (s[pos] === '(') depth++;
        else if (s[pos] === ')') { depth--; if (depth === 0) { args.push(s.slice(argBegin, pos)); break; } }
        else if (s[pos] === ',' && depth === 1) { args.push(s.slice(argBegin, pos)); argBegin = pos + 1; }
        pos++;
      }
      // Substitute parameters in body
      let expanded = def.body;
      for (let i = 0; i < def.params.length; i++) {
        const paramRegex = new RegExp('\\b' + def.params[i] + '\\b', 'g');
        expanded = expanded.replace(paramRegex, (args[i] || '0').trim());
      }
      s = s.slice(0, match.index) + expanded + s.slice(pos + 1);
      regex.lastIndex = match.index + expanded.length;
    }
  }

  // Apply simple defines (case-insensitive word replacement)
  for (const [name, value] of defines) {
    const regex = new RegExp('\\b' + name + '\\b', 'gi');
    s = s.replace(regex, value);
  }

  return s;
}

// ---- Public API ----

export function parse(code) {
  const preprocessed = preprocess(code);
  if (!preprocessed.trim()) return { type: 'program', body: [] };
  const tokens = tokenize(preprocessed);
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  // If the parser didn't consume all tokens, the code has unparseable fragments.
  // Throw so the compiler's fallback (statement-by-statement) kicks in.
  if (!parser.is(T.EOF)) {
    throw new Error('Unexpected token: ' + parser.peek().value);
  }
  return ast;
}

export { tokenize, Parser };

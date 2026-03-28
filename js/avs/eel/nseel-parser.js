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
      tokens.push({ type: T.ID, value: name });
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
  return code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// ---- Public API ----

export function parse(code) {
  const preprocessed = preprocess(code);
  if (!preprocessed.trim()) return { type: 'program', body: [] };
  const tokens = tokenize(preprocessed);
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

export { tokenize, Parser };

/**
 * help.js — Expression language reference dialog
 *
 * Ported from the original Nullsoft AVS expression help dialog (vis_avs/util.cpp).
 * Adapted for Freezer's implementation with additional context.
 */

const HELP_TABS = {
  general: `Expression Language Overview
═══════════════════════════

AVS expressions allow you to write code that controls visual effects.
Variables are created simply by using them — all variables are
floating-point numbers.

To create a variable, simply assign to it:
  x = 5;

You can combine operators and functions into expressions:
  x = 5 * cos(y) / 32.0;

Use semicolons to separate multiple expressions:
  x = x * 17.0; x = x / 5; y = pow(x,3.0);

Code can include C and C++ style comments:
  // double-slash comments to end of line
  /* classic C comments
     spanning multiple lines */

Extra whitespace (spaces, newlines) is ignored, so you can
space things out for clarity.

Code Sections
─────────────
Most components have multiple code sections:

  init      Runs once when the preset loads
  perFrame  Runs once per frame (set global animation state)
  onBeat    Runs when a beat is detected
  perPoint  Runs for each point/vertex (set position, color)

Variables set in one section persist to the next. Variables
set in init persist across frames.`,

  operators: `Operators
═════════

=
  Assigns a value to a variable.
  example:  var = 5;

+
  Adds two values, returns the sum.
  example:  var = 5 + var2;

-
  Subtracts two values, returns the difference.
  example:  var = 5 - var2;

*
  Multiplies two values, returns the product.
  example:  var = 5 * var2;

/
  Divides two values, returns the quotient.
  example:  var = 5 / var2;

%
  Converts two values to integer, performs division,
  returns the remainder.
  example:  var = var2 % 5;

|
  Converts two values to integer, returns bitwise OR.
  example:  var = var2 | 31;

&
  Converts two values to integer, returns bitwise AND.
  example:  var = var2 & 31;

Compound assignment operators are also available:
  +=  -=  *=  /=  %=  |=  &=`,

  functions: `Functions
═════════

Math Functions
──────────────
abs(value)
  Returns the absolute value of 'value'.

sin(value)
  Returns the sine of the radian angle 'value'.

cos(value)
  Returns the cosine of the radian angle 'value'.

tan(value)
  Returns the tangent of the radian angle 'value'.

asin(value)
  Returns the arcsine (in radians) of 'value'.

acos(value)
  Returns the arccosine (in radians) of 'value'.

atan(value)
  Returns the arctangent (in radians) of 'value'.

atan2(value, value2)
  Returns the arctangent (in radians) of value/value2.

sqr(value)
  Returns the square of 'value' (value * value).

sqrt(value)
  Returns the square root of 'value'.

invsqrt(value)
  Returns 1/sqrt(value) (fast reciprocal square root).

pow(value, value2)
  Returns 'value' to the power of 'value2'.

exp(value)
  Returns e to the power of 'value'.

log(value)
  Returns the natural logarithm (base e) of 'value'.

log10(value)
  Returns the base-10 logarithm of 'value'.

floor(value)
  Returns the largest integer ≤ 'value'.

ceil(value)
  Returns the smallest integer ≥ 'value'.

sign(value)
  Returns -1.0, 0.0, or 1.0 based on sign of 'value'.

min(value, value2)
  Returns the smaller of the two values.

max(value, value2)
  Returns the larger of the two values.

sigmoid(value, constraint)
  Returns the sigmoid function: 1/(1+exp(-value*constraint)).

rand(value)
  Returns a random integer between 0 and 'value'.

Logic Functions
───────────────
band(value, value2)
  Returns boolean AND of 'value' and 'value2'.

bor(value, value2)
  Returns boolean OR of 'value' and 'value2'.

bnot(value)
  Returns boolean NOT of 'value'.

if(condition, val_true, val_false)
  Returns val_true if condition is nonzero,
  val_false otherwise.

equal(value, value2)
  Returns 1.0 if value == value2, else 0.0.

above(value, value2)
  Returns 1.0 if value > value2, else 0.0.

below(value, value2)
  Returns 1.0 if value < value2, else 0.0.

Control Functions
─────────────────
assign(dest, source)
  Assigns source to dest. Returns source.
  Trick: assign(if(v,a,b), 1.0) sets a or b to 1.

exec2(expr1, expr2)
  Evaluates expr1 then expr2, returns expr2's value.

loop(count, statement)
  Executes statement count times (max 4096).

Audio Functions
───────────────
getosc(band, width, channel)
  Returns waveform data centered at 'band' (0..1),
  sampled 'width' (0..1) wide.
  channel: 0=center, 1=left, 2=right
  Returns: -1..1

getspec(band, width, channel)
  Returns spectrum data centered at 'band' (0..1),
  sampled 'width' (0..1) wide.
  channel: 0=center, 1=left, 2=right
  Returns: 0..1

gettime(start_time)
  Returns seconds since start_time.
  start_time=0: time since boot
  start_time=-1: current playback position (sec)
  start_time=-2: current playback length (sec)

Memory Functions
────────────────
megabuf(index)
  Get/set from the component-local buffer.
  Get: val = megabuf(index);
  Set: megabuf(index) = val;

gmegabuf(index)
  Get/set from the global shared buffer.
  Get: val = gmegabuf(index);
  Set: gmegabuf(index) = val;`,

  constants: `Constants
═════════

$PI
  3.14159265358979...
  The ratio of a circle's circumference to its diameter.

$E
  2.71828182845904...
  Euler's number, the base of natural logarithms.

$PHI
  1.61803398874989...
  The golden ratio.

Numbers
───────
Numbers can be specified as integers or floating point:
  5
  5.0
  5.00001
  0.5
  .5

All values are 64-bit floating point internally.`,

  variables: `Context Variables
═════════════════

SuperScope
──────────
  n         Number of points (set in init or perFrame)
  i         Current point index (0 to 1, normalized)
  v         Audio sample value at this point
  x, y      Output position (-1..1)
  red       Red color component (0..1)
  green     Green color component (0..1)
  blue      Blue color component (0..1)
  skip      Set nonzero to skip this point
  linesize  Line width
  drawmode  0=lines, 1=dots

DynamicMovement
───────────────
  x, y      Position (set to displaced UV, -1..1)
  d         Distance from center (polar mode)
  r         Angle from center (polar mode)
  alpha     Per-vertex alpha (0..1)
  w, h      Canvas width/height
  b         Beat flag (1 if beat, 0 otherwise)

MilkDropMotion
──────────────
  zoom      Zoom amount (1.0 = no zoom)
  rot       Rotation in radians
  dx, dy    Translation offset
  sx, sy    Scale X/Y
  warp      Warp amount
  cx, cy    Center point (0..1)
  decay     Frame persistence (0..1, 0.98 typical)
  bass      Bass level (~0.7 quiet, ~1.3 loud)
  mid       Mid level
  treb      Treble level
  time      Seconds since preset loaded
  fps       Current framerate
  b         Beat flag

Global Registers
────────────────
  reg00..reg99
    Shared across all components in a preset.
    Use these to pass data between components.

Hotkeys
───────
  Space     Random preset
  R         Toggle random switching
  Y / U     Cycle through presets
  Enter     Toggle fullscreen
  F         Toggle framerate counter
  Escape    Close open dialog`,
};

export function initHelp() {
  const dialog = document.getElementById('help-dialog');
  const backdrop = dialog.querySelector('.preset-lib-backdrop');
  const closeBtn = document.getElementById('btn-help-close');
  const content = document.getElementById('help-content');
  const tabs = dialog.querySelectorAll('[data-help-tab]');
  const helpBtn = document.getElementById('btn-help');

  function show(tab) {
    content.textContent = HELP_TABS[tab] || '';
    tabs.forEach(t => t.classList.toggle('active', t.dataset.helpTab === tab));
  }

  function open() {
    dialog.classList.remove('hidden');
    show('general');
  }

  function close() {
    dialog.classList.add('hidden');
  }

  helpBtn.addEventListener('click', () => {
    if (dialog.classList.contains('hidden')) open(); else close();
  });
  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.helpTab)));
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}

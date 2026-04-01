// AVS Component base class and factory registry

const registry = {};

export class AvsComponent {
  constructor(opts) {
    this.opts = opts;
    this.enabled = opts.enabled !== false;
  }

  init(ctx) {}
  render(ctx, fb) {}
  destroy() {}

  static register(type, cls) {
    registry[type.toLowerCase()] = cls;
    // Store original casing for display
    if (!cls._registeredName) cls._registeredName = type;
  }

  /** Return all registered type names (original casing). */
  static getRegisteredTypes() {
    const seen = new Set();
    const types = [];
    for (const cls of Object.values(registry)) {
      const name = cls._registeredName;
      if (name && !seen.has(name)) {
        seen.add(name);
        types.push(name);
      }
    }
    return types.sort();
  }

  static fromJSON(json) {
    if (!json || !json.type) return null;
    const cls = registry[json.type.toLowerCase()];
    if (!cls) {
      if (!json._unsupported) {
        console.warn('No component class registered for type:', json.type,
          '(registered:', Object.keys(registry).join(', '), ')');
      }
      return null;
    }
    return new cls(json);
  }

  static createComponents(jsonArray) {
    if (!Array.isArray(jsonArray)) return [];
    return jsonArray
      .map(json => AvsComponent.fromJSON(json))
      .filter(c => c !== null);
  }
}

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

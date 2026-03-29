// AVS EelTrans APE (Misc: AVSTrans Automation)
// EelTrans is a text preprocessor for EEL code — adds #define macros,
// semicolon support, and assignment translation. In our implementation,
// these features are built into the EEL parser's preprocess() function,
// so this component is a no-op at runtime. Its code field contains
// #define macros that are applied during EEL compilation.
import { AvsComponent } from '../avs-component.js';

export class EelTrans extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.code = opts.code || '';
  }
  init() {}
  render() {}
  destroy() {}
}

AvsComponent.register('EelTrans', EelTrans);

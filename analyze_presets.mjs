// Basic analysis of the 50 sample presets without needing full parser
// We'll extract what we can from binary inspection

import fs from 'fs';
import path from 'path';

const presets = [
  "/c/code/freezer-second-workspace/assets/presets/compilations/les-noobiens/08-punktchen-anton.avs",
  "/c/code/freezer-second-workspace/assets/presets/compilations/wfc-3/original-..-skybeam-disco-wfc3.avs",
  "/c/code/freezer-second-workspace/assets/presets/zamuz/zamuz-remix-collection/37-danaughty1-dr-greenthumb.avs",
  "/c/code/freezer-second-workspace/assets/presets/track13/track13-main/15-the-light.avs",
  "/c/code/freezer-second-workspace/assets/presets/uudet/uudet-2022/zacman-pink.avs",
  "/c/code/freezer-second-workspace/assets/presets/qoal/qoal-main/00-intro.avs",
  "/c/code/freezer-second-workspace/assets/presets/doggy/doggy-pack-2/black-hole-2-modd-pesci-mix-2a.avs",
  "/c/code/freezer-second-workspace/assets/presets/tuggummi/tuggummi-18-strobotonic-iii/tuggummi-the-weirdest.avs",
  "/c/code/freezer-second-workspace/assets/presets/pak-9/pak-9-avs-4-se/remixes-unconed-the-looking-glass-plastic-hippie-tweak.avs",
  "/c/code/freezer-second-workspace/assets/presets/compilations/irtopressut-main/dd-incarnation1.avs",
];

const componentMap = {
  '0x00': 'Simple', '0x01': 'DotPlane', '0x02': 'OscStar', '0x03': 'FadeOut',
  '0x04': 'BlitterFeedback', '0x05': 'OnBeatClear', '0x06': 'Blur', '0x07': 'BassSpin',
  '0x24': 'SuperScope', '0x0F': 'Movement', '0x2B': 'DynamicMovement', '0x19': 'ClearScreen',
};

// File size analysis  
console.log('\n=== PRESET FILE SIZE ANALYSIS ===');
for (const p of presets.slice(0, 5)) {
  try {
    const stat = fs.statSync(p);
    console.log(`${path.basename(p)}: ${stat.size} bytes`);
  } catch (e) {
    console.log(`Failed: ${p}`);
  }
}


# Icon

An amber B lit on a grid of LED dots, in the colours of the Play feature
graphic. It replaced Tauri's default logo, which the app had shipped with
until November 2026.

| File | Use |
|---|---|
| `blinkenbadge-icon.svg` | Vector source of the app icon |
| `blinkenbadge-icon-1024.png` | Input to `npx tauri icon`, which makes every platform's icons |
| `blinkenbadge-icon-512.png` | Store listings |
| `blinkenbadge-adaptive-foreground-1024.png` | Android's adaptive foreground: the B smaller in a 15 by 15 grid, because launchers crop the layer to about the middle two-thirds |
| `make-icon.py` | Draws them all |

To change the icon:

1. `python3 make-icon.py` and `python3 make-icon.py --adaptive` here.
2. `npx tauri icon ../docs/brand/blinkenbadge-icon-1024.png` from `BlinkenBadge/`.
3. Tauri writes the plain icon into the Android `ic_launcher_foreground.png`
   files, where the B is cropped. Replace them with the adaptive foreground
   at 108, 162, 216, 324 and 432 pixels (mdpi to xxxhdpi), and keep
   `values/ic_launcher_background.xml` at `#080E17`, not Tauri's white.
4. Copy `src-tauri/icons/32x32.png` to `public/favicon.png`.

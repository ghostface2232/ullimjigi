# Fonts

All interface text is set in these three families (see the type roles at the top of
`src/styles.css`). No font is loaded from the network.

| Family (CSS name) | Files | Role | Source | Licence |
|---|---|---|---|---|
| Heir of Light (`HeirOfLight`) | `HeirofLightOTFRegular.woff2`, `HeirofLightOTFBold.woff2` | Display: titles, names, numerals | 빛의 계승자체 (Com2uS / Gamevil), listed at https://www.sandollcloud.com/free-font/274/Sandoll-HeirofLight | SIL Open Font License 1.1 (as listed there) |
| DNF Forged Blade (`ForgedBlade`) | `DNFForgedBlade-Light.woff2`, `-Medium.woff2`, `-Bold.woff2` | UI: labels, buttons, key hints | 던파 연단된 칼날 (Nexon / Neople), listed at https://www.sandollcloud.com/free-font/19490/DNF-Forged-Blade | Nexon free font licence: free for personal and commercial use, embedding allowed; the font files may not be sold or redistributed in modified form. Not an OFL font. |
| Hahmlet (`Hahmlet`) | `Hahmlet-Regular.woff2`, `-Medium.woff2`, `-SemiBold.woff2` | Text: dialogue, descriptions | https://github.com/hyper-type/hahmlet | SIL Open Font License 1.1 (stated in the font's name table) |

Notes
- Heir of Light and Hahmlet cover the common 2,350-odd Hangul syllables, not all 11,172; the
  stacks in `src/styles.css` fall back to Forged Blade (full coverage) for the rest.
- The two licences taken from a third-party listing (Heir of Light, Forged Blade) should be
  checked against the rights holders' own pages before a commercial release.

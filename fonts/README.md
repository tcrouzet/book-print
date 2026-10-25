# Bookbinder font package

An optional library imported from polices-complet.zip: 22 families and 84 font files, organised by the archive’s body-text, heading and symbol categories. These categories are suggestions, not restrictions. In particular, several faces under titres also work for continuous text.

The plugin can install the package into its shared data/_fonts library. Fonts are not bundled into main.js, assigned to projects or embedded into books automatically. Body text stays on Auto by default. Each family below has a usage note, a file/version table, a licence and source links.

## Body text / corps

- [Fira Sans](corps/FiraSans/README.md)
- [IBM Plex Sans](corps/IBMPlexSans/README.md)
- [Literata](corps/Literata/README.md)
- [Lora](corps/Lora/README.md)
- [Noto Sans](corps/NotoSans/README.md)
- [Noto Serif](corps/NotoSerif/README.md)
- [Open Sans](corps/OpenSans/README.md)
- [PT Sans](corps/PTSans/README.md)
- [PT Serif](corps/PTSerif/README.md)
- [Source Sans 3](corps/SourceSans3/README.md)
- [Source Serif 4](corps/SourceSerif4/README.md)
- [Vollkorn](corps/Vollkorn/README.md)

## Headings / titres

- [Alegreya](titres/Alegreya/README.md)
- [Alegreya SC](titres/AlegreyaSC/README.md)
- [Cardo](titres/Cardo/README.md)
- [Cormorant Garamond](titres/CormorantGaramond/README.md)
- [Crimson Pro](titres/CrimsonPro/README.md)
- [EB Garamond](titres/EBGaramond/README.md)
- [Gentium Book Plus](titres/GentiumBookPlus/README.md)
- [Playfair Display](titres/PlayfairDisplay/README.md)
- [Spectral](titres/Spectral/README.md)

## Symbols / symboles

- [Noto Sans Symbols 2](symboles/NotoSansSymbols2/README.md)

## Licences and provenance

Each family includes its original OFL licence notice retrieved from Google Fonts. Copyright strings and versions in the family notes are read from the supplied font files. Open Sans 3.003 identifies OFL in its own metadata; the archive’s Apache classification is not used. The source archive SHA-256 is 33baa7b92c884943cff7b657c0289d6df5745d7cac8498343833e5070780b3f8. Font bytes are unchanged; no outline conversion, renaming or subsetting is performed. All supplied binaries use TrueType-flavoured OpenType data despite the .otf suffix.

## Download package

bookbinder-fonts-v1.json.gz is the optional download used by the plugin. It contains the font binaries and these notes/licences. A versioned filename keeps the download separate from plugin builds. Rebuild it after changing this catalogue or its files with node scripts/build-font-package.mjs. Publish the fonts folder and package in the GitHub repository to enable remote installation; the normal plugin release assets remain unchanged.

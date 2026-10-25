# Bookbinder font package

An optional library imported from polices-complet.zip: 22 families and 84 font files in one flat folder. The alphabetical list identifies each family as Serif, Sans serif or Symbol. Each family has a usage note, file/version table, full licence and source links.

The plugin installs fonts into its shared data/_fonts library. A style declaration automatically includes its font in the book. Body text stays on Auto by default. Users can also import their own fonts and choose their type. Font binaries are not bundled into main.js.

## Families

- [Alegreya](Alegreya.md) (Serif)
- [Alegreya SC](AlegreyaSC.md) (Serif)
- [Cardo](Cardo.md) (Serif)
- [Cormorant Garamond](CormorantGaramond.md) (Serif)
- [Crimson Pro](CrimsonPro.md) (Serif)
- [EB Garamond](EBGaramond.md) (Serif)
- [Fira Sans](FiraSans.md) (Sans serif)
- [Gentium Book Plus](GentiumBookPlus.md) (Serif)
- [IBM Plex Sans](IBMPlexSans.md) (Sans serif)
- [Literata](Literata.md) (Serif)
- [Lora](Lora.md) (Serif)
- [Noto Sans](NotoSans.md) (Sans serif)
- [Noto Sans Symbols 2](NotoSansSymbols2.md) (Symbol)
- [Noto Serif](NotoSerif.md) (Serif)
- [Open Sans](OpenSans.md) (Sans serif)
- [Playfair Display](PlayfairDisplay.md) (Serif)
- [PT Sans](PTSans.md) (Sans serif)
- [PT Serif](PTSerif.md) (Serif)
- [Source Sans 3](SourceSans3.md) (Sans serif)
- [Source Serif 4](SourceSerif4.md) (Serif)
- [Spectral](Spectral.md) (Serif)
- [Vollkorn](Vollkorn.md) (Serif)

## Licences and provenance

Each family includes its original OFL licence notice retrieved from Google Fonts. Copyright strings and versions in the family notes are read from the supplied font files. Open Sans 3.003 identifies OFL in its own metadata; the archive’s Apache classification is not used. The source archive SHA-256 is 33baa7b92c884943cff7b657c0289d6df5745d7cac8498343833e5070780b3f8. Font bytes are unchanged; no outline conversion, renaming or subsetting is performed. All supplied binaries use TrueType-flavoured OpenType data despite the .otf suffix.

## Download package

bookbinder-fonts.json.gz is the optional download used by the plugin. It contains the font binaries and these notes/licences. Rebuild it with node scripts/build-font-package.mjs. Publish this flat fonts folder and package to GitHub to enable remote installation. Normal plugin release assets remain unchanged.

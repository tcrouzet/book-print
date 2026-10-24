# Configuration and development

The [main README](../README.md) introduces Bookbinder and its visual project editor. This page covers project files and development tools.

## Project files

Bookbinder reads the YAML properties at the start of `bookbinder.md` in the selected folder, or in the selected Markdown file's parent folder. Chapter properties do not override the project settings. Without a project, the title comes from the source filename or folder name, the language is French and the reader supplies fallback fonts.

Use [bookbinder.example.md](../bookbinder.example.md) as a starting point, renaming it to `bookbinder.md`. YAML must be enclosed by two `---` lines at the beginning of the file. Nested settings can be edited in Obsidian's source mode. Text after the properties is preserved on save.

The note's `[Modifier le projet](obsidian://bookbinder)` link opens the visual editor. In reading mode, Bookbinder adds the vault and source note to the rendered link. Without those parameters, including in Live Preview, it uses the active project note. The saved link stays independent of the folder path and vault name.

Both `bookbinder.md` and `book-print.md` are excluded from assembly at every level of the selected hierarchy. The output filename is the source file or folder name with an `.epub` extension.

## Presentation properties

| Property | Purpose |
| --- | --- |
| `epub.page` | Top, bottom, left and right page margins, using `margin-top`, `margin-bottom`, `margin-left` and `margin-right`. |
| `epub.style` | Body text and the book's base typography. |
| `epub.headings` | Heading styles, from `h1` to `h6`. |
| `epub.styles` | Markdown styles such as `blockquote p`, `.smallcaps`, `sub` and `sup`. |
| `epub.rules` | Contextual rules for `h1 + p`, `h2 + p` and `h2 + p::first-letter`. |
| `epub.css` | One custom CSS path or a list of paths, replacing the bundled base CSS. |
| `epub.fonts` | Font files to embed. |
| `epub.toc-depth` | Table of contents depth, from 1 to 6; default 2. |
| `epub.split-level` | Heading level used to split the EPUB, from 1 to 6; default 2. |

Style properties accept `font-family`, `font-size`, `line-height`, `text-align`, `text-indent`, the four `margin-*` properties, `color`, `font-weight`, `font-style`, `letter-spacing`, `display` and `page-break-before`. An omitted property means Auto. Body text size is applied once; paragraphs inherit it.

EPUB controls use em. On saving through the editor, absolute values are converted to em using the loaded presentation. Bold and italic cycle through Auto, enabled and disabled. A style hidden in the export remains visible in the editor so it can be selected and changed. The preview does not modify the manuscript.

The bundled presentation starts a new page at heading level 2 and highlights the opening letter of the following paragraph. Generated cover text and technical punctuation elements are not offered as Markdown styles.

The `pdf` and `docx` sections retain separate presentation settings, with page margins in millimetres and typography in points. Their previews are indicative; their exporters are not implemented.

## Covers and fonts

`cover` selects an existing image. If it is empty, Bookbinder renders a JPEG cover at 1600 × 2400 pixels: a vertical pattern, author, red title, subtitle and a footer with the book's length and date. Use `\n` in the title for line breaks. `cover-background` supplies an optional background image.

Paths in `cover`, `cover-background`, `epub.css` and `epub.fonts` are relative to the project file.

To use the fonts referenced by the bundled CSS, place `AdamantSansPro-Light.otf`, `AdamantSansPro-Bold.otf` and `Adamant.otf` in the project's `fonts/` folder and list them under `epub.fonts`. These fonts are not distributed with the plugin. Missing font declarations are removed from the temporary export CSS; the bundled source stays intact.

Imported fonts are copied only when the project is saved. Cancelling the editor creates no font files. Removing a font clears its style references without deleting its file.

## Markdown assembly

The `fusion` section controls filename exclusions and the Markdown separator between notes. Its defaults exclude names containing `_`, notes named `sortspec` and timestamped Folder Fusion output files. Project notes are always excluded.

HTML comments and Obsidian `%%…%%` comments are omitted. Markdown `~~strikethrough~~` is preserved. Folder Fusion markers such as `@@`, `££`, `€€`, `--…--` and `\newpage` do not create special styles.

Standard Markdown images and Obsidian `![[image.png]]` embeds are supported. Each chapter retains its own relative image paths and footnotes. Embedded notes such as `![[chapter]]` are not expanded.

Pandoc's `[text]{.smallcaps}`, `H~2~O` and `m^2^` produce small caps, subscripts and superscripts. To apply the tabulation style, give a code block the `.tab` class:

````markdown
```{.tab}
    A tabulated line
```
````

Other code blocks keep their literal contents. The Markdown sources are assembled in memory; no merged Markdown file is written. Temporary export resources are removed after conversion. A failed conversion preserves the last successful output.

## Project compatibility

When `bookbinder.md` is absent, Bookbinder reads `book-print.md`, then `book-print.yml`. Saving through the editor creates `bookbinder.md`, preserves personal notes and leaves the older files intact. The new Markdown takes priority. Invalid properties stop opening or exporting instead of silently loading an older configuration. Existing `obsidian://book-print` links and stored font identifiers remain supported.

The editor expands `epub.style.page-margin` into the four page margins. Contextual rules stored under `epub.styles` are read into `epub.rules`. The `body` style is combined with body text; obsolete styles outside the Markdown catalogue and Folder Fusion transformation options are omitted when saving.

## Tool detection

Opening Bookbinder's settings automatically detects Pandoc and XeLaTeX and compares their versions with official releases. If several installations are found, the newest detected version is selected. A custom executable path takes priority. **Enregistrer et vérifier**, inside **Chemins personnalisés**, saves those paths and runs the checks again.

For Pandoc, supported installer links select a macOS Intel or Apple Silicon `.pkg`, or a Windows 64-bit `.msi`. LaTeX links point to official MacTeX, BasicTeX, MiKTeX or TeX Live pages. Current installations show **À jour** without an installation link. Installed versions remain visible when the online comparison is unavailable.

TeX Live comparisons concern the annual release. Component updates use TeX Live Utility on macOS or the TeX Live manager on Windows. MiKTeX uses MiKTeX Console. The plugin does not install or update these tools automatically.

## Build and checks

Node.js 22.18 or later is required for the TypeScript checks. Plugin users do not need Node.js. The CI version is pinned in [`.nvmrc`](../.nvmrc).

```bash
npm ci --ignore-scripts
npm test
npm run build
node scripts/check-resources.mjs
```

[package.json](../package.json) also defines `test:ui`, `test:epub` and `test:release`.

- `test:ui` exercises the style inspector in Chrome: project links and accent colours, nested format tabs, independent settings, Markdown styles and contextual rules, em conversions, resizing, Auto values, keyboard access, dark theme and the font → saved project → EPUB path. It uses `/System/Library/Fonts/Supplemental/Times New Roman.ttf` by default; `BOOKBINDER_TEST_FONT` selects another font.
- `test:epub` creates a real EPUB with Pandoc and a cover rendered in Chrome. It checks chapter assembly, project exclusion, local footnotes, relative images, XML and preservation of the previous output after failure. It requires Pandoc, Chrome, `/usr/bin/unzip` and `/usr/bin/xmllint` on macOS. `BOOKBINDER_CHROME` selects the Chrome executable for both browser checks.
- `test:release` checks the workflow and exercises release operations in local Git repositories. It uses Ruby's standard YAML library and simulates publication. ShellCheck runs in CI.

These tools are development dependencies, not plugin runtime requirements. Browser checks supply native browser element creation and parse the bundled preview samples; they do not exercise Obsidian's DOM helpers, HTML sanitizer, icons, system protocol handling, native file pickers or the complete Obsidian modal. Process checks use POSIX fixtures; Windows search paths are checked without running Windows executables.

## Source layout

[main.ts](../main.ts) loads [plugin/main.ts](../plugin/main.ts). Settings live in [plugin/settings-tab.ts](../plugin/settings-tab.ts), tool detection in [plugin/tools.ts](../plugin/tools.ts), version comparisons in [plugin/updates.ts](../plugin/updates.ts) and settings types in [plugin/types.ts](../plugin/types.ts).

The build produces `main.js` at the repository root. Obsidian loads it with `manifest.json` and `styles.css`.

Bundled resources live under [scripts/lua](../scripts/lua), [scripts/latex](../scripts/latex) and [scripts/epub](../scripts/epub). [scripts/resources.ts](../scripts/resources.ts) imports them as text; esbuild embeds them in `main.js`. No separate filter or template download is needed. [scripts/check-resources.mjs](../scripts/check-resources.mjs) verifies that the compiled bundle contains the source resources unchanged. The thin-space filter escapes XML characters and handles narrow no-break spaces.

## Release workflow

[release.sh](../release.sh) runs from the repository's default branch. It requires Node.js/npm, Git, an authenticated GitHub CLI and `jq`.

The script tests, builds and checks embedded resources, then commits pending changes and pushes the branch. It increments the patch version, synchronises the manifest, package and lockfile, updates `versions.json` when present, commits and pushes that version. It compares the manifest on GitHub with the local file before creating and pushing the numeric version tag.

[The release workflow](../.github/workflows/release.yml) uses pinned actions and artifact attestation. It validates versions, runs the checks and builds twice to verify reproducibility, then publishes `main.js`, `manifest.json` and `styles.css` from the tag. CSS, Lua and LaTeX resources are embedded in the bundle.

Running `bash release.sh` publishes a release. Use `test:release` to exercise the process locally without publishing; actual publication is not part of the local checks.

# Configuration and development

The [main README](../README.md) introduces Bookbinder and its visual project editor. This page covers project files and development tools.

## Project files

Bookbinder reads the YAML properties at the start of `bookbinder.md` in the selected folder, or in the selected Markdown file's parent folder. Chapter properties do not override the project settings. Without a project, the title comes from the source filename or folder name, the language is French and the reader supplies fallback fonts.

Use [bookbinder.example.md](../bookbinder.example.md) as a starting point, renaming it to `bookbinder.md`. YAML must be enclosed by two `---` lines at the beginning of the file. Nested settings can be edited in Obsidian's source mode. Text after the properties is preserved on save.

Saving or cloning places book metadata and custom properties first, followed by `fusion`, `pdf`, `docx` and `epub`, in that order. Property names and values are preserved.

The note's `[Modifier le projet](obsidian://bookbinder)` link opens the visual editor. In reading mode, Bookbinder adds the vault and source note to the rendered link. Without those parameters, including in Live Preview, it uses the active project note. The saved link stays independent of the folder path and vault name.

Both `bookbinder.md` and `book-print.md` are excluded from assembly at every level of the selected hierarchy. The output basename comes from the optional top-level `filename` field. When it is missing or empty, `plugin/filename.ts` combines the last word of the first author’s name with the title. The initial elided French article `L’` or `L'` is omitted from the title. The shared normaliser produces lowercase ASCII words joined by hyphens, removes diacritics, handles common Latin ligatures, strips known export extensions and avoids Windows device names. Names are limited to 200 characters to leave room for extensions and version suffixes; `book` is the fallback when nothing remains. The extension is appended by the exporter.

The General file-name input stores a normalised custom value on input and displays it on blur. Its placeholder is recomputed when title or author changes; clearing the input removes the override. Filename settings are saved with the editable properties and preserved by cloning. Without a project or author, the source filename or folder name supplies the default title and slug.

When that filename already exists, the desktop dialog offers replacement, a numbered version or cancellation. Numbered names append `-2`, `-3` and so on, preserving the slug format and skipping occupied names. New files use exclusive creation, including when exports race; replacement requires an explicit choice and happens after successful conversion. Calls without a confirmation callback create a numbered version. The exporter returns the generated path, or `undefined` on cancellation.

Cloning reads the selected `bookbinder.md`, `book-print.md` or `book-print.yml` file, writes a new `bookbinder.md` and preserves its properties and Markdown body. File paths in `cover`, `cover-background`, top-level `fonts`/`css` and the format-specific `fonts`/`css` settings become absolute paths to the original files. Library font references remain unchanged. No manuscript or resource files are copied by cloning. Existing destination projects are refused, and creation uses the same exclusive-write protection as a new project.

## Presentation properties

| Property | Purpose |
| --- | --- |
| `epub.page` | Top, bottom, left and right page margins, using `margin-top`, `margin-bottom`, `margin-left` and `margin-right`. |
| `epub.style` | Body text and the book's base typography. |
| `epub.headings` | Heading styles, from `h1` to `h6`. |
| `epub.styles` | Markdown styles such as `blockquote p`, `.smallcaps`, `sub` and `sup`. |
| `epub.rules` | The first paragraph of a chosen style after any heading, or its first character. |
| `epub.disabled-rules` | Styles with no contextual rule: `body`, `quote`, `footnote`, `tab`. Saved formatting remains available when reactivated. |
| `epub.css` | One custom CSS path or a list of paths, replacing the bundled base CSS. |
| `epub.fonts` | Library font references or legacy file paths to embed. |
| `epub.toc-depth` | Table of contents depth, from 1 to 6; default 2. |
| `epub.split-level` | Heading level used to split the EPUB, from 1 to 6; default 2. |

Custom stylesheet paths, table of contents depth and split level are advanced YAML properties. The visual editor offers Page, Styles and Rules; it preserves existing advanced properties when saving.

Style properties accept `font-family`, `font-size`, `line-height`, `text-align`, `text-indent`, the four `margin-*` properties, `color`, `font-weight`, `font-style`, `letter-spacing`, `display` and `page-break-before`. An omitted property means Auto. Body text size is applied once; paragraphs inherit it.

EPUB controls use em. On saving through the editor, absolute values are converted to em using the loaded presentation. Bold and italic cycle through Auto, enabled and disabled. A style hidden in the export remains visible in the editor so it can be selected and changed. The preview does not modify the manuscript.

Absent presentation properties mean Auto. Opening or saving the editor never fills them from computed preview values: browser fonts, colours and sizes must not become explicit project settings. Saving normalises explicit legacy dimensions to em and preserves missing properties. Previously saved explicit settings remain editable and can be cleared to Auto.

`epub.separator` optionally contains literal characters for Markdown thematic breaks. Omitting it keeps the line. The reader renders characters inside `div.bookbinder-separator`; `epub.styles.hr` applies to both forms. The preview exposes Line/Characters and a text field when editing the Separator style. Characters are inserted as text, with no Markdown or HTML interpretation. Assembly separators remain a separate `fusion.noteSeparator` setting.

Heading styles `epub.headings.h1` through `h6`, and the book-title style `epub.styles.h1.title`, also accept `page-position: one-third`. The Flow controls expose this as Heading position. Export adds `page-break-before:always`, `break-before:page`, `margin-top:0` and `padding-top:33.3333vh` after the explicit declarations. Padding preserves the space at a page boundary; its height follows the [viewport-relative length definition](https://www.w3.org/TR/css-values-3/#viewport-relative-lengths). The editor disables the top-margin and page-break controls while this option is active, preserves their stored values, and restores them on Auto. Inactive legacy top margins are left intact during unit normalisation. The earlier `two-thirds` value is read as `one-third` without rewriting the source object; saving persists the corrected value. The preview shows the vertical spacing in its scrolling frame; physical pagination and viewport-unit support depend on the reading system. The internal `page-position` key is never emitted as a CSS property.

The Book title style targets Pandoc’s existing `h1.title` on `title_page.xhtml`. Chapter-level h1 overrides use `h1:not(.title)` so their formatting does not affect the book title. Its preview and formatting controls use the same style editor as other elements. The generated JPEG cover remains configured through the cover settings.

The editable top-level `colophon` property is a Markdown string, exposed under Publication. After manuscript contextual rules have been applied, the reader appends an empty level-1 boundary with `unnumbered`, `unlisted` and `bookbinder-colophon-boundary` classes. Generated presentation CSS hides only that boundary heading; it contains no visible title. This makes the colophon a final spine item at every supported split level, outside the table of contents, without consuming after-heading paragraph rules or generating an intermediate Markdown file. Existing chapter footnotes stay before this page. Personal text and the credit are parsed separately, so a user’s Markdown cannot absorb the attribution into a list or code block. The credit is placed in `div.bookbinder-credit`, centred, with a 3em top margin and smaller text. It uses `generatedByBookbinderOn` with a `{date}` parameter, formatted from the generation time in the book’s language, independently of the publication date. The default credit links to `https://community.obsidian.md/plugins/bookbinder`. Old editable catalogues with the former credit key remain readable; the new dated key uses its bundled fallback when absent. Hyperlinks are underlined by default and inherit the text colour.

Before merging each note, the reader reserves its declared identifiers and makes them unique across the book, retaining unused identifiers and adding numerical suffixes to collisions. It updates that note’s local fragment links, including percent-encoded fragments. This covers repeated chapter or part headings and explicit IDs without creating collisions with existing spans or other anchors. The final Pandoc EPUB and NCX navigation therefore point to the correct occurrence of repeated titles. Footnotes remain parsed within each source note.

The bundled presentation starts a new page at heading levels 1 to 4 and removes the first-line indent from the first body paragraph after a heading. It leaves the body font, size and colour to the reading app, includes no font declarations, and imposes no colour or initial-letter formatting. Links and separators inherit the text colour. The preview shows default text in black on white; those preview colours are not exported. Project settings can add these effects. The interior book title has its own style; generated JPEG cover text and technical punctuation elements are not offered as Markdown styles.

The `pdf` and `docx` sections retain separate presentation settings, with page margins in millimetres and typography in points. Their previews are indicative; their exporters are not implemented.

## Covers and fonts

`cover` selects an existing image. If it is empty, Bookbinder renders a JPEG cover at 1600 × 2400 pixels: a vertical pattern, author, red title, subtitle and a footer with the book's length and date. Use `\n` in the title for line breaks. `cover-background` supplies an optional background image.

Paths in `cover`, `cover-background` and `epub.css` are relative to the project file. Imported fonts use `library:filename.ttf` references, resolved inside the plugin’s `data/_fonts/` directory. Legacy relative or absolute font paths remain supported by the exporter.

The bundled CSS requires no fonts. Import fonts into the library, select them for the project, then assign them to styles in the editor. Exported font declarations are generated from the project’s selected library references.

The optional package lives under [`fonts/`](../fonts/README.md), with a source file, usage note and full licence for every family. After editing its contents or `fonts/catalog.json`, run `node scripts/build-font-package.mjs` to rebuild the separate gzip-compressed JSON download and its SHA-256 manifest. Commit the source folder, catalogue and package together. Publish them to the repository’s main branch to enable the versioned raw GitHub URL compiled into the plugin; no release workflow change is required. The normal plugin assets contain the catalogue, without the font binaries. A source checkout uses its local package when present. Released plugins fetch the package only on demand through Obsidian’s request API. Native Node gzip decoding needs no shell command, archive tool or additional dependency. The installer checks the archive and every file against the compiled manifest before writing, refuses conflicting existing files, and installs the fonts into `data/_fonts/` with their notes/licences under `_package-notes/`. It never assigns fonts to projects automatically. `npm test` covers package integrity and installation; `test:ui` also loads all supplied fonts through Chrome’s native FontFace API.

Imported fonts are validated and saved immediately in the shared library; cancelling project edits keeps those imports available. Library files are listed without preloading every font. Only fonts selected for the project are loaded into its previews and embedded in its EPUB. Identical imports reuse the existing file; a different font with the same filename is refused. Removing a font clears its project style references and keeps the library file.

Opening a project with legacy font paths copies its selected fonts into the library and prepares library references in memory. Saving persists those references. Original files remain intact, and font-family identifiers stay compatible because they depend on the filename. The repository’s existing private-file rule ignores `data/_fonts/`.

## Markdown assembly

The `fusion` section controls filename exclusions and the Markdown separator between notes. Its defaults exclude names containing `_`, notes named `sortspec` and timestamped Folder Fusion output files. Project notes are always excluded.

`fusion.noteSeparator` accepts `''` (no separator), `page`, `even` or `odd`. Page breaks apply before the first block of each following non-empty note, with no extra break before the first note or after the last. EPUB output uses `page-break-before` and `break-before`; even and odd request left and right pages, which reading apps may render as ordinary page breaks. Existing custom Markdown separators remain supported and are inserted only between notes.

HTML comments and Obsidian `%%…%%` comments are omitted. Markdown `~~strikethrough~~` is preserved. Folder Fusion markers such as `@@`, `££`, `€€`, `--…--` and `\newpage` do not create special styles.

Standard Markdown images and Obsidian `![[image.png]]` embeds are supported. Each chapter retains its own relative image paths and footnotes. Embedded notes such as `![[chapter]]` are not expanded.

Pandoc's `[text]{.smallcaps}`, `H~2~O` and `m^2^` produce small caps, subscripts and superscripts. Indented blocks, beginning with a tab or at least four spaces, use the Tabulation style. Their contents retain Markdown emphasis and line breaks. A fenced block with the `.tab` class also selects this style:

````markdown
```{.tab}
    A tabulated line
```
````

Fenced code blocks without `.tab` keep their literal contents. The tabulation filter retains inline nodes for Pandoc's writer, and runs before the punctuation filter. The Markdown sources are assembled in memory; no merged Markdown file is written. Temporary export resources are removed after conversion. A failed conversion preserves the last successful output.

## Project compatibility

When `bookbinder.md` is absent, Bookbinder reads `book-print.md`, then `book-print.yml`. Saving through the editor creates `bookbinder.md`, preserves personal notes and leaves the older files intact. The new Markdown takes priority. Invalid properties stop opening or exporting instead of silently loading an older configuration. Existing `obsidian://book-print` links and stored font identifiers remain supported.

Rules use `.bookbinder-after-heading-body + p`, `blockquote .bookbinder-after-heading-quote + p`, `section.footnotes .bookbinder-after-heading-footnote + p` and `.bookbinder-after-heading-tab + p.tab`, with `::first-letter` appended for the first character. The reader marks the first paragraph of each style after headings 1–6, including when another style precedes it. Lists, table cells and image captions do not consume the body-text rule. The marker elements are hidden and preserve footnote backlinks inside their paragraphs.

The parser combines `h1 + p` and `h2 + p` settings into the body paragraph rule, and retains `h2 + p::first-letter` settings in its first-character rule. Explicit current rule keys take priority. The editor expands `epub.style.page-margin` into the four page margins. Contextual rules stored under `epub.styles` are read into `epub.rules`. The `body` style is combined with body text; obsolete styles outside the Markdown catalogue and Folder Fusion transformation options are omitted when saving.

## Interface languages

`plugin/i18n.ts` receives Obsidian’s public `getLanguage()` value when the plugin loads. It resolves the requested locale, its base language, then English. French and English are plain JSON catalogues in `locales/fr.json` and `locales/en.json`. They are bundled into `main.js`, and `plugin/locale-files.ts` reads editable copies from the installed plugin’s `locales/` folder before registering the interface. Missing files are created from the bundled defaults; existing files are never overwritten. Editing the JSON and reloading Bookbinder changes the interface without rebuilding or changing the release assets. Interface text, accessibility labels, examples, errors and dialogs use these catalogues. Style lists and language names use the selected locale for display and sorting.

Use `t(messageId, { namedParameters })` for new interface text. Message IDs are stable camelCase names, such as `bodyText` and `bodyFontWarning`. Change only the JSON values when editing wording, and preserve named `{parameters}`. The loader validates text and placeholders before applying a catalogue. Missing keys use the bundled translation; invalid files remain intact, trigger a notice and use the complete bundled fallback for that language. `plugin/messages.d.ts` lists keys for TypeScript checking and contains no interface wording. New interface messages require entries in both JSON files and that declaration; adding a language also requires registering it in `plugin/i18n.ts`. `npm test` checks catalogue completeness, placeholders, runtime file edits, fallback and untranslated French literals; `test:ui` checks French and English controls, the body-font warning and layout.

Project keys, font identifiers and manuscript content stay independent of the interface language. The project’s `lang` still defaults to French and controls generated cover labels and dates. Stored project notes are preserved; the reading view translates recognised generated edit links and keeps custom labels.

## Tool detection

Opening Bookbinder's settings automatically detects Pandoc and XeLaTeX and compares their versions with official releases. If several installations are found, the newest detected version is selected. A custom executable path takes priority. **Save and check**, inside **Custom paths**, saves those paths and runs the checks again.

For Pandoc, supported installer links select a macOS Intel or Apple Silicon `.pkg`, or a Windows 64-bit `.msi`. LaTeX links point to official MacTeX, BasicTeX, MiKTeX or TeX Live pages. Current installations show **Up to date** without an installation link. Installed versions remain visible when the online comparison is unavailable.

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

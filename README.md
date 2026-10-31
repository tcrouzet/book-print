# Bookbinder

**Turn your Obsidian notes into a book.**

A manuscript can live in a single note or across a whole folder of chapters. Bookbinder brings them together into an EPUB or PDF, with your title, cover, fonts and typography. Keep writing in Markdown and shape the book from inside Obsidian.

Bookbinder follows Obsidian’s interface language: French or English, with English as the fallback for other languages. The book’s language is set separately in its project.

Interface wording is editable in [`locales/fr.json`](locales/fr.json) and [`locales/en.json`](locales/en.json), inside the plugin folder. Each named key has its associated text, for example `bodyText` and `bodyFontWarning`. Edit the text on the right, keep keys and `{parameters}` intact, then reload Bookbinder. No rebuild is needed. Installed releases create missing language files automatically and preserve existing files. Invalid files trigger a notice and use the bundled wording.

[Download Bookbinder](https://github.com/tcrouzet/bookbinder/releases) · [Report a problem](https://github.com/tcrouzet/bookbinder/issues)

Bookbinder is in early development. **EPUB, PDF and DOCX export are available.**

## Install Bookbinder

1. Download `main.js`, `manifest.json` and `styles.css` from a Bookbinder release.
2. Place the files in a `bookbinder` folder inside your vault's `.obsidian/plugins/` folder.
3. Reload Obsidian and enable **Bookbinder** in **Settings → Community plugins**.

Obsidian **1.14.0 or later** on a desktop computer is required. Bookbinder is free and open source.

Open **Settings → Bookbinder** to check Pandoc. Bookbinder detects installed versions, checks for updates and offers the installer for your system when one is needed. On macOS and Windows, installation uses a graphical installer; Homebrew is not required.

EPUB and DOCX export need **Pandoc 3.1.1 or later**, without Python or LaTeX. PDF export also needs **XeLaTeX**, supplied by a LaTeX distribution. The settings check LaTeX and link to the appropriate official download page. Downloads start only when you choose them; you complete installation with the system's installer.

## Turn notes into a book

Right-click a Markdown file or a folder in the vault's file explorer and choose **Book to ePub**, **Book to PDF** or **Book to Docx**.

The vault root cannot be exported. A Markdown note at the root can be exported individually.

For the active Markdown note, the same **Book to PDF**, **Book to Docx** and **Book to ePub** commands are available in Obsidian’s command palette. They work independently of other export plugins.

- A file becomes a book on its own.
- A folder brings together Markdown files from its whole hierarchy, sorted by path. Number chapter filenames when you want to set their order.

The assembly happens in memory. Your source notes stay intact, and Bookbinder creates no merged Markdown file. Footnotes and relative image paths stay attached to their source chapters.

Under **Docx → Page → Notes**, choose **Bottom of page** (default) or **End of document**. Both use native editable Word notes, preserving note paragraphs, formatting, links and images. The setting is saved per project as `docx.page.notes-position` (`page-bottom` or `document-end`). Notes with the same Markdown identifier in different chapters remain distinct.

The note number stays on the same line as the first paragraph. PDF and Docx offer separate **Footnote** (note text), **Footnote call** (the mark in the manuscript), **Footnote index** (the number before the note) and **Footnote separator** styles. Call and index styles control font, size, colour and superscript independently. The separator controls line length, thickness, colour, alignment and visibility, with the same settings in both formats. Note styles and rules have no page-break control.

In the project's assembly settings, choose no separator, a page break, or a break to an even or odd page between notes. EPUB reading apps may treat even and odd page requests as ordinary page breaks.

The exported file is saved beside the source file, or inside the selected source folder. To choose another destination anywhere on your computer, use **Output folder → Browse…** in Bookbinder's settings. The reset button restores the default destination.

When the output file already exists, choose **Replace**, **Create a version** or **Cancel**. **Replace** is selected by default. A new version uses the next available name, such as `my-book-2.epub`, preserving existing files.

EPUB and DOCX files appear in the vault's explorer with your theme's accent colour. Open one and choose **Read ePub** or **Open DOCX** to launch your computer's default app for that file. Existing file associations from other plugins are preserved. If an export fails, Bookbinder keeps the last successfully generated output.

## Give each book its own project

Open **Settings → Bookbinder → Create/open project** and choose your manuscript folder.

Set the title, author, language and other book details, then save. The same button opens an existing folder project. **Book to** automatically creates a missing `bookbinder-<source name>.md` beside the source note or inside the selected folder, using its name as the title. For example, `Chapter.md` gets `bookbinder-Chapter.md`; the `Manuscript` folder gets `Manuscript/bookbinder-Manuscript.md`. Each note has its own settings, even when other notes share its folder. The **Base** model is included in the plugin, compiled from `models/base.md`, and selected by default. No download is required. Settings also let you download additional models from GitHub and choose one for new projects. Existing projects keep their settings. The default book language is French; choose another language in the project settings.

**General → File name** sets the export name without an extension. Leave it empty to derive a lowercase slug from the first author’s last name and the title: Thierry Crouzet and *L’expérience humaine* produce `crouzet-experience-humaine.epub`. Spaces, accents and punctuation are normalised. The automatic suggestion follows title and author edits; a custom name remains fixed until you clear it.

Each project lives in a **`bookbinder-<source name>.md`** note. It contains editable YAML properties and a link that opens the visual editor for that exact project. You can keep your own notes below the properties. All project notes are highlighted in the explorer and excluded from exported books, including when they sit in a subfolder. Existing `bookbinder.md` files remain supported for folder exports and keep their names when edited; individual note exports use their own named projects.

Project settings and images can travel with the manuscript folder. Imported fonts live in Bookbinder’s shared library. Bookbinder preserves additional properties and your project notes when saving, and stops if the project file has been changed elsewhere while the editor is open.

To reuse a project's settings, choose **Settings → Bookbinder → Clone a project**, select its project file, then choose a destination folder. Bookbinder saves `bookbinder-<destination folder name>.md` and opens its editor. It preserves your project notes and leaves the source unchanged. The clone reuses library fonts and keeps image and CSS references; chapters are not copied. An existing folder project at the destination is preserved and prevents cloning over it.

## Shape the typography

The resizable project window starts with general book details, followed by separate **PDF**, **DOCX** and **ePub** tabs. For EPUB, **Page**, **Styles** and **Rules** let you work on the book's presentation without writing CSS.

- **Page** sets the top, bottom, left and right page margins.
- In each format’s **Page → Table of contents** section, choose whether to show a contents page and include headings through level 1 to 6. The depth defaults to 2 and each format keeps its own settings. PDF and DOCX include a contents page by default. EPUB keeps its previous navigation-only default; enabling the option adds the contents page to the reading order. The reading app’s navigation remains available and follows the selected depth.
- **Styles** lists body text first, then headings, then other Markdown elements in the interface language’s alphabetical order. A compact inspector groups character, paragraph and flow settings, with bold, italic and alignment buttons and a live preview.
- In the **Separator** style for EPUB, PDF and DOCX, choose **Line** or **Characters** and enter an ornament such as `⁂ · ⁂`. This applies to Markdown thematic breaks (`***`, `---` or `___`), including separators inserted when assembling notes. Character formatting and spacing use the same style controls; each format saves its own choice.
- For EPUB headings, **Flow → Heading position → Space at top of page** starts a new page and adds a fixed space above the heading. **Space above heading (mm)** defaults to 50 mm and stays unchanged when either the heading size or the reading size changes. Padding retains that space at page boundaries. **Auto** restores normal margins and page-break settings. The ordinary top margin is saved separately. This replaces font-dependent and viewport-based spacing; a fixed height does not represent an exact fraction of every screen.
- **Book title** controls the title on the interior title page independently of chapter headings, including its font, size and start-of-page spacing.
- In PDF and DOCX, **Page → Title page** offers separate **Copyright** and **Character count** checkboxes, off by default. Copyright uses **General → Publication → Rights**. The count includes spaces and footnotes in the manuscript text, excluding Markdown markup, project notes and generated pages. The details appear below the title or supplied cover, before the contents.
  PDF displays the count in thousands, rounded to the nearest whole number, such as **410k characters**. DOCX keeps the exact count.
- **Rules** starts with any manuscript style, including headings, lists, tables and character styles. **First “style” in the book** applies once across all assembled notes. **After a heading** restarts after headings; for heading styles, only after a higher-level heading: the first H3 after an H1/H2 receives that rule; later H3s keep their normal style. When both rules apply, the first-in-book settings take priority over conflicting after-heading settings. Paragraph and heading styles also offer a first-character rule. The formatting controls decide the result; **No rule** disables all rules for that style while keeping their settings. These choices work in EPUB, PDF and DOCX.

EPUB sizes, spacing, paragraph margins and first-line indents use **em**, so the presentation can adapt to the reader's text size. **Auto** keeps the template's defaults; clearing a number restores Auto. The reading app can still apply its own layout preferences.

Measurement fields also accept units: type `5mm`, `5 mm`, `12pt` or `1.2em`. The value is converted to the field’s unit: em for EPUB, points for PDF/DOCX typography and millimetres for their pages. Invalid measurements stay visible and block saving.

Consecutive paragraphs of the same style keep only the previous paragraph's bottom margin: the second and later paragraphs have no top margin. Separate Markdown quote blocks, including across assembled notes, continue the same quotation style. A different style, a heading or an explicit page break starts a new sequence. This applies to body text, quotations, tabulation, footnotes and colophon paragraphs in EPUB, PDF and DOCX, including the preview. The project's stored margins remain unchanged.

**Tracking** uses InDesign’s relative notation in all three formats: enter `-10`, `0` or `+10`, without a displayed unit. A value of `+10` adds 0.01 em between characters, scaling with the text size. Existing project spacing values remain valid. Tracking affects character spacing; spacing between words is a separate setting. See [Adobe’s tracking guide](https://helpx.adobe.com/indesign/desktop/format-and-style-text/tabs-indents-and-spacing/adjust-tracking.html).

**Auto** is preserved when saving and reopening a project, including body text settings. The bundled CSS leaves the body font, size and colour to the reading app, keeps headings visible in the inherited colour, and applies no automatic initial-letter formatting. Fonts, colours and initial-letter effects are applied only when configured in the project.

Body text uses **Auto** for its font by default. Importing a font does not assign it to the body. A red advisory in the Body text character controls recommends letting reading devices choose the font; you can still select one explicitly.

Other styles and rules can choose **Body text** in the **Font** menu and the **Font size source** menu beside the size field. **Auto** keeps that style's defaults, **Body text** follows the body's font or size, and **Custom** fixes a size. These are separate choices: to make H3 use the body's font and size, select Body text in both menus. The references remain linked when the body changes, including when EPUB body settings are Auto. Bold and italic remain controlled by the selected style. This works for EPUB, PDF and DOCX.

**General → Publication → Colophon** accepts optional text in Markdown. Every EPUB ends with a separate page without a visible heading, containing that text when supplied. A centred credit block follows after a generous gap: “Generated by [Bookbinder](https://community.obsidian.md/plugins/bookbinder)”, with the generation date, translated into the book’s language. The **Colophon** style controls its paragraphs’ typography, margins and indentation; the credit keeps its centred alignment, smaller size and separate spacing. The table of contents includes a **Colophon** link to this final page. Hyperlinks are underlined by default and inherit the text colour.

Small caps, subscripts and superscripts are supported. Indented text, starting with a tab or at least four spaces, uses the **Tabulation** style and preserves Markdown emphasis. Explicit `.tab` blocks also use this style. Fenced code blocks keep their literal content. Bookbinder works with Markdown and Pandoc syntax; it does not apply Folder Fusion's special formatting markers or expand embedded notes such as `![[chapter]]`. Standard Markdown images and Obsidian image embeds are supported.

PDF and DOCX presentation settings are stored separately from EPUB settings.

For PDF and DOCX, choose **A4**, **A5** or **Custom** under the format’s **Page → Paper size** controls. A5 is the default; custom width and height use millimetres. **Page layout** selects **Single page** or **Facing pages**. Margins appear in two columns: left/right for single pages, inner/outer for facing pages. They default to 20 mm. The binding margin starts at 0 mm and adds space on the left in single-page mode and on the inner edge in facing-page mode. Facing-page margins alternate between recto and verso.

**Page → Folio** places page numbers at the bottom: left, centred, right, inner or outer, or **No folio**. Inner and outer positions alternate on facing pages. The distance from the bottom defaults to 10 mm. The **Folio** entry in **Styles** controls the numbers’ font, size, bold, italic, colour and spacing. The first book page has no folio.

Both print formats start with **EB Garamond, 11 pt type and Auto leading at 1.2 × the font size**, from the shared font library. Install the font package in settings or choose another imported OTF/TTF font. EB Garamond starts selected above the used-fonts separator. **Styles** and **Rules** show print values in points, with **Auto** for unset leading. Enter a point value to fix the leading; clear it to restore Auto. Resetting restores the model. PDF applies these settings through its bundled LaTeX template. DOCX keeps automatic leading relative to the font size and uses fixed spacing for explicit point values. It creates editable Word styles, dynamic page numbers and an optional table of contents for Word to update when opening the document. Without a table of contents, Bookbinder does not request a global field update at opening. Pagination depends on the word processor. Both exports preserve the manuscript’s assembly, footnotes and final colophon.

For heading styles 1 to 6 in PDF and DOCX, **Flow → Page break before** offers **No break**, **Next page**, **Even page** and **Odd page**. Even and odd insert a blank page when needed. These choices also work with headings positioned one-third down the page; that position requires a page break, so No break becomes unavailable until you restore the normal heading position.

**Top margin** stays editable in PDF and DOCX. Entering a margin, including zero, automatically switches a positioned heading to **Normal** so the entered value applies. The page-break and parity choices remain unchanged. A contextual rule can override an inherited one-third position without changing its base heading style. This also applies to the PDF colophon’s position.

PDF heading styles also offer **Flow → Show folio on the heading’s page**, checked by default. Uncheck it to hide the page number only on pages containing that heading style. Heading rules can override this choice. If several headings share a page, a request to hide its folio takes priority. Continuation pages resume normal folios, and physical page numbering keeps counting every page. Generated title pages and blank parity pages never show folios. These controls do not change EPUB or DOCX.

In PDF, **Styles → Colophon → Flow → Colophon position → One-third down the page** positions the start of the entire colophon, including when it contains only the Bookbinder credit. Its paragraphs remain together, and the credit keeps its separate spacing after personal text. Normal positioning restores the saved top margin. Uncheck **Show folio on colophon pages** to remove page numbers throughout the colophon, including its attribution and any continuation pages.

Block-style rules offer the same page-break choices. For example, choose **Rules → Heading 3 → First “Heading 3” after a heading**, then **Flow → Page break before → Odd page**. This includes the book’s first H3 and applies independently of the normal H3 style.

## Add a cover and your own fonts

Choose a cover image or let Bookbinder generate one from the title, author and subtitle, with an optional background image. The generated cover includes the book's length and date.

Use **Settings → Bookbinder → Fonts → Import fonts…** to choose OTF, TTF, WOFF or WOFF2 files from your computer. Bookbinder detects **Serif**, **Sans serif** or **Symbol** from the font’s OpenType metadata and imports recognized fonts directly. Only fonts with missing or ambiguous classification ask for a type. Fonts are saved in Bookbinder’s shared library, inside the plugin’s `data/_fonts/` folder. The style editor lists each family once, with its type after the name. **Bold** and **Italic** automatically select the corresponding real font files when available; those variants have no separate dropdown entries. This works in all three formats. Families used in the project’s styles appear first, followed by a separator and the remaining families; EPUB keeps Auto above these groups. A family is used automatically when a style declares it, with no separate activation. Removing its last style declaration removes its resources from the project and keeps the files available in the library. EPUB embeds the selected families with their available variants. PDF and DOCX use OTF/TTF fonts; DOCX embeds complete font files when their permissions allow editable embedding. Unrelated library fonts stay out of exports. No system font installation is needed.

The built-in EPUB presentation works without custom fonts. You can also supply your own CSS when a project needs more control.

If an export needs missing fonts from the [font collection](fonts/README.md), Bookbinder downloads and installs the package automatically, then continues generating the book. Installed fonts are reused on later exports. You can also install the package through **Fonts → Font package → Download and install** in settings. A single alphabetical catalogue includes packaged families and your personal fonts, with **Serif**, **Sans serif** or **Symbol** after each name. Packaged families keep their usage notes, licences and source links. Installation preserves existing fonts; choose a font directly in a project’s styles to use it. Font files and package notes are stored flat; installed package notes and licences have a `_package-` filename prefix.

## Local processing

Bookbinder assembles the manuscript locally, renders the automatic cover in Obsidian and runs Pandoc on your computer. It does not upload your manuscript to a conversion service.

The desktop plugin accesses project resources and export destinations through the filesystem, including folders you select outside the vault. It launches local executables to check Pandoc and LaTeX versions and uses Pandoc for conversion. These operations require filesystem and process access; commands run directly, without a system shell.

Opening the settings contacts GitHub and the official TeX sites to check published tool versions. Installer links open only when clicked. The font package downloads from GitHub when an export needs missing package fonts or when you click its installation button. Custom fonts and images otherwise come from the files you choose.

## Documentation and support

- [Example project](bookbinder.example.md): editable book properties and presentation settings.
- [Configuration and development](docs/development.md): custom CSS, Markdown syntax, project settings, builds and releases.
- [Code licence](LICENSE).

For a bug or an idea, [open an issue](https://github.com/tcrouzet/bookbinder/issues) with your Obsidian version, operating system and a short example when possible.

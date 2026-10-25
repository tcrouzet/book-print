# Bookbinder

**Turn your Obsidian notes into a book.**

A manuscript can live in a single note or across a whole folder of chapters. Bookbinder brings them together into an EPUB or PDF, with your title, cover, fonts and typography. Keep writing in Markdown and shape the book from inside Obsidian.

Bookbinder follows Obsidian’s interface language: French or English, with English as the fallback for other languages. The book’s language is set separately in its project.

Interface wording is editable in [`locales/fr.json`](locales/fr.json) and [`locales/en.json`](locales/en.json), inside the plugin folder. Each named key has its associated text, for example `bodyText` and `bodyFontWarning`. Edit the text on the right, keep keys and `{parameters}` intact, then reload Bookbinder. No rebuild is needed. Installed releases create missing language files automatically and preserve existing files. Invalid files trigger a notice and use the bundled wording.

[Download Bookbinder](https://github.com/tcrouzet/bookbinder/releases) · [Report a problem](https://github.com/tcrouzet/bookbinder/issues)

Bookbinder is in early development. **EPUB and PDF export are available. DOCX export is still in development.**

## Install Bookbinder

1. Download `main.js`, `manifest.json` and `styles.css` from a Bookbinder release.
2. Place the files in a `bookbinder` folder inside your vault's `.obsidian/plugins/` folder.
3. Reload Obsidian and enable **Bookbinder** in **Settings → Community plugins**.

Obsidian **1.14.0 or later** on a desktop computer is required. Bookbinder is free and open source.

Open **Settings → Bookbinder** to check Pandoc. Bookbinder detects installed versions, checks for updates and offers the installer for your system when one is needed. On macOS and Windows, installation uses a graphical installer; Homebrew is not required.

EPUB export needs **Pandoc 3.1.1 or later**. Python and LaTeX are not required for EPUB. PDF export also needs **XeLaTeX**, supplied by a LaTeX distribution. The settings check LaTeX and link to the appropriate official download page. Downloads start only when you choose them; you complete installation with the system's installer.

## Turn notes into a book

Right-click a Markdown file or a folder in the vault's file explorer and choose **Book to ePub** or **Book to PDF**.

- A file becomes a book on its own.
- A folder brings together Markdown files from its whole hierarchy, sorted by path. Number chapter filenames when you want to set their order.

The assembly happens in memory. Your source notes stay intact, and Bookbinder creates no merged Markdown file. Footnotes and relative image paths stay attached to their source chapters.

In the project's assembly settings, choose no separator, a page break, or a break to an even or odd page between notes. EPUB reading apps may treat even and odd page requests as ordinary page breaks.

The exported file is saved beside the source file, or inside the selected source folder. To choose another destination anywhere on your computer, use **Output folder → Browse…** in Bookbinder's settings. The reset button restores the default destination.

When the output file already exists, choose **Replace**, **Create a version** or **Cancel**. **Replace** is selected by default. A new version uses the next available name, such as `my-book-2.epub`, preserving existing files.

EPUB files stand out in the explorer with your theme's accent colour. Open one and choose **Read ePub** to launch your computer's reading app. If an export fails, Bookbinder keeps the last successfully generated EPUB.

## Give each book its own project

Open **Settings → Bookbinder → Create/open project** and choose your manuscript folder.

Set the title, author, language and other book details, then save. The same button opens an existing project. You can export without creating one: Bookbinder uses the file or folder name as the title and the default presentation. The default book language is French; choose another language in the project settings.

**General → File name** sets the export name without an extension. Leave it empty to derive a lowercase slug from the first author’s last name and the title: Thierry Crouzet and *L’expérience humaine* produce `crouzet-experience-humaine.epub`. Spaces, accents and punctuation are normalised. The automatic suggestion follows title and author edits; a custom name remains fixed until you clear it.

Each project lives in a **`bookbinder.md`** note beside the manuscript. It contains editable YAML properties and a link that opens the visual editor. You can keep your own notes below the properties. The project note is highlighted in the explorer and excluded from the exported book, including when it sits in a subfolder.

Project settings and images can travel with the manuscript folder. Imported fonts live in Bookbinder’s shared library. Bookbinder preserves additional properties and your project notes when saving, and stops if the project file has been changed elsewhere while the editor is open.

To reuse a project's settings, choose **Settings → Bookbinder → Clone a project**, select its project file, then choose a destination folder. Bookbinder saves a new `bookbinder.md` and opens its editor. It preserves your project notes and leaves the source unchanged. The clone reuses library fonts and keeps image and CSS references; chapters are not copied. A folder that already contains a project cannot be used as the destination.

## Shape the typography

The resizable project window starts with general book details, followed by separate **PDF**, **DOCX** and **ePub** tabs. For EPUB, **Page**, **Styles** and **Rules** let you work on the book's presentation without writing CSS.

- **Page** sets the top, bottom, left and right page margins.
- **Styles** lists body text first, then headings, then other Markdown elements in the interface language’s alphabetical order. A compact inspector groups character, paragraph and flow settings, with bold, italic and alignment buttons and a live preview.
- In the **Separator** style, choose **Line** or **Characters** and enter an ornament such as `⁂ · ⁂`. This applies to Markdown thematic breaks (`***`, `---` or `___`), including separators inserted when assembling notes. Character formatting and spacing use the same style controls.
- For EPUB headings, **Flow → Heading position → One-third down the page** starts a new page and lowers the heading. **Auto** restores its previous top margin and page-break settings. Exact placement depends on the reading app’s pagination support.
- **Book title** controls the title on the interior title page independently of chapter headings, including its font, size, spacing and one-third position.
- **Rules** starts with the paragraph style: body text, quotation, footnote or tabulation. Then choose the first paragraph of that style after any heading, or the first character of that paragraph. Both choices include the style name; the formatting controls decide its appearance. **No rule** disables these effects for the selected style and keeps its settings for reactivation.

EPUB sizes, spacing, paragraph margins and first-line indents use **em**, so the presentation can adapt to the reader's text size. **Auto** keeps the template's defaults; clearing a number restores Auto. The reading app can still apply its own layout preferences.

**Auto** is preserved when saving and reopening a project, including body text settings. The bundled CSS leaves the body font, size and colour to the reading app, keeps headings visible in the inherited colour, and applies no automatic initial-letter formatting. Fonts, colours and initial-letter effects are applied only when configured in the project.

Body text uses **Auto** for its font by default. Importing a font does not assign it to the body. A red advisory in the Body text character controls recommends letting reading devices choose the font; you can still select one explicitly.

**General → Publication → Colophon** accepts optional text in Markdown. Every EPUB ends with a separate page without a visible heading, containing that text when supplied. A centred credit block follows after a generous gap: “Generated by [Bookbinder](https://community.obsidian.md/plugins/bookbinder)”, with the generation date, translated into the book’s language. The **Colophon** style controls its paragraphs’ typography, margins and indentation; the credit keeps its centred alignment, smaller size and separate spacing. The table of contents includes a **Colophon** link to this final page. Hyperlinks are underlined by default and inherit the text colour.

Small caps, subscripts and superscripts are supported. Indented text, starting with a tab or at least four spaces, uses the **Tabulation** style and preserves Markdown emphasis. Explicit `.tab` blocks also use this style. Fenced code blocks keep their literal content. Bookbinder works with Markdown and Pandoc syntax; it does not apply Folder Fusion's special formatting markers or expand embedded notes such as `![[chapter]]`. Standard Markdown images and Obsidian image embeds are supported.

PDF and DOCX presentation settings are stored separately from EPUB settings.

For PDF, choose **A4**, **A5** or **Custom** under **General → PDF paper size**. A5 is the default; custom width and height use millimetres. **General → PDF page layout** selects **Single page** or **Facing pages**. **PDF → Page** groups margins in two columns: left/right for single pages, inner/outer for facing pages. Auto uses 20 mm. The binding margin adds extra space on the left in single-page mode and on the inner edge in facing-page mode; Auto adds 0 mm. Facing-page margins alternate between recto and verso. **PDF → Styles** and **PDF → Rules** use the same inspector as EPUB, with typography in points. Body text defaults to 11 pt, and PDF fonts can come from the shared OTF/TTF library. The bundled LaTeX template applies these settings without manual template editing. The PDF includes its title page, table of contents, footnotes and final colophon.

## Add a cover and your own fonts

Choose a cover image or let Bookbinder generate one from the title, author and subtitle, with an optional background image. The generated cover includes the book's length and date.

Use **Settings → Bookbinder → Fonts → Import fonts…** to choose OTF, TTF, WOFF or WOFF2 files from your computer. Bookbinder detects **Serif**, **Sans serif** or **Symbol** from the font’s OpenType metadata and imports recognized fonts directly. Only fonts with missing or ambiguous classification ask for a type. Fonts are saved in Bookbinder’s shared library, inside the plugin’s `data/_fonts/` folder, and appear directly in the style editor’s Font list with their type after the name. Auto stays first, followed by fonts used in the project’s styles, a separator and the remaining fonts. A font is used automatically when a style declares it, with no separate activation. Returning the last style that uses it to Auto removes it from the project’s export resources and keeps it available in the library. Only fonts declared in styles are embedded in the EPUB; importing fonts alone does not add them to a book. No system font installation is needed.

The built-in presentation works without custom fonts. You can also supply your own CSS when a project needs more control.

In Bookbinder’s general settings, **Fonts → Font package → Download and install** adds the optional [font collection](fonts/README.md) to the shared library. A single alphabetical catalogue includes packaged families and your personal fonts, with **Serif**, **Sans serif** or **Symbol** after each name. Packaged families keep their usage notes, licences and source links. Installation preserves existing fonts; choose a font directly in a project’s styles to use it. Font files and package notes are stored flat; installed package notes and licences have a `_package-` filename prefix.

## Local processing

Bookbinder assembles the manuscript locally, renders the automatic cover in Obsidian and runs Pandoc on your computer. It does not upload your manuscript to a conversion service.

The desktop plugin accesses project resources and export destinations through the filesystem, including folders you select outside the vault. It launches local executables to check Pandoc and LaTeX versions and uses Pandoc for conversion. These operations require filesystem and process access; commands run directly, without a system shell.

Opening the settings contacts GitHub and the official TeX sites to check published tool versions. Installer links open only when clicked. The optional font package downloads from GitHub when you click its installation button. Custom fonts and images otherwise come from the files you choose.

## Documentation and support

- [Example project](bookbinder.example.md): editable book properties and presentation settings.
- [Configuration and development](docs/development.md): custom CSS, Markdown syntax, project settings, builds and releases.
- [Code licence](LICENSE).

For a bug or an idea, [open an issue](https://github.com/tcrouzet/bookbinder/issues) with your Obsidian version, operating system and a short example when possible.

# Bookbinder

**Turn your Obsidian notes into a book.**

A manuscript can live in a single note or across a whole folder of chapters. Bookbinder brings them together into an EPUB, with your title, cover, fonts and typography. Keep writing in Markdown and shape the book from inside Obsidian.

[Download Bookbinder](https://github.com/tcrouzet/bookbinder/releases) · [Report a problem](https://github.com/tcrouzet/bookbinder/issues)

Bookbinder is in early development. **EPUB export is available. PDF and DOCX export are still in development.** The interface currently uses French labels.

## Install Bookbinder

1. Download `main.js`, `manifest.json` and `styles.css` from a Bookbinder release.
2. Place the files in a `bookbinder` folder inside your vault's `.obsidian/plugins/` folder.
3. Reload Obsidian and enable **Bookbinder** in **Settings → Community plugins**.

Obsidian **1.14.0 or later** on a desktop computer is required. Bookbinder is free and open source.

Open **Settings → Bookbinder** to check Pandoc. Bookbinder detects installed versions, checks for updates and offers the installer for your system when one is needed. On macOS and Windows, installation uses a graphical installer; Homebrew is not required.

EPUB export needs **Pandoc 3.1.1 or later**. Python and LaTeX are not required for EPUB. The settings also check LaTeX in preparation for PDF export and link to the appropriate official download page. Downloads start only when you choose them; you complete installation with the system's installer.

## Turn notes into a book

Right-click a Markdown file or a folder in the vault's file explorer and choose **Book to ePub**.

- A file becomes a book on its own.
- A folder brings together Markdown files from its whole hierarchy, sorted by path. Number chapter filenames when you want to set their order.

The assembly happens in memory. Your source notes stay intact, and Bookbinder creates no merged Markdown file. Footnotes and relative image paths stay attached to their source chapters.

The EPUB is saved beside the source file, or inside the selected source folder. To choose another destination anywhere on your computer, use **Dossier de génération → Parcourir…** in Bookbinder's settings. The reset button restores the default destination.

EPUB files stand out in the explorer with your theme's accent colour. Open one and choose **Lire l'EPUB** to launch your computer's reading app. If an export fails, Bookbinder keeps the last successfully generated EPUB.

## Give each book its own project

Open **Settings → Bookbinder → Créer/Ouvrir projet** and choose your manuscript folder.

Set the title, author, language and other book details, then save. The same button opens an existing project. You can export without creating one: Bookbinder uses the file or folder name as the title and the default presentation. The default book language is French; choose another language in the project settings.

Each project lives in a **`bookbinder.md`** note beside the manuscript. It contains editable YAML properties and a link that opens the visual editor. You can keep your own notes below the properties. The project note is highlighted in the explorer and excluded from the exported book, including when it sits in a subfolder.

Project settings, fonts and images can travel with the manuscript folder. Bookbinder preserves additional properties and your project notes when saving, and stops if the project file has been changed elsewhere while the editor is open.

## Shape the typography

The resizable project window starts with general book details, followed by separate **PDF**, **DOCX** and **ePub** tabs. For EPUB, **Page**, **Styles** and **Règles** let you work on the book's presentation without writing CSS.

- **Page** sets the top, bottom, left and right page margins.
- **Styles** controls body text, headings, quotations, footnotes, lists, tables and other Markdown elements. A compact inspector groups character, paragraph and flow settings, with bold, italic and alignment buttons and a live preview.
- **Règles** controls paragraphs following chapter headings and the opening drop cap. These contextual rules are separate from the Markdown styles.

EPUB sizes, spacing, paragraph margins and first-line indents use **em**, so the presentation can adapt to the reader's text size. **Auto** keeps the template's defaults; clearing a number restores Auto. The reading app can still apply its own layout preferences.

Small caps, subscripts, superscripts and explicitly marked tabulated blocks are supported. Ordinary code blocks keep their literal content. Bookbinder works with Markdown and Pandoc syntax; it does not apply Folder Fusion's special formatting markers or expand embedded notes such as `![[chapter]]`. Standard Markdown images and Obsidian image embeds are supported.

PDF and DOCX presentation settings are stored separately, ready for their future exporters. They do not change the EPUB's settings.

## Add a cover and your own fonts

Choose a cover image or let Bookbinder generate one from the title, author and subtitle, with an optional background image. The generated cover includes the book's length and date.

Use **Importer des polices…** to choose OTF, TTF, WOFF or WOFF2 files from your computer. They become available in the style editor and are copied into the project's `fonts/` folder when you save. They are embedded in the EPUB, with no system font installation needed. Removing a font from the project leaves its file on disk.

The built-in presentation works without custom fonts. You can also supply your own CSS when a project needs more control.

## Local processing

Bookbinder assembles the manuscript locally, renders the automatic cover in Obsidian and runs Pandoc on your computer. It does not upload your manuscript to a conversion service.

Opening the settings contacts GitHub and the official TeX sites to check published tool versions. Installer links open only when clicked. Custom fonts and images come from the files you choose.

## Documentation and support

- [Example project](bookbinder.example.md): editable book properties and presentation settings.
- [Configuration and development](docs/development.md): custom CSS, Markdown syntax, project compatibility, builds and releases.
- [Code licence](LICENSE).

For a bug or an idea, [open an issue](https://github.com/tcrouzet/bookbinder/issues) with your Obsidian version, operating system and a short example when possible.

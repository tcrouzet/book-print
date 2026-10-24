# book-print

Plugin Obsidian de production de livres avec Pandoc. L’export EPUB, l’édition visuelle de ses styles et la détection de Pandoc/XeLaTeX sont disponibles. Les exports PDF/DOCX et leur interface de mise en page restent à développer.

## Créer ou modifier un projet

Dans **Réglages → Book Print → Créer/Ouvrir projet**, choisir le dossier d’un livre. La fenêtre redimensionnable présente les onglets **Généralités · PDF · DOCX · ePub**. L’ePub contient **Page · Styles · Règles** ; PDF/DOCX conservent **Page · Styles**, avec des réglages indépendants. Elle charge `book-print.md` s’il existe, ou prépare un nouveau projet. **Enregistrer le projet** crée ou met à jour les propriétés YAML en tête de ce Markdown ; les paramètres supplémentaires et le texte placé après les propriétés sont conservés. Une modification du fichier par une autre application bloque son remplacement.

**Généralités** regroupe les métadonnées, la couverture, les polices et les options d’assemblage des fichiers. Le sommaire et les CSS existantes se trouvent dans **ePub**. **Page** définit séparément les marges haute, basse, gauche et droite : en **em pour l’ePub**, en millimètres pour PDF/DOCX. Le format d’un EPUB s’adapte à l’écran de la liseuse. Les réglages PDF et DOCX sont enregistrés sous `pdf` et `docx` ; leurs exports restent à développer et l’aperçu typographique est indicatif.

**Styles** présente un panneau compact organisé en **Caractère · Paragraphe · Enchaînement**, sous le choix du style. La catégorie reste sélectionnée lorsqu’on change de style. Les boutons à icônes Obsidian règlent le gras, l’italique et les alignements ; les unités apparaissent dans les champs, et l’aperçu rappelle le style sélectionné. En ePub, corps, interligne, marges, alinéa et espacement des caractères se règlent en **em**. La liste contient les éléments du Markdown : un seul **Texte courant**, titres 1 à 6, citations, notes de bas de page, listes, tableaux, code, emphases, texte barré, séparateurs, liens et images. Petites capitales, indices, exposants et tabulation restent disponibles. Le texte courant définit aussi la base typographique du livre ; sa taille est appliquée une seule fois.

**Règles** contient les traitements contextuels, séparés des styles : premier paragraphe après un titre 1 ou 2, et lettrine après un titre 2. Dans le modèle, le titre 2 ouvre une page et la première lettre du paragraphe suivant est mise en valeur. Les textes de couverture générés et les éléments techniques de ponctuation ne sont pas proposés comme styles Markdown.

Les réglages sont en **Auto** lorsqu’aucune valeur n’est imposée. Auto conserve les valeurs du modèle ; effacer un nombre rétablit Auto. Le gras et l’italique passent successivement par Auto, activé et désactivé. Les quatre marges du paragraphe sont distinctes de l’alinéa, qui règle le retrait de la première ligne. Les anciennes valeurs absolues de l’ePub sont converties en em à l’enregistrement, avec le modèle chargé. PDF/DOCX conservent des réglages typographiques en points. L’aperçu représente une page claire et ne modifie pas le manuscrit ; un style masqué à l’export reste visible dans l’éditeur pour pouvoir le régler.

**Importer des polices…** accepte OTF, TTF, WOFF et WOFF2 sur toute la machine. Elles deviennent disponibles dans la liste des polices ; leur copie dans `fonts/` a lieu à l’enregistrement. Aucun fichier n’est créé si la fenêtre est abandonnée. **Retirer** retire la police du projet et rétablit les styles concernés, sans supprimer son fichier. Les polices choisies sont incorporées dans l’EPUB sans installation dans le système.

Les EPUB et les notes `book-print.md` du vault apparaissent dans l’explorateur avec la couleur d’accentuation du thème. Un EPUB propose **Lire l’EPUB**, qui utilise l’application de lecture du système. `book-print.md` reste un Markdown ordinaire, éditable dans Obsidian. Son lien `[Modifier le projet](obsidian://book-print)` ouvre la même fenêtre de réglages. En lecture, le plugin résout ce lien vers le coffre et la note rendue ; sans ces paramètres, il utilise la note de projet active, notamment en aperçu dynamique. Le lien enregistré reste indépendant du chemin du projet et du nom du coffre, pour pouvoir copier ou déplacer le dossier.

## Export EPUB

Clic droit sur un Markdown ou un dossier → **Book to ePub**. L’export nécessite Pandoc 3.1.1 ou plus récent pour son [lecteur interne](https://pandoc.org/lua-filters.html#module-pandoc.json). Pour un dossier, les Markdown de toute la hiérarchie sont assemblés en mémoire, dans l’ordre des chemins comme Folder Fusion. Aucun fichier Markdown intermédiaire n’est créé. Chaque note conserve ses propres notes de bas de page et chemins d’images. Les ressources temporaires sont supprimées après conversion ; le dernier EPUB réussi est conservé si la conversion échoue.

Le plugin lit les propriétés YAML de `book-print.md` dans le dossier sélectionné ou dans celui du Markdown sélectionné. La note de projet est toujours exclue de la fusion et de l’EPUB, y compris dans les sous-dossiers. Sans configuration, le plugin utilise le nom du fichier/dossier comme titre, la langue française et la présentation par défaut avec les polices de remplacement de la liseuse. Les propriétés des chapitres ne remplacent pas la configuration du projet. Le nom de sortie est celui du fichier/dossier avec l’extension `.epub`, dans le dossier de génération configuré ou, par défaut, dans le dossier source.

Les propriétés peuvent aussi être écrites directement à partir de [book-print.example.md](book-print.example.md), à renommer `book-print.md`. Le YAML est délimité par deux lignes `---` au début du fichier ; les réglages imbriqués peuvent être modifiés en mode Source. `epub.page` contient les quatre marges de page (`margin-top`, `margin-bottom`, `margin-left`, `margin-right`). `epub.style` règle le texte courant ; `epub.headings.h1` à `h6` règlent les titres. `epub.styles` utilise les sélecteurs du catalogue Markdown, par exemple `"blockquote p"`, `".smallcaps"`, `"sub"` ou `"sup"`. `epub.rules` utilise `"h1 + p"`, `"h2 + p"` et `"h2 + p::first-letter"`. Les propriétés de style acceptées sont `font-family`, `font-size`, `line-height`, `text-align`, `text-indent` (alinéa), les quatre `margin-*`, `color`, `font-weight`, `font-style`, `letter-spacing`, `display` et `page-break-before`. Une propriété absente signifie Auto. L’ancien `epub.style.page-margin` reste lisible et est repris dans les quatre marges de page lors de l’ouverture dans l’interface.

Les anciennes règles stockées dans `epub.styles` sont reprises dans `epub.rules`. L’ancien style `body` est réuni avec le texte courant ; les autres styles étrangers au Markdown et les options de transformation Folder Fusion sont ignorés et retirés à l’enregistrement.

Un ancien `book-print.yml` reste lisible si `book-print.md` est absent. L’enregistrement depuis l’interface crée le Markdown avec son lien, en conservant l’ancien YAML intact. Si les deux fichiers existent, le Markdown est prioritaire ; une erreur dans ses propriétés bloque l’ouverture ou l’export au lieu de charger silencieusement l’ancienne configuration.

`cover` peut désigner une image existante. S’il est vide, Obsidian génère une couverture JPEG 1600 × 2400 : trame verticale, auteur, titre rouge, sous-titre et pied de page avec longueur et date, comme AutoCover. Le titre accepte `\n` pour les retours à la ligne. `cover-background` fournit une image de fond facultative. Python et LaTeX ne sont pas nécessaires pour l’EPUB.

Les chemins de `cover`, `cover-background`, `epub.css` et `epub.fonts` sont relatifs au fichier de projet. `epub.css` accepte un chemin ou une liste de CSS personnalisées qui remplacent la base intégrée. `epub.fonts` accepte une liste de fichiers de polices à embarquer. Pour utiliser les polices prévues par la CSS de base, placer `AdamantSansPro-Light.otf`, `AdamantSansPro-Bold.otf` et `Adamant.otf` dans un sous-dossier `fonts`, puis les lister sous `epub.fonts`. Elles ne sont pas distribuées avec le plugin.

La section `fusion` conserve uniquement les exclusions de fichiers et le séparateur Markdown entre notes. Les marqueurs Folder Fusion ne sont plus transformés : `@@`, `££`, `€€`, `--…--` et `\newpage` ne créent aucun style particulier. Les commentaires HTML et Obsidian `%%…%%` sont ignorés ; `~~…~~` est conservé comme texte barré Markdown. Les images Markdown et les images incorporées avec `![[image.png]]` sont prises en charge ; les inclusions de notes `![[note]]` ne sont pas développées.

Les syntaxes Pandoc `[texte]{.smallcaps}`, `H~2~O` et `m^2^` donnent les petites capitales, indices et exposants. Les blocs de code ordinaires restent des blocs de code, avec leur contenu littéral. Pour utiliser le style Tabulation, marquer explicitement un bloc :

````markdown
```{.tab}
    Une ligne tabulée
```
````

## Réglages

Dans **Réglages → Book Print**, la vérification démarre automatiquement. Les versions installées sont comparées aux versions publiées sur les sites officiels. Pour Pandoc, **Télécharger l’installateur** mène au `.pkg` sur Mac Intel ou Apple Silicon ou au `.msi` sur Windows 64 bits. Pour LaTeX, **Page officielle de téléchargement** ouvre le site de MacTeX, BasicTeX, MiKTeX ou TeX Live, où l’utilisateur choisit son installateur graphique. Homebrew n’est pas nécessaire.

Lorsqu’un moteur est à jour, le statut **À jour** s’affiche sans lien d’installation. **Enregistrer et vérifier** se trouve dans la section déroulante **Chemins personnalisés**. La détection automatique sélectionne la version la plus récente trouvée, même si une ancienne copie reste installée. Un chemin personnalisé conserve la priorité lorsqu’il est renseigné.

Le **Dossier de génération** utilise par défaut le dossier du fichier Markdown source. **Parcourir…** ouvre le sélecteur du système et permet de choisir un dossier sur toute la machine. Le choix est enregistré immédiatement ; l’icône de réinitialisation rétablit le dossier du Markdown source.

Pour TeX Live, la comparaison porte sur la version annuelle ; les mises à jour des composants sont distinguées et s’effectuent dans TeX Live Utility sur Mac ou dans le gestionnaire TeX Live sur Windows. MiKTeX utilise MiKTeX Console. Les versions locales restent affichées si la vérification en ligne échoue.

Le plugin fonctionne sur ordinateur. Python n’est pas nécessaire. Aucun moteur n’est téléchargé ou installé automatiquement : le téléchargement est déclenché par l’utilisateur, puis l’assistant du système réalise l’installation.

## Développement

Node.js 22.18 ou plus récent est nécessaire pour les contrôles TypeScript. Les utilisateurs du plugin n’ont pas à installer Node.js.

## Publier une release

Depuis la branche par défaut du dépôt, lancer `bash release.sh`. Node.js/npm, Git, GitHub CLI authentifié et `jq` sont nécessaires. La version Node utilisée par GitHub Actions est fixée dans `.nvmrc`, comme dans Finition.

Le script lance les tests, compile et vérifie les ressources embarquées, puis commite les changements en cours et pousse la branche. Il incrémente ensuite le patch du manifest, synchronise `package.json` et son verrou, met à jour `versions.json` si ce fichier existe, commite et pousse cette version. Il compare le manifest publié sur GitHub au fichier local avant de créer et pousser le tag numérique.

Le workflow `.github/workflows/release.yml` reprend les actions épinglées et l’attestation de Finition. Il vérifie les versions, exécute les tests, reconstruit deux fois le bundle pour contrôler sa reproductibilité, puis publie `main.js`, `manifest.json` et `styles.css` depuis le tag. Les ressources Lua, LaTeX et CSS sont déjà intégrées au bundle et ne nécessitent aucune release de données séparée.

`npm run test:release` contrôle le workflow et simule les opérations dans des dépôts Git locaux. Ce test utilise Ruby et sa bibliothèque YAML standard, sans paquet npm supplémentaire. ShellCheck est exécuté dans la CI. Aucune commande de publication réelle n’est lancée par ce test.

## Contrôles locaux

```bash
npm ci --ignore-scripts
npm test
npm run build
node scripts/check-resources.mjs
```

Les contrôles de processus utilisent des exécutables de test POSIX. La recherche des emplacements Windows est contrôlée sans exécuter de programme Windows.

`main.ts` charge `plugin/main.ts`. Les réglages sont dans `plugin/settings-tab.ts`, la détection dans `plugin/tools.ts`, la comparaison des versions dans `plugin/updates.ts` et les types dans `plugin/types.ts`. La compilation produit `main.js` à la racine ; Obsidian charge ce fichier avec `manifest.json` et `styles.css`.

Les ressources fournies sont dans `scripts/lua/` (filtres EPUB et PDF), `scripts/latex/A5.latex` (gabarit LaTeX) et `scripts/epub/base.css` (CSS). `scripts/resources.ts` les référence et esbuild embarque leur contenu comme texte dans `main.js`. Aucun téléchargement de filtres ou de modèles n’est nécessaire. Le contrôle `check-resources.mjs` vérifie le contenu du bundle après compilation.

Les modèles récupérés dans le dossier Pandoc sont conservés ; le filtre d’espaces fines protège les caractères XML et traite aussi l’espace fine insécable. La CSS conserve ses références aux polices prévues ; lors de l’export, les déclarations des polices absentes sont retirées de la copie temporaire.

`npm run test:epub` vérifie un EPUB réel avec Pandoc, une couverture rendue dans Chrome, les notes, images, fichiers XML, l’exclusion des notes de projet et la conservation de la sortie en cas d’échec. Ce contrôle nécessite Pandoc, Chrome, `/usr/bin/unzip` et `/usr/bin/xmllint` sur macOS ; `BOOK_PRINT_CHROME` permet de préciser le chemin de Chrome. Ces outils de contrôle ne sont pas des dépendances du plugin.

`npm run test:ui` vérifie les liens rendus des notes de projet, leur couleur, les onglets imbriqués par format, l’indépendance de leurs réglages, le catalogue Markdown et sa séparation des règles, les dimensions en em et la conversion des anciennes unités, le redimensionnement, les états Auto, le clavier, le thème sombre et le parcours police → projet enregistré → EPUB dans Chrome. Il utilise par défaut `/System/Library/Fonts/Supplemental/Times New Roman.ttf` ; `BOOK_PRINT_TEST_FONT` permet de choisir une autre police de contrôle. Les icônes natives, le protocole système `obsidian://`, les sélecteurs natifs et la fenêtre complète dans Obsidian ne sont pas exercés par ce contrôle.

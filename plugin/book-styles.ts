export interface BookStyle {
	selector: string;
	label: string;
	sample?: string;
	target?: string;
	pseudo?: string;
}

export const bookStyles: BookStyle[] = [
	{ selector: "p", label: "Texte courant" },
	...[1, 2, 3, 4, 5, 6].map(level => ({ selector: "h" + level, label: "Titre " + level })),
	{ selector: "blockquote p", label: "Citation", sample: "<blockquote><p>Une voix qui accompagne le récit.</p></blockquote>", target: "p" },
	{ selector: "section.footnotes p", label: "Note de bas de page", sample: "<section class='footnotes'><ol><li><p>Une note qui accompagne le récit.</p></li></ol></section>", target: "p" },
	{ selector: "ul", label: "Liste à puces", sample: "<ul><li>Un premier point</li><li>Un deuxième point</li></ul>" },
	{ selector: "ol", label: "Liste numérotée", sample: "<ol><li>Une première étape</li><li>Une deuxième étape</li></ol>" },
	{ selector: "li", label: "Élément de liste", sample: "<ul><li>Un élément de la liste.</li></ul>", target: "li" },
	{ selector: "table", label: "Tableau", sample: "<table><tr><th>Jour</th><th>Lieu</th></tr><tr><td>Lundi</td><td>La ville</td></tr></table>" },
	{ selector: "th", label: "En-tête de tableau", sample: "<table><tr><th>Un en-tête</th></tr></table>", target: "th" },
	{ selector: "td", label: "Cellule de tableau", sample: "<table><tr><td>Une cellule</td></tr></table>", target: "td" },
	{ selector: "pre", label: "Bloc de code", sample: "<pre><code>Texte littéral\n  avec indentation</code></pre>" },
	{ selector: "code", label: "Code en ligne", sample: "<code>une_expression</code>" },
	{ selector: "em", label: "Emphase", sample: "<em>Une emphase dans le texte.</em>" },
	{ selector: "strong", label: "Emphase forte", sample: "<strong>Un passage important.</strong>" },
	{ selector: "del", label: "Texte barré", sample: "<del>Un passage barré.</del>" },
	{ selector: ".smallcaps", label: "Petites capitales", sample: "<span class='smallcaps'>Petites capitales</span>" },
	{ selector: "sub", label: "Indice", sample: "<span>H<sub>2</sub>O</span>", target: "sub" },
	{ selector: "sup", label: "Exposant", sample: "<span>m<sup>2</sup></span>", target: "sup" },
	{ selector: "p.tab", label: "Tabulation", sample: "<p class='tab'>Une ligne\tavec tabulation.</p>" },
	{ selector: "hr", label: "Séparateur", sample: "<hr>" },
	{ selector: "a", label: "Lien", sample: "<a href='#'>Une référence à suivre</a>" },
	{ selector: "img", label: "Image", sample: "<img alt='Illustration'>" },
];

export const contextRules: BookStyle[] = [
	{ selector: "h1 + p", label: "Premier paragraphe après Titre 1", sample: "<section><h1>Une partie</h1><p>Le premier pas d’une nouvelle aventure.</p></section>", target: "p" },
	{ selector: "h2 + p", label: "Premier paragraphe après Titre 2", sample: "<section><h2>Un chapitre</h2><p>La porte s’ouvrit sur un jardin.</p></section>", target: "p" },
	{ selector: "h2 + p::first-letter", label: "Lettrine après Titre 2", sample: "<section><h2>Un nouveau départ</h2><p>Au commencement, il y eut un regard.</p></section>", target: "p", pseudo: "::first-letter" },
];

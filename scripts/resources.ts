import epubThinSpace from "./lua/epub-thin-space.lua";
import epubTab from "./lua/epub-tab.lua";
import latexFilter from "./lua/latex.lua";
import a5Latex from "./latex/A5.latex";
import baseCss from "./epub/base.css";
import bookReader from "./lua/book-reader.lua";

export const resources = {
	"lua/epub-thin-space.lua": epubThinSpace,
	"lua/epub-tab.lua": epubTab,
	"lua/latex.lua": latexFilter,
	"latex/A5.latex": a5Latex,
	"epub/base.css": baseCss,
	"lua/book-reader.lua": bookReader,
} as const;

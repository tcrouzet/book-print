import epubThinSpace from "./lua/epub-thin-space.lua";
import epubTab from "./lua/epub-tab.lua";
import pdfFilter from "./lua/pdf.lua";
import bookLatex from "./latex/book.latex";
import baseCss from "./epub/base.css";
import bookReader from "./lua/book-reader.lua";

export const resources = {
	"lua/epub-thin-space.lua": epubThinSpace,
	"lua/epub-tab.lua": epubTab,
	"lua/pdf.lua": pdfFilter,
	"latex/book.latex": bookLatex,
	"epub/base.css": baseCss,
	"lua/book-reader.lua": bookReader,
} as const;

local config, extra_styles, first_content, combined_styles, definitions
local function read(path) local file = assert(io.open(path, 'rb')); local bytes = file:read('*a'); file:close(); return bytes end
local function raw(text) return pandoc.RawBlock('openxml', text) end
local function escape(text) return text:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;') end
-- ECMA-376 CT_Settings is a sequence; preserve native settings while inserting ours in order.
local settings_order = {}
local names = [[writeProtection view zoom removePersonalInformation removeDateAndTime doNotDisplayPageBoundaries displayBackgroundShape
printPostScriptOverText printFractionalCharacterWidth printFormsData embedTrueTypeFonts embedSystemFonts saveSubsetFonts saveFormsData
mirrorMargins alignBordersAndEdges bordersDoNotSurroundHeader bordersDoNotSurroundFooter gutterAtTop hideSpellingErrors hideGrammaticalErrors
activeWritingStyle proofState formsDesign attachedTemplate linkStyles stylePaneFormatFilter stylePaneSortMethod documentType mailMerge revisionView
trackRevisions doNotTrackMoves doNotTrackFormatting documentProtection autoFormatOverride styleLockTheme styleLockQFSet defaultTabStop
autoHyphenation consecutiveHyphenLimit hyphenationZone doNotHyphenateCaps showEnvelope summaryLength clickAndTypeStyle defaultTableStyle
evenAndOddHeaders bookFoldRevPrinting bookFoldPrinting bookFoldPrintingSheets drawingGridHorizontalSpacing drawingGridVerticalSpacing
displayHorizontalDrawingGridEvery displayVerticalDrawingGridEvery doNotUseMarginsForDrawingGridOrigin drawingGridHorizontalOrigin
drawingGridVerticalOrigin doNotShadeFormData noPunctuationKerning characterSpacingControl printTwoOnOne strictFirstAndLastChars noLineBreaksAfter
noLineBreaksBefore savePreviewPicture doNotValidateAgainstSchema saveInvalidXml ignoreMixedContent alwaysShowPlaceholderText doNotDemarcateInvalidXml
saveXmlDataOnly useXSLTWhenSaving saveThroughXslt showXMLTags alwaysMergeEmptyNamespace updateFields hdrShapeDefaults footnotePr endnotePr compat
docVars rsids m:mathPr attachedSchema themeFontLang clrSchemeMapping doNotIncludeSubdocsInStats doNotAutoCompressPictures forceUpgrade captions
readModeInkLockDown smartTagType sl:schemaLibrary shapeDefaults doNotEmbedSmartTags decimalSymbol listSeparator]]
local rank = 0; for name in names:gmatch('%S+') do rank = rank + 1; settings_order[name:find(':') and name or 'w:' .. name] = rank end
local function insert_setting(xml, name, element)
  local depth, position = 0, nil
  for start, closing, tag, attributes in xml:gmatch('()<(/?)([%w:]+)([^>]*)>') do
    if closing == '/' then
      depth = depth - 1
      if depth == 0 then position = start; break end
    else
      if depth == 1 and settings_order[tag] and settings_order[tag] > settings_order['w:' .. name] then position = start; break end
      if not attributes:match('/%s*$') then depth = depth + 1 end
    end
  end
  assert(position, 'Missing DOCX settings root')
  return xml:sub(1, position - 1) .. element .. xml:sub(position)
end
local function page_break(mode)
  if mode == 'left' or mode == 'right' then
    return raw('<w:p><w:pPr><w:sectPr><w:type w:val="' .. (mode == 'left' and 'evenPage' or 'oddPage') .. '"/></w:sectPr></w:pPr></w:p>')
  end
  return raw('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
end
local walk
local function contextual(element)
  if element.attr then for index = #element.classes, 1, -1 do local definition = definitions[element.classes[index]]; if definition then return config.rules[definition.selector], definition end end end
end
local function combined(parent, style)
  if not parent then return style end
  local key = parent.id .. '/' .. style.id
  if not combined_styles[key] then
    local id = 'BookbinderInline' .. (#combined_styles + 1)
    combined_styles[#combined_styles + 1] = key
    combined_styles[key] = {id = id, hidden = parent.hidden or style.hidden}
    extra_styles = extra_styles .. '<w:style w:type="character" w:styleId="' .. id .. '"><w:name w:val="' .. id .. '"/><w:basedOn w:val="' .. parent.id .. '"/><w:rPr>' .. (style.run or '') .. '</w:rPr></w:style>'
  end
  return combined_styles[key]
end
local function paragraph_style(parent, style)
  if not parent then return style end
  local key = 'paragraph/' .. parent.id .. '/' .. style.id
  if not combined_styles[key] then
    local id = 'BookbinderParagraph' .. (#combined_styles + 1)
    combined_styles[#combined_styles + 1] = key
    combined_styles[key] = {id = id, hidden = parent.hidden or style.hidden, pageBreak = style.pageBreak}
    extra_styles = extra_styles .. '<w:style w:type="paragraph" w:styleId="' .. id .. '"><w:name w:val="' .. id .. '"/><w:basedOn w:val="' .. parent.id .. '"/><w:pPr>' .. (style.paragraph or '') .. '</w:pPr><w:rPr>' .. (style.run or '') .. '</w:rPr></w:style>'
  end
  return combined_styles[key]
end
local function inlines(content, inherited, inherited_rule, inherited_definition)
  local result = pandoc.Inlines({})
  for _, element in ipairs(content) do
    if element.t == 'Note' then element.content = walk(element.content, 'footnote'); result:insert(element)
    else
      local conditional, definition = contextual(element)
      if element.t == 'Span' and definition and definition.wrapper == 'span' then
        result:extend(inlines(element.content, inherited, conditional, definition))
      else
        local selector = ({Emph = 'em', Strong = 'strong', Strikeout = 'del', SmallCaps = '.smallcaps', Subscript = 'sub', Superscript = 'sup', Code = 'code', Link = 'a', Image = 'img'})[element.t]
        if element.t == 'Span' and element.classes:includes('smallcaps') then selector = '.smallcaps' end
        if inherited_definition and inherited_definition.paragraph == selector then conditional = inherited_rule end
        local style = selector and combined(inherited, conditional or config.styles[selector]) or inherited
        if not style or not style.hidden then
          if element.content then element.content = inlines(element.content, style) end
          if element.t == 'Emph' or element.t == 'Strong' or element.t == 'SmallCaps' or element.t == 'Subscript' or element.t == 'Superscript' or element.t == 'Span' and selector == '.smallcaps' then result:extend(element.content)
          else result:insert(style and (selector or not element.content) and pandoc.Span({element}, pandoc.Attr('', {}, {['custom-style'] = style.id})) or element) end
        end
      end
    end
  end
  return result
end
local function first_character(content, style)
  if not style then return content end
  local done = false
  return pandoc.Pandoc({pandoc.Plain(content)}):walk({traverse = 'topdown', Note = function(note) return note, false end, Str = function(str)
    if done or str.text == '' then return end
    done = true
    local stop = utf8.offset(str.text, 2) or (#str.text + 1)
    return {style.hidden and pandoc.Str('') or pandoc.Span({pandoc.Str(str.text:sub(1, stop - 1))}, pandoc.Attr('', {}, {['custom-style'] = style.id})), pandoc.Str(str.text:sub(stop))}
  end}).blocks[1].content
end
local selectors = {body = 'p', quote = 'blockquote p', footnote = 'section.footnotes p', tab = 'p.tab', colophon = '.bookbinder-colophon p', item = 'li', th = 'th', td = 'td', credit = '.bookbinder-credit', separator = 'hr'}
local rule_selectors = {body = '.bookbinder-after-heading-body + p', quote = 'blockquote .bookbinder-after-heading-quote + p', footnote = 'section.footnotes .bookbinder-after-heading-footnote + p', tab = '.bookbinder-after-heading-tab + p.tab'}
walk = function(blocks, kind, inherited, inherited_definition, container, continued)
  local result, pending, pending_definition = pandoc.Blocks({}), nil, nil
  for _, block in ipairs(blocks) do
    local marker = block.t == 'Div' and #block.content == 0 and block.classes[1] and block.classes[1]:match('^bookbinder%-after%-heading%-(.+)$')
    if marker then pending = marker; local _; _, pending_definition = contextual(block)
    else
      local conditional, definition = contextual(block)
      local own_definition = definition
      conditional, definition = conditional or inherited, definition or inherited_definition
      local function selected(selector)
        local style = definition and definition.paragraph == selector and conditional or config.styles[selector]
        return paragraph_style(container, style)
      end
      local heading_style = block.t == 'Header' and selected('h' .. block.level)
      local parity = heading_style and not heading_style.hidden and (heading_style.pageBreak == 'left' or heading_style.pageBreak == 'right')
      if block.attr and block.classes:includes('bookbinder-note-start') and not parity then result:insert(page_break(config.pageBreak)) end
      if block.t == 'Header' then
        first_content = false
        if block.classes:includes('bookbinder-colophon-boundary') then
          result:insert(page_break('page'))
          if config.toc then result:insert(raw('<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> TC "' .. escape(pandoc.utils.stringify(block.content)) .. '" \\f B \\l 1 </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>')) end
        elseif not heading_style.hidden then
          if parity then result:insert(page_break(heading_style.pageBreak)) end
          block.content = inlines(block.content)
          if definition then
            block.content = first_character(block.content, config.rules[definition.selector .. '::first-letter'])
            if conditional then block.content:insert(1, pandoc.RawInline('openxml', '<!--bookbinder-style:' .. heading_style.id .. '-->')) end
          end
          result:insert(block)
        end
      elseif block.t == 'Para' or block.t == 'Plain' then
        local style = kind == 'credit' and config.creditStyle or selected(selectors[kind] or 'p')
        local has_image = false
        block:walk({Image = function() has_image = true end})
        block.content = inlines(block.content)
        if pending and rule_selectors[pending] then
          local rule = rule_selectors[pending]
          block.content = first_character(block.content, pending_definition and config.rules[pending_definition.selector .. '::first-letter'] or config.rules[rule .. '::first-letter'])
          style = pending_definition and config.rules[pending_definition.selector] or config.rules[rule] or style
        end
        if definition then block.content = first_character(block.content, config.rules[definition.selector .. '::first-letter']) end
        pending, pending_definition = nil, nil
        if continued then
          local id = style.id .. 'Continued'
          if not combined_styles[id] then
            combined_styles[id] = true
            extra_styles = extra_styles .. '<w:style w:type="paragraph" w:styleId="' .. id .. '"><w:name w:val="' .. id .. '"/><w:basedOn w:val="' .. style.id .. '"/><w:pPr><w:spacing w:before="0"/></w:pPr></w:style>'
          end
          style = {id = id, hidden = style.hidden, pageBreak = style.pageBreak}
        end
        if not style.hidden and (style.pageBreak == 'left' or style.pageBreak == 'right') then result:insert(page_break(style.pageBreak)) end
        if first_content and kind ~= 'footnote' then
          extra_styles = extra_styles .. '<w:style w:type="paragraph" w:styleId="BookbinderStart"><w:name w:val="BookbinderStart"/><w:basedOn w:val="' .. style.id .. '"/><w:pPr><w:pageBreakBefore/></w:pPr></w:style>'
          if style.pageBreak ~= 'left' and style.pageBreak ~= 'right' then style = {id = 'BookbinderStart', hidden = style.hidden} end
          first_content = false
        end
        if has_image then
          local id = style.id .. 'Image'
          if not combined_styles[id] then
            combined_styles[id] = true
            extra_styles = extra_styles .. '<w:style w:type="paragraph" w:styleId="' .. id .. '"><w:name w:val="' .. id .. '"/><w:basedOn w:val="' .. style.id .. '"/><w:pPr><w:spacing w:line="0" w:lineRule="atLeast"/></w:pPr></w:style>'
          end
          style = {id = id, hidden = style.hidden}
        end
        if block.t == 'Plain' then block = pandoc.Para(block.content) end
        if not style.hidden then result:insert(pandoc.Div({block}, pandoc.Attr('', {}, {['custom-style'] = style.id}))) end
      elseif block.t == 'BlockQuote' then result:extend(walk(block.content, 'quote'))
      elseif block.t == 'CodeBlock' then
        local style = selected('pre')
        if not style.hidden then
          if style.pageBreak == 'left' or style.pageBreak == 'right' then result:insert(page_break(style.pageBreak)) end
          result:insert(raw('<!--bookbinder-code:' .. style.id .. '-->')); result:insert(block); result:insert(raw('<!--bookbinder-code-end-->'))
        end
      elseif block.t == 'Div' then
        if block.classes[1] and block.classes[1]:match('^bookbinder%-continued%-') then result:extend(walk(block.content, kind, conditional, definition, container, true))
        elseif own_definition and own_definition.wrapper then result:extend(walk(block.content, kind, conditional, definition, container, continued))
        else
          block.content = walk(block.content, block.classes:includes('bookbinder-tab') and 'tab' or block.classes:includes('bookbinder-credit') and 'credit' or block.classes:includes('bookbinder-colophon') and 'colophon' or block.classes:includes('bookbinder-separator') and 'separator' or kind, conditional, definition, container, continued)
          result:insert(block)
        end
      elseif block.t == 'HorizontalRule' then
        local style = selected('hr')
        if not style.hidden then
          if style.pageBreak == 'left' or style.pageBreak == 'right' then result:insert(page_break(style.pageBreak)) end
          result:insert(raw('<w:p><w:pPr><w:pStyle w:val="' .. style.id .. '"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="auto"/></w:pBdr></w:pPr></w:p>'))
        end
      elseif block.t == 'BulletList' or block.t == 'OrderedList' then
        local style = selected(block.t == 'BulletList' and 'ul' or 'ol')
        if not style.hidden then
          if conditional and (style.pageBreak == 'left' or style.pageBreak == 'right') then result:insert(page_break(style.pageBreak)) end
          for index, item in ipairs(block.content) do block.content[index] = walk(item, 'item', nil, nil, (conditional or style.characterFormatting) and style or container) end
          result:insert(block)
        end
      elseif block.t == 'Table' then
        local style = selected('table')
        local function rows(list, cell_kind) for _, row in ipairs(list) do for _, cell in ipairs(row.cells) do cell.contents = walk(cell.contents, cell_kind, nil, nil, (conditional or style.characterFormatting) and style or container) end end end
        rows(block.head.rows, 'th'); for _, body in ipairs(block.bodies) do rows(body.head, 'th'); rows(body.body, 'td') end; rows(block.foot.rows, 'td')
        if not style.hidden then
          if conditional and (style.pageBreak == 'left' or style.pageBreak == 'right') then result:insert(page_break(style.pageBreak)) end
          result:insert(block)
        end
      elseif block.t == 'Figure' then block.content = walk(block.content, kind); result:insert(block)
      else result:insert(block) end
    end
  end
  return result
end

function ByteStringWriter(document, options)
  local config_path = pandoc.utils.stringify(document.meta['bookbinder-config'])
  config = pandoc.json.decode(read(config_path))
  definitions = {}; for _, definition in ipairs(config.ruleDefinitions) do if definition.marker then definitions[definition.marker] = definition end end
  document.meta['bookbinder-config'] = nil
  extra_styles, first_content, combined_styles = '', true, {}
  document.blocks = walk(document.blocks, 'body')
  if config.cover then
    document.meta.title, document.meta.subtitle, document.meta.author, document.meta.date = nil, nil, nil, nil
    local width = '100%'
    if config.coverMaxHeight then
      local size = pandoc.image.size(read(config.cover))
      width = math.min(config.textWidth / 20, config.coverMaxHeight * size.width * size.dpi_vert / (size.height * size.dpi_horz)) .. 'pt'
    end
    document.blocks:insert(1, pandoc.Div({pandoc.Para({pandoc.Image({}, config.cover, '', pandoc.Attr('', {}, {width = width}))})}, pandoc.Attr('', {}, {['custom-style'] = 'BookbinderCover'})))
    extra_styles = extra_styles .. '<w:style w:type="paragraph" w:styleId="BookbinderCover"><w:name w:val="BookbinderCover"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="0" w:lineRule="atLeast"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr></w:style>'
  else document.meta.date = nil end
  local opts, reference_entries = pandoc.WriterOptions(options), {}
  local gutter = tonumber(config.section:match('w:gutter="(%d+)"'))
  local reference_section = config.section:gsub('w:left="(%d+)"', function(left) return 'w:left="' .. (tonumber(left) + gutter) .. '"' end):gsub('w:gutter="%d+"', 'w:gutter="0"')
  for _, entry in ipairs(pandoc.zip.Archive(pandoc.write(pandoc.Pandoc({}), 'docx', opts)).entries) do
    local content = entry:contents()
    if entry.path == 'word/document.xml' then content = content:gsub('<w:sectPr[^>]*>.-</w:sectPr>', function() return '<w:sectPr>' .. reference_section .. '</w:sectPr>' end) end
    reference_entries[#reference_entries + 1] = pandoc.zip.Entry(entry.path, content)
  end
  local reference_path = pandoc.path.join({pandoc.path.directory(config_path), 'reference.docx'})
  local reference_file = assert(io.open(reference_path, 'wb')); reference_file:write(pandoc.zip.Archive(reference_entries):bytestring()); reference_file:close()
  opts.reference_doc = reference_path; opts.table_of_contents = config.toc; opts.toc_depth = config.tocDepth
  local archive, parts = pandoc.zip.Archive(pandoc.write(document, 'docx', opts)), {}
  for _, entry in ipairs(archive.entries) do parts[entry.path] = entry:contents() end
  -- Native headings keep their bookmarks and TOC level while taking the conditional style.
  parts['word/document.xml'] = parts['word/document.xml']:gsub('<w:p[ >].-</w:p>', function(paragraph)
    local id = paragraph:match('<!%-%-bookbinder%-style:([%w]+)%-%->')
    if id then return paragraph:gsub('<w:pStyle[^>]*/>', '<w:pStyle w:val="' .. id .. '"/>', 1):gsub('<!%-%-bookbinder%-style:[%w]+%-%->', '') end
  end):gsub('<!%-%-bookbinder%-code:([%w]+)%-%->(.-)<!%-%-bookbinder%-code%-end%-%->', function(id, code)
    return code:gsub('<w:pStyle w:val="SourceCode"%s*/>', '<w:pStyle w:val="' .. id .. '"/>'):gsub('<w:rStyle w:val="VerbatimChar"%s*/>', '')
  end)
  -- Pandoc's default table grid can exceed the chosen paper's text width.
  parts['word/document.xml'] = parts['word/document.xml']:gsub('<w:tblGrid>(.-)</w:tblGrid>', function(grid)
    local total = 0; for width in grid:gmatch('w:w="(%d+)"') do total = total + tonumber(width) end
    if total > config.textWidth then grid = grid:gsub('w:w="(%d+)"', function(width) return 'w:w="' .. math.floor(tonumber(width) * config.textWidth / total) .. '"' end) end
    return '<w:tblGrid>' .. grid .. '</w:tblGrid>'
  end)
  if config.cover then
    local cover = ''
    parts['word/document.xml'] = parts['word/document.xml']:gsub('<w:p[ >].-</w:p>', function(paragraph)
      if paragraph:find('w:val="BookbinderCover"', 1, true) then cover = paragraph; return '' end
    end):gsub('<w:body>', function() return '<w:body>' .. cover end, 1)
  end
  local details = ''
  for _, key in ipairs({'bookbinder-copyright', 'bookbinder-character-count'}) do
    if document.meta[key] then
      details = details .. '<w:p><w:pPr><w:spacing w:before="120" w:after="0"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">' .. escape(pandoc.utils.stringify(document.meta[key])) .. '</w:t></w:r></w:p>'
    end
  end
  if details ~= '' then
    local position
    for start, paragraph in parts['word/document.xml']:gmatch('()(<w:p[ >].-</w:p>)') do
      local style = paragraph:match('<w:pStyle w:val="([^"]+)"')
      if style == 'BookbinderCover' or style == 'Title' or style == 'Subtitle' or style == 'Author' then position = start + #paragraph - 1 end
    end
    if position then parts['word/document.xml'] = parts['word/document.xml']:sub(1, position) .. details .. parts['word/document.xml']:sub(position + 1) end
  end
  local additions = config.styleXml .. config.creditStyle.xml .. extra_styles
  additions = additions .. '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="' .. config.styles['h1.title'].id .. '"/></w:style>'
  additions = additions .. '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/></w:style>'
  local replaced = {}; for id in additions:gmatch('w:styleId="([^"]+)"') do replaced[id] = true end
  parts['word/styles.xml'] = parts['word/styles.xml']:gsub('<w:style%s[^>]*w:styleId="([^"]+)"[^>]*>.-</w:style>', function(id)
    if replaced[id] then return '' end
    return nil
  end):gsub('</w:styles>', function() return additions .. '</w:styles>' end)
  local section = '<w:footerReference w:type="default" r:id="bookbinderFooterOdd"/><w:footerReference w:type="even" r:id="bookbinderFooterEven"/><w:footerReference w:type="first" r:id="bookbinderFooterFirst"/>' .. config.section
  -- A conditional break supersedes a note break at the same position.
  local count
  repeat
    parts['word/document.xml'], count = parts['word/document.xml']:gsub('(<w:p><w:pPr><w:sectPr>.-</w:sectPr></w:pPr></w:p>)%s*(<w:p><w:pPr><w:sectPr>.-</w:sectPr></w:pPr></w:p>)', '%2')
  until count == 0
  local section_index, pending_kind = 0, ''
  parts['word/document.xml'] = parts['word/document.xml']:gsub('<w:sectPr([^>]*)>(.-)</w:sectPr>', function(attributes, content)
    section_index = section_index + 1
    -- Section properties describe the section ending here, so breaks apply to the next one.
    local kind = pending_kind; pending_kind = content:match('<w:type[^>]*/>') or ''
    local properties = section_index == 1 and section or section:gsub('<w:titlePg/>', '')
    return '<w:sectPr' .. attributes .. '>' .. properties:gsub('<w:pgSz', function() return kind .. '<w:pgSz' end, 1) .. '</w:sectPr>'
  end):gsub('(<w:instrText[^>]*>)(.-)(</w:instrText>)', function(start, content, stop)
    return start .. (content:match('^%s*TOC') and content .. ' \\f B ' or content) .. stop
  end)
  local relationship_type = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
  local rels, content_types = '', ''
  for _, kind in ipairs({'Odd', 'Even', 'First'}) do
    local filename = 'bookbinder-footer-' .. kind .. '.xml'
    parts['word/' .. filename] = kind == 'Odd' and config.oddFooter or kind == 'Even' and config.evenFooter or '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
    rels = rels .. '<Relationship Id="bookbinderFooter' .. kind .. '" Type="' .. relationship_type .. 'footer" Target="' .. filename .. '"/>'
    content_types = content_types .. '<Override PartName="/word/' .. filename .. '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
  end
  parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels']:gsub('</Relationships>', function() return rels .. '</Relationships>' end)
  local font_rels = ''
  for _, font in ipairs(config.fonts) do
    parts['word/fonts/' .. font.file] = read(font.path)
    font_rels = font_rels .. '<Relationship Id="' .. font.id .. '" Type="' .. relationship_type .. 'font" Target="fonts/' .. font.file .. '"/>'
  end
  parts['word/_rels/fontTable.xml.rels'] = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' .. font_rels .. '</Relationships>'
  local font_table = parts['word/fontTable.xml']
  if not font_table:find('xmlns:r=') then font_table = font_table:gsub('<w:fonts', '<w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"', 1) end
  local embedded_names = {}; for name in config.fontTable:gmatch('<w:font w:name="([^"]+)"') do embedded_names[name] = true end
  font_table = font_table:gsub('<w:font%s[^>]*w:name="([^"]+)"[^>]*>.-</w:font>', function(name) if embedded_names[name] then return '' end end)
  parts['word/fontTable.xml'] = font_table:gsub('</w:fonts>', function() return config.fontTable .. '</w:fonts>' end)
  if not parts['[Content_Types].xml']:match('<Default%s[^>]*Extension="odttf"') then content_types = content_types .. '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>' end
  parts['[Content_Types].xml'] = parts['[Content_Types].xml']:gsub('</Types>', function() return content_types .. '</Types>' end)
  local settings = parts['word/settings.xml']
  for name, element in pairs({evenAndOddHeaders = config.double and '<w:evenAndOddHeaders/>' or false, mirrorMargins = config.double and '<w:mirrorMargins/>' or false,
    autoHyphenation = '<w:autoHyphenation w:val="true"/>', updateFields = '<w:updateFields w:val="' .. (config.toc and 'true' or 'false') .. '"/>', embedTrueTypeFonts = '<w:embedTrueTypeFonts/>', saveSubsetFonts = '<w:saveSubsetFonts w:val="false"/>'}) do
    settings = settings:gsub('<w:' .. name .. '%f[%s/>][^>]*/>', '')
    if element then settings = insert_setting(settings, name, element) end
  end
  parts['word/settings.xml'] = settings
  local entries = {}; for name, content in pairs(parts) do entries[#entries + 1] = pandoc.zip.Entry(name, content) end
  table.sort(entries, function(a, b) return a.path < b.path end)
  return pandoc.zip.Archive(entries):bytestring()
end

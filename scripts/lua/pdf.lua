local config, definitions, no_folio_id

local function raw(text) return pandoc.RawBlock('latex', text) end
local function inline(text) return pandoc.RawInline('latex', text) end

local function code_font(style)
  return '\\let\\BookbinderCodeFont\\ttfamily\\def\\ttfamily{\\BookbinderCodeFont ' .. style.inline:gsub('\\ttfamily', '\\BookbinderCodeFont') .. '}\n'
end

local function wrap(block, selector, override, continued)
  local style = override or config.styles[selector]
  if not style then return {block} end
  if style.hidden then return {} end
  return {raw(continued and style.continuedBefore or style.before), block, raw(style.after)}
end

local function contextual(element)
  if element.attr then for index = #element.classes, 1, -1 do local definition = definitions[element.classes[index]]; if definition then return config.rules[definition.selector], definition end end end
end

local function first_character(content, style)
  if not style then return content end
  local done = false
  return pandoc.Pandoc({pandoc.Plain(content)}):walk({traverse = 'topdown', Note = function(note) return note, false end, Str = function(str)
    if done or str.text == '' then return end
    done = true
    local stop = utf8.offset(str.text, 2) or (#str.text + 1)
    if style.hidden then return pandoc.Str(str.text:sub(stop)) end
    return {inline('{' .. style.inline), pandoc.Str(str.text:sub(1, stop - 1)), inline('}'), pandoc.Str(str.text:sub(stop))}
  end}).blocks[1].content
end

local walk
local selectors = {body = 'p', quote = 'blockquote p', footnote = 'section.footnotes p', tab = 'p.tab', colophon = '.bookbinder-colophon p', item = 'li', th = 'th', td = 'td'}
local rule_selectors = {
  body = '.bookbinder-after-heading-body + p', quote = 'blockquote .bookbinder-after-heading-quote + p',
  footnote = 'section.footnotes .bookbinder-after-heading-footnote + p', tab = '.bookbinder-after-heading-tab + p.tab'
}

local function inlines(content, inherited, inherited_definition)
  return pandoc.Pandoc({pandoc.Plain(content)}):walk({
    traverse = 'topdown',
    Note = function(note) note.content = walk(note.content, 'footnote'); return note, false end,
    Inline = function(element)
      local conditional, definition = contextual(element)
      if element.t == 'Span' and definition and definition.wrapper == 'span' then return inlines(element.content, conditional, definition), false end
      local selector = ({Emph = 'em', Strong = 'strong', Strikeout = 'del', SmallCaps = '.smallcaps', Subscript = 'sub', Superscript = 'sup', Code = 'code', Link = 'a', Image = 'img'})[element.t]
      if element.t == 'Span' and element.classes:includes('smallcaps') then selector = '.smallcaps'; element = pandoc.SmallCaps(element.content) end
      if not selector then return end
      if inherited_definition and inherited_definition.paragraph == selector then conditional = inherited end
      local style = conditional or config.styles[selector]
      if style.hidden then return {} end
      if element.content then element.content = inlines(element.content) end
      local overrides = conditional and conditional.overrides or config.overrides[selector]
      if element.t == 'Emph' and overrides and overrides['font-style'] then element = pandoc.Span(element.content) end
      if element.t == 'Strong' and overrides and overrides['font-weight'] then element = pandoc.Span(element.content) end
      if element.t == 'Link' then element.content:insert(1, inline('\\uline{')); element.content:insert(inline('}')) end
      if element.t == 'Subscript' or element.t == 'Superscript' then
        element.content:insert(1, inline('{' .. style.inline)); element.content:insert(inline('}'))
        return element, false
      end
      return {inline('{' .. (element.t == 'Code' and code_font(style) or '') .. style.inline), element, inline('}')}, false
    end
  }).blocks[1].content
end

local function page_break(mode)
  if mode == 'left' then return '\\BookbinderEvenPage\n' end
  if mode == 'right' then return '\\BookbinderOddPage\n' end
  return '\\clearpage\n'
end

walk = function(blocks, kind, inherited, inherited_definition, continued)
  local result, pending, pending_definition = pandoc.Blocks({}), nil, nil
  for _, block in ipairs(blocks) do
    local marker = block.t == 'Div' and #block.content == 0 and block.classes[1] and block.classes[1]:match('^bookbinder%-after%-heading%-(.+)$')
    if marker then
      pending = marker
      local _; _, pending_definition = contextual(block)
    else
      local conditional, definition = contextual(block)
      local own_definition = definition
      conditional, definition = conditional or inherited, definition or inherited_definition
      local function selected(selector) return definition and definition.paragraph == selector and conditional or config.styles[selector] end
      if block.attr and block.classes:includes('bookbinder-note-start') then result:insert(raw(page_break(config.pageBreak))) end
      local output
      if block.t == 'Header' then
        if block.classes:includes('bookbinder-colophon-boundary') then
          local title = pandoc.write(pandoc.Pandoc({pandoc.Plain(block.content)}), 'latex')
          result:insert(raw(config.colophon.before .. '\\phantomsection\\addcontentsline{toc}{chapter}{' .. title .. '}'))
          output = {}
        else
          local title = pandoc.write(pandoc.Pandoc({pandoc.Plain(block.content)}), 'latex')
          local level = ({'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'})[block.level]
          local anchor = pandoc.write(pandoc.Pandoc({pandoc.Div({}, pandoc.Attr(block.identifier))}), 'latex')
          local content = inlines(block.content)
          if definition then content = first_character(content, config.rules[definition.selector .. '::first-letter']) end
          local style = selected('h' .. block.level)
          if style.folio == false then
            no_folio_id = no_folio_id + 1
            content:insert(1, inline('\\leavevmode\\marks\\BookbinderNoFolioMark{' .. no_folio_id .. '}'))
          end
          output = wrap(pandoc.Plain(content), 'h' .. block.level, style)
          if #output > 0 then table.insert(output, 2, raw(anchor .. '\\phantomsection\\addcontentsline{toc}{' .. level .. '}{' .. title .. '}')) end
        end
      elseif block.t == 'Para' or block.t == 'Plain' then
        local selector = selectors[kind] or 'p'
        local style = selected(selector)
        block.content = inlines(block.content)
        if pending and rule_selectors[pending] then
          local rule = rule_selectors[pending]
          block.content = first_character(block.content, pending_definition and config.rules[pending_definition.selector .. '::first-letter'] or config.rules[rule .. '::first-letter'])
          style = pending_definition and config.rules[pending_definition.selector] or config.rules[rule] or style
        end
        if definition then block.content = first_character(block.content, config.rules[definition.selector .. '::first-letter']) end
        pending, pending_definition = nil, nil
        if kind == 'footnote' then
          if style.hidden then output = {}
          else
            local before = style.continuedBefore or style.before
            -- The note label opens the line; a strut puts top space above it instead of below it.
            if not continued and style.marginTop and style.marginTop ~= 0 then before = before .. '\\rule{0pt}{\\dimexpr\\ht\\strutbox+' .. style.marginTop .. 'pt\\relax}' end
            block.content:insert(1, inline(before:gsub('\\par\\begingroup', '\\begingroup')))
            block.content:insert(inline(style.after))
            output = {block}
          end
        else output = wrap(block, selector, style, continued) end
      elseif block.t == 'BlockQuote' then
        output = walk(block.content, 'quote')
      elseif block.t == 'CodeBlock' then
        local style = selected('pre')
        output = wrap(block, 'pre', {before = style.before .. code_font(style), after = style.after, hidden = style.hidden})
      elseif block.t == 'Div' then
        if block.classes[1] and block.classes[1]:match('^bookbinder%-continued%-') then
          output = walk(block.content, kind, conditional, definition, true)
        elseif own_definition and own_definition.wrapper then
          output = walk(block.content, kind, conditional, definition, continued)
        elseif block.classes:includes('bookbinder-credit') then
          block = block:walk({Para = function(paragraph) paragraph.content = inlines(paragraph.content); return paragraph end})
          output = {raw(continued and config.credit.continuedBefore or config.credit.before), block, raw(config.credit.after)}
        elseif block.classes:includes('bookbinder-colophon') then
          output = walk(block.content, 'colophon', conditional, definition, config.colophon.positioned and #block.content == 1)
          output:insert(raw(config.colophon.after))
        elseif block.classes:includes('bookbinder-separator') then
          output = wrap(pandoc.Para(inlines(pandoc.utils.blocks_to_inlines(block.content))), 'hr', selected('hr'))
        else
          block.content = walk(block.content, block.classes:includes('bookbinder-tab') and 'tab' or block.classes:includes('bookbinder-colophon') and 'colophon' or kind, conditional, definition, continued)
          output = {block}
        end
      elseif block.t == 'BulletList' or block.t == 'OrderedList' then
        for index, item in ipairs(block.content) do block.content[index] = walk(item, 'item') end
        local selector = block.t == 'BulletList' and 'ul' or 'ol'
        output = wrap(block, selector, selected(selector))
      elseif block.t == 'HorizontalRule' then output = wrap(block, 'hr', selected('hr'))
      elseif block.t == 'Table' then
        local function rows(rows, cell_kind)
          for _, row in ipairs(rows) do for _, cell in ipairs(row.cells) do cell.contents = walk(cell.contents, cell_kind) end end
        end
        rows(block.head.rows, 'th')
        for _, body in ipairs(block.bodies) do rows(body.head, 'th'); rows(body.body, 'td') end
        rows(block.foot.rows, 'td')
        output = wrap(block, 'table', selected('table'))
      elseif block.t == 'Figure' then block.content = walk(block.content, kind); output = {block}
      else output = {block} end
      result:extend(output)
    end
  end
  return result
end

function Pandoc(document)
  local file = assert(io.open(pandoc.utils.stringify(document.meta['bookbinder-config']), 'rb'))
  config = pandoc.json.decode(file:read('*a')); file:close()
  definitions = {}; for _, definition in ipairs(config.ruleDefinitions) do if definition.marker then definitions[definition.marker] = definition end end
  document.meta['bookbinder-config'] = nil
  no_folio_id = 0
  document.blocks = walk(document.blocks, 'body')
  return document
end

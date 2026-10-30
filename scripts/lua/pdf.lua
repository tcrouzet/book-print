local config, definitions, no_folio_id

local function raw(text) return pandoc.RawBlock('latex', text) end
local function inline(text) return pandoc.RawInline('latex', text) end

local function character_values(parent, style)
  local result = {}; for key, value in pairs(parent or {}) do result[key] = value end
  for key, value in pairs(style and style.characters or {}) do result[key] = value end
  return result
end

local function characters(element, values)
  -- Lua's locale-dependent whitespace classes can split UTF-8 bytes inside accented letters.
  if element.t == 'Str' and element.text:find('[ \t\r\n\f\v]') then
    local result = pandoc.Inlines({})
    for word, spaces in element.text:gmatch('([^ \t\r\n\f\v]+)([ \t\r\n\f\v]*)') do
      result:extend(characters(pandoc.Str(word), values))
      if spaces ~= '' then result:insert(pandoc.Space()) end
    end
    return result
  end
  local prefix, suffix = '', ''
  if values and values['text-transform'] == 'uppercase' then prefix, suffix = '\\MakeUppercase{', '}' end
  if values and (values['vertical-align'] == 'super' or values['vertical-align'] == 'sub') then
    prefix = prefix .. (values['vertical-align'] == 'super' and '\\textsuperscript{' or '\\textsubscript{'); suffix = suffix .. '}'
  end
  if prefix == '' then return {element} end
  return {inline(prefix), element, inline(suffix)}
end

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

local walk
local selectors = {body = 'p', quote = 'blockquote p', footnote = 'section.footnotes p', tab = 'p.tab', colophon = '.bookbinder-colophon p', item = 'li', th = 'th', td = 'td'}
local rule_selectors = {
  body = '.bookbinder-after-heading-body + p', quote = 'blockquote .bookbinder-after-heading-quote + p',
  footnote = 'section.footnotes .bookbinder-after-heading-footnote + p', tab = '.bookbinder-after-heading-tab + p.tab'
}

local function inlines(content, inherited, inherited_definition, formatting, initial)
  return pandoc.Pandoc({pandoc.Plain(content)}):walk({
    traverse = 'topdown',
    Note = function(note) note.content = walk(note.content, 'footnote'); return note, false end,
    Inline = function(element)
      if element.t == 'Str' then
        if initial and initial.style and not initial.done and element.text ~= '' then
          initial.done = true
          local style, stop = initial.style, utf8.offset(element.text, 2) or (#element.text + 1)
          local result = pandoc.Inlines({})
          if not style.hidden then
            result:insert(inline('{' .. style.inline)); result:extend(characters(pandoc.Str(element.text:sub(1, stop - 1)), character_values(formatting, style))); result:insert(inline('}'))
          end
          if stop <= #element.text then result:extend(characters(pandoc.Str(element.text:sub(stop)), formatting)) end
          return result, false
        end
        return characters(element, formatting), false
      end
      local conditional, definition = contextual(element)
      if element.t == 'Span' and definition and definition.wrapper == 'span' then return inlines(element.content, conditional, definition, formatting, initial), false end
      local selector = ({Emph = 'em', Strong = 'strong', Strikeout = 'del', SmallCaps = '.smallcaps', Subscript = 'sub', Superscript = 'sup', Code = 'code', Link = 'a', Image = 'img'})[element.t]
      if element.t == 'Span' and element.classes:includes('smallcaps') then selector = '.smallcaps'; element = pandoc.SmallCaps(element.content) end
      if not selector then return end
      if inherited_definition and inherited_definition.paragraph == selector then conditional = inherited end
      local style = conditional or config.styles[selector]
      if style.hidden then return {} end
      local overrides = conditional and conditional.overrides or config.overrides[selector]
      local values = character_values(formatting, style)
      if (element.t == 'Subscript' or element.t == 'Superscript') and not (overrides and overrides['vertical-align']) then values['vertical-align'] = 'baseline' end
      if element.content then element.content = inlines(element.content, nil, nil, values, initial) end
      if element.t == 'Emph' and overrides and overrides['font-style'] then element = pandoc.Span(element.content) end
      if element.t == 'Strong' and overrides and overrides['font-weight'] then element = pandoc.Span(element.content) end
      if (element.t == 'SmallCaps' or element.t == 'Span' and selector == '.smallcaps') and overrides and overrides['font-variant'] then element = pandoc.Span(element.content) end
      if (element.t == 'Subscript' or element.t == 'Superscript') and overrides and overrides['vertical-align'] then element = pandoc.Span(element.content) end
      if element.t == 'Link' then element.content:insert(1, inline('\\uline{')); element.content:insert(inline('}')) end
      if element.t == 'Subscript' or element.t == 'Superscript' then
        element.content:insert(1, inline('{' .. style.inline)); element.content:insert(inline('}'))
        return element, false
      end
      local result = pandoc.Inlines({inline('{' .. (element.t == 'Code' and code_font(style) or '') .. style.inline)})
      result:extend(element.t == 'Code' and characters(element, values) or {element}); result:insert(inline('}'))
      return result, false
    end
  }).blocks[1].content
end

local function page_break(mode)
  if mode == 'left' then return '\\BookbinderEvenPage\n' end
  if mode == 'right' then return '\\BookbinderOddPage\n' end
  return '\\clearpage\n'
end

walk = function(blocks, kind, inherited, inherited_definition, continued, formatting)
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
        -- Avoid expanding footnotes inside LaTeX's moving contents argument.
        local title = pandoc.write(pandoc.Pandoc({pandoc.Plain(block.content)}):walk({Note = function() return {} end}), 'latex')
        if block.classes:includes('bookbinder-colophon-boundary') then
          result:insert(raw(config.colophon.before .. '\\phantomsection\\addcontentsline{toc}{chapter}{' .. title .. '}'))
          output = {}
        else
          local level = ({'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'})[block.level]
          local anchor = pandoc.write(pandoc.Pandoc({pandoc.Div({}, pandoc.Attr(block.identifier))}), 'latex')
          local style = selected('h' .. block.level)
          local content = inlines(block.content, nil, nil, character_values(formatting, style), {style = definition and config.rules[definition.selector .. '::first-letter']})
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
        local initial
        if pending and rule_selectors[pending] then
          local rule = rule_selectors[pending]
          initial = pending_definition and config.rules[pending_definition.selector .. '::first-letter'] or config.rules[rule .. '::first-letter']
          style = pending_definition and config.rules[pending_definition.selector] or config.rules[rule] or style
        end
        if definition then initial = config.rules[definition.selector .. '::first-letter'] or initial end
        block.content = inlines(block.content, nil, nil, character_values(formatting, style), {style = initial})
        pending, pending_definition = nil, nil
        if kind == 'footnote' or kind == 'figure' then
          if style.hidden then output = {}
          else
            local before = style.continuedBefore or style.before
            -- The note label opens the line; a strut puts top space above it instead of below it.
            if kind == 'footnote' and not continued and style.marginTop and style.marginTop ~= 0 then before = before .. '\\rule{0pt}{\\dimexpr\\ht\\strutbox+' .. style.marginTop .. 'pt\\relax}' end
            block.content:insert(1, inline(before:gsub('\\par\\begingroup', '\\begingroup')))
            block.content:insert(inline(style.after))
            output = {block}
          end
        else output = wrap(block, selector, style, continued) end
      elseif block.t == 'BlockQuote' then
        output = walk(block.content, 'quote', nil, nil, nil, formatting)
      elseif block.t == 'CodeBlock' then
        local style = selected('pre')
        local values = character_values(formatting, style)
        if values['text-transform'] == 'uppercase' or values['vertical-align'] == 'super' or values['vertical-align'] == 'sub' then
          local content = pandoc.Inlines({})
          for line in (block.text .. '\n'):gmatch('(.-)\n') do
            if #content > 0 then content:insert(pandoc.LineBreak()) end
            content:insert(pandoc.Code(line))
          end
          block = pandoc.Plain(inlines(content, nil, nil, values))
        end
        output = wrap(block, 'pre', {before = style.before .. code_font(style), after = style.after, hidden = style.hidden})
      elseif block.t == 'Div' then
        if block.classes[1] and block.classes[1]:match('^bookbinder%-continued%-') then
          output = walk(block.content, kind, conditional, definition, true, formatting)
        elseif own_definition and own_definition.wrapper then
          output = walk(block.content, kind, conditional, definition, continued, formatting)
        elseif block.classes:includes('bookbinder-credit') then
          block = block:walk({Para = function(paragraph) paragraph.content = inlines(paragraph.content); return paragraph end})
          output = {raw(continued and config.credit.continuedBefore or config.credit.before), block, raw(config.credit.after)}
        elseif block.classes:includes('bookbinder-colophon') then
          output = walk(block.content, 'colophon', conditional, definition, config.colophon.positioned and #block.content == 1, formatting)
          output:insert(raw(config.colophon.after))
        elseif block.classes:includes('bookbinder-separator') then
          local style = selected('hr')
          output = wrap(pandoc.Para(inlines(pandoc.utils.blocks_to_inlines(block.content), nil, nil, character_values(formatting, style))), 'hr', style)
        else
          block.content = walk(block.content, block.classes:includes('bookbinder-tab') and 'tab' or block.classes:includes('bookbinder-colophon') and 'colophon' or kind, conditional, definition, continued, formatting)
          output = {block}
        end
      elseif block.t == 'BulletList' or block.t == 'OrderedList' then
        local selector = block.t == 'BulletList' and 'ul' or 'ol'
        for index, item in ipairs(block.content) do block.content[index] = walk(item, 'item', nil, nil, nil, character_values(formatting, selected(selector))) end
        output = wrap(block, selector, selected(selector))
      elseif block.t == 'HorizontalRule' then output = wrap(block, 'hr', selected('hr'))
      elseif block.t == 'Table' then
        local function rows(rows, cell_kind)
          for _, row in ipairs(rows) do for _, cell in ipairs(row.cells) do cell.contents = walk(cell.contents, cell_kind, nil, nil, nil, character_values(formatting, selected('table'))) end end
        end
        rows(block.head.rows, 'th')
        for _, body in ipairs(block.bodies) do rows(body.head, 'th'); rows(body.body, 'td') end
        rows(block.foot.rows, 'td')
        output = wrap(block, 'table', selected('table'))
      elseif block.t == 'Figure' then block.content = walk(block.content, 'figure', nil, nil, nil, formatting); output = {block}
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
  -- Keep note paragraphs outside inline formatting commands with short arguments.
  document = document:walk({Inline = function(element)
    if not element.content or element.t == 'Note' or element.t == 'Image' then return end
    local has_note = false
    for _, child in ipairs(element.content) do if child.t == 'Note' then has_note = true end end
    if not has_note then return end
    local result, chunk = pandoc.Inlines({}), pandoc.Inlines({})
    local function flush()
      if #chunk > 0 then local copy = element:clone(); copy.content = chunk; result:insert(copy); chunk = pandoc.Inlines({}) end
    end
    for _, child in ipairs(element.content) do
      if child.t == 'Note' then flush(); result:insert(child) else chunk:insert(child) end
    end
    flush()
    return result
  end})
  no_folio_id = 0
  local formatting = {['text-transform'] = config.styles.p.characters['text-transform']}
  document.blocks = walk(document.blocks, 'body', nil, nil, nil, formatting)
  if document.meta.title then
    local title = document.meta.title
    if pandoc.utils.type(title) ~= 'Inlines' then title = pandoc.Inlines({pandoc.Str(pandoc.utils.stringify(title))}) end
    document.meta.title = pandoc.MetaInlines(inlines(title, nil, nil, character_values(formatting, config.styles['h1.title'])))
  end
  return document
end

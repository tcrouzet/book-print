local config

local function raw(text) return pandoc.RawBlock('latex', text) end
local function inline(text) return pandoc.RawInline('latex', text) end

local function code_font(style)
  return '\\let\\BookbinderCodeFont\\ttfamily\\def\\ttfamily{\\BookbinderCodeFont ' .. style.inline:gsub('\\ttfamily', '\\BookbinderCodeFont') .. '}\n'
end

local function wrap(block, selector, override)
  local style = override or config.styles[selector]
  if not style then return {block} end
  if style.hidden then return {} end
  return {raw(style.before), block, raw(style.after)}
end

local function merge_style(base, rule)
  if not rule then return base end
  return {before = base.before .. rule.before, after = rule.after .. base.after, hidden = base.hidden or rule.hidden}
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

local function inlines(content)
  return pandoc.Pandoc({pandoc.Plain(content)}):walk({
    traverse = 'topdown',
    Note = function(note) note.content = walk(note.content, 'footnote'); return note, false end,
    Inline = function(element)
      local selector = ({Emph = 'em', Strong = 'strong', Strikeout = 'del', SmallCaps = '.smallcaps', Subscript = 'sub', Superscript = 'sup', Code = 'code', Link = 'a', Image = 'img'})[element.t]
      if element.t == 'Span' and element.classes:includes('smallcaps') then selector = '.smallcaps'; element = pandoc.SmallCaps(element.content) end
      if not selector then return end
      local style = config.styles[selector]
      if style.hidden then return {} end
      if element.content then element.content = inlines(element.content) end
      if element.t == 'Emph' and config.overrides.em and config.overrides.em['font-style'] then element = pandoc.Span(element.content) end
      if element.t == 'Strong' and config.overrides.strong and config.overrides.strong['font-weight'] then element = pandoc.Span(element.content) end
      if element.t == 'Link' then element.content:insert(1, inline('\\uline{')); element.content:insert(inline('}')) end
      return {inline('{' .. (element.t == 'Code' and code_font(style) or '') .. style.inline), element, inline('}')}, false
    end
  }).blocks[1].content
end

local function page_break(mode)
  if mode == 'left' then return '\\clearpage\\ifodd\\value{page}\\null\\thispagestyle{empty}\\newpage\\fi\n' end
  if mode == 'right' then return '\\clearpage\\ifodd\\value{page}\\else\\null\\thispagestyle{empty}\\newpage\\fi\n' end
  return '\\clearpage\n'
end

walk = function(blocks, kind)
  local result, pending = pandoc.Blocks({}), nil
  for _, block in ipairs(blocks) do
    local marker = block.t == 'Div' and #block.content == 0 and block.classes[1] and block.classes[1]:match('^bookbinder%-after%-heading%-(.+)$')
    if marker then
      pending = marker
    else
      if block.attr and block.classes:includes('bookbinder-note-start') then result:insert(raw(page_break(config.pageBreak))) end
      local output
      if block.t == 'Header' then
        if block.classes:includes('bookbinder-colophon-boundary') then
          local title = pandoc.write(pandoc.Pandoc({pandoc.Plain(block.content)}), 'latex')
          result:insert(raw('\\clearpage\\phantomsection\\addcontentsline{toc}{chapter}{' .. title .. '}'))
          output = {}
        else
          local title = pandoc.write(pandoc.Pandoc({pandoc.Plain(block.content)}), 'latex')
          local level = ({'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'})[block.level]
          local anchor = pandoc.write(pandoc.Pandoc({pandoc.Div({}, pandoc.Attr(block.identifier))}), 'latex')
          local content = pandoc.Plain(inlines(block.content))
          output = wrap(content, 'h' .. block.level)
          if #output > 0 then table.insert(output, 2, raw(anchor .. '\\phantomsection\\addcontentsline{toc}{' .. level .. '}{' .. title .. '}')) end
        end
      elseif block.t == 'Para' or block.t == 'Plain' then
        local selector = selectors[kind] or 'p'
        local style = config.styles[selector]
        block.content = inlines(block.content)
        if pending and rule_selectors[pending] then
          local rule = rule_selectors[pending]
          block.content = first_character(block.content, config.rules[rule .. '::first-letter'])
          style = merge_style(style, config.rules[rule])
        end
        pending = nil
        if kind == 'footnote' then
          if style.hidden then output = {}
          else
            block.content:insert(1, inline(style.before:gsub('\\par\\begingroup', '\\begingroup')))
            block.content:insert(inline(style.after))
            output = {block}
          end
        else output = wrap(block, selector, style) end
      elseif block.t == 'BlockQuote' then
        output = walk(block.content, 'quote')
      elseif block.t == 'CodeBlock' and block.classes:includes('tab') then
        local parsed = pandoc.read(block.text:gsub('\t', '&#9;'), 'markdown+hard_line_breaks')
        if pending then parsed.blocks:insert(1, pandoc.Div({}, pandoc.Attr('', {'bookbinder-after-heading-' .. pending}))) end
        pending = nil
        output = walk(parsed.blocks, 'tab')
      elseif block.t == 'CodeBlock' then
        local style = config.styles.pre
        output = wrap(block, 'pre', {before = style.before .. code_font(style), after = style.after, hidden = style.hidden})
      elseif block.t == 'Div' then
        if block.classes:includes('bookbinder-credit') then
          block = block:walk({Para = function(paragraph) paragraph.content = inlines(paragraph.content); return paragraph end})
          output = {raw(config.credit.before), block, raw(config.credit.after)}
        elseif block.classes:includes('bookbinder-separator') then
          output = wrap(pandoc.Para(inlines(pandoc.utils.blocks_to_inlines(block.content))), 'hr')
        else
          block.content = walk(block.content, block.classes:includes('bookbinder-colophon') and 'colophon' or kind)
          output = {block}
        end
      elseif block.t == 'BulletList' or block.t == 'OrderedList' then
        for index, item in ipairs(block.content) do block.content[index] = walk(item, 'item') end
        output = wrap(block, block.t == 'BulletList' and 'ul' or 'ol')
      elseif block.t == 'HorizontalRule' then output = wrap(block, 'hr')
      elseif block.t == 'Table' then
        local function rows(rows, cell_kind)
          for _, row in ipairs(rows) do for _, cell in ipairs(row.cells) do cell.contents = walk(cell.contents, cell_kind) end end
        end
        rows(block.head.rows, 'th')
        for _, body in ipairs(block.bodies) do rows(body.head, 'th'); rows(body.body, 'td') end
        rows(block.foot.rows, 'td')
        output = wrap(block, 'table')
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
  document.meta['bookbinder-config'] = nil
  document.blocks = walk(document.blocks, 'body')
  return document
end

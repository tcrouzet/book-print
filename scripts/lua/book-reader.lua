local function unique_identifiers(document, used)
  local reserved, targets = {}, {}
  local function reserve(element)
    if element.attr and element.identifier ~= '' then reserved[element.identifier] = true end
  end
  document:walk({Block = reserve, Inline = reserve})
  local function rename(element)
    if element.attr and element.identifier ~= '' then
      local original, identifier, suffix = element.identifier, element.identifier, 1
      while used[identifier] or (identifier ~= original and reserved[identifier]) do
        identifier = original .. '-' .. suffix
        suffix = suffix + 1
      end
      used[identifier] = true
      targets[original] = targets[original] or identifier
      element.identifier = identifier
    end
    return element
  end
  document = document:walk({traverse = 'topdown', Block = rename, Inline = rename})
  return document:walk({Link = function(link)
    local identifier = link.target:match('^#(.+)$')
    if identifier then
      local decoded = identifier:gsub('%%(%x%x)', function(hex) return string.char(tonumber(hex, 16)) end)
      local target = targets[identifier] or targets[decoded]
      if target then link.target = '#' .. target end
    end
    return link
  end})
end

local function contextual_styles(blocks, disabled, definitions)
  local disabled, pending, styles, first, book_styles = pandoc.List(disabled or {}), {}, {}, {}, {}
  definitions = definitions or {{kind = 'body'}, {kind = 'quote'}, {kind = 'footnote'}, {kind = 'tab'}}
  for _, definition in ipairs(definitions) do
    if definition.scope == 'book' then book_styles[definition.kind] = definition; first[definition.kind] = true
    else styles[definition.kind] = definition; pending[definition.kind] = true end
  end
  local function take(kind)
    local result = {}
    if not disabled:includes(kind) then
      if styles[kind] and pending[kind] then pending[kind] = false; result[#result + 1] = styles[kind] end
      if book_styles[kind] and first[kind] then first[kind] = false; result[#result + 1] = book_styles[kind] end
    end
    return result
  end
  local function mark(block, kind)
    local before, wrapper = {}, {}
    for _, definition in ipairs(take(kind)) do
      if not definition.marker then before[#before + 1] = 'bookbinder-after-heading-' .. kind
      elseif definition.wrapper == 'before' then before[#before + 1] = definition.marker
      elseif definition.wrapper then wrapper[#wrapper + 1] = definition.marker
      else block.classes:insert(definition.marker) end
    end
    local result = {block}
    if #before > 0 then result = {pandoc.Div({}, pandoc.Attr('', before)), block} end
    if #wrapper > 0 then result = {pandoc.Div(result, pandoc.Attr('', wrapper))} end
    return result
  end
  local walk, inlines
  inlines = function(content)
    local result = pandoc.Inlines({})
    for _, element in ipairs(content) do
      if element.t == 'Note' then element.content = walk(element.content, 'footnote'); result:insert(element)
      else
        local kind = ({Emph = 'em', Strong = 'strong', Strikeout = 'del', SmallCaps = 'smallcaps', Subscript = 'sub', Superscript = 'sup', Code = 'code', Link = 'a', Image = 'img'})[element.t]
        if element.t == 'Span' and element.classes:includes('smallcaps') then kind = 'smallcaps' end
        local selected = kind and take(kind) or {}
        if element.content then element.content = inlines(element.content) end
        local wrapper = {}
        for _, definition in ipairs(selected) do
          if definition.wrapper then wrapper[#wrapper + 1] = definition.marker
          else element.classes:insert(definition.marker) end
        end
        if #wrapper > 0 then element = pandoc.Span({element}, pandoc.Attr('', wrapper)) end
        result:insert(element)
      end
    end
    return result
  end
  local function contents(blocks, kind)
    local selected = take(kind)
    local result = walk(blocks, kind)
    local classes = {}; for _, definition in ipairs(selected) do classes[#classes + 1] = definition.marker end
    if #classes > 0 then return {pandoc.Div(result, pandoc.Attr('', classes))} end
    return result
  end
  walk = function(content, kind, previous)
    local result = pandoc.Blocks({})
    for _, block in ipairs(content) do
      local marked, paragraph_kind = {block}, nil
      if block.t == 'Header' then
        if not block.classes:includes('bookbinder-colophon-boundary') then
          marked = mark(block, 'h' .. block.level)
          block.content = inlines(block.content)
          for name in pairs(pending) do
            local level = tonumber(name:match('^h([1-6])$'))
            if not level or block.level < level then pending[name] = true end
          end
        end
      elseif block.t == 'Para' or block.t == 'Plain' then
        if kind ~= 'credit' and kind ~= 'figure' then paragraph_kind = kind end
        if kind ~= 'credit' then block.content = inlines(block.content) end
        if kind ~= 'li' and kind ~= 'td' and kind ~= 'th' and kind ~= 'credit' then marked = mark(block, kind) end
      elseif block.t == 'BlockQuote' then
        block.content, paragraph_kind = walk(block.content, 'quote', previous)
        previous = nil -- The child flow already marked continued paragraphs.
      elseif block.t == 'CodeBlock' and block.classes:includes('tab') then
        paragraph_kind = 'tab'
        local parsed = pandoc.read(block.text:gsub('\t', '&#9;'), 'markdown+hard_line_breaks')
        block = pandoc.Div(mark(pandoc.Para(inlines(pandoc.utils.blocks_to_inlines(parsed.blocks))), 'tab'), pandoc.Attr('', {'bookbinder-tab'}))
        marked = {block}
      elseif block.t == 'CodeBlock' then marked = mark(block, 'pre')
      elseif block.t == 'Div' then
        if block.classes:includes('bookbinder-separator') then marked = mark(block, 'hr')
        elseif block.classes:includes('bookbinder-note-start') then previous = nil; block.content, paragraph_kind = walk(block.content, kind)
        else block.content = walk(block.content, block.classes:includes('bookbinder-credit') and 'credit' or block.classes:includes('bookbinder-colophon') and 'colophon' or kind) end
      elseif block.t == 'BulletList' or block.t == 'OrderedList' then
        marked = mark(block, block.t == 'BulletList' and 'ul' or 'ol')
        for index, item in ipairs(block.content) do block.content[index] = contents(item, 'li') end
      elseif block.t == 'Table' then
        marked = mark(block, 'table')
        local function rows(list, cell_kind) for _, row in ipairs(list) do for _, cell in ipairs(row.cells) do cell.contents = contents(cell.contents, cell_kind) end end end
        rows(block.head.rows, 'th'); for _, body in ipairs(block.bodies) do rows(body.head, 'th'); rows(body.body, 'td') end; rows(block.foot.rows, 'td')
      elseif block.t == 'HorizontalRule' then marked = mark(block, 'hr')
      elseif block.t == 'Figure' then block.content = walk(block.content, 'figure')
      elseif block.t == 'DefinitionList' then for _, item in ipairs(block.content) do item[1] = inlines(item[1]); for index, definition in ipairs(item[2]) do item[2][index] = walk(definition, kind) end end end
      if #marked == 1 and marked[1].t == 'Div' and marked[1] ~= block then marked[1].content = {block} end
      if paragraph_kind and previous == paragraph_kind then marked = {pandoc.Div(marked, pandoc.Attr('', {'bookbinder-continued-' .. paragraph_kind}))} end
      previous = paragraph_kind
      result:extend(marked)
    end
    return result, previous
  end
  local result = walk(blocks, 'body')
  return result
end

-- Each note is parsed separately so footnote labels remain local to its source.
function Reader(input)
  local project = pandoc.json.decode(tostring(input))
  local blocks = pandoc.Blocks({})
  local identifiers = {}
  for _, source in ipairs(project.sources) do
    local document = pandoc.read(source.content, 'markdown+wikilinks_title_after_pipe', {indented_code_classes = {'tab'}})
    document = unique_identifiers(document, identifiers)
    document = document:walk({
      HorizontalRule = function()
        if project.separator ~= nil then
          return pandoc.Div({pandoc.Plain({pandoc.Str(project.separator)})}, pandoc.Attr('', {'bookbinder-separator'}))
        end
      end,
      Image = function(image)
        if not image.src:match('^[%a][%w+.-]*:') and not pandoc.path.is_absolute(image.src) then
          image.src = pandoc.path.normalize(pandoc.path.join({source.directory, image.src}))
        end
        return image
      end
    })
    if project.pageBreak and #blocks > 0 and #document.blocks > 0 then
      local first = document.blocks[1]
      if first.attr and not (first.t == 'CodeBlock' and first.classes:includes('tab')) then
        first.classes:insert('bookbinder-note-start')
      else
        document.blocks[1] = pandoc.Div({first}, pandoc.Attr('', {'bookbinder-note-start'}))
      end
    end
    blocks:extend(document.blocks)
  end
  local metadata = {}
  if project.characterCountLabel then
    local counted = pandoc.Pandoc(blocks):walk({Note = function(note)
      local text = pandoc.Inlines({pandoc.Space()}); text:extend(pandoc.utils.blocks_to_inlines(note.content)); text:insert(pandoc.Space())
      return pandoc.Span(text)
    end})
    -- ASCII whitespace avoids splitting accented UTF-8 characters in the system locale.
    local text = pandoc.utils.stringify(pandoc.utils.blocks_to_inlines(counted.blocks)):gsub('[ \t\r\n]+', ' '):match('^ *(.-) *$')
    local count = math.floor(utf8.len(text) / (project.characterCountDivisor or 1) + 0.5)
    metadata['bookbinder-character-count'] = pandoc.MetaString(project.characterCountLabel:gsub('{count}', tostring(count)))
  end
  if project.colophonCredit then
    local colophon = pandoc.read(project.colophon or '', 'markdown')
    colophon.blocks:insert(pandoc.Div(pandoc.read(project.colophonCredit, 'markdown').blocks, pandoc.Attr('', {'bookbinder-credit'})))
    colophon = pandoc.Pandoc({
      pandoc.Header(1, {pandoc.Str(project.colophonTitle or 'Colophon')}, pandoc.Attr('bookbinder-colophon', {'unnumbered', 'bookbinder-colophon-boundary'})),
      pandoc.Div(colophon.blocks, pandoc.Attr('', {'bookbinder-colophon'}))
    })
    blocks:extend(unique_identifiers(colophon, identifiers).blocks)
  end
  return pandoc.Pandoc(contextual_styles(blocks, project.disabledRules, project.ruleDefinitions), metadata)
end

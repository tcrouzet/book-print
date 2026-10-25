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

local function contextual_paragraphs(blocks, disabled)
  local disabled = pandoc.List(disabled or {})
  local pending = {}
  local walk
  local function note(note)
    note.content = walk(note.content, 'footnote')
    return note, false
  end
  local function notes(block)
    return block:walk({traverse = 'topdown', Note = note})
  end
  local function mark(block, style)
    if pending[style] and not disabled:includes(style) then
      pending[style] = nil
      return {pandoc.Div({}, pandoc.Attr('', {'bookbinder-after-heading-' .. style})), block}
    end
    return block
  end
  local function list(block)
    for index, item in ipairs(block.content) do
      block.content[index] = walk(item, 'list')
    end
    return block, false
  end
  walk = function(content, style)
    return pandoc.Pandoc(content):walk({
      traverse = 'topdown',
      Header = function() pending = {body = true, quote = true, footnote = true, tab = true} end,
      Para = function(block) return mark(notes(block), style), false end,
      Plain = function(block) return notes(block), false end,
      Note = note,
      BlockQuote = function(block) block.content = walk(block.content, 'quote'); return block, false end,
      Div = function(block) block.content = walk(block.content, style); return block, false end,
      BulletList = list,
      OrderedList = list,
      Table = function(block) return notes(block), false end,
      Figure = function(block) return notes(block), false end,
      DefinitionList = function(block) return notes(block), false end,
      CodeBlock = function(block)
        if block.classes:includes('tab') then return mark(block, 'tab'), false end
      end,
    }).blocks
  end
  return walk(blocks, 'body')
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
  blocks = contextual_paragraphs(blocks, project.disabledRules)
  if project.colophonCredit then
    local colophon = pandoc.read(project.colophon or '', 'markdown')
    colophon.blocks:insert(pandoc.Div(pandoc.read(project.colophonCredit, 'markdown').blocks, pandoc.Attr('', {'bookbinder-credit'})))
    colophon = pandoc.Pandoc({
      pandoc.Header(1, {pandoc.Str(project.colophonTitle or 'Colophon')}, pandoc.Attr('bookbinder-colophon', {'unnumbered', 'bookbinder-colophon-boundary'})),
      pandoc.Div(colophon.blocks, pandoc.Attr('', {'bookbinder-colophon'}))
    })
    blocks:extend(unique_identifiers(colophon, identifiers).blocks)
  end
  return pandoc.Pandoc(blocks)
end

function Div(el)
  if el.classes:includes('bookbinder-tab') and (FORMAT:match("html") or FORMAT:match("epub")) then
    return el.content:map(function(block)
      if block.t == 'Para' or block.t == 'Plain' then
        block.content:insert(1, pandoc.RawInline('html', '<p class="tab">'))
        block.content:insert(pandoc.RawInline('html', '</p>'))
        return pandoc.Plain(block.content)
      end
      return block
    end)
  end
end

function Pandoc(document)
  if not document.meta['bookbinder-character-position'] then return document end
  document.meta['bookbinder-character-position'] = nil
  local function wrap(block)
    if block.content[1] and block.content[1].t == 'RawInline' and block.content[1].text == '<p class="tab">' then
      local opening, closing = block.content:remove(1), block.content:remove()
      block.content = {opening, pandoc.Span(block.content, pandoc.Attr('', {'bookbinder-character'})), closing}
    else block.content = {pandoc.Span(block.content, pandoc.Attr('', {'bookbinder-character'}))} end
    return block
  end
  document = document:walk({Para = wrap, Plain = wrap, Header = wrap})
  if document.meta.title then
    local title = document.meta.title
    if pandoc.utils.type(title) ~= 'Inlines' then title = pandoc.Inlines({pandoc.Str(pandoc.utils.stringify(title))}) end
    document.meta.title = pandoc.MetaInlines({pandoc.Span(title, pandoc.Attr('', {'bookbinder-character'}))})
  end
  return document
end

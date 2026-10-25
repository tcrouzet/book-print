function CodeBlock(el)
  if el.classes:includes('tab') and (FORMAT:match("html") or FORMAT:match("epub")) then
    local document = pandoc.read(el.text:gsub('\t', '&#9;'), 'markdown+hard_line_breaks')
    local content = pandoc.utils.blocks_to_inlines(document.blocks)
    content:insert(1, pandoc.RawInline('html', '<p class="tab">'))
    content:insert(pandoc.RawInline('html', '</p>'))
    return pandoc.Plain(content)
  end
end

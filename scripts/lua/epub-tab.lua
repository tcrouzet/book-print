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

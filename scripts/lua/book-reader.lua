-- Each note is parsed separately so footnote labels remain local to its source.
function Reader(input)
  local project = pandoc.json.decode(tostring(input))
  local blocks = pandoc.Blocks({})
  for _, source in ipairs(project.sources) do
    local document = pandoc.read(source.content, 'markdown+wikilinks_title_after_pipe')
    document = document:walk({
      Image = function(image)
        if not image.src:match('^[%a][%w+.-]*:') and not pandoc.path.is_absolute(image.src) then
          image.src = pandoc.path.normalize(pandoc.path.join({source.directory, image.src}))
        end
        return image
      end
    })
    blocks:extend(document.blocks)
  end
  return pandoc.Pandoc(blocks)
end

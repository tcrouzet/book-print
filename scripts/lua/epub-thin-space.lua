function Str(element)
  if not element.text:find('\u{00A0}') and not element.text:find('\u{202F}') then return nil end
  local text = element.text:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')
  for _, space in ipairs({'\u{00A0}', '\u{202F}'}) do
    for _, punctuation in ipairs({':', '!', ';', '»', '—', '?'}) do
      local pattern = punctuation == '?' and '%?' or punctuation
      text = text:gsub(space .. pattern, '<span class="thin-space-before">' .. punctuation .. '</span>')
    end
    for _, punctuation in ipairs({'«', '—', '/'}) do
      text = text:gsub(punctuation .. space, '<span class="thin-space-after">' .. punctuation .. '</span>')
    end
    text = text:gsub(space, '<span class="thin-space">\u{00A0}</span>')
  end
  return pandoc.RawInline('html', text)
end

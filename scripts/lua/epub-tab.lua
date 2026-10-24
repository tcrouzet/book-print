-- Only explicitly marked Markdown blocks use the tabulation style.
local function html_escape(s)
  s = s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;")
  return s
end

function CodeBlock(el)
  if el.classes:includes('tab') and (FORMAT:match("html") or FORMAT:match("epub")) then
    local content = el.text:gsub("\r\n", "\n")
    content = html_escape(content)
    content = content:gsub("\n", "<br />")
    return pandoc.RawBlock("html", '<p class="tab">' .. content .. '</p>')
  end
end

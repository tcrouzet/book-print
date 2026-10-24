
function log(...)
    local args = {...}
    for i, v in ipairs(args) do
        io.stderr:write(tostring(v) .. "\n")
    end
end

-- Échappement TeX pour du texte (avant injection)
local function tex_escape(s)
  -- ordre important: d'abord le backslash
  s = s:gsub("\\", "\\textbackslash{}")
  -- puis les caractères spéciaux TeX
  s = s:gsub("([%%$#&_{}])", "\\%1")
  s = s:gsub("~", "\\textasciitilde{}")
  s = s:gsub("%^", "\\textasciicircum{}")
  return s
end

-- ===================================================================
-- PARTIE 1 : GESTION DE LA STRUCTURE (LOGIQUE DE BALAYAGE ARRIÈRE)
-- ===================================================================
function Pandoc(doc)
  local blocks = doc.blocks
  local processed_paragraphs = {}

  
  for i = 1, #blocks do
    local block = blocks[i]

    -- CAS 1 : Règle horizontale (inchangé)
    if block.t == "HorizontalRule" then  
        blocks[i] = pandoc.RawBlock('latex', '\\starrule')

    -- CAS 2 : Citation. C'est ici que la logique complexe intervient.
    elseif block.t == "BlockQuote" then
      -- On ne fait rien si c'est le premier bloc du document.
      if i > 1 then
        -- On remonte en arrière, en partant du bloc juste avant la citation.
        for k = i - 1, 1, -1 do
          local context_block = blocks[k]

          -- On ne s'intéresse qu'aux en-têtes pour définir le contexte.
          if context_block.t == "Header" then
            local level = context_block.level

            -- Contexte trouvé : H3. La citation est un \chapexergue.
            -- On vérifie que c'est bien le bloc IMMÉDIATEMENT avant (k == i - 1)
            -- car \chapexergue ne s'applique qu'aux citations qui suivent directement un H3.
            if level == 3 and k == i - 1 then
              local quote_content = pandoc.write(pandoc.Pandoc(block.content), "latex")
              quote_content = quote_content:gsub("\\n+$", "")
              local latex_command = "\\chapexergue{" .. quote_content .. "}"
              blocks[i] = pandoc.RawBlock('latex', latex_command)
              break -- On a trouvé le contexte, on arrête de remonter.

            -- Contexte trouvé : H4. La citation est un \bookexergue.
            -- Ceci peut arriver même si le H4 n'est pas immédiat.
            elseif level == 4 then
              local quote_content = pandoc.write(pandoc.Pandoc(block.content), "latex")
              quote_content = quote_content:gsub("\\n+$", "")
              local latex_command = "\\bookexergue{" .. quote_content .. "}"
              blocks[i] = pandoc.RawBlock('latex', latex_command)
              break -- On a trouvé le contexte, on arrête de remonter.
            
            -- Contexte de rupture : On a trouvé un H1, H2 ou H3 (non-immédiat).
            -- La recherche s'arrête ici, la citation n'est pas un \bookexergue.
            elseif level <= 3 then
              break -- On arrête de remonter, la citation reste une citation normale.
            end
          end
          -- Si le context_block n'est pas un Header (ex: un autre BlockQuote, un H6),
          -- on l'ignore et la boucle "k" continue de remonter.
        end
      end

    -- CAS 3 : CodeBlock
    elseif block.t == "CodeBlock" then
      local has_class = (#block.classes or 0) > 0

      if not has_class then
        -- Sans classe ET du texte court : paragraphe à droite
        -- Mais ignorer les blocs longs (laisser Pandoc les traiter)
        local line_count = select(2, string.gsub(block.text, '\n', '\n')) + 1
        if line_count < 5 then
          local content = block.text
          content = content:gsub("\\", "\\textbackslash{}") -- neutralise \0, \[...
          content = content:gsub("%%", "\\%%")              -- évite commentaires
          content = content:gsub("%*([^%*]+)%*", "\\textit{%1}")
          blocks[i] = pandoc.RawBlock('latex', '\\alignright{' .. content .. '}')
        else
          -- Blocs longs sans classe : ajouter une classe vide pour forcer Highlighting
          table.insert(block.classes, "text")
        end
      end

-- CAS 4 : Lettrines
    elseif block.t == "Para" then
      for k = i - 1, 1, -1 do
        local prev_block = blocks[k]
        
        if prev_block.t == "Para" then
          break
          
        elseif prev_block.t == "Header" and (prev_block.level == 1 or prev_block.level == 2 or prev_block.level == 3) then
          local inlines = block.content
          for j = 1, #inlines do
            local inline_element = inlines[j]

            if inline_element.t == "Str" and inline_element.text:match("%S") then
              local text = inline_element.text
              local offset2 = utf8.offset(text, 2)
              local first_char = offset2 and text:sub(1, offset2 - 1) or text
              local rest_of_text = offset2 and text:sub(offset2) or ""
              local lettrine_inline = pandoc.RawInline('latex', '\\lettrine[lines=1]{' .. first_char .. '}{}')
              inline_element.text = rest_of_text
              table.insert(inlines, j, lettrine_inline)
              break

            elseif inline_element.t == "Emph" or inline_element.t == "Strong" then
              local sub_inlines = inline_element.content
              for m = 1, #sub_inlines do
                local sub_el = sub_inlines[m]
                if sub_el.t == "Str" and sub_el.text:match("%S") then
                  local text = sub_el.text
                  local offset2 = utf8.offset(text, 2)
                  local first_char = offset2 and text:sub(1, offset2 - 1) or text
                  local rest_of_text = offset2 and text:sub(offset2) or ""
                  local lettrine_inline = pandoc.RawInline('latex', '\\lettrine[lines=1]{' .. first_char .. '}{}')
                  sub_el.text = rest_of_text
                  table.insert(inlines, j, lettrine_inline)
                  break
                end
              end
              break
            end

          end        -- ← fin for j
          break      -- ← Arrêter la recherche (for k)

        -- Continuer pour H4, H5, H6, BlockQuote…
        end          -- ← fin if/elseif prev_block
      end            -- ← fin for k


    end
  end

  return doc
end

-- ===================================================================
-- PARTIE 2 : GESTION DU CONTENU TEXTUEL (INLINES)
-- Cette fonction est appelée par Pandoc pour chaque groupe d'éléments
-- "inline" (dans les titres, les paragraphes, etc.).
-- ===================================================================

function Inlines(inlines)

    if in_note then
        return inlines
    end

    local i = 1
    local result = {}
    
    while i <= #inlines do
        local el = inlines[i]
        
        -- Détecte les balises d'ouverture
        if el.t == "RawInline" and el.format == "html" then
            if el.text == "<sup>" or el.text == "<sub>" then
                local tag_type = el.text:match("<(.-)>")  -- Extrait "sup" ou "sub"
                local content = ""
                local closing_tag = "</" .. tag_type .. ">"
                i = i + 1
                
                -- Collecte tout jusqu'à la balise de fermeture
                while i <= #inlines do
                    el = inlines[i]
                    if el.t == "RawInline" and el.format == "html" and el.text == closing_tag then
                        -- Fin de la balise
                        if tag_type == "sup" then
                            tag_type = "super"
                        end
                        local latex_cmd = "\\text" .. tag_type .. "script{" .. content .. "}"
                        table.insert(result, pandoc.RawInline("latex", latex_cmd))
                        break
                    else
                        -- Ajoute le contenu
                        content = content .. pandoc.utils.stringify({el})
                    end
                    i = i + 1
                end
            else
                -- Autre RawInline, l'ajouter normalement
                table.insert(result, el)
            end
        elseif el.t == "Str" then
            local text = el.text
            
            -- Espace insécable (U+00A0) encodé en UTF-8 comme \194\160
            local NBSP = "\194\160"
            
            -- Supprimer les espaces insécables avant ponctuation double
            text = text:gsub(NBSP .. "([;:!?»])", "%1")
            text = text:gsub("«" .. NBSP, "«")
            
            -- Remplace derniers insécables par des fine latex \, 
            local last_pos = 1
            while true do
                local nbs_pos = text:find(NBSP, last_pos, true)
                
                if not nbs_pos then
                    -- Plus de NBSP, ajouter le reste de la chaîne et sortir de la boucle
                    local remaining_text = text:sub(last_pos)
                    if #remaining_text > 0 then
                        -- Échapper les caractères spéciaux LaTeX restants comme '&'
                        remaining_text = remaining_text:gsub("\\", "\\textbackslash{}")
                        remaining_text = remaining_text:gsub("&", "\\&")
                        remaining_text = remaining_text:gsub("%%", "\\%%")
                        -- table.insert(result, pandoc.Str(remaining_text))
                        table.insert(result, pandoc.RawInline("latex", remaining_text))

                    end
                    break
                end
                
                -- Ajouter le segment de texte avant le NBSP
                local text_part = text:sub(last_pos, nbs_pos - 1)
                if #text_part > 0 then
                    text_part = text_part:gsub("\\", "\\textbackslash{}")
                    text_part = text_part:gsub("&", "\\&")
                    text_part = text_part:gsub("%%", "\\%%")
                    -- table.insert(result, pandoc.Str(text_part))
                    table.insert(result, pandoc.RawInline("latex", text_part))
                end
                
                -- Insérer l'espace fine en tant que RawInline LaTeX
                table.insert(result, pandoc.RawInline("latex", "\\,"))
                
                -- Mettre à jour la position pour la prochaine recherche
                last_pos = nbs_pos + #NBSP
            end

        else
            -- Élément normal, l'ajouter
            table.insert(result, el)
        end
        
        i = i + 1
    end
    
    return result
end
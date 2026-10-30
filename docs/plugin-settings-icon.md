# Icône dans la liste latérale des paramètres Obsidian

Méthode utilisée par Bookbinder et Typewriter Mode, vérifiée dans Obsidian 1.14.5. Elle concerne le nom du plugin dans la colonne gauche des paramètres.

## Déclarer l’icône

Dans la classe qui hérite de `PluginSettingTab` :

```ts
override icon = "bookbinder";
```

Pour un SVG personnalisé, enregistrer l’icône avant l’ajout de l’onglet :

```ts
addIcon("bookbinder", bookbinderIcon);
this.addSettingTab(new BookbinderSettingTab(this.app, this));
```

Dans Bookbinder, [icon.svg](../icon.svg) est importé comme texte et intégré à `main.js` par la compilation. Conserver `width="100" height="100"` pour le cadre créé par `addIcon` ; le `viewBox` interne peut rester en `0 0 24 24`. Utiliser `currentColor` pour suivre le thème.

## Rendre l’icône visible

Obsidian 1.14.5 masque les icônes des plugins communautaires par défaut. Ajouter dans `styles.css` :

```css
.vertical-tab-nav-item[data-setting-id="bookbinder"] .vertical-tab-nav-item-icon {
  display: flex;
}
```

Pour un autre plugin, remplacer `bookbinder` par son identifiant dans `manifest.json`, adapter la classe de réglages et enregistrer son propre SVG. Garder le sélecteur CSS limité à ce plugin.

## Statut et vérification

La propriété `SettingTab.icon` est publique depuis Obsidian 1.11.0. Le complément CSS repose sur la structure interne des paramètres : il peut nécessiter une adaptation après une mise à jour. [API officielle](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) et [CSS de Typewriter Mode](https://github.com/davisriedel/obsidian-typewriter-mode/blob/main/src/styles/ui/_settings.scss).

Après compilation, désactiver puis réactiver le plugin. Contrôler dans Obsidian que l’icône apparaît réellement, en thème clair et sombre. Une compilation réussie et un aperçu SVG seuls ne suffisent pas : vérifier aussi que `.vertical-tab-nav-item-icon` n’a pas `display: none`.

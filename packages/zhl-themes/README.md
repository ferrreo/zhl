# @zhl/themes

CSS themes for the [zhl](../../README.md) syntax highlighting engine, matching
GitHub's Primer "prettylights" syntax palettes.

zhl's HTML renderer emits `<span class="zhl-<style>">` spans for 21 style
classes (`zhl-keyword`, `zhl-string`, `zhl-comment`, ...). These stylesheets
color those classes, scoped under a wrapper class so multiple themes can
coexist on one page.

## Files

| File               | Wrapper class      | Palette                              |
| ------------------ | ------------------ | ------------------------------------ |
| `github-dark.css`  | `zhl-github-dark`  | GitHub Dark                          |
| `github-light.css` | `zhl-github-light` | GitHub Light                         |
| `github.css`       | `zhl-github`       | Light by default, dark via `prefers-color-scheme` |

## Usage

```html
<link rel="stylesheet" href="node_modules/@zhl/themes/github-dark.css" />

<pre class="zhl-github-dark"><code><!-- zhl renderHtml() output --></code></pre>
```

Or with a bundler:

```js
import '@zhl/themes/github-dark.css'
```

For automatic light/dark switching based on the OS setting, use `github.css`
with the `zhl-github` wrapper class instead.

Every theme defines its palette as CSS custom properties (`--zhl-fg`,
`--zhl-keyword`, ...) on the wrapper, so individual colors can be overridden
without editing the stylesheet:

```css
.zhl-github-dark {
  --zhl-keyword: hotpink;
}
```

## Style class → color mapping

| zhl classes | Primer token | Dark | Light |
| --- | --- | --- | --- |
| wrapper background | `bgColor` | `#0d1117` | `#ffffff` |
| `zhl-plain`, `zhl-parameter`, `zhl-punctuation` | `fgColor` | `#e6edf3` | `#1f2328` |
| `zhl-comment`, `zhl-doc-comment`*, `zhl-container-doc-comment`* | `syntax-comment` | `#8b949e` | `#57606a` |
| `zhl-string`, `zhl-multiline-string`, `zhl-char` | `syntax-string` | `#a5d6ff` | `#0a3069` |
| `zhl-escape`, `zhl-format-placeholder`, `zhl-number-integer`, `zhl-number-float`, `zhl-field`, `zhl-label` | `syntax-constant` | `#79c0ff` | `#0550ae` |
| `zhl-keyword`, `zhl-operator` | `syntax-keyword` | `#ff7b72` | `#cf222e` |
| `zhl-builtin`, `zhl-type-name` | `syntax-variable` | `#ffa657` | `#953800` |
| `zhl-function` | `syntax-entity` | `#d2a8ff` | `#6639ba` |
| `zhl-invalid` | danger fg + translucent bg | `#f85149` | `#cf222e` |

\* doc comments are additionally italicized.

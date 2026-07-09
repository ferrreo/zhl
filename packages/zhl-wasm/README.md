# @zhl/wasm

Browser-first ESM bindings for the zhl syntax highlighting engine (WebAssembly).
Zero dependencies, no Node builtins.

Build the wasm artifact with the languages you need (default: 25 native grammars):

```bash
zig build wasm-api -Doptimize=ReleaseFast                         # 25 native langs
zig build wasm-api -Doptimize=ReleaseFast -Dlangs=zig,typescript   # custom set
zig build wasm-api -Doptimize=ReleaseFast -Dlangs=full             # native + converted ext
```

`full` and ext names require `tools/generate_grammars_ext.sh` first. Ext language ids
start at `1000`. Native ids stay `1..25` (e.g. `zig` → `25`).

## Usage

```js
import { init } from '@zhl/wasm'

// Accepts a WebAssembly.Module, wasm bytes, a Response, or a URL/string to fetch.
const zhl = await init('/zhl_api.wasm')

const langId = zhl.languageId('zig')          // 0 if unknown
const tokens = zhl.highlight('zig', code)     // [{ start, end, styleId, ... }]
const raw = zhl.highlightRaw(langId, code)    // { count, bytes: Uint8Array }
const count = zhl.highlightTokenCount(langId, code) // fast path, no copy
const html = zhl.renderHtml('zig', code)      // string
```

In Node/Bun (no fetch of local paths), pass bytes:

```js
import { readFile } from 'node:fs/promises'
const zhl = await init(await readFile('zig-out/bin/zhl_api.wasm'))
```

Token layout: 16 bytes little-endian — `u32 start`, `u32 end`, `u16 styleId`,
`u16 scopeStackId`, `u16 languageId`, `u16 flags`. Offsets are absolute byte
offsets into the UTF-8 source. The library is single-threaded.

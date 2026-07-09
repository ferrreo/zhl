# @zhl/bun

Bun FFI (`bun:ffi`) bindings for the zhl syntax highlighting engine shared
library (`libzhl.so`). Bun only.

## Usage

```js
import { open } from '@zhl/bun'

const zhl = open() // defaults to <repo>/zig-out/lib/libzhl.so; or open('/path/to/libzhl.so')

const langId = zhl.languageId('zig')          // 0 if unknown
const tokens = zhl.highlight('zig', code)     // [{ start, end, styleId, ... }]
const raw = zhl.highlightRaw(langId, code)    // { count, bytes: Uint8Array }
const count = zhl.highlightTokenCount(langId, code) // fast path, no copy
const html = zhl.renderHtml('zig', code)      // string
```

Token layout: 16 bytes little-endian — `u32 start`, `u32 end`, `u16 styleId`,
`u16 scopeStackId`, `u16 languageId`, `u16 flags`. The library is
single-threaded; do not call from multiple threads/workers concurrently.

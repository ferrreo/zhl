/**
 * @zhl/node — Node.js FFI bindings (node:ffi) for the zhl shared library.
 *
 * Requires Node >= 26.1 started with --experimental-ffi.
 *
 * Same method surface as @zhl/wasm: languageId, highlight, highlightRaw,
 * highlightTokenCount, renderHtml.
 *
 * NOTE: input bytes are staged into native memory obtained from zhl_alloc and
 * passed as raw u64 pointers instead of using node:ffi's 'buffer' argument
 * type. As of Node 26.4, 'buffer' arguments intermittently marshal a bogus
 * pointer once V8 optimizes the calling code (TurboFan/Maglev fast-call
 * path), causing spurious failures after a few thousand calls.
 */

import { fileURLToPath } from 'node:url'

let ffi
try {
  ffi = (await import('node:ffi')).default
} catch {
  throw new Error('zhl: node:ffi is unavailable — run with node --experimental-ffi, Node >= 26.1')
}

const TOKEN_SIZE = 16
const ERROR_NAMES = {
  100: 'out of memory',
  101: 'unknown language',
}

const decoder = new TextDecoder()

class ZhlError extends Error {
  constructor(operation, code) {
    const detail = ERROR_NAMES[code] ?? `highlight error ${code}`
    super(`zhl: ${operation} failed with code ${code} (${detail})`)
    this.name = 'ZhlError'
    this.code = code
  }
}

class Zhl {
  constructor(fns) {
    this._fn = fns
    this._scratchPtr = 0n
    this._scratchCap = 0
    this._scratchView = null
    const version = fns.zhl_api_version()
    if (version !== 1) {
      throw new Error(`zhl: unsupported ABI version ${version} (expected 1)`)
    }
    if (fns.zhl_token_size() !== TOKEN_SIZE) {
      throw new Error('zhl: unexpected token size, ABI mismatch')
    }
  }

  /**
   * Resolve a language name (canonical or alias) to a numeric id. 0 if unknown.
   * @param {string} name
   * @returns {number}
   */
  languageId(name) {
    const len = this._stage(name)
    return this._fn.zhl_language_from_name(this._scratchPtr, BigInt(len))
  }

  /**
   * Highlight `code` and return a copy of the raw token bytes.
   * @param {number|string} lang
   * @param {string} code
   * @returns {{ count: number, bytes: Uint8Array }}
   */
  highlightRaw(lang, code) {
    const count = this._runHighlight(lang, code)
    const byteLen = count * TOKEN_SIZE
    if (byteLen === 0) return { count, bytes: new Uint8Array(0) }
    const bytes = ffi.toBuffer(this._fn.zhl_result_ptr(), byteLen, true)
    return { count, bytes }
  }

  /**
   * Highlight `code` and decode tokens into plain objects.
   * @param {number|string} lang
   * @param {string} code
   */
  highlight(lang, code) {
    const { count, bytes } = this.highlightRaw(lang, code)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const tokens = new Array(count)
    for (let i = 0; i < count; i++) {
      const base = i * TOKEN_SIZE
      tokens[i] = {
        start: dv.getUint32(base, true),
        end: dv.getUint32(base + 4, true),
        styleId: dv.getUint16(base + 8, true),
        scopeStackId: dv.getUint16(base + 10, true),
        languageId: dv.getUint16(base + 12, true),
        flags: dv.getUint16(base + 14, true),
      }
    }
    return tokens
  }

  /**
   * Fast path: highlight and return only the token count (no copy out).
   * @param {number|string} lang
   * @param {string} code
   * @returns {number}
   */
  highlightTokenCount(lang, code) {
    return this._runHighlight(lang, code)
  }

  /**
   * Render `code` as HTML.
   * @param {number|string} lang
   * @param {string} code
   * @returns {string}
   */
  renderHtml(lang, code) {
    const langId = this._resolveLang(lang)
    const len = this._stage(code)
    const rc = this._fn.zhl_render_html(langId, this._scratchPtr, BigInt(len))
    if (rc !== 0) throw new ZhlError('zhl_render_html', rc)
    const byteLen = Number(this._fn.zhl_result_len())
    if (byteLen === 0) return ''
    const bytes = ffi.toBuffer(this._fn.zhl_result_ptr(), byteLen, true)
    return decoder.decode(bytes)
  }

  _runHighlight(lang, code) {
    const langId = this._resolveLang(lang)
    const len = this._stage(code)
    const rc = this._fn.zhl_highlight(langId, this._scratchPtr, BigInt(len))
    if (rc !== 0) throw new ZhlError('zhl_highlight', rc)
    return Number(this._fn.zhl_result_len())
  }

  _resolveLang(lang) {
    if (typeof lang === 'number') return lang
    const id = this.languageId(lang)
    if (id === 0) throw new Error(`zhl: unknown language "${lang}"`)
    return id
  }

  /** Write `text` as UTF-8 into the native scratch buffer; returns byte length. */
  _stage(text) {
    const byteLen = Buffer.byteLength(text, 'utf8')
    if (byteLen > this._scratchCap) {
      if (this._scratchCap > 0) this._fn.zhl_free(this._scratchPtr, BigInt(this._scratchCap))
      const cap = Math.max(byteLen, this._scratchCap * 2, 4096)
      const ptr = this._fn.zhl_alloc(BigInt(cap))
      if (ptr === 0n) {
        this._scratchPtr = 0n
        this._scratchCap = 0
        this._scratchView = null
        throw new ZhlError('zhl_alloc', 100)
      }
      this._scratchPtr = ptr
      this._scratchCap = cap
      this._scratchView = ffi.toBuffer(ptr, cap, false)
    }
    this._scratchView.write(text, 0, byteLen, 'utf8')
    return byteLen
  }
}

/**
 * Open libzhl.so and return a Zhl instance.
 * @param {string} [libPath] - defaults to zig-out/lib/libzhl.so relative to the repo root.
 * @returns {Zhl}
 */
export function open(libPath = fileURLToPath(new URL('../../zig-out/lib/libzhl.so', import.meta.url))) {
  const { functions } = ffi.dlopen(libPath, {
    zhl_api_version: { arguments: [], return: 'u32' },
    zhl_alloc: { arguments: ['u64'], return: 'u64' },
    zhl_free: { arguments: ['u64', 'u64'], return: 'void' },
    zhl_language_from_name: { arguments: ['u64', 'u64'], return: 'u32' },
    zhl_token_size: { arguments: [], return: 'u32' },
    zhl_highlight: { arguments: ['u32', 'u64', 'u64'], return: 'u32' },
    zhl_render_html: { arguments: ['u32', 'u64', 'u64'], return: 'u32' },
    zhl_result_ptr: { arguments: [], return: 'u64' },
    zhl_result_len: { arguments: [], return: 'u64' },
    zhl_result_free: { arguments: [], return: 'void' },
  })
  return new Zhl(functions)
}

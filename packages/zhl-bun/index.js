/**
 * @zhl/bun — Bun FFI (bun:ffi) bindings for the zhl shared library.
 *
 * Same method surface as @zhl/wasm: languageId, highlight, highlightRaw,
 * highlightTokenCount, renderHtml.
 */

import { dlopen, FFIType, ptr, toArrayBuffer } from 'bun:ffi'

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
  constructor(symbols) {
    this._sym = symbols
    this._input = null
    const version = symbols.zhl_api_version()
    if (version !== 1) {
      throw new Error(`zhl: unsupported ABI version ${version} (expected 1)`)
    }
    if (symbols.zhl_token_size() !== TOKEN_SIZE) {
      throw new Error('zhl: unexpected token size, ABI mismatch')
    }
  }

  /**
   * Resolve a language name (canonical or alias) to a numeric id. 0 if unknown.
   * @param {string} name
   * @returns {number}
   */
  languageId(name) {
    const buf = Buffer.from(name, 'utf8')
    // Anchor the buffer on `this` so it cannot be collected mid-call.
    this._input = buf
    try {
      return this._sym.zhl_language_from_name(ptr(buf), buf.length)
    } finally {
      this._input = null
    }
  }

  /**
   * Highlight `code` and return a copy of the raw token bytes.
   * @param {number|string} lang
   * @param {string} code
   * @returns {{ count: number, bytes: Uint8Array }}
   */
  highlightRaw(lang, code) {
    const count = this._runHighlight(lang, code)
    const addr = Number(this._sym.zhl_result_ptr())
    const byteLen = count * TOKEN_SIZE
    const bytes = byteLen === 0
      ? new Uint8Array(0)
      : new Uint8Array(toArrayBuffer(addr, 0, byteLen)).slice()
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
    const buf = Buffer.from(code, 'utf8')
    this._input = buf
    let rc
    try {
      rc = this._sym.zhl_render_html(langId, ptr(buf), buf.length)
    } finally {
      this._input = null
    }
    if (rc !== 0) throw new ZhlError('zhl_render_html', rc)
    const addr = Number(this._sym.zhl_result_ptr())
    const byteLen = Number(this._sym.zhl_result_len())
    if (byteLen === 0) return ''
    return decoder.decode(toArrayBuffer(addr, 0, byteLen))
  }

  _runHighlight(lang, code) {
    const langId = this._resolveLang(lang)
    const buf = Buffer.from(code, 'utf8')
    this._input = buf
    let rc
    try {
      rc = this._sym.zhl_highlight(langId, ptr(buf), buf.length)
    } finally {
      this._input = null
    }
    if (rc !== 0) throw new ZhlError('zhl_highlight', rc)
    return Number(this._sym.zhl_result_len())
  }

  _resolveLang(lang) {
    if (typeof lang === 'number') return lang
    const id = this.languageId(lang)
    if (id === 0) throw new Error(`zhl: unknown language "${lang}"`)
    return id
  }
}

/**
 * Open libzhl.so and return a Zhl instance.
 * @param {string} [libPath] - defaults to zig-out/lib/libzhl.so relative to the repo root.
 * @returns {Zhl}
 */
export function open(libPath = new URL('../../zig-out/lib/libzhl.so', import.meta.url).pathname) {
  const { symbols } = dlopen(libPath, {
    zhl_api_version: { args: [], returns: FFIType.u32 },
    zhl_token_size: { args: [], returns: FFIType.u32 },
    zhl_language_from_name: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u32 },
    zhl_highlight: { args: [FFIType.u32, FFIType.ptr, FFIType.u64], returns: FFIType.u32 },
    zhl_render_html: { args: [FFIType.u32, FFIType.ptr, FFIType.u64], returns: FFIType.u32 },
    zhl_result_ptr: { args: [], returns: FFIType.u64 },
    zhl_result_len: { args: [], returns: FFIType.u64 },
    zhl_result_free: { args: [], returns: FFIType.void },
  })
  return new Zhl(symbols)
}

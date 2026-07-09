/**
 * @zhl/wasm — browser-first ESM bindings for the zhl WebAssembly module.
 *
 * Zero dependencies, no Node builtins. Works in browsers, Node, Bun, Deno,
 * and workers as long as a `WebAssembly.Module`, wasm bytes, a `Response`,
 * or a fetchable URL is provided to `init()`.
 */

const TOKEN_SIZE = 16
const ERROR_NAMES = {
  100: 'out of memory',
  101: 'unknown language',
}

const encoder = new TextEncoder()
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
  /** @param {WebAssembly.Instance} instance */
  constructor(instance) {
    this._exports = instance.exports
    const version = this._exports.zhl_api_version()
    if (version !== 1) {
      throw new Error(`zhl: unsupported ABI version ${version} (expected 1)`)
    }
    if (this._exports.zhl_token_size() !== TOKEN_SIZE) {
      throw new Error('zhl: unexpected token size, ABI mismatch')
    }
  }

  /**
   * Resolve a language name (canonical or alias) to a numeric id.
   * Returns 0 if the language is unknown.
   * @param {string} name
   * @returns {number}
   */
  languageId(name) {
    const bytes = encoder.encode(name)
    const ptr = this._alloc(bytes)
    try {
      return this._exports.zhl_language_from_name(ptr, bytes.length)
    } finally {
      this._exports.zhl_free(ptr, bytes.length)
    }
  }

  /**
   * Highlight `code` and return a copy of the raw token bytes.
   * @param {number|string} lang - language id or name
   * @param {string} code
   * @returns {{ count: number, bytes: Uint8Array }}
   */
  highlightRaw(lang, code) {
    const count = this._runHighlight(lang, code)
    const resultPtr = this._exports.zhl_result_ptr()
    // memory.buffer may have been detached by growth during the call;
    // always re-read it after the exported calls above.
    const view = new Uint8Array(this._exports.memory.buffer, resultPtr, count * TOKEN_SIZE)
    return { count, bytes: view.slice() }
  }

  /**
   * Highlight `code` and decode tokens into plain objects.
   * @param {number|string} lang - language id or name
   * @param {string} code
   * @returns {Array<{start: number, end: number, styleId: number, scopeStackId: number, languageId: number, flags: number}>}
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
   * Fast path: highlight and return only the token count, without copying
   * token bytes out of wasm memory.
   * @param {number|string} lang - language id or name
   * @param {string} code
   * @returns {number}
   */
  highlightTokenCount(lang, code) {
    return this._runHighlight(lang, code)
  }

  /**
   * Render `code` as HTML.
   * @param {number|string} lang - language id or name
   * @param {string} code
   * @returns {string}
   */
  renderHtml(lang, code) {
    const langId = this._resolveLang(lang)
    const bytes = encoder.encode(code)
    const ptr = this._alloc(bytes)
    let rc
    try {
      rc = this._exports.zhl_render_html(langId, ptr, bytes.length)
    } finally {
      this._exports.zhl_free(ptr, bytes.length)
    }
    if (rc !== 0) throw new ZhlError('zhl_render_html', rc)
    const resultPtr = this._exports.zhl_result_ptr()
    const resultLen = this._exports.zhl_result_len()
    const view = new Uint8Array(this._exports.memory.buffer, resultPtr, resultLen)
    return decoder.decode(view)
  }

  /** Runs zhl_highlight and returns the token count. */
  _runHighlight(lang, code) {
    const langId = this._resolveLang(lang)
    const bytes = encoder.encode(code)
    const ptr = this._alloc(bytes)
    let rc
    try {
      rc = this._exports.zhl_highlight(langId, ptr, bytes.length)
    } finally {
      this._exports.zhl_free(ptr, bytes.length)
    }
    if (rc !== 0) throw new ZhlError('zhl_highlight', rc)
    return this._exports.zhl_result_len()
  }

  _resolveLang(lang) {
    if (typeof lang === 'number') return lang
    const id = this.languageId(lang)
    if (id === 0) throw new Error(`zhl: unknown language "${lang}"`)
    return id
  }

  /** Allocates wasm memory and copies `bytes` into it. Returns the pointer. */
  _alloc(bytes) {
    const ptr = this._exports.zhl_alloc(bytes.length)
    if (ptr === 0 && bytes.length > 0) {
      throw new Error('zhl: zhl_alloc failed (out of memory)')
    }
    // Re-acquire the buffer: zhl_alloc may grow memory and detach old views.
    new Uint8Array(this._exports.memory.buffer, ptr, bytes.length).set(bytes)
    return ptr
  }
}

/**
 * Initialize the zhl wasm module.
 *
 * @param {WebAssembly.Module | ArrayBuffer | ArrayBufferView | Response | URL | string} source
 *   A compiled module, raw wasm bytes, a fetch Response, or a URL/string to fetch.
 * @returns {Promise<Zhl>}
 */
export async function init(source) {
  if (typeof source === 'string' || source instanceof URL) {
    source = await fetch(source)
  }

  let instance
  if (source instanceof WebAssembly.Module) {
    instance = await WebAssembly.instantiate(source, {})
  } else if (typeof Response !== 'undefined' && source instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        // Clone so the fallback below still has an unconsumed body.
        ;({ instance } = await WebAssembly.instantiateStreaming(source.clone(), {}))
      } catch {
        // Fall through to ArrayBuffer path (e.g. wrong MIME type).
      }
    }
    if (!instance) {
      const bytes = await source.arrayBuffer()
      ;({ instance } = await WebAssembly.instantiate(bytes, {}))
    }
  } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    ;({ instance } = await WebAssembly.instantiate(source, {}))
  } else {
    throw new TypeError('zhl: init() expects a WebAssembly.Module, wasm bytes, Response, or URL')
  }

  return new Zhl(instance)
}

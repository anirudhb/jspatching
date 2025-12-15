/** Webpack hooking tools */

// Ref: https://gist.github.com/0xdevalias/8c621c5d09d780b1d321bfdb86d67cdd

/* Discord-type */
type _1__webpack_exports__type = {
  exports?: Record<string, any> & {
    default: any;
  };
};
type _1__webpack_require__type = ((n: any) => any) & {
  c: Record<string, _1__webpack_exports__type>;
};
type _1_WebpackChunkInfo = {
  type: 1;
  chunk: any;
  require: _1__webpack_require__type;
};

/* Slack-type */
type _2__webpack_exports__type = Record<string, any>;
type _2__webpack_require__type = (n: string) => _2__webpack_exports__type;
type _2_WebpackModuleChunkInfo = [
  /* chunk ids */ string[],
  /* modules */ Record<string, any>,
  /* init function? */ undefined | Function,
];
type _2_WebpackChunkInfo = {
  type: 2;
  chunk: _2_WebpackModuleChunkInfo[];
  require: _2__webpack_require__type;
};

type WebpackChunkInfo = _1_WebpackChunkInfo | _2_WebpackChunkInfo;
let __webpackChunkRegistry = new Map<Symbol, WebpackChunkInfo>();
let __webpackModuleRegistry = new Map<string, any>();

if (globalThis.__webpackChunkRegistry)
  __webpackChunkRegistry = globalThis.__webpackChunkRegistry;
if (globalThis.__webpackModuleRegistry)
  __webpackModuleRegistry = globalThis.__webpackModuleRegistry;

/**
 * Internal hooking function for 3-type webpack chunks.
 */
function __internal_3type_hookWebpackChunk(webpackChunk: any, chunkId: any, type: WebpackChunkInfo["type"], sym?: Symbol): Symbol {
  /* Don't double hook */
  if (sym && __webpackChunkRegistry.has(sym))
    return sym;

  let _require: any | null = null;

  webpackChunk.push([
    /* chunk ids */ [chunkId],
    /* modules */ {},
    /* init function */ (U: any) => _require = U,
  ]);

  const s = sym ?? Symbol(webpackChunk.toString());
  __webpackChunkRegistry.set(s, {
    type,
    chunk: webpackChunk,
    require: _require!,
  });
  return s;
}

/**
 * Hooks the given webpack chunk (type 1). See __internal_3type_hookWebpackChunk.
 */
export function _1_hookWebpackChunk(webpackChunk: any, key?: string): Symbol {
  return __internal_3type_hookWebpackChunk(webpackChunk, 1337, 1, key ? Symbol.for(`_1_hookWebpackChunk_${key}`) : undefined);
}

/**
 * Hooks the given webpack chunk (type 2). See __internal_3type_hookWebpackChunk.
 */
export function _2_hookWebpackChunk(webpackChunk: any, key?: string): Symbol {
  return __internal_3type_hookWebpackChunk(webpackChunk, "1337", 2, key ? Symbol.for(`_2_hookWebpackChunk_${key}`) : undefined);
}

/**
 * Tries to find a webpack module from the given chunk (type 1) and return it.
 * Uses the given filter function and returns the first result.
 */
function _1__chunk_tryFindWebpackModule(chunk: _1_WebpackChunkInfo, filter: (m: any) => boolean): any[] {
  let candidates = [];
  for (const v of Object.values(chunk.require.c)) {
    if (v.exports && filter(v.exports.default))
      candidates.push(v.exports.default);
  }
  return candidates;
}

/**
 * Tries to find a webpack module from the given chunk (type 2). See _1__chunk_tryFindWebpackModule.
 */
function _2__chunk_tryFindWebpackModule(chunk: _2_WebpackChunkInfo, filter: (m: any) => boolean): any[] {
  let candidates = [];
  for (const ci of chunk.chunk) {
    for (const mi of Object.keys(ci[1])) {
      try {
        const m = chunk.require(mi);
        if (!m)
          continue;
        if (filter(m))
          candidates.push(m);
        /* try checking exports */
        for (const v of Object.values(m))
          if (v && filter(v))
            candidates.push(v);
      } catch (_) {}
    }
  }
  return candidates;
}

/**
 * Tries to find a webpack module from the given chunk id. See __map_tryFindWebpackModule.
 */
function __chunkId_tryFindWebpackModule(cid: Symbol, filter: (m: any) => boolean): any[] {
  const chunk = __webpackChunkRegistry.get(cid);
  if (chunk === undefined)
    return null;

  if (chunk.type == 1) {
    return _1__chunk_tryFindWebpackModule(chunk, filter);
  } else if (chunk.type == 2) {
    return _2__chunk_tryFindWebpackModule(chunk, filter);
  }

  return null;
}

/**
 * Tries to find a webpack module. See __map_tryFindWebpackModule.
 */
export function tryFindWebpackModule(filter: (m: any) => boolean, all: boolean = false): any | null {
  for (const cid of __webpackChunkRegistry.keys()) {
    const r = __chunkId_tryFindWebpackModule(cid, filter);
    if (r.length)
      return all ? r : r[0];
  }
  return null;
}

/**
 * Populates the given module name with the given filter, if a matching module is found.
 * Returns the matched module, if any, or the existing one in the registry.
 */
export function tryPopulateModule(name: string, filter: (m: any) => boolean): any | null {
  const m = tryFindWebpackModule(filter);
  if (m != null)
    __webpackModuleRegistry.set(name, m);
  return m ?? __webpackModuleRegistry.get(name) ?? null;
}

/*
 * Performs a require based on webpackModuleRegistry.
 * If the argument is a function, it is used as a filter function instead.
 */
function __nothrow_webpackRequire2(arg: string | ((m: any) => boolean)): any | null {
  if (typeof arg === "string") {
    const m = __webpackModuleRegistry.get(arg);
    if (m !== undefined) {
      return m;
    } else {
      return null;
    }
  } else {
    return tryFindWebpackModule(arg);
  }
}

/**
 * Performs a require based on webpackModuleRegistry. See __nothrow_webpackRequire2.
 */
export function webpackRequire2(arg: string | ((m: any) => boolean)): any {
  const r = __nothrow_webpackRequire2(arg);
  if (r == null)
    throw new Error(`Module ${arg} not found`);
  return r;
}

/** Expose on window */
let o = {
  __webpackChunkRegistry,
  __webpackModuleRegistry,
  _1_hookWebpackChunk,
  _2_hookWebpackChunk,
  tryFindWebpackModule,
  tryPopulateModule,
  webpackRequire2,
};

for (const [k, v] of Object.entries(o)) {
  globalThis[k] = v;
}

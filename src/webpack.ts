/** Webpack hooking tools */
//import * as utils from "./utils";

// Ref: https://gist.github.com/0xdevalias/8c621c5d09d780b1d321bfdb86d67cdd

/* TODO: support non 3type stuff, for now we just assume everything is 3type for simplicity */

export type WebpackModuleId = {
  chunkName: string;
  moduleId: string;
  chunkIds: string[];
};
export type WebpackExportId<T = any> = {
  moduleId: WebpackModuleId;
  // null indicates top-level
  export: string | null;
};
export type WebpackImported<I extends WebpackMatcher | WebpackExportId> = I extends WebpackExportId<infer T>
  ? T
  : I extends WebpackMatcher<infer T>
    ? T
    : never;

// Require functions for 3type Webpack chunks, keyed by chunk name
let __3type_webpackRequires = new Map<string, _3type_webpack_require_type>();
if (globalThis.__3type_webpackRequires)
  __3type_webpackRequires = globalThis.__3type_webpackRequires;

export type _3type_webpack_require_type = (n: any) => any;
/**
 * module: {
 *  exports: object;
 *  id: number;
 *  loaded: boolean;
 * }
 * exports seems to only have getters (citation needed), if there is a "default" export it will be module.exports
 */
export type _3type_webpack_module_function = (module: any, exports: any, require: _3type_webpack_require_type) => void;
type _3type_WebpackPushArg = [
  /* chunk ids */ string[],
  /* modules */ Record<string, _3type_webpack_module_function>,
  /* init */ (require: _3type_webpack_require_type) => void,
];
export type _3type_WebpackPatch = {
  // for debugging
  debugName: string;
  moduleId: string;
  patch: (f: _3type_webpack_module_function) => _3type_webpack_module_function;
};

/**
 * Hooking function for 3-type webpack chunks (early).
 * If globalThis[chunkName] is already defined, this is a no-op.
 * Applies the given patches.
 */
export function _3type_hookWebpackChunkEarly(chunkName: string, patches: _3type_WebpackPatch[]) {
  if (globalThis[chunkName])
    return;

  // sort patches by module id
  const patchesById = new Map<string, _3type_WebpackPatch[]>();
  for (const p of patches) {
    if (!patchesById.has(p.moduleId))
      patchesById.set(p.moduleId, []);
    patchesById.get(p.moduleId).push(p);
  }

  let a = [];
  let webpackPush: (...args: any[]) => any | null = null;
  let origPush: typeof Array.prototype.push = a.push.bind(a);

  function push2(...elements: _3type_WebpackPushArg[]): number {
    let count = 0;
    for (const el of elements) {
      /* check if this has already been patched
       * added since the original webpack push function calls this again */
      if ((el as any).__patched || !webpackPush) {
        count += origPush(el);
        continue;
      }
      /* patch it */
      if (el[1]) {
        for (const k of Object.keys(el[1])) {
          let module = el[1][k];
          // Apply patches if any
          const modulePatches = patchesById.get(k);
          if (modulePatches && modulePatches.length) {
            for (const p of modulePatches) {
              console.log(`[jspatching] Patching module ID ${k} with patch ${p.debugName}`);
              module = p.patch(module);
            }
            // remove patches
            patchesById.delete(k);
          }
          el[1][k] = module;
        }
      }
      // XXX: should not be necessary
      //if (el[2]) {
      //  const origInit = el[2];
      //  const patchedInit: typeof origInit = (r) => {
      //    const r2 = makePatchingRequire(chunkName, r);
      //    return origInit(r2);
      //  };
      //  el[2] = patchedInit;
      //}
      // mark as patched
      (el as any).__patched = true;
      // call the original push function
      count += webpackPush(el);
    }
    return count;
  }

  globalThis[chunkName] = new Proxy(a, {
    get(target, p, _receiver) {
      if (p !== "push")
        return Reflect.get(target, p);
      return push2;
    },
    set(target, p, newValue, _receiver) {
      if (p !== "push")
        return Reflect.set(target, p, newValue);
      webpackPush = newValue;
      return true;
    },
  });
}

/**
 * Retrieves an object by its export id given the 3type require function.
 * Does not check the chunk name!
 */
function _3type_requireWebpackExport<T = any>(r: _3type_webpack_require_type, id: WebpackExportId<T>): T | null {
  // Get the module
  const m = r(id.moduleId.moduleId);
  if (!m)
    return null;
  // Get the prop if needed
  if (id.export !== null)
    return m[id.export];
  else
    return m;
}
export const requireWebpackExport: typeof _3type_requireWebpackExport = _3type_requireWebpackExport;

/**
 * Populates a 3type webpack require function.
 * No-op if the chunk does not exist or the require is already populated.
 * Returns the new function.
 */
export function _3type_populateWebpackRequire(chunkName: string): _3type_webpack_require_type | null {
  if (__3type_webpackRequires.has(chunkName))
    return __3type_webpackRequires.get(chunkName);
  if (!globalThis[chunkName])
    return null;

  const chunk = globalThis[chunkName] as ({
    push(arg: _3type_WebpackPushArg): void;
  });
  let r: _3type_webpack_require_type;
  chunk.push([
    [`1337_jspatching_${Math.random()}`],
    // FIXME: should we actually stub a dummy module here?
    {},
    (_require) => r = _require,
  ]);
  __3type_webpackRequires.set(chunkName, r);
  return r;
}

export type WebpackMatcher<T = any> = (m: any) => boolean;
/**
 * Finds an export ID on an existing 3type Webpack chunk.
 */
function _3type_tryFindWebpackExportId(chunkName: string, filter: WebpackMatcher, all: true) : WebpackExportId[];
function _3type_tryFindWebpackExportId(chunkName: string, filter: WebpackMatcher, all?: boolean): WebpackExportId | null;
function _3type_tryFindWebpackExportId(chunkName: string, filter: WebpackMatcher, all: boolean = false): WebpackExportId[] | WebpackExportId | null {
  if (!globalThis[chunkName])
    return null;
  const chunk = globalThis[chunkName] as [string[], Record<string, any>, Function][];

  const r = _3type_populateWebpackRequire(chunkName);
  if (!r)
    return null;

  let candidates: WebpackExportId[] = [];
  for (const chunk2 of chunk) {
    for (const moduleId of Object.keys(chunk2[1])) {
      try {
        const m = r(moduleId);
        if (!m)
          continue;
        const mid = {
          chunkName,
          moduleId,
          chunkIds: chunk2[0],
        } satisfies WebpackModuleId;
        if (filter(m))
          candidates.push({
            moduleId: mid,
            export: null,
          });
        // XXX: use getOwnPropertyNames instead of keys to get computed props
        for (const k of Object.getOwnPropertyNames(m)) {
          const v = m[k];
          if (filter(v))
            candidates.push({
              moduleId: mid,
              export: k,
            });
        }
      } catch {}
    }
  }
  return all === true ? candidates : candidates.at(0) ?? null;
}
export const tryFindWebpackExportId: typeof _3type_tryFindWebpackExportId = _3type_tryFindWebpackExportId;

/** Expose on globalThis */
let o = {
  __3type_webpackRequires,
  _3type_hookWebpackChunkEarly,
  _3type_requireWebpackExport,
  _3type_populateWebpackRequire,
  _3type_tryFindWebpackExportId,
  requireWebpackExport,
  tryFindWebpackExportId,
};

for (const [k, v] of Object.entries(o)) {
  globalThis[k] = v;
}

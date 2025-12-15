/** Webpack hooking tools */
import * as utils from "./utils";

// Ref: https://gist.github.com/0xdevalias/8c621c5d09d780b1d321bfdb86d67cdd

type WebpackModuleId = {
  chunkName: string;
  moduleId: string;
};
type WebpackExportId = {
  moduleId: WebpackModuleId;
  // null indicates top-level
  export: string | null;
};

type WebpackPatcher = (e: any) => any;
type WebpackPatch = {
  // "patch name" => patcher, for removal later
  patches: Record<string, WebpackPatcher>;
};

// TODO: figure out a better way to do this

function webpackModuleIdToKey(i: WebpackModuleId): string {
  return `${i.chunkName}\x00${i.moduleId}`;
}

function webpackModuleIdFromKey(s: string): WebpackModuleId {
  let [chunkName, moduleId] = s.split("\x00");
  return { chunkName, moduleId };
}

function webpackExportIdToKey(i: WebpackExportId): string {
  return `${i.moduleId.chunkName}\x00${i.moduleId.moduleId}\x00${i.export ?? "\xff"}`;
}

function webpackExportIdFromKey(s: string): WebpackExportId {
  let [chunkName, moduleId, exp] = s.split("\x00");
  return { moduleId: { chunkName, moduleId }, export: exp == "\xff" ? null : exp };
}

// Webpack modules (exports), keyed by their original IDs
let __webpackModuleRegistry = new Map</*WebpackModuleId*/string, {
  original: any;
  proxy: any;
}>();
// Mappings from pretty names to actual Webpack module IDs
let __webpackMappings = new Map<string, WebpackExportId>();
// Patches for Webpack modules
let __webpackPatchRegistry = new Map</*WebpackExportId*/string, WebpackPatch>();

if (globalThis.__webpackModuleRegistry)
  __webpackModuleRegistry = globalThis.__webpackModuleRegistry;
if (globalThis.__webpackMappings)
  __webpackMappings = globalThis.__webpackMappings;
if (globalThis.__webpackPatchRegistry)
  __webpackPatchRegistry = globalThis.__webpackPatchRegistry;

type _3type_webpack_require_type = (n: any) => any;
type _3type_webpack_module_function = (module: any, exports: any, require: _3type_webpack_require_type) => void;
type _3type_WebpackPushArg = [
  /* chunk ids */ string[],
  /* modules */ Record<string, _3type_webpack_module_function>,
  /* init */ (require: _3type_webpack_require_type) => void,
];

function patchedProxy(id: WebpackExportId, orig: any, bounceSet: boolean = true): any {
  //console.log(`[Rope] creating patchedProxy for ${JSON.stringify(id)} with original:`);
  //console.log(orig);
  const memProxy = utils.memoizeProxy(() => [__webpackPatchRegistry.get(webpackExportIdToKey(id))], (patchData) => {
    if (!patchData)
      return orig;

    /* FIXME: what to do about patches possibly (erroneously?) modifying the original object? */
    let final = orig;
    for (const patch of Object.values(patchData.patches)) {
      final = patch(final);
    }
    return final;
  }, true);
  // necessary for "sub-exports" which may just be normal props
  return bounceSet ? utils.setBouncerProxy(memProxy, orig) : memProxy;
}

function isAllowedPatchable(x: any): boolean {
  return (typeof x === "object" || typeof x === "function") && x !== null;
}

/**
 * Patches the given webpack module from the given chunk.
 */
function patchWebpackModule(moduleId: WebpackModuleId, origModule: any): any {
  const baseId = {
    moduleId,
    export: null,
  } satisfies WebpackExportId;
  const patchedRoot = patchedProxy(baseId, origModule, /* we wrap the proxy again */ false);
  let proxies = new Map();
  return utils.setBouncerProxy(new Proxy(patchedRoot, {
    get(target, p, _receiver) {
      if (p === "__patchedModule")
        return true;
      const orig = Reflect.get(target, p);
      return orig; // temp
      const origDescriptor = Reflect.getOwnPropertyDescriptor(target, p);

      /* symbols are never exports */
      if (typeof p === "symbol")
        return orig;
      /* only patch own properties */
      if (!Object.hasOwnProperty.call(target, p))
        return orig;
      /* only patch configurable properties */
      if (!(origDescriptor.configurable ?? true))
        return orig;

      /* inherently not patchable */
      if (!isAllowedPatchable(orig))
        return orig;

      if (proxies.has(p))
        return proxies.get(p);
      const pVal = patchedProxy({ ...baseId, export: p }, Reflect.get(target, p));
      proxies.set(p, pVal);
      return pVal;
    },
  }), origModule);
}

function makePatchingRequire(chunkName: string, r: _3type_webpack_require_type): _3type_webpack_require_type {
  const r2: typeof r = (n) => {
    const modId = {
      chunkName,
      moduleId: n,
    } satisfies WebpackModuleId;
    const modIdK = webpackModuleIdToKey(modId);
    if (__webpackModuleRegistry.has(modIdK))
      return __webpackModuleRegistry.get(modIdK).proxy;

    const orig = r(n);
    /* no double patches */
    if (orig.__patchedModule === true)
      return orig;
    /* inherently not patchable */
    if (!isAllowedPatchable(orig))
      return orig;
    //console.log(`[Rope] require is patching for chunk ${chunkName} moduleId ${n}`);
    const patched = patchWebpackModule(modId, orig);
    __webpackModuleRegistry.set(modIdK, {
      original: orig,
      proxy: patched,
    });
    return patched;
  };
  // important for things like require.O
  return new Proxy(r, {
    apply: (_target, thiz, args) => Reflect.apply(r2, thiz, args),
  });
}

/**
 * Hooking function for 3-type webpack chunks (early).
 * If globalThis[chunkName] is already defined, this is a no-op.
 */
export function _3type_hookWebpackChunkEarly(chunkName: string) {
  if (globalThis[chunkName])
    return;

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
          const origModule = el[1][k];
          const patchedModule: typeof origModule = (m, e, r) => {
            const r2 = makePatchingRequire(chunkName, r);
            return origModule(m, e, r2);
          };
          el[1][k] = patchedModule;
        }
      }
      if (el[2]) {
        const origInit = el[2];
        const patchedInit: typeof origInit = (r) => {
          const r2 = makePatchingRequire(chunkName, r);
          (r2 as any).__patchedRequireForInit = true;
          return origInit(r2);
        };
        el[2] = patchedInit;
      }
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

/** Expose on globalThis */
let o = {
  __webpackModuleRegistry,
  __webpackMappings,
  __webpackPatchRegistry,
  _3type_hookWebpackChunkEarly,
};

for (const [k, v] of Object.entries(o)) {
  globalThis[k] = v;
}

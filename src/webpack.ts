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
  patches: Map<string, WebpackPatcher>;
};

// TODO: figure out a better way to do this

function webpackModuleIdToKey(i: WebpackModuleId): string {
  return `${i.chunkName}\x00${i.moduleId}`;
}

function webpackModuleIdFromKey(s: string): WebpackModuleId {
  let [chunkName, moduleId] = s.split("\x00");
  return { chunkName, moduleId };
}

function webpackModuleIdEqual(x1?: WebpackModuleId, x2?: WebpackModuleId): boolean {
  return x1 && x2 && x1.chunkName === x2.chunkName && x1.moduleId === x2.moduleId;
}

type WebpackModuleInfo = {
  original: any;
  proxy: any;
};

// Webpack modules (exports), keyed by their original IDs
let __webpackModuleRegistry = new Map</*WebpackModuleId*/string, WebpackModuleInfo>();
// Mappings from pretty names to actual Webpack module IDs
let __webpackMappings = new Map<string, WebpackExportId>();
// Patches for Webpack modules
// module id => export | null (toplevel) => WebpackPatch
let __webpackPatchRegistry = new Map</*WebpackModuleId*/string, Map<string | null, WebpackPatch>>();
// Canaries for Webpack patches
// Values are replaced with non-equivalent objects when the patch registry for that key changes
let __webpackPatchCanaries = new Map</*WebpackModuleId*/string, any>();

// Early module catchers that run with original id and modules
// Entries are removed once they return a non-falsey value.
// If a function is returned, it is invoked right after patching - NOTE these only get called if the module is patchable.
// Note that this runs *before* patching so this can be used to patch the very first require of a module
let __webpackEarlyCatchers = new Map<symbol, (id: WebpackModuleId, m: any) => boolean | (() => void)>();

if (globalThis.__webpackModuleRegistry)
  __webpackModuleRegistry = globalThis.__webpackModuleRegistry;
if (globalThis.__webpackMappings)
  __webpackMappings = globalThis.__webpackMappings;
if (globalThis.__webpackPatchRegistry)
  __webpackPatchRegistry = globalThis.__webpackPatchRegistry;
if (globalThis.__webpackPatchCanaries)
  __webpackPatchCanaries = globalThis.__webpackPatchCanaries;
if (globalThis.__webpackEarlyCatchers)
  __webpackEarlyCatchers = globalThis.__webpackEarlyCatchers;

type _3type_webpack_require_type = (n: any) => any;
type _3type_webpack_module_function = (module: any, exports: any, require: _3type_webpack_require_type) => void;
type _3type_WebpackPushArg = [
  /* chunk ids */ string[],
  /* modules */ Record<string, _3type_webpack_module_function>,
  /* init */ (require: _3type_webpack_require_type) => void,
];

function isAllowedPatchable(x: any): boolean {
  return (typeof x === "object" || typeof x === "function") && x !== null;
}

/**
 * Patches the given webpack module from the given chunk.
 */
function patchWebpackModule(moduleId: WebpackModuleId, origModule: any): any {
  const moduleIdK = webpackModuleIdToKey(moduleId);

  /**
   * We know this is static because we don't allow additional non-configurable props to be defined,
   * and this proxy (and the module itself) holds the only reference to the original exports object
   * (assuming that the patches play nice and don't touch it). Modules get a proxy to the original
   * exports object that doesn't allow defining non-configurable props.
   */
  const nonConfigurableProps = Object.getOwnPropertyDescriptors(origModule);
  for (const [k, v] of Object.entries(nonConfigurableProps))
    if (!(v.configurable ?? true))
      delete nonConfigurableProps[k];
  Object.freeze(nonConfigurableProps);

  /* Patched internal objects/props */
  const patchCache = new Map<string | null, any>();
  /* Proxies to props - these are only created once, never purged */
  const propProxies = new Map<string, any>();
  const propsWithGetters = new Set<string>();
  let lastCanary = Symbol();
  const patchedModule = { moduleId, origModule };
  Object.freeze(patchedModule);

  function invalidateCacheIfNeeded() {
    const o = __webpackPatchCanaries.get(moduleIdK);
    if (o && !Object.is(o, lastCanary)) {
      lastCanary = o;
      patchCache.clear();
    }
  }

  /* Retrieves a patched object possibly from cache */
  function getPatched(key: string | null, original: () => any) {
    const v = patchCache.get(key);
    if (v)
      return v;
    /* patch */
    let final = original();
    const p = __webpackPatchRegistry.get(moduleIdK)?.get(key);
    if (p)
      for (const patch of p.patches.values())
        final = patch(final);
    patchCache.set(key, final);
    return final;
  }

  /* Retrieves a prop proxy possibly from cache
    If the original is not proxyable, returns it */
  function getPropProxy(key: string, original: () => any) {
    const v = propProxies.get(key);
    if (v)
      return v;
    const orig = original();
    if (typeof orig !== "object" || typeof orig !== "function")
      return orig;
    const orig2 = () => orig;

    /* static */
    const nonConfigurableProps = Object.getOwnPropertyDescriptors(orig);
    for (const [k, v] of Object.entries(nonConfigurableProps))
      if (!(v.configurable ?? true))
        delete nonConfigurableProps[k];
    Object.freeze(nonConfigurableProps);

    const bindCache = new WeakMap();
    const handler = {
      apply: (_target, thiz, args) => {
        invalidateCacheIfNeeded();
        return Reflect.apply(getPatched(key, orig2), thiz, args);
      },
      construct: (_target, args, newTarget) => {
        invalidateCacheIfNeeded();
        return Reflect.construct(getPatched(key, orig2), args, newTarget);
      },
      defineProperty: (target, prop, attrs) => {
        if (!(attrs?.configurable ?? true))
          attrs.configurable = true;
        patchCache.delete(key);
        return Reflect.defineProperty(target, prop, attrs);
      },
      deleteProperty: (target, p) => {
        patchCache.delete(key);
        return Reflect.deleteProperty(target, p);
      },
      get: (target, p, _receiver) => {
        if (typeof p !== "string" || p in nonConfigurableProps)
          return Reflect.get(target, p);
        invalidateCacheIfNeeded();
        const x = Reflect.get(getPatched(key, orig2), p);
        if (typeof x === "function")
          if (bindCache.has(x))
            return bindCache.get(x);
          else try {
            const x2 = x.bind(target);
            bindCache.set(x, x2);
            return x2;
          } catch {};
        return x;
      },
      getOwnPropertyDescriptor: (target, p) => {
        if (typeof p === "string" && p in nonConfigurableProps)
          return nonConfigurableProps[p];
        invalidateCacheIfNeeded();
        return Reflect.getOwnPropertyDescriptor(getPatched(key, orig2), p);
      },
      getPrototypeOf: (target) => {
        invalidateCacheIfNeeded();
        return Reflect.getPrototypeOf(getPatched(key, orig2));
      },
      has: (target, p) => {
        if (p in nonConfigurableProps)
          return true;

        invalidateCacheIfNeeded();
        return Reflect.has(getPatched(key, orig2), p);
      },
      /* isExtensible passed through */
      ownKeys: (target) => {
        invalidateCacheIfNeeded();
        return Reflect.ownKeys(getPatched(key, orig2));
      },
      /* FIXME (?) */
      preventExtensions: (target) => true,
      set: (target, p, newValue, _receiver) => {
        patchCache.clear();
        return Reflect.set(target, p, newValue);
      },
      /* FIXME (?) */
      setPrototypeOf: (target, v) => false,
    } satisfies ProxyHandler<any>;
    Object.freeze(handler);

    const final = new Proxy(orig, handler);
    propProxies.set(key, final);
    return final;
  }

  const handler = {
    apply: (target, thiz, args) => {
      invalidateCacheIfNeeded();
      return Reflect.apply(getPatched(null, () => target), thiz, args);
    },
    construct: (target, args, newTarget) => {
      invalidateCacheIfNeeded();
      return Reflect.construct(getPatched(null, () => target), args, newTarget);
    },
    defineProperty: (target, prop, attrs) => {
      if (!(attrs?.configurable ?? true))
        attrs.configurable = true;
      ///* patch getter to return proxy */
      if (typeof prop === "string" && attrs.get) {
        const oldGet = attrs.get;
        //getters.set(prop, oldGet);
        //attrs.get = () => getGetterProxy(target, prop, true);
        attrs.get = () => getPropProxy(prop, oldGet);
      }
      patchCache.clear();
      const r = Reflect.defineProperty(target, prop, attrs);
      if (typeof prop === "string" && attrs.get && r)
        propsWithGetters.add(prop);
      return r;
    },
    deleteProperty: (target, p) => {
      patchCache.clear();
      return Reflect.deleteProperty(target, p);
    },
    get: (target, p, _receiver) => {
      //if (typeof p !== "string" || p in nonConfigurableProps)
      //  return Reflect.get(target, p);
      if (typeof p !== "string" || !(Reflect.getOwnPropertyDescriptor(target, p)?.configurable ?? true))
        return Reflect.get(target, p);
      if (p === "__patchedModule")
        return patchedModule;

      invalidateCacheIfNeeded();
      /* Conjecture: props without getters are always accessed explicitly from the root export */
      if (propsWithGetters.has(p))
        // don't double patch
        return Reflect.get(target, p);
      else
        return getPatched(p, () => Reflect.get(target, p));
      //return getPropProxy(p, () => Reflect.get(target, p));
    },
    getOwnPropertyDescriptor: (target, p) => {
      if (typeof p === "string" && p in nonConfigurableProps)
        return nonConfigurableProps[p];
      if (!(Reflect.getOwnPropertyDescriptor(target, p)?.configurable ?? true))
        return Reflect.getOwnPropertyDescriptor(target, p);
      invalidateCacheIfNeeded();
      return Reflect.getOwnPropertyDescriptor(getPatched(null, () => target), p);
    },
    getPrototypeOf: (target) => {
      invalidateCacheIfNeeded();
      return Reflect.getPrototypeOf(getPatched(null, () => target));
    },
    has: (target, p) => {
      if (p in nonConfigurableProps || p === "__patchedModule")
        return true;
      if (typeof p !== "string")
        return Reflect.has(target, p);

      invalidateCacheIfNeeded();
      return Reflect.has(getPatched(null, () => target), p);
    },
    /* isExtensible passed through */
    ownKeys: (target) => {
      invalidateCacheIfNeeded();
      return Reflect.ownKeys(getPatched(null, () => target));
    },
    /* preventExtensions passed through */
    set: (target, p, newValue, _receiver) => {
      patchCache.clear();
      return Reflect.set(target, p, newValue);
    },
    setPrototypeOf: (target, v) => {
      patchCache.clear();
      return Reflect.setPrototypeOf(target, v);
    },
  } satisfies ProxyHandler<any>;
  Object.freeze(handler);
  return new Proxy(origModule, handler);
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
    // seems to be unnecessary
    //if (webpackModuleIdEqual(orig.__patchedModule?.moduleId, modId))
    //  return orig;

    /* run early catchers */
    let postCallbacks = [];
    for (const [k, v] of __webpackEarlyCatchers.entries()) {
      const r = v(modId, orig);
      if (r)
        __webpackEarlyCatchers.delete(k);
      if (typeof r === "function")
        postCallbacks.push(r);
    }

    /* inherently not patchable */
    if (!isAllowedPatchable(orig))
      return orig;
    //console.log(`[Rope] require is patching for chunk ${chunkName} moduleId ${n}`);
    const patched = patchWebpackModule(modId, orig);
    __webpackModuleRegistry.set(modIdK, {
      original: orig,
      proxy: patched,
    });

    /* run post-callbacks from early catchers */
    for (const cb of postCallbacks)
      cb();

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
            /* don't allow setting non-configurable props on exports as they cannot be overriden later */
            const e2 = utils.setBouncerProxy(e, e, true);
            return origModule(m, e2, r2);
          };
          el[1][k] = patchedModule;
        }
      }
      if (el[2]) {
        const origInit = el[2];
        const patchedInit: typeof origInit = (r) => {
          const r2 = makePatchingRequire(chunkName, r);
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

export type FoundWebpackExport = {
  id: WebpackExportId;
  // The original export
  export: any;
  // Patched proxy of the toplevel module this export is part of
  parentProxy: any;
};

/**
 * Finds an (original) export by a filter function.
 */
export function tryFindWebpackExport(filter: (m: any) => boolean, all: true): FoundWebpackExport[];
export function tryFindWebpackExport(filter: (m: any) => boolean, all?: boolean): FoundWebpackExport | null;
export function tryFindWebpackExport(filter: (m: any) => boolean, all: boolean = false): FoundWebpackExport[] | FoundWebpackExport | null {
  let candidates: FoundWebpackExport[] = [];
  for (const [moduleIdK, module] of __webpackModuleRegistry.entries()) {
    const moduleId = webpackModuleIdFromKey(moduleIdK);
    const orig = module.original;
    if (filter(orig)) {
      candidates.push({
        id: { moduleId, export: null },
        export: orig,
        parentProxy: module.proxy,
      });
    }
    for (const [k, v] of Object.entries(orig))
      if (filter(v))
        candidates.push({
          id: { moduleId, export: k },
          export: v,
          parentProxy: module.proxy,
        });
  }
  return all === true ? candidates : candidates.at(0) ?? null;
}

/**
 * Inserts a patch with the given name for the given export.
 * If you just want to modify a single property of a top-level export,
 * you *should* pass an exportId with export=that property's key.
 * Returns a function that deletes the patch by key, equivalent to calling deleteWebpackPatch.
 */
export function insertWebpackPatch<T = any>(exportId: WebpackExportId, name: string, patch: (x: T) => T): () => void {
  const { moduleId, export: exp } = exportId;
  const moduleIdK = webpackModuleIdToKey(moduleId);
  if (!__webpackPatchRegistry.has(moduleIdK))
    __webpackPatchRegistry.set(moduleIdK, new Map());
  let modulePatchMap = __webpackPatchRegistry.get(moduleIdK);
  if (!modulePatchMap.has(exp))
    modulePatchMap.set(exp, { patches: new Map() });
  let exportPatchMap = modulePatchMap.get(exp);
  exportPatchMap.patches.set(name, patch);
  /* invalidate */
  __webpackPatchCanaries.set(moduleIdK, Symbol());
  return () => {
    deleteWebpackPatch(exportId, name);
  };
}

/**
 * Deletes a patch with the given name for the given export.
 * Returns true if the patch was present.
 */
export function deleteWebpackPatch(exportId: WebpackExportId, name: string): boolean {
  const { moduleId, export: exp } = exportId;
  const moduleIdK = webpackModuleIdToKey(moduleId);
  const modulePatchMap = __webpackPatchRegistry.get(moduleIdK);
  if (!modulePatchMap)
    return false;
  const exportPatchMap = modulePatchMap.get(exp);
  if (!exportPatchMap)
    return false;
  /* invalidate */
  __webpackPatchCanaries.set(moduleIdK, Symbol());
  return exportPatchMap.patches.delete(name);
}

/**
 * Populates the given pretty name with the given matcher.
 * If a module cannot be found when this function is called,
 * an early catcher is added.
 *
 * Returns a factory that allows registering callbacks to be run once the module is populated.
 * If the module was already found, the callbacks are run immediately.
 */
export function earlyPopulatePrettyWebpackExport(name: string, matcher: (m: any) => boolean): {
  pre: (cb: (i: WebpackExportId) => void) => void;
  post: (cb: (i: WebpackExportId) => void) => void;
} {
  const existing = tryFindWebpackExport(matcher);
  if (existing) {
    __webpackMappings.set(name, existing.id);
    const f = (x: any) => { x(existing.id); };
    return { pre: f, post: f };
  }
  let preCallbacks = [];
  let postCallbacks = [];
  let foundId: WebpackExportId | null = null;
  const catcher = (modId: WebpackModuleId, m: any) => {
    let finalId: WebpackExportId | null = null;
    // check root
    if (matcher(m))
      finalId = { moduleId: modId, export: null };
    // check props, but try to be graceful
    if (finalId === null)
      for (const k of Object.keys(m)) {
        try {
          const v = m[k];
          if (matcher(v)) {
            finalId = { moduleId: modId, export: k };
            break;
          }
        } catch {}
      }
    if (finalId === null) {
      return false;
    } else {
      /* set */
      __webpackMappings.set(name, finalId);
      /* run callbacks */
      foundId = finalId;
      for (const cb of preCallbacks) {
        cb(finalId);
      }
      preCallbacks.length = 0;
      return () => {
        for (const cb of postCallbacks) {
          cb(finalId);
        }
      };
    }
  };
  const s = Symbol(`webpack-early-catcher-${name}-${matcher}`);
  __webpackEarlyCatchers.set(s, catcher);
  return {
    pre: (x) => {
      if (foundId !== null) {
        x(foundId);
      } else {
        preCallbacks.push(x);
      }
    },
    post: (x) => {
      if (foundId !== null) {
        x(foundId);
      } else {
        postCallbacks.push(x);
      }
    },
  };
}

/**
 * Looks up a Webpack module by id.
 */
export function findWebpackModule(id: WebpackModuleId): WebpackModuleInfo | null {
  const idK = webpackModuleIdToKey(id);
  return __webpackModuleRegistry.get(idK) ?? null;
}

/**
 * Looks up a Webpack export by id.
 */
export function findWebpackExport(id: WebpackExportId): FoundWebpackExport | null {
  const m = findWebpackModule(id.moduleId);
  if (!m)
    return null;
  const v = id.export === null ? m.original : m.original[id.export];
  return {
    id,
    export: v,
    parentProxy: m.proxy,
  };
};

/**
 * Looks up a Webpack export by pretty name.
 */
export function prettyFindWebpackExport(name: string): FoundWebpackExport | null {
  const id = __webpackMappings.get(name);
  if (!id)
    return null;
  return findWebpackExport(id);
}

/**
 * Returns a virtual reference to a possibly unpopulated pretty Webpack export.
 * Using this reference before the export is present will likely throw an error.
 */
export function virtualPrettyWebpackExport<T = any>(name: string): T {
  return utils.forwardingProxy(() => prettyFindWebpackExport(name)?.export);
}

/**
 * Populates a Webpack export and returns a virtual reference to it.
 */
export function virtualPopulatePrettyWebpackExport<T = any>(name: string, matcher: (m: any) => boolean): T {
  earlyPopulatePrettyWebpackExport(name, matcher);
  return virtualPrettyWebpackExport<T>(name);
}

/** Expose on globalThis */
let o = {
  __webpackModuleRegistry,
  __webpackMappings,
  __webpackPatchRegistry,
  __webpackPatchCanaries,
  __webpackEarlyCatchers,
  _3type_hookWebpackChunkEarly,
  tryFindWebpackExport,
  insertWebpackPatch,
  deleteWebpackPatch,
  earlyPopulatePrettyWebpackExport,
  findWebpackModule,
  findWebpackExport,
  prettyFindWebpackExport,
  virtualPrettyWebpackExport,
  virtualPopulatePrettyWebpackExport,
};

for (const [k, v] of Object.entries(o)) {
  globalThis[k] = v;
}

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
  const patched = utils.memoizeProxy<any, [Map<string | null, WebpackPatch>, ...string[]]>(() => {
    const p = __webpackPatchRegistry.get(moduleIdK);
    return [p, ...(p?.keys() ?? [])];
  }, (patchMap, ..._keys) => {
    if (!patchMap)
      return origModule;

    let final = origModule;
    let rootPatchData = patchMap.get(null);
    if (rootPatchData) {
      for (const p of rootPatchData.patches.values())
        final = p(final);
    }
    let overlays = [final];
    for (const [k, v] of patchMap.entries()) {
      if (k === null)
        continue;
      for (const p of v.patches.values()) {
        const patched = p(final[k]);
        overlays.push({ [k]: patched });
      }
    }
    overlays.reverse();
    return utils.overlayProxy(overlays);
  });
  /* mark as patched */
  const patchedWithMark = new Proxy(patched, {
    get(target, p, _receiver) {
      if (p === "__patchedModule") {
        return { moduleId, origModule };
      }
      return Reflect.get(target, p);
    },
  });
  const p = utils.setBouncerProxy(patchedWithMark, origModule, true);
  /* patch defineProperty so that getters run patches */
  return new Proxy(p, {
    defineProperty: (target, prop, attrs) => {
      if (attrs.get && typeof prop === "string") {
        const origGet = attrs.get;
        attrs.get = () => {
          return utils.memoizeProxy<any, [any, WebpackPatch]>(() => {
            return [origGet(), __webpackPatchRegistry.get(moduleIdK)?.get(prop)];
          }, (orig, patch) => {
            if (!patch)
              return orig;

            let final = orig;
            for (const v of patch.patches.values())
              final = v(final);
            return final;
          });
        };
      }
      return Reflect.defineProperty(target, prop, attrs);
    },
  });
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

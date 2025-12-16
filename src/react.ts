/** React hooking tools */

import * as webpack from "./webpack";
import * as utils from "./utils";

// FIXME: what to do about normal class components?
let __reactComponentRegistry = new Map<string, React.FC>();

if (globalThis.__reactComponentRegistry)
  __reactComponentRegistry = globalThis.__reactComponentRegistry;

// patches for named components
type ReactPatch = {
  patcher: (c: React.FC) => React.FC;
  tester: (p: any) => boolean;
};
let __reactPatchRegistry = new Map<string, ReactPatch>();
// component => patcher => patched
let __reactPatchCache = new Map<React.FC, Map<any, React.FC>>();

declare global {
  var __real_createElement: typeof import("react").createElement;
}

export function init() {
  // FIXME: this doesn't need an init function

  /* Populate modules */
  globalThis.React = utils.overlayProxy([
    { createElement },
    webpack.virtualPrettyWebpackExport("react"),
  ]) as typeof import("react");
  const dom1 = webpack.virtualPopulatePrettyWebpackExport("react-dom", m => m.render || m.createPortal);
  const dom2 = webpack.virtualPopulatePrettyWebpackExport("react-dom/client", m => m.createRoot || m.hydrateRoot);
  globalThis._ReactDOM = dom1;
  globalThis._ReactDOMClient = dom2;
  globalThis.ReactDOM = utils.overlayProxy([dom1, dom2]) as typeof import("react-dom") & typeof import("react-dom/client");

  /* Save createElement */
  globalThis.__real_createElement = utils.forwardingProxy(() => globalThis.React.createElement);
  /* Populate and hook React */
  let { pre, post } = webpack.earlyPopulatePrettyWebpackExport("react", m => m.createElement || m.Component || m.useState);
  pre((i) => {
    /* Require that a module was found */
    if (i.export !== null) {
      throw new Error("React export was not a top-level module!");
    }

    /* Hook createElement */
    webpack.insertWebpackPatch({ ...i, export: "createElement" }, "jspatching/react", (_) => createElement);
  });
  post((i) => {
    /* fix-up React and createElement */
    const e = webpack.findWebpackExport(i);
    globalThis.__real_createElement = e.export.createElement;
    globalThis.React = e.parentProxy;
  });
}

function patchOrCache(x: React.FC, patcher: (c: React.FC) => React.FC): React.FC {
  if (__reactPatchCache.has(x)) {
    const c1 = __reactPatchCache.get(x);
    if (c1.has(patcher)) {
      return c1.get(patcher);
    } else {
      const r = patcher(x);
      c1.set(patcher, r);
      return r;
    }
  } else {
    const r = patcher(x);
    const c1 = new Map();
    c1.set(patcher, r);
    __reactPatchCache.set(x, c1);
    return r;
  }
}

/**
 * Hooked createElement
 */
const createElement = function(type: any, props: any, ...children: any[]) {
  // devirtualize
  if (type.__isForwardedProxy)
    type = type.__thunkValue;
  const name = typeof type === "string" ? type : getComponentName(type);
  if (__reactPatchRegistry.has(name)) {
    const patch = __reactPatchRegistry.get(name);
    if (patch.tester(props)) {
      type = patchOrCache(type, patch.patcher);
    }
  }
  return globalThis.__real_createElement(type, props, ...children);
} as typeof globalThis.React.createElement;

export function patchComponentWithTester<P = {}>(name: string, tester: (p: P) => boolean, patcher: (c: React.FC<P>) => React.FC<P>): () => void {
  let revoked = false;
  const prevPatch = __reactPatchRegistry.get(name) ?? null;
  const prevPatcher = prevPatch?.patcher ?? null;
  const prevTester = prevPatch?.tester ?? null;
  const patcher2 = (old: React.FC<P>) => {
    let old2 = (props: P) => globalThis.__real_createElement(old, props);
    (old2 as any).displayName = `OriginalThunk(${getComponentName(old)})`;
    if (prevPatch !== null)
      old2 = prevPatcher(old2) as any;
    if (revoked) {
      //console.log(`patcher running for ${name} ${sym.toString()} (revoked)`);
      return old2;
    } else {
      //console.log(`patcher running for ${name} ${sym.toString()} (real)`);
      const patched = patcher(old2);
      (patched as any).displayName = `Patch(${getComponentName(old)})`;
      return patched;
    }
  };
  const tester2 = (props: any) => {
    return (revoked ? false : tester(props)) || (prevTester?.(props) ?? false);
  };
  __reactPatchRegistry.set(name, {
    tester: tester2,
    patcher: patcher2,
  });
  // XXX: can't just remove the patcher entry here and restore
  // prevPatch because there could have been more patches added.
  return () => {
    revoked = true;
    // FIXME: a better way to do this
    __reactPatchCache.clear();
  };
}

function trueTester(_: any): boolean {
  return true;
}

/*
 * patchComponentWithTester with friendlier type annotations.
 */
export function patchComponentWithTester2<C extends React.FC>(c: C, tester: (p: React.ComponentProps<C>) => boolean, patcher: (c: C) => (p: React.ComponentProps<C>) => C): () => void {
  return patchComponentWithTester<React.ComponentProps<C>>(getComponentName(c), tester as any, patcher as any);
}

/**
 * Patches the given named component and returns the revoke function.
 */
export function patchComponent<P = {}>(name: string, patcher: (c: React.FC<P>) => React.FC<P>): () => void {
  return patchComponentWithTester<P>(name, trueTester, patcher);
}

/*
 * patchComponent with friendlier type annotations.
 */
export function patchComponent2<C extends React.FC>(c: C, patcher: (c: C) => (p: React.ComponentProps<C>) => C): () => void {
  return patchComponent<React.ComponentProps<C>>(getComponentName(c), patcher as any);
}

/*
 * Tries to find the name of the given React component/whatever.
 */
export function getComponentName(c: any): string | null {
  if (!c)
    return null;

  if (c.displayName)
    return c.displayName || null;
  if (c.$$typeof === Symbol.for("react.memo"))
    return getComponentName(c.type);
  if (c.$$typeof === Symbol.for("react.forward_ref"))
    return c.displayName || c.render?.displayName || c.render?.name || null;

  return null;
}

/**
 * Tries to find a webpack module whose default export is a React component by the given name.
 */
export function tryFindReactComponent<P = {}>(name: string): React.FC<P> | null {
  return webpack.tryFindWebpackExport(m => getComponentName(m) === name)?.export;
}

/**
 * Tries to populate a React component by the given name. Returns the matched component if any.
 * If the given component already exists, returns that instead.
 */
export function tryPopulateReactComponent<P = {}>(name: string): React.FC<P> | null {
  let c = __reactComponentRegistry.get(name) ?? null;
  if (c === null)
    c = tryFindReactComponent<P>(name);
  if (c != null)
    __reactComponentRegistry.set(name, c);
  return c;
}

/**
 * Thunk dispenser that creates virtual components by name.
 * Names are populated early.
 */
export function virtualComponent<P = {}>(name: string): React.FC<P> {
  return utils.forwardingProxy(() => tryPopulateReactComponent(name) ?? { displayName: name } as any);
}

/** Expose on window */
let o = {
  __reactComponentRegistry,
  getComponentName,
  patchComponent,
  tryFindReactComponent,
  tryPopulateReactComponent,
  virtualComponent,
};

for (const [k, v] of Object.entries(o)) {
  globalThis[k] = v;
}

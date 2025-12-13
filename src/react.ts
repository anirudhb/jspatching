/** React hooking tools */

import * as webpack from "./webpack";

export function init() {
  /* Populate modules */
  globalThis.React = webpack.tryPopulateModule("react", m => m.createElement || m.Component || m.useState) as typeof import("react");
  let dom1 = webpack.tryPopulateModule("react-dom", m => m.render || m.createPortal);
  let dom2 = webpack.tryPopulateModule("react-dom/client", m => m.createRoot || m.hydrateRoot);
  globalThis.ReactDOM = {...dom1, ...dom2} as typeof import("react-dom") & typeof import("react-dom/client");
}

/* FIXME: very hacky */
//let React = utils.forwardingProxy(() => globalThis.React);
//let ReactDOM = utils.forwardingProxy(() => globalThis.ReactDOM);

// FIXME: what to do about normal class components?
let __reactComponentRegistry = new Map<string, React.FC>();

if (globalThis.__reactComponentRegistry)
  __reactComponentRegistry = globalThis.__reactComponentRegistry;

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
  return webpack.tryFindWebpackModule(m => getComponentName(m) === name);
}

/**
 * Tries to populate a React component by the given name. Returns the matched component if any.
 */
export function tryPopulateReactComponent<P = {}>(name: string): React.FC<P> | null {
  const c = tryFindReactComponent<P>(name);
  if (c != null)
    __reactComponentRegistry.set(name, c);
  return c;
}

/**
 * Rewrites a createElement tree using __reactComponentRegistry, component names prefixed with "Component$".
 * Drop-in replacement for React.createElement
 */
export function rewriteTree(tree: React.ReactElement): React.ReactElement {
  /* primitives */
  if (typeof tree !== "object")
    return tree;

  let ty = tree.type;
  if (typeof tree.type === "string" && tree.type.startsWith("Component$")) {
    const name = tree.type.substring("Component$".length);
    let c = __reactComponentRegistry.get(name);
    if (c === undefined) {
      /* try to populate */
      c = tryPopulateReactComponent(name);
    }
    if (c) {
      ty = c;
    } else {
      console.warn(`Failed to rewrite tree: couldn't find component ${tree.type}`);
    }
  }

  return {
    ...tree,
    type: ty,
    props: typeof tree.props === "object" ? {
      ...tree.props,
      ...("children" in tree.props ? { children: rewriteTree((tree.props as any).children) } : {}),
    } : tree.props,
  };
}

/**
 * Thunk dispenser that creates virtual components by name.
 */
export function virtualComponent<P = {}>(name: string): React.FC<P> {
  function f(props: P): React.ReactNode {
    return globalThis.React.createElement(`Component\$${name}`, props);
  }
  return f;
}

/**
 * Populates a component and returns a virtual thunk to it.
 */
export function tryVirtualizeReactComponent<P = {}>(name: string): React.FC<P> {
  tryPopulateReactComponent(name);
  return virtualComponent(name);
}

/** Expose on window */
let o = {
  __reactComponentRegistry,
  getComponentName,
  tryFindReactComponent,
  tryPopulateReactComponent,
  rewriteTree,
  virtualComponent,
  tryVirtualizeReactComponent,
};

for (const [k, v] of Object.entries(o)) {
  globalThis[k] = v;
}

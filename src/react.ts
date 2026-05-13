/** React hooking tools */

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
 * Imbues the given component with the patched name of the "original" component.
 * Modifies the object in place.
 */
export function patchedComponent<T>(orig: any, component: T): T {
  const n = getComponentName(orig);
  if (n)
    (component as any).displayName = `Patched(${n})`;
  return component;
}

/** Expose on window */
let o = {
  getComponentName,
  patchedComponent,
};

for (const [k, v] of Object.entries(o)) {
  globalThis["react$" + k] = v;
}

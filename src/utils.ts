/** Utilities */

// Creates a forwarding thunk *readonly* Proxy.
// Useful when early-binding to a late-bound object.
// Attempting to modify the given Proxy is a no-op.
export function forwardingProxy<T extends object = any>(thunk: () => T, hide: boolean = false, useFirst: boolean = false, initialValue: any = function() {}): T {
  return new Proxy<T>(useFirst ? thunk() : initialValue as any, {
    apply: (target, thiz, args) => {
      const t = thunk() as any;
      //return Reflect.apply(target as any, t, args);
      return Reflect.apply(t, thiz, args);
    },
    construct: (target, args, newTarget) => Reflect.construct(thunk() as any, args, newTarget),
    defineProperty: (target, prop, attrs) => false,
    deleteProperty: (target, p) => false,
    get: (target, p, receiver) => {
      const d = Reflect.getOwnPropertyDescriptor(target, p);
      /* must return original if non-configurable */
      if (!(d?.configurable ?? true))
        return Reflect.get(target, p);
      if (!hide) {
        if (p === "__isForwardedProxy") {
          return true;
        } else if (p === "__thunkValue") {
          return thunk();
        }
      }
      const t = thunk() as any;
      return Reflect.get(t, p, t);
    },
    getOwnPropertyDescriptor: (target, p) => {
      /* must return its descriptor */
      if (Reflect.has(target, p))
        return Reflect.getOwnPropertyDescriptor(target, p);
      return Reflect.getOwnPropertyDescriptor(thunk(), p);
    },
    getPrototypeOf: (target) => Reflect.getPrototypeOf(thunk()),
    has: (target, p) => Reflect.has(thunk(), p),
    /* isExtensible must be passed through */
    //isExtensible: (target) => /* must be passed through */ Reflect false,
    ownKeys: (target) => Reflect.ownKeys(thunk()),
    preventExtensions: (target) => true,
    set: (target, p, newValue, receiver) => false,
    setPrototypeOf: (target, v) => false,
  });
}

/**
 * Memoizes the result of a function with the given inputs.
 * Returns a forwardingProxy to the memoized result.
 * Inputs are compared using Object.is
 */
export function memoizeProxy<
  T extends object = any,
  Args extends any[] = any[]
>(
  deps: () => Args,
  transformer: (...args: Args) => T,
  hide: boolean = false,
): T {
  let cachedDeps = undefined;
  let cached = undefined;
  return forwardingProxy<T>(() => {
    const newDeps = deps();
    let needsUpdate = typeof newDeps?.length === "undefined" || typeof cachedDeps?.length === "undefined" || newDeps.length != cachedDeps.length;
    if (!needsUpdate)
      for (let i = 0; i < cachedDeps.length; i++)
        if (!Object.is(cachedDeps[i], newDeps[i])) {
          needsUpdate = true;
          break;
        }
    if (needsUpdate) {
      // copy
      cachedDeps = [...newDeps];
      cached = transformer(...cachedDeps);
    }
    return cached;
  }, hide, true);
}

/**
 * Creates a proxy that forwards all set ops to the given object.
 * !!! WARNING !!! This may cause inconsistent behavior
 */
export function setBouncerProxy<T extends object = any>(target: T, setter: T, forceConfigurable: boolean = false): T {
  //let bindCache = new WeakMap();
  return new Proxy(target, {
    // FIXME: is this needed?
    //get(target, p, receiver) {
    //  /* rebind functions that get called with this=receiver */
    //  const x = Reflect.get(target, p);
    //  if (false || typeof x === "function") {
    //    if (bindCache.has(x))
    //      return bindCache.get(x);
    //    const px = new Proxy(x, {
    //      apply: (target2, thiz, args) => {
    //        if (thiz === receiver)
    //          thiz = setter;
    //        //if (thiz === target2)
    //        //  thiz = x;
    //        //if (thiz === receiver || thiz === target)
    //        //  thiz = setter;
    //        return Reflect.apply(x, thiz, args);
    //      },
    //    });
    //    bindCache.set(x, px);
    //    return px;
    //  }
    //  return x;
    //},
    defineProperty: (_target, prop, attrs) => {
      if (forceConfigurable)
        attrs.configurable = true;
      return Reflect.defineProperty(setter, prop, attrs);
    },
    deleteProperty: (_target, p) => Reflect.deleteProperty(setter, p),
    isExtensible: (_target) => Reflect.isExtensible(setter),
    preventExtensions: (_target) => Reflect.preventExtensions(setter),
    set: (_target, p, newValue, _receiver) => Reflect.set(setter, p, newValue),
  });
}

/**
 * Creates a proxy that overlays multiple objects together.
 * Objects at the start of the array are searched first.
 * Read-only, like forwardingProxy.
 * Miscellany like function calls forward to the last object.
 */
export function overlayProxy<T extends object = any>(objects: T[], hide: boolean = false): T {
  if (objects.length === 1)
    return objects[0];
  return new Proxy<T>(objects[objects.length-1], {
    /* pass through apply and construct, they should throw */
    defineProperty: (target, prop, attrs) => false,
    deleteProperty: (target, p) => false,
    get: (target, p, receiver) => {
      const d = Reflect.getOwnPropertyDescriptor(target, p);
      /* must return original if non-configurable */
      if (!(d?.configurable ?? true))
        return Reflect.get(target, p);
      if (!hide) {
        if (p === "__isOverlayProxy") {
          return true;
        } else if (p === "__underlyingObjects") {
          return objects;
        }
      }
      for (const o of objects) {
        const v = Reflect.get(o, p);
        if (v !== undefined)
          return v;
      }
      return undefined;
    },
    getOwnPropertyDescriptor: (target, p) => {
      /* must return its descriptor */
      if (Reflect.has(target, p))
        return Reflect.getOwnPropertyDescriptor(target, p);
      for (const o of objects) {
        const d = Reflect.getOwnPropertyDescriptor(o, p);
        if (d !== undefined)
          return d;
      }
      return undefined;
    },
    /* pass through getPrototypeOf */
    has: (target, p) => {
      for (const o of objects)
        if (Reflect.has(o, p))
          return true;
      return false;
    },
    /* isExtensible must be passed through */
    ownKeys: (target) => {
      let ownKeys = new Set<string | symbol>();
      for (const o of objects)
        for (const k of Reflect.ownKeys(o))
          ownKeys.add(k);
      return [...ownKeys];
    },
    preventExtensions: (target) => true,
    set: (target, p, newValue, receiver) => false,
    setPrototypeOf: (target, v) => false,
  });
}

/** Expose on globalThis */
let o = {
  forwardingProxy,
  memoizeProxy,
  setBouncerProxy,
  overlayProxy,
};

for (const [k, v] of Object.entries(o)) {
  globalThis["utils$" + k] = v;
}

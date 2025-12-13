/** Utilities */

// Creates a forwarding thunk *readonly* Proxy.
// Useful when early-binding to a late-bound object.
// Attempting to modify the given Proxy is a no-op.
export function forwardingProxy<T extends object = any>(thunk: () => T): T {
  return new Proxy<T>((function() {}) as any, {
    apply: (target, thiz, args) => {
      const t = thunk() as any;
      return Reflect.apply(t, t, args);
    },
    construct: (target, args, newTarget) => Reflect.construct(thunk() as any, args, newTarget),
    defineProperty: (target, prop, attrs) => false,
    deleteProperty: (target, p) => false,
    get: (target, p, receiver) => {
      if (p === "__isForwardedProxy") {
        return true;
      } else if (p === "__thunkValue") {
        return thunk();
      }
      const t = thunk() as any;
      return Reflect.get(t, p, t);
    },
    getOwnPropertyDescriptor: (target, p) => Reflect.getOwnPropertyDescriptor(thunk(), p),
    getPrototypeOf: (target) => Reflect.getPrototypeOf(thunk()),
    has: (target, p) => Reflect.has(thunk(), p),
    isExtensible: (target) => false,
    ownKeys: (target) => Reflect.ownKeys(thunk()),
    preventExtensions: (target) => true,
    set: (target, p, newValue, receiver) => false,
    setPrototypeOf: (target, v) => false,
  });
}

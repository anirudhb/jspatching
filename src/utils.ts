/** Utilities */

// Creates a forwarding thunk *readonly* Proxy.
// Useful when early-binding to a late-bound object.
// Attempting to modify the given Proxy is a no-op.
// *This is slow!*
// Every operation on the Proxy calls the thunk, so try to avoid using this.
export function forwardingProxy<T extends object = any>(thunk: () => T): T {
  return new Proxy<T>(Object.create(null), {
    apply: (target, thiz, args) => Reflect.apply(thunk() as any, thiz, args),
    construct: (target, args, newTarget) => Reflect.construct(thunk() as any, args, newTarget),
    defineProperty: (target, prop, attrs) => false,
    deleteProperty: (target, p) => false,
    get: (target, p, receiver) => Reflect.get(thunk(), p, thunk()),
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

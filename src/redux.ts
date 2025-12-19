/** Redux patching tools */
import * as utils from "./utils";
import * as webpack from "./webpack";
import type * as redux from "redux";

/**
 * An extra word of caution.
 * Reducers should be idempotent and order-independent.
 */

type ReduxReducerPatch<S = any, A extends redux.Action = redux.UnknownAction> = (state: S, action: A, prevReducer: redux.Reducer<S, A>) => any;
type ReduxPatch = {
  // "patch name" => reducer patch, for removal later
  reducerPatches: Map<string, ReduxReducerPatch>;
};

type ReduxMatcher = (...args: Parameters<typeof redux.createStore>) => boolean;

// Redux stores with pretty names
let __reduxStoreRegistry = new Map<string, redux.Store>();
// Patches for Redux stores
let __reduxPatchRegistry = new Map<string, ReduxPatch>();
// Redux store catchers for pretty names
// Unnamed stores cannot be patched!
// Matchers are deleted once they are satisfied.
// It is undefined behavior for the same predicate to be assigned to multiple keys.
let __reduxStoreMatchers = new Map<string, ReduxMatcher>();

//let __reduxStores = [];
//
//if (globalThis.__reduxStores)
//  __reduxStores = globalThis.__reduxStores;

if (globalThis.__reduxStoreRegistry)
  globalThis.__reduxStoreRegistry = __reduxStoreRegistry;
if (globalThis.__reduxPatchRegistry)
  globalThis.__reduxPatchRegistry = __reduxPatchRegistry;

declare global {
  var __real_createStore: typeof import("redux").createStore;
}

/* Populate modules */
let { pre, post } = webpack.earlyPopulatePrettyWebpackExport("redux.createStore", m => m?.name === "createStore");
pre((i) => {
  /* Hook it */
  webpack.insertWebpackPatch(i, "jspatching/redux.createStore", (_) => createStore);
});
post((i) => {
  /* store the real one */
  const e = webpack.findWebpackExport(i);
  globalThis.__real_createStore = e.export;
});

/**
 * Hooked createStore
 */
const createStore = function(reducer, preloadedState, enhancer) {
  /* fix args */
  if (typeof preloadedState === "function" && typeof enhancer === "undefined") {
    (enhancer as any) = preloadedState;
    preloadedState = undefined;
  }

  console.log(`[Rope] redux createStore called with args`, reducer, preloadedState, enhancer);
  let storeName: string | null = null;
  for (const [k, v] of __reduxStoreMatchers.entries()) {
    if (v(reducer, preloadedState, enhancer)) {
      storeName = k;
      __reduxStoreMatchers.delete(k);
      break;
    }
  }
  if (storeName !== null)
    /* patch the reducer */
    reducer = patchReducer(reducer, storeName);

  // FIXME: devtools ext says the action payloads are too big to serialize
  ///* Redux devtools support */
  //if (enhancer && globalThis.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__)
  //  enhancer = globalThis.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__(enhancer);
  //else if (globalThis.__REDUX_DEVTOOLS_EXTENSION__)
  //  enhancer = globalThis.__REDUX_DEVTOOLS_EXTENSION__();

  ///* swap args back */
  if (typeof preloadedState === "undefined" && typeof enhancer !== "undefined") {
    (preloadedState as any) = enhancer;
    enhancer = undefined;
  }

  const store = globalThis.__real_createStore(reducer, preloadedState, enhancer);
  if (storeName !== null)
    __reduxStoreRegistry.set(storeName, store);
    ///* temp */
    //const oldDispatch = store.dispatch;
    //store.dispatch = (action, ...args) => {
    //  console.log(`[Rope] dispatcher for ${storeName} called with action`, action, args);
    //  return oldDispatch(action, ...args);
    //};

  return store;
} as typeof import("redux").createStore;

function patchReducer(origReducer: redux.Reducer, storeName: string): redux.Reducer {
  const r2: redux.Reducer = (state, action) => {
    const patch = __reduxPatchRegistry.get(storeName);
    if (!patch)
      return origReducer(state, action);

    let prev = origReducer;
    for (const [k, v] of patch.reducerPatches.entries()) {
      //console.log(`[Rope] running patch ${k} for store ${storeName}`);
      const oldPrev = prev;
      state = v(state, action, oldPrev);
      prev = (state, action) => v(state, action, oldPrev);
    }
    return state;
  };
  return r2;
  //return new Proxy(origReducer, {
  //  apply: (_target, thiz, args) => Reflect.apply(r2, thiz, args),
  //});
}

/**
 * Registers a matcher to assign a pretty name for a Redux store.
 * This allows its reducer to be patched.
 * Of note is that the initial state can be overriden by listening for the undefined action,
 * as noted in the Redux docs: https://redux.js.org/api/createstore#tips
 */
export function registerPrettyReduxMatcher(storeName: string, matcher: ReduxMatcher) {
  __reduxStoreMatchers.set(storeName, matcher);
}

/**
 * Inserts a reducer patch with the given name for the given store.
 *
 * Returns a function that deletes the patch by key, equivalent to calling deleteReduxReducerPatch.
 */
export function insertReduxReducerPatch<S = any, A extends redux.Action = redux.UnknownAction>(storeName: string, name: string, patcher: ReduxReducerPatch<S, A>): () => void {
  if (!__reduxPatchRegistry.has(storeName))
    __reduxPatchRegistry.set(storeName, { reducerPatches: new Map() });
  const p = __reduxPatchRegistry.get(storeName);
  p.reducerPatches.set(name, patcher);
  return () => {
    deleteReduxReducerPatch(storeName, name);
  };
}

/**
 * Deletes a reducer patch with the given name for the given store.
 * Returns true if the patch was present.
 */
export function deleteReduxReducerPatch(storeName: string, name: string): boolean {
  const p = __reduxPatchRegistry.get(storeName);
  if (!p)
    return false;
  return p.reducerPatches.delete(name);
}

/**
 * Returns a virtual ref to the Redux store by the given pretty name.
 */
export function virtualPrettyReduxStore(storeName: string): redux.Store {
  return utils.forwardingProxy(() => __reduxStoreRegistry.get(storeName));
}

/** Expose on window */
let o = {
  __reduxStoreRegistry,
  __reduxPatchRegistry,
  __reduxStoreMatchers,
  Redux_createStore: createStore,
  registerPrettyReduxMatcher,
  insertReduxReducerPatch,
  deleteReduxReducerPatch,
};

for (const [k, v] of Object.entries(o)) {
  globalThis[k] = v;
}

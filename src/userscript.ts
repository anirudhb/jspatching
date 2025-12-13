/* Userscript entry point */
async function sleep(ms: number) {
  await new Promise(r => setTimeout(r, ms));
}

async function main() {
  /* wait for 19 slack chunks
   * FIXME: deal with changing number of chunks in a better way */
  while ((window as any).webpackChunkwebapp?.length < 19)
    await sleep(10);

  await import("./main");
}

main();

//const globalThis_keys1 = Object.keys(globalThis);
//
//import "./main";
//
//const globalThis_keys2 = Object.keys(globalThis);
//
//// copy keys to unsafeWindow
//const unsafeWindow = globalThis.unsafeWindow;
//
//for (const k of globalThis_keys2)
//  if (!globalThis_keys1.includes(k))
//    unsafeWindow[k] = globalThis[k];

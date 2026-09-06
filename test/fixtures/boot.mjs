// Child-process boot harness. Spawned as `node test/fixtures/boot.mjs` with the
// per-scenario env already set (server.js reads env into module-load consts, so
// env MUST precede the import). Guarded by BOOT_FIXTURE so `node --test` loading
// this file as a stray test file is a no-op instead of binding a port.
if (process.env.BOOT_FIXTURE === "1") {
  const { start, __setSupabaseFactory } = await import("../../server.js");
  const { makeFakeFactory } = await import("./fake-supabase.mjs");
  __setSupabaseFactory(makeFakeFactory());
  start();
}

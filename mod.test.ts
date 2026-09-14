import { assertEquals, assertStrictEquals } from "@std/assert";
import createPullApp, {
  createPullApp as namedCreatePullApp,
  DEFAULT_PROCESSING_TIMEOUT_MS,
  getPullConfig,
  getRepoProcessor,
  processRepository,
  Pull,
  pullConfigSchema,
} from "./mod.ts";

Deno.test("root library entry point exposes the supported interface", () => {
  assertStrictEquals(createPullApp, namedCreatePullApp);
  assertEquals(typeof createPullApp, "function");
  assertEquals(typeof getRepoProcessor, "function");
  assertEquals(typeof processRepository, "function");
  assertEquals(typeof getPullConfig, "function");
  assertEquals(typeof Pull, "function");
  assertEquals(typeof pullConfigSchema.safeParse, "function");
  assertEquals(DEFAULT_PROCESSING_TIMEOUT_MS, 60_000);
});

Deno.test("documented subpath exports resolve", async () => {
  const [app, processor, pull, schema] = await Promise.all([
    import("./src/app.ts"),
    import("./src/processor/index.ts"),
    import("./src/processor/pull.ts"),
    import("./src/utils/schema.ts"),
  ]);
  assertEquals(typeof app.createPullApp, "function");
  assertEquals(typeof processor.getRepoProcessor, "function");
  assertEquals(typeof pull.Pull, "function");
  assertEquals(typeof schema.pullConfigSchema.safeParse, "function");
});

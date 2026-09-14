import { assertEquals } from "@std/assert";
import { missingRepositoryResponse } from "@/src/router/repo-response.ts";

Deno.test("missing repository response explains installation requirement", () => {
  assertEquals(missingRepositoryResponse("dockur/zima"), {
    statusCode: 404,
    body: {
      status: "error",
      message:
        "Repository 'dockur/zima' is not registered. Install the Pull GitHub App on this repository before checking its configuration.",
    },
  });
});

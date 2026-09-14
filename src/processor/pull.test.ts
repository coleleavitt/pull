import { assertEquals, assertRejects } from "@std/assert";
import { Pull } from "@/src/processor/pull.ts";

type CompareStatus = "ahead" | "behind" | "diverged" | "identical";

function makePull(
  status: CompareStatus,
  options: { compareError?: Error; updateError?: Error } = {},
) {
  const compareCalls: unknown[] = [];
  const graphqlCalls: unknown[] = [];
  const github = {
    repos: {
      compareCommits: (args: unknown) => {
        compareCalls.push(args);
        if (options.compareError) throw options.compareError;
        return Promise.resolve({
          data: {
            status,
            ahead_by: status === "ahead" || status === "diverged" ? 1 : 0,
          },
        });
      },
    },
    graphql: (query: string, variables: unknown) => {
      graphqlCalls.push({ query, variables });
      if (options.updateError) throw options.updateError;
      return Promise.resolve({ updateRefs: { clientMutationId: null } });
    },
  };
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    error: () => undefined,
  };
  const pull = new Pull(
    github as never,
    { owner: "fork", repo: "repo", logger: logger as never },
    {
      version: "1",
      rules: [{
        base: "main",
        upstream: "source:main",
        mergeMethod: "hardreset",
        mergeUnstable: false,
        assignees: [],
        reviewers: [],
        conflictReviewers: [],
      }],
      label: "pull",
      conflictLabel: "conflict",
    },
  );
  const hardReset = (pull as unknown as {
    hardResetCommit(
      baseRef: string,
      expectedBaseSha: string,
      upstreamSha: string,
      repositoryId: string,
      force?: boolean,
    ): Promise<void>;
  }).hardResetCommit.bind(pull);
  return { hardReset, compareCalls, graphqlCalls };
}

Deno.test("safe hardreset atomically advances a behind destination", async () => {
  const { hardReset, compareCalls, graphqlCalls } = makePull("behind");
  await hardReset("main", "destination-sha", "upstream-sha", "repository-id");

  assertEquals(compareCalls, [{
    owner: "fork",
    repo: "repo",
    base: "upstream-sha",
    head: "destination-sha",
    per_page: 1,
  }]);
  assertEquals(graphqlCalls.length, 1);
  const call = graphqlCalls[0] as {
    query: string;
    variables: Record<string, unknown>;
  };
  assertEquals(call.variables, {
    repositoryId: "repository-id",
    refName: "refs/heads/main",
    beforeOid: "destination-sha",
    afterOid: "upstream-sha",
    force: true,
  });
  assertEquals(call.query.includes("beforeOid: $beforeOid"), true);
});

Deno.test("safe hardreset is a no-op for identical commits", async () => {
  const { hardReset, graphqlCalls } = makePull("identical");
  await hardReset("main", "same-sha", "same-sha", "repository-id");
  assertEquals(graphqlCalls, []);
});

for (const status of ["ahead", "diverged"] as const) {
  Deno.test(`safe hardreset rejects a ${status} destination`, async () => {
    const { hardReset, graphqlCalls } = makePull(status);
    await assertRejects(
      () =>
        hardReset("main", "destination-sha", "upstream-sha", "repository-id"),
      Error,
      "unique commits",
    );
    assertEquals(graphqlCalls, []);
  });
}

Deno.test("safe hardreset fails closed when compare fails", async () => {
  const { hardReset, graphqlCalls } = makePull("behind", {
    compareError: new Error("compare unavailable"),
  });
  await assertRejects(
    () => hardReset("main", "destination-sha", "upstream-sha", "repository-id"),
    Error,
    "compare unavailable",
  );
  assertEquals(graphqlCalls, []);
});

Deno.test("safe hardreset fails when destination changes after compare", async () => {
  const { hardReset, graphqlCalls } = makePull("behind", {
    updateError: new Error("beforeOid does not match the current ref"),
  });
  await assertRejects(
    () => hardReset("main", "destination-sha", "upstream-sha", "repository-id"),
    Error,
    "beforeOid",
  );
  assertEquals(graphqlCalls.length, 1);
});

Deno.test("forcehardreset explicitly bypasses compare but retains the SHA lease", async () => {
  const { hardReset, compareCalls, graphqlCalls } = makePull("diverged");
  await hardReset(
    "main",
    "destination-sha",
    "upstream-sha",
    "repository-id",
    true,
  );
  assertEquals(compareCalls, []);
  assertEquals(graphqlCalls.length, 1);
});

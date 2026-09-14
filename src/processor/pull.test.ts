import { assert, assertEquals, assertMatch } from "@std/assert";
import { Pull } from "@/src/processor/pull.ts";
import type { PullConfig, PullRule } from "@/src/utils/schema.ts";
import type { ProbotOctokit } from "probot";

interface Call {
  name: string;
  args: Record<string, unknown>;
}

const config: PullConfig = {
  version: "1",
  label: "pull",
  conflictLabel: "conflict",
  rules: [{
    base: "fork",
    upstream: "upstream:main",
    mergeMethod: "reverse-rebase",
    mergeUnstable: false,
    assignees: [],
    reviewers: [],
    conflictReviewers: [],
  }],
};
const rule = config.rules[0];
const incoming = {
  number: 7,
  base: { ref: "fork", sha: "fork-old", repo: { node_id: "repo-node" } },
  head: { ref: "main", sha: "upstream-new" },
};

function fixture(options: {
  createRefError?: unknown;
  createPRError?: unknown;
  mergeError?: unknown;
  merged?: boolean;
  baseSha?: string;
  temporarySha?: string;
  deleteError?: unknown;
  leaseError?: unknown;
} = {}) {
  const calls: Call[] = [];
  let tempRef = "";
  let tempMerged = false;
  const record = (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
  };
  const github = {
    graphql: (query: string, variables: Record<string, unknown>) => {
      record("graphql", { query, ...variables });
      if (options.leaseError) throw options.leaseError;
      return { updateRefs: { clientMutationId: null } };
    },
    git: {
      createRef: (args: Record<string, unknown>) => {
        record("git.createRef", args);
        if (options.createRefError) throw options.createRefError;
        tempRef = String(args.ref).replace("refs/heads/", "");
        return { data: {} };
      },
      getRef: (args: Record<string, unknown>) => {
        record("git.getRef", args);
        const sha = String(args.ref) === "heads/fork"
          ? options.baseSha ?? "fork-old"
          : options.temporarySha ?? (tempMerged ? "rebased" : "upstream-new");
        return { data: { object: { sha } } };
      },
      updateRef: (args: Record<string, unknown>) => {
        record("graphql", args);
        return { data: {} };
      },
      deleteRef: (args: Record<string, unknown>) => {
        record("git.deleteRef", args);
        if (options.deleteError) throw options.deleteError;
        return { data: {} };
      },
    },
    pulls: {
      create: (args: Record<string, unknown>) => {
        record("pulls.create", args);
        if (options.createPRError) throw options.createPRError;
        return {
          data: {
            number: 99,
            state: "open",
            head: { ref: "fork", sha: "fork-old" },
            base: { ref: tempRef, sha: "upstream-new" },
          },
        };
      },
      merge: (args: Record<string, unknown>) => {
        record("pulls.merge", args);
        if (options.mergeError) throw options.mergeError;
        const merged = options.merged ?? true;
        tempMerged = merged;
        return { data: { merged, sha: "rebased" } };
      },
      get: (args: Record<string, unknown>) => {
        record("pulls.get", args);
        return {
          data: {
            number: 99,
            state: "open",
            head: { ref: "fork" },
            base: { ref: tempRef },
          },
        };
      },
      update: (args: Record<string, unknown>) => {
        record("pulls.update", args);
        return { data: {} };
      },
      requestReviewers: (args: Record<string, unknown>) => {
        record("pulls.requestReviewers", args);
        return { data: {} };
      },
    },
    issues: {
      getLabel: (args: Record<string, unknown>) => {
        record("issues.getLabel", args);
        return { data: {} };
      },
      update: (args: Record<string, unknown>) => {
        record("issues.update", args);
        return { data: {} };
      },
      createLabel: (args: Record<string, unknown>) => {
        record("issues.createLabel", args);
        return { data: {} };
      },
    },
  } as unknown as ProbotOctokit;
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    error: () => undefined,
  };
  const processor = new Pull(github, {
    owner: "owner",
    repo: "repo",
    logger: logger as never,
  }, config);
  const run = () =>
    (processor as unknown as {
      reverseRebase(value: unknown, selectedRule: PullRule): Promise<boolean>;
    }).reverseRebase(incoming, rule);
  return { calls, run };
}

Deno.test("reverse-rebase verifies SHAs, updates base to merge result, and cleans up", async () => {
  const { calls, run } = fixture();
  assertEquals(await run(), true);
  assertEquals(calls.map((call) => call.name), [
    "git.createRef",
    "pulls.create",
    "pulls.merge",
    "git.getRef",
    "git.getRef",
    "graphql",
    "pulls.get",
    "pulls.update",
    "git.getRef",
    "git.deleteRef",
  ]);
  const create = calls[0].args;
  assertMatch(
    String(create.ref),
    /^refs\/heads\/pull-reverse-rebase\/[0-9a-f-]{36}$/,
  );
  assertEquals(create.sha, "upstream-new");
  assertEquals(calls[1].args.head, "fork");
  assertEquals(
    calls[1].args.base,
    String(create.ref).replace("refs/heads/", ""),
  );
  assertEquals(calls[2].args.merge_method, "rebase");
  assertMatch(String(calls[5].args.query), /updateRefs/);
  assertEquals(
    { ...calls[5].args, query: undefined },
    {
      query: undefined,
      repositoryId: "repo-node",
      refName: "refs/heads/fork",
      beforeOid: "fork-old",
      afterOid: "rebased",
      force: true,
    },
  );
  assertEquals(calls[9].args.ref, String(create.ref).replace("refs/", ""));
});

Deno.test("reverse-rebase never cleans up a ref it failed to create", async () => {
  const { calls, run } = fixture({ createRefError: new Error("collision") });
  assertEquals(await run(), false);
  assertEquals(calls.map((call) => call.name), ["git.createRef"]);
});

Deno.test("reverse-rebase cleans its ref when temporary PR creation fails", async () => {
  const { calls, run } = fixture({ createPRError: new Error("forbidden") });
  assertEquals(await run(), false);
  assertEquals(calls.map((call) => call.name), [
    "git.createRef",
    "pulls.create",
    "git.getRef",
    "git.deleteRef",
  ]);
});

Deno.test("reverse-rebase surfaces 405 as conflict and cleans temporary resources", async () => {
  const { calls, run } = fixture({ mergeError: { status: 405 } });
  assertEquals(await run(), false);
  assert(
    calls.some((call) =>
      call.name === "issues.update" && call.args.issue_number === 7
    ),
  );
  assert(!calls.some((call) => call.name === "graphql"));
  assert(
    calls.some((call) =>
      call.name === "pulls.update" && call.args.pull_number === 99
    ),
  );
  assertEquals(calls.at(-1)?.name, "git.deleteRef");
});

Deno.test("reverse-rebase fails closed if the base branch changes", async () => {
  const { calls, run } = fixture({ baseSha: "someone-else-updated" });
  assertEquals(await run(), false);
  assert(!calls.some((call) => call.name === "graphql"));
  assertEquals(calls.at(-1)?.name, "git.deleteRef");
});

Deno.test("reverse-rebase does not delete a temporary ref whose SHA changed", async () => {
  const { calls, run } = fixture({ temporarySha: "unrelated-change" });
  assertEquals(await run(), false);
  assert(!calls.some((call) => call.name === "graphql"));
  assert(!calls.some((call) => call.name === "git.deleteRef"));
});

Deno.test("reverse-rebase treats merged:false as a conflict", async () => {
  const { calls, run } = fixture({ merged: false });
  assertEquals(await run(), false);
  assert(!calls.some((call) => call.name === "graphql"));
  assert(
    calls.some((call) =>
      call.name === "issues.update" && call.args.issue_number === 7
    ),
  );
  assertEquals(calls.at(-1)?.name, "git.deleteRef");
});

Deno.test("reverse-rebase fails closed when the atomic branch lease is rejected", async () => {
  const { calls, run } = fixture({
    leaseError: new Error("beforeOid mismatch"),
  });
  assertEquals(await run(), false);
  const lease = calls.find((call) => call.name === "graphql");
  assertEquals(lease?.args.beforeOid, "fork-old");
  assertEquals(lease?.args.afterOid, "rebased");
  assertEquals(calls.filter((call) => call.name === "graphql").length, 1);
  assertEquals(calls.at(-1)?.name, "git.deleteRef");
});

Deno.test("reverse-rebase cleanup failure does not undo a successful update", async () => {
  const { calls, run } = fixture({ deleteError: new Error("cleanup denied") });
  assertEquals(await run(), true);
  assertEquals(calls.filter((call) => call.name === "graphql").length, 1);
  assertEquals(calls.at(-1)?.name, "git.deleteRef");
});

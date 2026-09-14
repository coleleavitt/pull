import {
  conflictNotificationMarker,
  postConflictCommentOnce,
} from "@/src/processor/conflict-notification.ts";
import { assertEquals } from "@std/assert";
import type { ProbotOctokit } from "probot";

function githubStub(
  comments: Array<{ body: string | null }> = [],
  listError?: Error,
  createError?: Error,
) {
  const created: string[] = [];
  const issues = {
    listComments: () => undefined,
    createComment: ({ body }: { body: string }) => {
      if (createError) throw createError;
      created.push(body);
    },
  };
  const github = {
    issues,
    paginate: () => {
      if (listError) throw listError;
      return Promise.resolve(comments);
    },
  } as unknown as ProbotOctokit;
  return { github, created };
}

function loggerStub() {
  const errors: unknown[][] = [];
  return {
    logger: { error: (...args: unknown[]) => errors.push(args) },
    errors,
  };
}

const params = {
  owner: "fork-owner",
  repo: "repo",
  issueNumber: 42,
  comment: "@maintainer, this pull request has merge conflicts.",
};

Deno.test("posts configured conflict notification with marker", async () => {
  const { github, created } = githubStub();
  const { logger, errors } = loggerStub();

  await postConflictCommentOnce(github, logger, params);

  assertEquals(created, [
    `${params.comment}\n\n${conflictNotificationMarker}`,
  ]);
  assertEquals(errors, []);
});

Deno.test("does not repeat a conflict notification", async () => {
  const { github, created } = githubStub([
    { body: `Already notified\n\n${conflictNotificationMarker}` },
  ]);
  const { logger, errors } = loggerStub();

  await postConflictCommentOnce(github, logger, params);

  assertEquals(created, []);
  assertEquals(errors, []);
});

Deno.test("fails closed when comments cannot be checked", async () => {
  const { github, created } = githubStub([], new Error("forbidden"));
  const { logger, errors } = loggerStub();

  await postConflictCommentOnce(github, logger, params);

  assertEquals(created, []);
  assertEquals(errors.length, 1);
});

Deno.test("handles comment creation failure", async () => {
  const { github, created } = githubStub(
    [],
    undefined,
    new Error("comments are disabled"),
  );
  const { logger, errors } = loggerStub();

  await postConflictCommentOnce(github, logger, params);

  assertEquals(created, []);
  assertEquals(errors.length, 1);
});

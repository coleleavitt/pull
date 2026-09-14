import type { Logger, ProbotOctokit } from "probot";

export const conflictNotificationMarker =
  "<!-- pull:merge-conflict-notification -->";

export async function postConflictCommentOnce(
  github: ProbotOctokit,
  logger: Pick<Logger, "error">,
  params: {
    owner: string;
    repo: string;
    issueNumber: number;
    comment: string;
  },
): Promise<void> {
  const { owner, repo, issueNumber, comment } = params;

  try {
    const comments = await github.paginate(github.issues.listComments, {
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });

    if (
      comments.some(({ body }) => body?.includes(conflictNotificationMarker))
    ) {
      return;
    }

    await github.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `${comment}\n\n${conflictNotificationMarker}`,
    });
  } catch (err) {
    // A notification must never stop scheduled conflict handling. In particular,
    // do not post when comment lookup fails: that would risk repeated comments.
    logger.error({ err }, `#${issueNumber} Conflict notification failed`);
  }
}

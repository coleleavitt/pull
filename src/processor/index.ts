import type { Job } from "bullmq";
import type { SchedulerJobData } from "@wei/probot-scheduler";
import type { Logger, Probot, ProbotOctokit } from "probot";
import type { PullMergeMethod } from "@/src/utils/schema.ts";
import { getPullConfig } from "@/src/utils/get-pull-config.ts";
import { Pull } from "@/src/processor/pull.ts";

export const DEFAULT_PROCESSING_TIMEOUT_MS = 60 * 1000;

export type RepositoryJobProcessor = (
  job: Job<SchedulerJobData>,
) => Promise<void>;

export interface RepositoryProcessorOptions {
  logger?: Logger;
  timeoutMs?: number;
  botName?: string;
  version?: string;
  configFilename?: string;
  defaultMergeMethod?: PullMergeMethod;
}

function createTimeoutPromise(log: Logger, timeoutMs: number) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      log.warn("⏰ Job timed out after 1 minute");
      reject(new Error("Job timed out after 1 minute"));
    }, timeoutMs);
  });
}

export async function processRepository(
  octokit: ProbotOctokit,
  jobData: SchedulerJobData,
  log: Logger,
  options: RepositoryProcessorOptions = {},
) {
  const { owner, repo } = jobData;

  const config = await getPullConfig(octokit, log, jobData, {
    configFilename: options.configFilename,
    defaultMergeMethod: options.defaultMergeMethod,
  });
  if (!config) {
    log.info(`⚠️ No config found, skipping`);
    return;
  }

  const pull = new Pull(
    octokit,
    {
      owner,
      repo,
      logger: log,
      botName: options.botName,
      version: options.version,
    },
    config,
  );
  await pull.routineCheck();
}

export function getRepoProcessor(
  probot: Probot,
  options: RepositoryProcessorOptions = {},
): RepositoryJobProcessor {
  const logger = options.logger ?? probot.log;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESSING_TIMEOUT_MS;

  return async function RepoJobProcessor(job: Job<SchedulerJobData>) {
    const log = logger.child({
      jobId: job.id,
      jobData: job.data,
    });

    log.info("🏃 Processing repo job");

    try {
      const octokit = await probot.auth(job.data.installation_id);

      await Promise.race([
        processRepository(octokit, job.data, log, options),
        createTimeoutPromise(log, timeoutMs),
      ]);

      log.info(`✅ Repo job processed successfully`);
    } catch (error) {
      log.error(error, "❌ Repo job failed");
    }
  };
}

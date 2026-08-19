import log from "electron-log";
/**
 * GitHub user service — extracted from github_handlers so utilities like
 * git_author can resolve the current user without importing a handler
 * module (which created a circular dependency: git_utils → git_author →
 * github_handlers → git_utils).
 */
import fetch from "node-fetch";
import type { GithubUser } from "../../lib/schemas";
import { readSettings, writeSettings } from "../../main/settings";
import { IS_TEST_BUILD } from "../utils/test_utils";

const logger = log.scope("github_user_service");

export function isGitHubTestBuild() {
  return IS_TEST_BUILD || process.env.E2E_TEST_BUILD === "true";
}

export function getGitHubTestServerBase() {
  return `http://localhost:${process.env.FAKE_LLM_PORT || "3500"}`;
}

export function getGitHubApiBase() {
  return isGitHubTestBuild()
    ? `${getGitHubTestServerBase()}/github/api`
    : "https://api.github.com";
}

/**
 * Fetches the GitHub username of the currently authenticated user (using the stored access token).
 * @returns {Promise<string|null>} The GitHub username, or null if not authenticated or on error.
 */
export async function getGithubUser(): Promise<GithubUser | null> {
  const settings = readSettings();
  const email = settings.githubUser?.email;
  if (email) return { email };
  try {
    const accessToken = settings.githubAccessToken?.value;
    if (!accessToken) return null;
    const res = await fetch(`${getGitHubApiBase()}/user/emails`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const emails = (await res.json()) as Array<{
      primary?: boolean;
      email?: string;
    }>;
    const email = emails.find((e: any) => e.primary)?.email;
    if (!email) return null;

    writeSettings({
      githubUser: {
        email,
      },
    });
    return { email };
  } catch (err) {
    logger.error("[GitHub Handler] Failed to get GitHub username:", err);
    return null;
  }
}

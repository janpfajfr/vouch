import { readFileSync } from "node:fs";

export interface ReviewClient {
  /** Logins of permitted (write-association) users who APPROVED the current PR.
   *  null = couldn't determine (no token / not a PR / API error) — fail-open. */
  approvingReviewers(): Promise<string[] | null>;
}

/** True if at least one reviewer is permitted: any reviewer when allow is empty,
 *  else a reviewer whose login is in the allow-list. */
export function permittedApprover(reviewers: string[], allowedApprovers: string[]): boolean {
  if (reviewers.length === 0) return false;
  if (allowedApprovers.length === 0) return true;
  const allow = new Set(allowedApprovers);
  return reviewers.some((r) => allow.has(r));
}

const WRITE_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

interface PrContext { owner: string; repo: string; number: number; token: string; api: string; }

function prContext(): PrContext | null {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  if (!token || !repo.includes("/")) return null;
  let number = NaN;
  try {
    const evt = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
    number = Number(evt?.pull_request?.number);
  } catch { /* not a PR event */ }
  if (!Number.isInteger(number)) return null;
  const [owner, name] = repo.split("/");
  return { owner, repo: name, number, token, api };
}

export class GitHubReviewClient implements ReviewClient {
  async approvingReviewers(): Promise<string[] | null> {
    const ctx = prContext();
    if (!ctx) return null;
    try {
      const res = await fetch(`${ctx.api}/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.number}/reviews?per_page=100`, {
        headers: { authorization: `Bearer ${ctx.token}`, accept: "application/vnd.github+json", "user-agent": "vouch" },
      });
      if (!res.ok) return null;
      const reviews = (await res.json()) as Array<{ state?: string; user?: { login?: string }; author_association?: string }>;
      const approvers = new Set<string>();
      for (const r of reviews) {
        if (r.state === "APPROVED" && r.user?.login && WRITE_ASSOCIATIONS.has(r.author_association ?? "")) {
          approvers.add(r.user.login);
        }
      }
      return [...approvers];
    } catch {
      return null;
    }
  }
}

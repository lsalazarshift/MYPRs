/**
 * azdoPrStatus.ts
 *
 * Utility for computing a derived status label for Azure DevOps Pull Requests.
 *
 * The Azure DevOps REST API returns pull request objects with fields like
 * `status`, `isDraft`, `mergeStatus` and `reviewers[].vote`. This utility
 * maps those raw values to a human-friendly `ComputedStatus` that can be used
 * to drive UI filters without coupling the view layer to raw API semantics.
 *
 * NOTE: Vote values are based on the standard Azure DevOps model:
 *   10 = Approved, 5 = Approved with suggestions, 0 = No vote,
 *   -5 = Waiting for author, -10 = Rejected.
 * Adapt these constants if your instance uses a custom policy mapping.
 */

// ---------------------------------------------------------------------------
// Types / Interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal representation of an Azure DevOps reviewer as returned by the
 * Pull Requests REST API.
 *
 * Adapt property names to match the exact shape returned by
 * `GET /_apis/git/repositories/{repo}/pullRequests/{id}`.
 */
export interface AzdoReviewer {
  id?: string;
  displayName?: string;
  /**
   * Vote value from Azure DevOps:
   *   10  = Approved
   *    5  = Approved with suggestions
   *    0  = No vote (pending / abstained)
   *   -5  = Waiting for author
   *  -10  = Rejected
   */
  vote?: number;
}

/**
 * Status entry associated with a specific commit.
 * Obtained via `GET /_apis/git/repositories/{repo}/commits/{commitId}/statuses`.
 *
 * NOTE: `state` values follow the Azure DevOps GitStatusState enum:
 *   'succeeded' | 'failed' | 'pending' | 'notSet' | 'error'
 */
export interface AzdoCommitStatus {
  state?: "succeeded" | "failed" | "pending" | "notSet" | "error" | string;
  context?: { name?: string; genre?: string };
  description?: string;
}

/**
 * Minimal commit information as returned inside a PR's commit list
 * (`GET /_apis/git/repositories/{repo}/pullRequests/{id}/commits`).
 */
export interface AzdoCommit {
  commitId: string;
  /** ISO-8601 date string; use `author.date` or `committer.date`. */
  author?: { date?: string };
  committer?: { date?: string };
}

/**
 * Subset of the Azure DevOps Pull Request object relevant for status
 * computation. All fields are optional so callers can pass partial objects
 * (e.g. list responses) without error.
 *
 * Adapt field names to the exact JSON keys your API version returns.
 */
export interface AzdoPullRequest {
  pullRequestId?: number;
  /** PR lifecycle status from the API: 'active' | 'completed' | 'abandoned' */
  status?: "active" | "completed" | "abandoned" | string;
  /** True when the PR is a work-in-progress / draft. */
  isDraft?: boolean;
  title?: string;
  /**
   * Merge status as computed by Azure DevOps:
   * 'notSet' | 'succeeded' | 'conflicts' | 'rejectedByPolicy' | 'failure' | 'queued'
   */
  mergeStatus?: "notSet" | "succeeded" | "conflicts" | "rejectedByPolicy" | "failure" | "queued" | string;
  /** Reviewers with their current vote. */
  reviewers?: AzdoReviewer[];
  /**
   * Ordered list of commits on the PR source branch (latest first or last –
   * pass the single most-recent commit here).
   * Populated by calling `GET .../pullRequests/{id}/commits`.
   */
  commits?: AzdoCommit[];
  /**
   * Statuses (build / policy checks) attached to the last commit.
   * Populated by calling `GET .../commits/{commitId}/statuses`.
   */
  lastCommitStatuses?: AzdoCommitStatus[];
}

/**
 * The derived status that the UI filter layer works with.
 *
 * - `draft`              – PR is a work-in-progress; not ready for review.
 * - `active`             – PR is open, no blocking signals detected.
 * - `waiting_for_author` – A reviewer requested changes and no new commit
 *                          has been pushed since that request.
 * - `reviewed`           – At least one approving vote and no pending changes.
 * - `needs_review`       – No reviewer has voted yet (or only abstained).
 * - `ready_to_merge`     – Approved + merge succeeds + all checks pass.
 * - `blocked`            – Merge conflicts detected OR a check has failed.
 * - `closed`             – PR status is 'completed' or 'abandoned'.
 */
export type ComputedStatus =
  | "draft"
  | "active"
  | "waiting_for_author"
  | "reviewed"
  | "needs_review"
  | "ready_to_merge"
  | "blocked"
  | "closed";

// ---------------------------------------------------------------------------
// Helper constants
// ---------------------------------------------------------------------------

/** Vote thresholds – adjust if your Azure DevOps instance uses different values. */
const VOTE_APPROVED_WITH_SUGGESTIONS = 5;
const VOTE_WAITING_FOR_AUTHOR = -5;

// ---------------------------------------------------------------------------
// computeAzdoPRStatus
// ---------------------------------------------------------------------------

/**
 * Computes a `ComputedStatus` label for a single Azure DevOps Pull Request.
 *
 * Decision tree (evaluated in order – first match wins):
 *
 * 1. PR not open (completed / abandoned)   → `closed`
 * 2. PR is a draft                         → `draft`
 * 3. mergeStatus === 'conflicts'           → `blocked`
 * 4. Any commit status is 'failed'/'error' → `blocked`
 * 5. Any reviewer voted ≤ -5 (requested changes / rejected) AND no evidence
 *    of author responding with new commits → `waiting_for_author`
 * 6. All voters approved AND
 *    mergeStatus === 'succeeded' AND
 *    no failing/pending checks             → `ready_to_merge`
 * 7. At least one approving vote, no negatives → `reviewed`
 * 8. No votes at all (reviewers assigned but none voted) → `needs_review`
 * 9. Fallback                              → `active`
 *
 * @param pr - The Azure DevOps pull request object (partial is acceptable).
 * @returns   A `ComputedStatus` string label.
 */
export function computeAzdoPRStatus(pr: AzdoPullRequest): ComputedStatus {
  // Guard: handle null/undefined gracefully.
  if (!pr) return "active";

  // ── 1. Closed (completed or abandoned) ────────────────────────────────────
  const prStatus = (pr.status ?? "active").toLowerCase();
  if (prStatus !== "active") return "closed";

  // ── 2. Draft / Work-in-progress ───────────────────────────────────────────
  if (pr.isDraft) return "draft";

  const mergeStatus = (pr.mergeStatus ?? "").toLowerCase();

  // ── 3. Blocked by merge conflicts ─────────────────────────────────────────
  if (mergeStatus === "conflicts") return "blocked";

  // ── 4. Blocked by failing commit checks ───────────────────────────────────
  const lastStatuses = pr.lastCommitStatuses ?? [];
  const failingStates = ["failed", "error"];
  const hasFailingStatus = lastStatuses.some((s) =>
    failingStates.includes((s.state ?? "").toLowerCase())
  );
  if (hasFailingStatus) return "blocked";

  // ── 5. Waiting for author ─────────────────────────────────────────────────
  // Signal: any reviewer voted ≤ VOTE_WAITING_FOR_AUTHOR (i.e. -5 or -10).
  // Refinement: if the author pushed commits after the negative vote was cast,
  // they have responded. Without reviewer vote timestamps in the API response,
  // we use a conservative heuristic: negative vote present ⟹ waiting.
  //
  // TODO: When `reviewer.modifiedDate` is available, compare it against
  // `getLastCommitDate(pr.commits)` and return 'active' if the last commit
  // is more recent than the review request.
  const reviewers = pr.reviewers ?? [];
  const hasNegativeVote = reviewers.some(
    (r) => (r.vote ?? 0) <= VOTE_WAITING_FOR_AUTHOR
  );
  if (hasNegativeVote) return "waiting_for_author";

  // ── 6 & 7. Approved states ────────────────────────────────────────────────
  const positiveVotes = reviewers.filter(
    (r) => (r.vote ?? 0) >= VOTE_APPROVED_WITH_SUGGESTIONS
  );
  const negativeVotes = reviewers.filter(
    (r) => (r.vote ?? 0) < 0
  );

  if (positiveVotes.length > 0 && negativeVotes.length === 0) {
    // ── 6. Ready to merge ───────────────────────────────────────────────────
    const hasPendingStatus = lastStatuses.some(
      (s) => (s.state ?? "").toLowerCase() === "pending"
    );
    if (mergeStatus === "succeeded" && !hasPendingStatus) {
      return "ready_to_merge";
    }
    // ── 7. Reviewed ─────────────────────────────────────────────────────────
    return "reviewed";
  }

  // ── 8. Needs review ───────────────────────────────────────────────────────
  // Reviewers are assigned but none have voted yet.
  const hasAnyVote = reviewers.some((r) => (r.vote ?? 0) !== 0);
  if (!hasAnyVote && reviewers.length > 0) return "needs_review";

  // ── 9. Fallback ───────────────────────────────────────────────────────────
  return "active";
}

// ---------------------------------------------------------------------------
// Internal helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Returns the ISO-8601 date string of the most recent commit author date,
 * or `null` if unavailable.
 *
 * @internal
 */
export function getLastCommitDate(commits?: AzdoCommit[]): string | null {
  if (!commits || commits.length === 0) return null;
  for (const commit of commits) {
    const date = commit.author?.date ?? commit.committer?.date;
    if (date) return date;
  }
  return null;
}

/**
 * azdoPrStatus.test.ts
 *
 * Unit tests for the `computeAzdoPRStatus` utility.
 *
 * Coverage: draft, closed, blocked (conflicts), blocked (failed status),
 * waiting_for_author, reviewed, ready_to_merge, needs_review, active (fallback).
 *
 * Run with:
 *   npx jest src/utils/azdoPrStatus.test.ts
 * or:
 *   npm test
 */

import {
  computeAzdoPRStatus,
  getLastCommitDate,
  AzdoPullRequest,
  AzdoReviewer,
  AzdoCommitStatus,
  AzdoCommit,
} from "./azdoPrStatus";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

/** Returns a baseline active, non-draft PR with no reviewers or statuses. */
function basePR(overrides: Partial<AzdoPullRequest> = {}): AzdoPullRequest {
  return {
    pullRequestId: 1,
    status: "active",
    isDraft: false,
    mergeStatus: "notSet",
    reviewers: [],
    commits: [],
    lastCommitStatuses: [],
    ...overrides,
  };
}

function reviewer(vote: number): AzdoReviewer {
  return { id: "r1", displayName: "Reviewer", vote };
}

function commitStatus(state: AzdoCommitStatus["state"]): AzdoCommitStatus {
  return { state, context: { name: "ci/build" } };
}

function commit(date: string): AzdoCommit {
  return { commitId: "abc123", author: { date } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeAzdoPRStatus", () => {
  // ── draft ────────────────────────────────────────────────────────────────

  it("returns 'draft' when isDraft is true", () => {
    const pr = basePR({ isDraft: true });
    expect(computeAzdoPRStatus(pr)).toBe("draft");
  });

  it("returns 'draft' even if reviewers have voted (draft takes priority)", () => {
    const pr = basePR({
      isDraft: true,
      reviewers: [reviewer(10)],
    });
    expect(computeAzdoPRStatus(pr)).toBe("draft");
  });

  // ── closed ───────────────────────────────────────────────────────────────

  it("returns 'closed' for a completed PR", () => {
    const pr = basePR({ status: "completed" });
    expect(computeAzdoPRStatus(pr)).toBe("closed");
  });

  it("returns 'closed' for an abandoned PR", () => {
    const pr = basePR({ status: "abandoned" });
    expect(computeAzdoPRStatus(pr)).toBe("closed");
  });

  it("returns 'closed' for any non-active status string (case-insensitive)", () => {
    const pr = basePR({ status: "Completed" });
    expect(computeAzdoPRStatus(pr)).toBe("closed");
  });

  // ── blocked (merge conflicts) ─────────────────────────────────────────────

  it("returns 'blocked' when mergeStatus is 'conflicts'", () => {
    const pr = basePR({ mergeStatus: "conflicts" });
    expect(computeAzdoPRStatus(pr)).toBe("blocked");
  });

  it("returns 'blocked' for conflicts even if there are positive votes", () => {
    const pr = basePR({
      mergeStatus: "conflicts",
      reviewers: [reviewer(10)],
    });
    expect(computeAzdoPRStatus(pr)).toBe("blocked");
  });

  // ── blocked (failing status check) ───────────────────────────────────────

  it("returns 'blocked' when a commit status is 'failed'", () => {
    const pr = basePR({
      lastCommitStatuses: [commitStatus("failed")],
    });
    expect(computeAzdoPRStatus(pr)).toBe("blocked");
  });

  it("returns 'blocked' when a commit status is 'error'", () => {
    const pr = basePR({
      lastCommitStatuses: [commitStatus("error")],
    });
    expect(computeAzdoPRStatus(pr)).toBe("blocked");
  });

  it("returns 'blocked' for failing status even when reviewer approved", () => {
    const pr = basePR({
      reviewers: [reviewer(10)],
      lastCommitStatuses: [commitStatus("failed")],
    });
    expect(computeAzdoPRStatus(pr)).toBe("blocked");
  });

  // ── waiting_for_author ────────────────────────────────────────────────────

  it("returns 'waiting_for_author' when a reviewer voted -5 (WaitingForAuthor)", () => {
    const pr = basePR({ reviewers: [reviewer(-5)] });
    expect(computeAzdoPRStatus(pr)).toBe("waiting_for_author");
  });

  it("returns 'waiting_for_author' when a reviewer voted -10 (Rejected)", () => {
    const pr = basePR({ reviewers: [reviewer(-10)] });
    expect(computeAzdoPRStatus(pr)).toBe("waiting_for_author");
  });

  it("returns 'waiting_for_author' with negative vote even if another reviewer approved", () => {
    // A negative vote signals the author still needs to act; the approval of
    // a different reviewer does not cancel the change-request signal.
    const pr = basePR({
      reviewers: [reviewer(-5), reviewer(10)],
    });
    expect(computeAzdoPRStatus(pr)).toBe("waiting_for_author");
  });

  // ── reviewed ─────────────────────────────────────────────────────────────

  it("returns 'reviewed' when all reviewers approved and mergeStatus is not succeeded", () => {
    const pr = basePR({
      reviewers: [reviewer(10)],
      mergeStatus: "queued",
    });
    expect(computeAzdoPRStatus(pr)).toBe("reviewed");
  });

  it("returns 'reviewed' when reviewer voted 5 (ApprovedWithSuggestions)", () => {
    const pr = basePR({
      reviewers: [reviewer(5)],
      mergeStatus: "notSet",
    });
    expect(computeAzdoPRStatus(pr)).toBe("reviewed");
  });

  it("returns 'reviewed' when approved but checks are still pending", () => {
    const pr = basePR({
      reviewers: [reviewer(10)],
      mergeStatus: "succeeded",
      lastCommitStatuses: [commitStatus("pending")],
    });
    expect(computeAzdoPRStatus(pr)).toBe("reviewed");
  });

  // ── ready_to_merge ────────────────────────────────────────────────────────

  it("returns 'ready_to_merge' when approved + mergeStatus succeeded + checks passing", () => {
    const pr = basePR({
      reviewers: [reviewer(10)],
      mergeStatus: "succeeded",
      lastCommitStatuses: [commitStatus("succeeded")],
    });
    expect(computeAzdoPRStatus(pr)).toBe("ready_to_merge");
  });

  it("returns 'ready_to_merge' with no commit statuses (no checks = nothing blocking)", () => {
    const pr = basePR({
      reviewers: [reviewer(10)],
      mergeStatus: "succeeded",
      lastCommitStatuses: [],
    });
    expect(computeAzdoPRStatus(pr)).toBe("ready_to_merge");
  });

  it("returns 'ready_to_merge' when multiple reviewers all approved", () => {
    const pr = basePR({
      reviewers: [reviewer(10), reviewer(5)],
      mergeStatus: "succeeded",
      lastCommitStatuses: [commitStatus("succeeded")],
    });
    expect(computeAzdoPRStatus(pr)).toBe("ready_to_merge");
  });

  // ── needs_review ─────────────────────────────────────────────────────────

  it("returns 'needs_review' when reviewers are assigned but none have voted", () => {
    const pr = basePR({
      reviewers: [reviewer(0), reviewer(0)],
    });
    expect(computeAzdoPRStatus(pr)).toBe("needs_review");
  });

  // ── active (fallback) ────────────────────────────────────────────────────

  it("returns 'active' when there are no reviewers and no blocking signals", () => {
    const pr = basePR({ reviewers: [] });
    expect(computeAzdoPRStatus(pr)).toBe("active");
  });

  it("returns 'active' as a fallback for a generic open PR", () => {
    const pr = basePR();
    expect(computeAzdoPRStatus(pr)).toBe("active");
  });

  it("returns 'active' (defensive) when called with null-ish input", () => {
    // TypeScript guard: the function handles undefined gracefully.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeAzdoPRStatus(null as any)).toBe("active");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeAzdoPRStatus(undefined as any)).toBe("active");
  });

  // ── edge cases ───────────────────────────────────────────────────────────

  it("treats missing status field as 'active'", () => {
    const pr: AzdoPullRequest = { pullRequestId: 99 };
    expect(computeAzdoPRStatus(pr)).toBe("active");
  });

  it("is case-insensitive for mergeStatus 'Conflicts'", () => {
    const pr = basePR({ mergeStatus: "Conflicts" });
    expect(computeAzdoPRStatus(pr)).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// getLastCommitDate helper
// ---------------------------------------------------------------------------

describe("getLastCommitDate", () => {
  it("returns null for undefined input", () => {
    expect(getLastCommitDate(undefined)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(getLastCommitDate([])).toBeNull();
  });

  it("returns the author date of the first commit", () => {
    const commits: AzdoCommit[] = [commit("2024-01-15T10:00:00Z")];
    expect(getLastCommitDate(commits)).toBe("2024-01-15T10:00:00Z");
  });

  it("falls back to committer.date when author.date is missing", () => {
    const commits: AzdoCommit[] = [
      { commitId: "xyz", committer: { date: "2024-02-01T08:00:00Z" } },
    ];
    expect(getLastCommitDate(commits)).toBe("2024-02-01T08:00:00Z");
  });

  it("skips commits with no date and returns the first available one", () => {
    const commits: AzdoCommit[] = [
      { commitId: "no-date" },
      { commitId: "has-date", author: { date: "2024-03-01T12:00:00Z" } },
    ];
    expect(getLastCommitDate(commits)).toBe("2024-03-01T12:00:00Z");
  });
});

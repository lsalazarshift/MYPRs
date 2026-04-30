// ============================================================
// Tests unitarios para computeAzdoPRStatus
// Framework: Jest + ts-jest
// Ejecutar con: npm test (o yarn test)
// ============================================================

import {
  computeAzdoPRStatus,
  AzdoPullRequest,
  AzdoReviewer,
  AzdoCommitStatus,
} from "./azdoPrStatus";

// ---- Helpers para construir fixtures ----

function makePR(overrides: Partial<AzdoPullRequest> = {}): AzdoPullRequest {
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
  return { id: `rev-${vote}`, displayName: `Reviewer ${vote}`, vote };
}

function commitStatus(state: AzdoCommitStatus["state"]): AzdoCommitStatus {
  return { state, context: { name: "ci/build" } };
}

// ---- Tests ----

describe("computeAzdoPRStatus", () => {
  // --- Estados cerrados ---
  it("devuelve 'closed' cuando status es 'completed'", () => {
    expect(computeAzdoPRStatus(makePR({ status: "completed" }))).toBe("closed");
  });

  it("devuelve 'closed' cuando status es 'abandoned'", () => {
    expect(computeAzdoPRStatus(makePR({ status: "abandoned" }))).toBe("closed");
  });

  // --- Draft ---
  it("devuelve 'draft' cuando isDraft es true", () => {
    expect(computeAzdoPRStatus(makePR({ isDraft: true }))).toBe("draft");
  });

  it("draft tiene prioridad sobre conflictos de merge", () => {
    expect(
      computeAzdoPRStatus(makePR({ isDraft: true, mergeStatus: "conflicts" }))
    ).toBe("draft");
  });

  // --- Bloqueado por conflictos ---
  it("devuelve 'blocked' cuando mergeStatus es 'conflicts'", () => {
    expect(
      computeAzdoPRStatus(makePR({ mergeStatus: "conflicts" }))
    ).toBe("blocked");
  });

  // --- Bloqueado por checks fallidos ---
  it("devuelve 'blocked' cuando hay un commit status 'failed'", () => {
    expect(
      computeAzdoPRStatus(
        makePR({ lastCommitStatuses: [commitStatus("failed")] })
      )
    ).toBe("blocked");
  });

  it("devuelve 'blocked' cuando hay un commit status 'error'", () => {
    expect(
      computeAzdoPRStatus(
        makePR({ lastCommitStatuses: [commitStatus("error")] })
      )
    ).toBe("blocked");
  });

  it("checks fallidos tienen prioridad sobre votos positivos", () => {
    expect(
      computeAzdoPRStatus(
        makePR({
          reviewers: [reviewer(10)],
          lastCommitStatuses: [commitStatus("failed")],
        })
      )
    ).toBe("blocked");
  });

  // --- Esperando al autor ---
  it("devuelve 'waiting_for_author' cuando hay voto negativo (-5) y sin aprobaciones", () => {
    expect(
      computeAzdoPRStatus(makePR({ reviewers: [reviewer(-5)] }))
    ).toBe("waiting_for_author");
  });

  it("devuelve 'waiting_for_author' cuando hay voto rechazado (-10) y sin aprobaciones", () => {
    expect(
      computeAzdoPRStatus(makePR({ reviewers: [reviewer(-10)] }))
    ).toBe("waiting_for_author");
  });

  it("devuelve 'waiting_for_author' cuando hay mezcla de votos negativos sin positivos", () => {
    expect(
      computeAzdoPRStatus(
        makePR({ reviewers: [reviewer(-5), reviewer(-10), reviewer(0)] })
      )
    ).toBe("waiting_for_author");
  });

  // --- Reviewed (aprobado) ---
  it("devuelve 'reviewed' cuando hay aprobación completa (vote=10) y mergeStatus no es 'succeeded'", () => {
    expect(
      computeAzdoPRStatus(makePR({ reviewers: [reviewer(10)], mergeStatus: "queued" }))
    ).toBe("reviewed");
  });

  it("devuelve 'reviewed' cuando hay aprobación con sugerencias (vote=5)", () => {
    expect(
      computeAzdoPRStatus(
        makePR({ reviewers: [reviewer(5)], mergeStatus: "queued" })
      )
    ).toBe("reviewed");
  });

  it("devuelve 'reviewed' cuando hay aprobación pero checks pendientes", () => {
    expect(
      computeAzdoPRStatus(
        makePR({
          reviewers: [reviewer(10)],
          mergeStatus: "succeeded",
          lastCommitStatuses: [commitStatus("pending")],
        })
      )
    ).toBe("reviewed");
  });

  // --- Ready to merge ---
  it("devuelve 'ready_to_merge' cuando aprobado + mergeStatus succeeded + sin checks problemáticos", () => {
    expect(
      computeAzdoPRStatus(
        makePR({
          reviewers: [reviewer(10)],
          mergeStatus: "succeeded",
          lastCommitStatuses: [commitStatus("succeeded")],
        })
      )
    ).toBe("ready_to_merge");
  });

  it("devuelve 'ready_to_merge' cuando aprobado + sin lastCommitStatuses + mergeStatus succeeded", () => {
    expect(
      computeAzdoPRStatus(
        makePR({
          reviewers: [reviewer(10)],
          mergeStatus: "succeeded",
          lastCommitStatuses: [],
        })
      )
    ).toBe("ready_to_merge");
  });

  it("devuelve 'ready_to_merge' cuando aprobado y mergeStatus no está definido (notSet → string vacío tratado como OK)", () => {
    expect(
      computeAzdoPRStatus(
        makePR({
          reviewers: [reviewer(10)],
          mergeStatus: "",
          lastCommitStatuses: [],
        })
      )
    ).toBe("ready_to_merge");
  });

  // --- Needs review ---
  it("devuelve 'needs_review' cuando hay revisores sin votos (vote=0)", () => {
    expect(
      computeAzdoPRStatus(
        makePR({ reviewers: [reviewer(0), reviewer(0)] })
      )
    ).toBe("needs_review");
  });

  // --- Fallback active ---
  it("devuelve 'active' cuando no hay revisores asignados", () => {
    expect(computeAzdoPRStatus(makePR({ reviewers: [] }))).toBe("active");
  });

  it("devuelve 'active' cuando PR activo sin revisores ni statuses", () => {
    expect(
      computeAzdoPRStatus(
        makePR({
          reviewers: [],
          lastCommitStatuses: [],
          mergeStatus: "notSet",
        })
      )
    ).toBe("active");
  });

  // --- Edge cases ---
  it("devuelve 'active' como fallback si pr es null-like (cast defensivo)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeAzdoPRStatus(null as any)).toBe("active");
  });

  it("ignora checks 'notApplicable' y 'succeeded' para bloqueado", () => {
    expect(
      computeAzdoPRStatus(
        makePR({
          reviewers: [reviewer(10)],
          mergeStatus: "succeeded",
          lastCommitStatuses: [
            commitStatus("notApplicable"),
            commitStatus("succeeded"),
          ],
        })
      )
    ).toBe("ready_to_merge");
  });

  it("estado closed tiene prioridad sobre isDraft", () => {
    expect(
      computeAzdoPRStatus(makePR({ status: "completed", isDraft: true }))
    ).toBe("closed");
  });
});

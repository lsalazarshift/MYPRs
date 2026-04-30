// ============================================================
// Azure DevOps PR Computed Status Utility
// ============================================================
// Interpreta los campos de la API REST de Azure DevOps para
// calcular un estado derivado (ComputedStatus) por Pull Request.
//
// NOTAS DE ADAPTACIÓN:
// - Los valores numéricos de `vote` están documentados abajo;
//   verifica con datos reales de tu instancia de Azure DevOps.
// - `mergeStatus` puede variar según la versión de la API y la
//   configuración de políticas de rama.
// - `lastCommitStatuses` debe alimentarse desde la llamada a
//   GET .../commits/{commitId}/statuses o la API de Builds.
// ============================================================

/**
 * Información básica de un revisor en Azure DevOps.
 * El campo `vote` usa la escala estándar de Azure DevOps:
 *   10  = Approved
 *    5  = Approved with suggestions
 *    0  = No vote
 *   -5  = Waiting for author
 *  -10  = Rejected
 *
 * Adapta si tu instancia usa valores distintos.
 */
export interface AzdoReviewer {
  id?: string;
  displayName?: string;
  /** Voto numérico: >0 aprobación, 0 sin voto, <0 cambios solicitados/rechazo */
  vote?: number;
}

/**
 * Estado de un check/build asociado a un commit.
 * Valores esperados de la API de Git Statuses de Azure DevOps:
 *   'succeeded' | 'failed' | 'pending' | 'notApplicable' | 'notSet' | 'error'
 */
export interface AzdoCommitStatus {
  /** Estado del check/build */
  state?: "succeeded" | "failed" | "pending" | "notApplicable" | "notSet" | "error" | string;
  context?: {
    name?: string;
    genre?: string;
  };
}

/**
 * Información básica de un commit dentro del PR.
 */
export interface AzdoCommit {
  commitId: string;
  author?: {
    date?: string;
  };
  committer?: {
    date?: string;
  };
}

/**
 * Representación mínima de un Pull Request de Azure DevOps
 * que contiene los campos necesarios para calcular el ComputedStatus.
 *
 * Mapea los campos del objeto retornado por:
 *   GET .../pullRequests/{id}?api-version=6.0
 */
export interface AzdoPullRequest {
  pullRequestId: number;
  /** Estado en Azure DevOps: 'active' | 'completed' | 'abandoned' */
  status?: "active" | "completed" | "abandoned" | string;
  /** true si el PR es un borrador (Work In Progress) */
  isDraft?: boolean;
  title?: string;
  /**
   * Estado de la fusión. Valores estándar de Azure DevOps:
   *   'notSet' | 'queued' | 'conflicts' | 'succeeded' | 'rejectedByPolicy' | 'failure'
   *
   * ADAPTAR: verifica los valores exactos retornados por tu instancia.
   */
  mergeStatus?: "notSet" | "queued" | "conflicts" | "succeeded" | "rejectedByPolicy" | "failure" | string;
  /** Lista de revisores con sus votos */
  reviewers?: AzdoReviewer[];
  /** Commits del PR, ordenados de más antiguo a más reciente */
  commits?: AzdoCommit[];
  /**
   * Estados/resultados del último commit (checks, builds).
   * Poblar desde: GET .../commits/{lastCommitId}/statuses
   *
   * ADAPTAR: este campo no viene por defecto en el objeto PR;
   * debes enriquecerlo en tu capa de servicio.
   */
  lastCommitStatuses?: AzdoCommitStatus[];
}

/**
 * Estado computado de un Pull Request para el dashboard.
 * Derivado de los campos de Azure DevOps.
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

/**
 * Calcula el ComputedStatus de un PR de Azure DevOps.
 *
 * Orden de evaluación (prioridad):
 *  1. PR no activo (completed/abandoned) → 'closed'
 *  2. Draft / Work In Progress → 'draft'
 *  3. Conflictos de merge → 'blocked'
 *  4. Checks/builds fallidos en el último commit → 'blocked'
 *  5. Revisores con voto negativo sin commits posteriores → 'waiting_for_author'
 *  6. Aprobado + merge listo + checks OK → 'ready_to_merge'
 *  7. Aprobado (sin conflictos evidentes) → 'reviewed'
 *  8. Revisores asignados sin votos → 'needs_review'
 *  9. Fallback → 'active'
 *
 * @param pr Objeto Pull Request de Azure DevOps (enriquecido con commits y lastCommitStatuses)
 * @returns Estado computado del PR
 */
export function computeAzdoPRStatus(pr: AzdoPullRequest): ComputedStatus {
  if (!pr) return "active";

  // 1. PR cerrado (completed / abandoned)
  if (pr.status && pr.status !== "active") {
    return "closed";
  }

  // 2. Draft / Work In Progress
  if (pr.isDraft) {
    return "draft";
  }

  const mergeStatus = (pr.mergeStatus ?? "").toLowerCase();

  // 3. Bloqueado por conflictos de merge
  if (mergeStatus === "conflicts") {
    return "blocked";
  }

  // 4. Bloqueado por checks/builds fallidos en el último commit
  const lastStatuses = pr.lastCommitStatuses ?? [];
  const FAILING_STATES = ["failed", "error"];
  const hasFailingStatus = lastStatuses.some((s) =>
    FAILING_STATES.includes((s.state ?? "").toLowerCase())
  );
  if (hasFailingStatus) {
    return "blocked";
  }

  // Analizar votos de los revisores
  const reviewers = pr.reviewers ?? [];
  const positiveVotes = reviewers.filter((r) => (r.vote ?? 0) > 0);
  const negativeVotes = reviewers.filter((r) => (r.vote ?? 0) < 0);
  const noVoteReviewers = reviewers.filter((r) => (r.vote ?? 0) === 0);

  // 5. Esperando al autor: hay votos negativos y no hay aprobaciones que los contrarresten.
  //    ADAPTAR: Para mayor precisión, compara la fecha del último commit con la fecha
  //    del último voto negativo (la API retorna `reviewers[].votedFor[].votedDate`
  //    en algunas versiones). Aquí usamos la heurística: voto negativo sin aprobaciones.
  if (negativeVotes.length > 0 && positiveVotes.length === 0) {
    return "waiting_for_author";
  }

  // 6 & 7. Revisado/Aprobado
  if (positiveVotes.length > 0 && negativeVotes.length === 0) {
    const hasPendingStatus = lastStatuses.some(
      (s) => (s.state ?? "").toLowerCase() === "pending"
    );
    // Listo para fusionar: aprobado + sin conflictos + merge succeeded + checks OK
    if (
      (mergeStatus === "succeeded" || mergeStatus === "") &&
      !hasPendingStatus &&
      !hasFailingStatus
    ) {
      return "ready_to_merge";
    }
    // Aprobado pero merge aún pendiente o checks en curso
    return "reviewed";
  }

  // 8. Necesita revisión: hay revisores asignados pero ninguno ha votado
  if (reviewers.length > 0 && noVoteReviewers.length === reviewers.length) {
    return "needs_review";
  }

  // 9. Fallback activo
  return "active";
}

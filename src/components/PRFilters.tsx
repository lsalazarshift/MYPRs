/**
 * PRFilters.tsx
 *
 * Skeleton component that renders a row of filter chips for each
 * `ComputedStatus` value. Intended for integration into the PR
 * Dashboard toolbar alongside the existing `FilterBar` component.
 *
 * Usage:
 *   <PRFilters
 *     selected={['active', 'blocked']}
 *     onChange={(statuses) => setSelectedStatuses(statuses)}
 *   />
 *
 * TODO: Wire `selected` / `onChange` to application state (Redux, Zustand,
 *       or local useState) and pass the active statuses down to the PR list
 *       filtering logic / `computeAzdoPRStatus`.
 */

import React from "react";
import { ComputedStatus } from "../utils/azdoPrStatus";

// ---------------------------------------------------------------------------
// Human-readable labels for each status
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<ComputedStatus, string> = {
  active: "Active",
  draft: "Draft",
  waiting_for_author: "Waiting for author",
  reviewed: "Reviewed",
  needs_review: "Needs review",
  ready_to_merge: "Ready to merge",
  blocked: "Blocked",
  closed: "Closed",
};

/** Ordered list of statuses shown as filter chips. */
const ALL_STATUSES: ComputedStatus[] = [
  "active",
  "waiting_for_author",
  "reviewed",
  "needs_review",
  "ready_to_merge",
  "blocked",
  "draft",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PRFiltersProps {
  /** Currently selected status filters. */
  selected: ComputedStatus[];
  /** Called with the updated selection when the user clicks a chip. */
  onChange: (statuses: ComputedStatus[]) => void;
  /** Optional: pass a count per status to show badges on each chip. */
  counts?: Partial<Record<ComputedStatus, number>>;
}

/**
 * Renders a horizontal row of toggle-buttons (chips) for each
 * `ComputedStatus`.  Clicking a chip toggles it on/off; the updated
 * selection is emitted via `onChange`.
 *
 * The component is purely presentational: it does NOT manage its own
 * selected state. Lift state to the parent (or global store) and pass
 * it back via `selected`.
 */
const PRFilters: React.FC<PRFiltersProps> = ({ selected, onChange, counts }) => {
  const handleClick = (status: ComputedStatus) => {
    const isActive = selected.includes(status);
    const next: ComputedStatus[] = isActive
      ? selected.filter((s) => s !== status)
      : [...selected, status];
    onChange(next);
  };

  return (
    <div className="pr-filters" role="group" aria-label="Filter by PR status">
      {ALL_STATUSES.map((status) => {
        const isActive = selected.includes(status);
        const count = counts?.[status];
        return (
          <button
            key={status}
            type="button"
            className={`pr-filter pr-filter--${status}${isActive ? " is-active" : ""}`}
            aria-pressed={isActive}
            onClick={() => handleClick(status)}
          >
            {STATUS_LABELS[status]}
            {count !== undefined && (
              <span className="pr-filter__count" aria-label={`${count} pull requests`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default PRFilters;
export { ALL_STATUSES, STATUS_LABELS };

// ============================================================
// PRFilters — Componente de filtros por estado computado
// ============================================================
// Muestra chips/botones para filtrar PRs por ComputedStatus.
// Los estados se muestran en español.
//
// Props:
//   selected  - Lista de estados actualmente seleccionados.
//   onChange  - Callback al seleccionar/deseleccionar un estado.
//
// USO:
//   import { PRFilters } from './PRFilters';
//   <PRFilters selected={selectedStatuses} onChange={setSelectedStatuses} />
// ============================================================

import React from "react";
import { ComputedStatus } from "../utils/azdoPrStatus";
import "../styles/_pr-filters.scss";

/** Todos los estados disponibles para filtrar */
const ALL_STATUSES: ComputedStatus[] = [
  "active",
  "waiting_for_author",
  "reviewed",
  "needs_review",
  "ready_to_merge",
  "blocked",
  "draft",
  "closed",
];

/** Etiquetas en español para cada estado */
const STATUS_LABELS: Record<ComputedStatus, string> = {
  active: "Activo",
  waiting_for_author: "Esperando autor",
  reviewed: "Revisado",
  needs_review: "Necesita revisión",
  ready_to_merge: "Listo para fusionar",
  blocked: "Bloqueado",
  draft: "Borrador",
  closed: "Cerrado",
};

interface PRFiltersProps {
  /** Estados actualmente seleccionados. Array vacío = "Todos" seleccionado. */
  selected: ComputedStatus[];
  /** Callback ejecutado al cambiar la selección */
  onChange: (selected: ComputedStatus[]) => void;
}

/**
 * Componente de filtros por estado computado de Pull Request.
 *
 * Incluye un chip "Todos" que limpia todos los filtros activos.
 * Al seleccionar un estado se activa su chip; al volver a pulsar se desactiva.
 */
export function PRFilters({ selected, onChange }: PRFiltersProps): React.ReactElement {
  const isAllSelected = selected.length === 0;

  const handleToggle = (status: ComputedStatus) => {
    if (selected.includes(status)) {
      // Deseleccionar este estado
      onChange(selected.filter((s) => s !== status));
    } else {
      // Seleccionar este estado
      onChange([...selected, status]);
    }
  };

  const handleAll = () => {
    onChange([]);
  };

  return (
    <div className="pr-filters" role="group" aria-label="Filtrar por estado">
      {/* Chip "Todos" */}
      <button
        type="button"
        className={`pr-filter pr-filter--all${isAllSelected ? " is-active" : ""}`}
        aria-pressed={isAllSelected}
        onClick={handleAll}
      >
        Todos
      </button>

      {ALL_STATUSES.map((status) => {
        const isActive = selected.includes(status);
        return (
          <button
            key={status}
            type="button"
            className={`pr-filter pr-filter--${status}${isActive ? " is-active" : ""}`}
            aria-pressed={isActive}
            onClick={() => handleToggle(status)}
          >
            {STATUS_LABELS[status]}
          </button>
        );
      })}
    </div>
  );
}

export default PRFilters;

/**
 * The toolbar and the List view of Home's applications panel. The Cards view stays in `home.tsx`;
 * both draw from the same query, so search, filter and sort mean the same in either view.
 */
import type { ReactNode } from "react";
import type { ApplicationSummaryView } from "./application-contract.js";
import {
  type ApplicationListQuery,
  type ApplicationSortOrder,
  type ApplicationStatusFilter,
  applicationSortLabels,
  applicationSortOrders,
  applicationStatusFilterLabel,
  applicationStatusFilters,
} from "./home-list-model.js";
import { applicationActivityText } from "./home-model.js";

export const applicationListViews = ["cards", "list"] as const;
export type ApplicationListView = (typeof applicationListViews)[number];

export function isApplicationListView(value: unknown): value is ApplicationListView {
  return typeof value === "string" && (applicationListViews as readonly string[]).includes(value);
}

const viewLabels: Readonly<Record<ApplicationListView, string>> = {
  cards: "Cards",
  list: "List",
};

export function ApplicationsToolbar({
  query,
  view,
  counts,
  onQuery,
  onView,
}: {
  readonly query: ApplicationListQuery;
  readonly view: ApplicationListView;
  readonly counts: Readonly<Record<ApplicationStatusFilter, number>>;
  readonly onQuery: (query: ApplicationListQuery) => void;
  readonly onView: (view: ApplicationListView) => void;
}) {
  return (
    <div className="applications-toolbar">
      <div className="applications-toolbar-row">
        <input
          id="applications-search"
          className="applications-search"
          type="search"
          value={query.search}
          placeholder="Search by name, employer or role"
          aria-label="Search applications"
          onChange={(event) => onQuery({ ...query, search: event.target.value })}
        />
        <label className="applications-sort">
          <span>Sort</span>
          <select
            id="applications-sort"
            value={query.sort}
            onChange={(event) =>
              onQuery({ ...query, sort: event.target.value as ApplicationSortOrder })
            }
          >
            {applicationSortOrders.map((order) => (
              <option key={order} value={order}>
                {applicationSortLabels[order]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="applications-segmented">
          <legend className="sr-only">View</legend>
          {applicationListViews.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => onView(option)}
            >
              {viewLabels[option]}
            </button>
          ))}
        </fieldset>
      </div>
      <fieldset className="applications-status-filter">
        <legend className="sr-only">Filter by status</legend>
        {applicationStatusFilters.map((filter) => (
          <button
            key={filter}
            type="button"
            className="applications-status-chip"
            aria-pressed={query.status === filter}
            onClick={() => onQuery({ ...query, status: filter })}
          >
            {applicationStatusFilterLabel(filter)}
            <span className="numeric">{counts[filter]}</span>
          </button>
        ))}
      </fieldset>
    </div>
  );
}

/** What a row can do besides opening; each action is absent when the host cannot do it. */
export interface ApplicationRowActions {
  readonly onArchive?: () => void;
  readonly onRequestDelete?: () => void;
  readonly onConfirmDelete?: () => void;
  readonly onCancelDelete?: () => void;
  readonly confirmingDelete?: boolean;
  readonly busy?: boolean;
}

export function ApplicationsTable({
  applications,
  label,
  now,
  onOpen,
  actionsFor,
  status,
  deleteConfirmation,
}: {
  readonly applications: readonly ApplicationSummaryView[];
  readonly label: string;
  readonly now: Date;
  readonly onOpen: (application: ApplicationSummaryView) => void;
  readonly actionsFor: (application: ApplicationSummaryView) => ApplicationRowActions;
  /** The status chip, drawn by Home so both views show the same one. */
  readonly status: (application: ApplicationSummaryView) => ReactNode;
  readonly deleteConfirmation: (name: string) => string;
}) {
  return (
    <div className="applications-table-wrap">
      <table className="applications-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Status</th>
            <th scope="col">Last activity</th>
            <th scope="col" className="numeric">
              Runs
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {applications.map((application) => (
            <ApplicationRow
              key={application.id}
              application={application}
              now={now}
              onOpen={onOpen}
              actions={actionsFor(application)}
              status={status(application)}
              deleteConfirmation={deleteConfirmation}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApplicationRow({
  application,
  now,
  onOpen,
  actions,
  status,
  deleteConfirmation,
}: {
  readonly application: ApplicationSummaryView;
  readonly now: Date;
  readonly onOpen: (application: ApplicationSummaryView) => void;
  readonly actions: ApplicationRowActions;
  readonly status: ReactNode;
  readonly deleteConfirmation: (name: string) => string;
}) {
  const archived = application.archivedAt !== null;
  const busy = actions.busy === true;
  const { onArchive, onRequestDelete, onConfirmDelete, onCancelDelete } = actions;
  const hasMenu = onArchive !== undefined || onRequestDelete !== undefined;
  return (
    <tr className={archived ? "applications-row applications-row-archived" : "applications-row"}>
      <td>
        <button
          className="applications-row-name"
          type="button"
          title={application.name}
          onClick={() => onOpen(application)}
        >
          {application.name}
        </button>
      </td>
      <td>{status}</td>
      <td title={application.updatedAt}>
        {applicationActivityText(application.updatedAt, now).replace(/^Last activity /u, "")}
      </td>
      <td className="numeric">{application.runCount}</td>
      <td className="applications-row-actions">
        {actions.confirmingDelete === true ? (
          <fieldset className="application-card-confirm">
            <legend>{deleteConfirmation(application.name)}</legend>
            <div className="application-card-actions">
              <button
                className="button button-danger"
                type="button"
                disabled={busy}
                onClick={onConfirmDelete}
              >
                Delete
              </button>
              <button className="button button-outline" type="button" onClick={onCancelDelete}>
                Cancel
              </button>
            </div>
          </fieldset>
        ) : (
          <>
            <button
              className="button button-primary"
              type="button"
              aria-label={`Open ${application.name}`}
              onClick={() => onOpen(application)}
            >
              Open
            </button>
            {hasMenu ? (
              <details className="applications-row-menu">
                <summary aria-label={`More actions for ${application.name}`}>⋯</summary>
                <div className="applications-row-menu-items">
                  {onArchive === undefined ? null : (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${archived ? "Restore" : "Archive"} ${application.name}`}
                      onClick={onArchive}
                    >
                      {archived ? "Restore" : "Archive"}
                    </button>
                  )}
                  {onRequestDelete === undefined ? null : (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Delete ${application.name}`}
                      onClick={onRequestDelete}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </details>
            ) : null}
          </>
        )}
      </td>
    </tr>
  );
}

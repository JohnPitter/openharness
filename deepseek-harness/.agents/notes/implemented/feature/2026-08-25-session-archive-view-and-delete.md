# Agent Note: Session archive viewing and session delete

Status: implemented

English | [中文](2026-08-25-session-archive-view-and-delete.zh.md)

## Problem

Archive hid a session from every grouping surface with no viewing or restore control, so a user who archived a row could not find it. The product also needed a true destructive delete, which the [archive set](2026-07-31-session-archive-global-set.md) was never intended to be.

## Decision

**Archive stays the registry-global hide set; the workspace browser adds a trailing Archived section with unarchive; destructive removal is a separate `session.delete` that drops origin-subagent descendants only.**

The archive field, `workspace.archiveSession`, and `host/archived-sessions-changed` full-snapshot posture are unchanged. `tree.ts` still hides archived ids from workspace groups, Ungrouped, content search, and the flat live list. Those ids appear in a trailing **Archived** group (`ARCHIVED_KEY`), collapsed by default, with no add, drag, or workspace menu. `workspace.unarchiveSession` removes one id from the set without touching accounting, so the restored row returns to its prior workspace slot. Local archive of the open session still clears to New Session; opening a row from Archived keeps the selection; a remote tab's archive frame clears the current session only when that id newly joins the set.

`session.delete` is session-domain. The Host disposes the handles it created or resumed, then `SessionPersistence.delete` plus `workspaceRegistry.forgetSession` for the complete identity set: the named root and every `origin: 'subagent'` descendant, not ordinary forks. Deleting a named subagent as the root answers `agent-busy`. An unknown id answers `session-not-found`. `host/session-deleted` always drops the client row, including origin-subagent rows that `host/session-removed` would keep as idle activations. The Session row's Delete action opens a confirmation that names permanent log removal.

## Alternatives considered

**Treat archive as delete.** Rejected: the archive set exists so logs and accounting survive hiding; users asked for a viewing folder and a real delete as two actions.

**Delete ordinary forks with the parent.** Rejected: a fork is a peer session with its own log; only subagent-origin children are owned by the parent.

**Filter archived ids in `workspaceView`.** Rejected: the original archive note already keeps accounting and display separate so unarchive can restore position.

**Reuse `host/session-removed` for delete.** Rejected: removal keeps origin-subagent rows as idle activations; delete must drop them.

## Consequences

Archived sessions are findable at the bottom of the sidebar. Delete is irreversible and also removes origin-subagent descendants. Workspace registration deletion still does not delete sessions. This extends the [session archive set](2026-07-31-session-archive-global-set.md) and supplies the session-delete capability the [workspace registration deletion](2026-07-27-workspace-registration-deletion.md) decision left separate.

## Testing

Workspace registry tests cover unarchive idempotence and `forgetSession`. Apiproxy tests cover unarchive frames, live delete with a cold subagent descendant, named-subagent `agent-busy`, and unknown-id `session-not-found`. Client tree, row, and browser specs cover the Archived section, unarchive, and the delete confirmation. The workspace-management e2e archives into Archived, unarchives, then deletes the seeded log.

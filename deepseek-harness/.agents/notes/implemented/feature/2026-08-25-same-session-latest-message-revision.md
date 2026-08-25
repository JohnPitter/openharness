# Agent Note: Revise the latest completed user message in place

Status: implemented

English | [中文](2026-08-25-same-session-latest-message-revision.zh.md)

## Problem

A user needs to correct the latest completed prompt without creating a second conversation or retaining the obsolete turn in the active conversation. A client-only replacement cannot keep durable replay, model input, search, and token accounting aligned, and a retry must not run the revised prompt twice.

## Decision

Editing is limited to the latest user message in the same session. It keeps the session id and never forks. The Host uses the shared per-session admission and cancellation path, then appends a durable revision cut that anchors on the latest completed user message and removes the old user/generated assistant/tool/milestone/todo tail from active projections through the captured log tail. The replacement message is appended in that same session.

The Chat view offers edit on the latest user node while the session is idle. A revision cut can leave that node in an orphaned open turn, so eligibility does not require a closed-turn Location.

The revision cut is folded by every active projection that consumes the session history. The conversation surface, model-visible history, session search, and token meter therefore exclude the removed tail and include the replacement. Repeated editing is supported by anchoring each new operation on the current latest completed user message and its resulting revision.

Each operation uses a deterministic `operationId` derived from the session, anchor identity, and normalized replacement content. Duplicate admission returns the committed revision without dispatching a second response. The durability barrier precedes dispatch: a crash after commit and before dispatch can leave the revised message without a response, and regeneration is the recovery path; the operation is never retried as duplicate model or tool work.

Explicit forks retain their existing seed boundary and semantics. This feature edits only the live session and does not reinterpret fork creation or fork history.

## Alternatives considered

**Fork the session for every edit.** Rejected because correction is a same-session operation and a new session would split identity, durable history, search, and user-visible continuity.

**Replace only the client projection or truncate storage.** Rejected because those paths leave model reconstruction, search, token metering, or crash recovery with a different history; the append-only revision event gives every consumer one durable source.

**Commit the revision and always dispatch on retry.** Rejected because a crash between commit and dispatch would duplicate the revised response when the caller retries; at-most-once dispatch is preferable to an automatic duplicate.

**Alter explicit fork semantics to share revision cuts.** Rejected because forks have an independent seed boundary and existing callers rely on that boundary remaining unchanged.

## Consequences

A revision is durable append-only history rather than destructive log deletion, while active projections hide the superseded interval. A committed edit can temporarily show a revised user message without a response after a crash, and the user can regenerate it explicitly. The shared admission and cancellation path serializes editing with other session work, and deterministic operation ids make retries idempotent without promising automatic response recovery.

## Verification

The owning [session subsystem reference](../../../../docs/subsystems/session.md) documents the revision event, cut operation, service method, shared admission, and at-most-once dispatch contract; its [paired reference](../../../../docs/subsystems/session.md) remains paired. Focused implementation and integration coverage exercises latest-message eligibility, including an idle session-located or orphaned-open-turn tail, repeated revisions, projection/model/search/token-meter removal, operation-id reuse, cancellation races, crash-after-commit recovery, and unchanged explicit forks.

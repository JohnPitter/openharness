# Agent Note: Edit a sent user message

Status: implemented

English | [中文](2026-08-24-edit-sent-message.zh.md)

## Problem

A settled user message is durable history, but correcting its text previously required starting a separate conversation manually. Editing in place would also need to rewrite the original session's later turns, images, and derived state, conflicting with append-only storage.

## Decision

Settled user bubbles expose an edit action when no run is active, excluding steering messages and the first window turn because an empty prefix cannot fork. The action prefills the composer and shows an editing indicator with cancel; Escape or the cancel button restores the prior draft. Sending while editing forks at the previous turn's `turn/end` sequence with `increaseTitle: false`, prompts the revised text in the child session, and switches to that child. A failure keeps the draft and editing state and displays `message.editFailed`.

The fork copies the text history prefix but not images from the original message. The original session remains intact, so editing is a text-only correction path over append-only session storage rather than an in-place rewrite.

## Alternatives considered

**Truncate the original session in place.** Rejected: it would require a foundational persistence rewrite and would destroy the original transcript.

**Copy the original message's images into the child.** Rejected: the edit operation revises user text only; image identity and upload lifetime are not part of the forked prompt.

## Consequences

Users can revise eligible settled user messages while retaining the original session and its later turns. The child starts at the completed turn immediately before the edited message, does not receive a title increase, and runs the revised text as its first new prompt. The first visible turn cannot be edited, and an edited submission does not carry the original message's images. Locale keys `message.edit`, `message.editing`, `message.cancelEdit`, and `message.editFailed` are available in zh/en/pt/es.

## Testing

`tests/message-edit.client.spec.tsx` covers ten cases, including eligibility, draft restoration, fork boundary and title behavior, text-only prompting, switching, failure retention, and locale presentation. Updated chat-branch-tails, chat-view, and queue-dock fixtures cover the assembled conversation states.

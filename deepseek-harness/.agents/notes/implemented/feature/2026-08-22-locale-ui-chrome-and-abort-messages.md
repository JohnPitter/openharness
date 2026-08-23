# Agent Note: Locale chrome for permission labels, tool rows, and abort errors

Status: implemented

English | [中文](2026-08-22-locale-ui-chrome-and-abort-messages.zh.md)

## Problem

The composer mixed locale copy with English chrome: the Access chip showed `Full access` / `Read Only` / `Workspace Write`, tool rows showed `Pwsh` / `Code` / `Tool call`, `/compact` kept the wire name, and Inspect / IN / OUT were English literals. Collapsed error lines showed `Error: wait aborted` and `Error: code run failed (abort): [object Object]` because `AbortSignal.reason` is often an `AgentCancelCause` object and `String(object)` is `[object Object]`. Model-authored tool descriptions (the pwsh `description` argument) are English by construction and must stay verbatim.

## Decision

**UI chrome is locale copy; model-authored arguments and durable executor English remain on the session log.** Permission pickers use `access.*` / `preset.*` keys and interpolate that name into confirm dialogs (see [GUI Full access risk confirmation](2026-07-31-gui-full-access-confirmation.md)). Tool rows keep English titles in `toolRowModel` and translate at the render site through `localizedToolTitle` / `localizeDisplayedError`. Known executor prefixes (`Error: wait aborted`, `code run failed (abort): …`, `command aborted`) remap in the collapsed row and Output section; unknown bodies keep their text. `formatThrownMessage` / worker `messageOf` render `{ kind }` cancel causes instead of `[object Object]`.

## Alternatives considered

**Machine-translate model `description` arguments and every tool-result body.** Rejected: those strings are model-visible and reconstructed from the session log; a UI rewrite would disagree with replay and with the model.

**Change `toolRowModel.title` to a locale key.** Rejected: the pure model stays language-free so unit tests pin classification without a `t` seat; only the render site localizes.

**Keep `Full access` as an English product brand.** Rejected: the chip sits next to fully localized composer copy, and the confirmation already interpolates the locale name.

## Consequences

A Portuguese session shows Acesso total, Código, Chamada de ferramenta, Compactar, and Erro: espera cancelada. Stopping a `run_code` call logs `code run failed (abort): user` rather than `[object Object]`. Historical logs that still contain `[object Object]` map to the cancelled locale string in the UI only.

# Agent Note: Remote publishes a public HTTPS tunnel, not a LAN bind

Status: implemented

English | [中文](2026-08-22-remote-internet-quick-tunnel.zh.md)

## Problem

A phone off this PC's Wi-Fi cannot open a listener that advertises a private IPv4, even when that listener binds `0.0.0.0`. Home NAT, CGNAT, and disabled UPnP keep inbound TCP from the internet from reaching the desktop, so "Remote" that only shares a LAN URL fails the moment the operator is on cellular or another network.

## Decision

**EnableRemote publishes the loopback harness through a Cloudflare Quick Tunnel and puts that HTTPS URL (plus the existing unguessable `access` token) on the QR.** `internal/remote` listens on `127.0.0.1`, reverse-proxies to the sidecar with the same cookie gate, and runs a cached `cloudflared tunnel --url` whose `*.trycloudflare.com` host is what `RemoteChip` copies. The first enable downloads pinned `cloudflared` `2026.8.2` into `%LOCALAPPDATA%\openharness\cloudflared` and verifies SHA-256; later enables reuse the binary. DisableRemote and app shutdown kill the tunnel process. The PC needs outbound internet; the phone may be on any network. Anyone who has the live link operates every session as on the desktop.

The sidebar chip placement is unchanged: [Remote lives in the sidebar above the model chip](2026-08-22-lan-remote-sidebar-chip.md).

## Alternatives considered

**UPnP / NAT-PMP plus the WAN IPv4 in the QR.** Rejected: CGNAT and many ISP routers never create a reachable mapping, so the advertised URL would still fail from cellular.

**Manual port-forward instructions.** Rejected: the operator asked for access while the PC is on and OpenHarness is open, without router configuration.

**ngrok or a named Cloudflare account tunnel.** Rejected: Quick Tunnels need no account or extra product login; the URL already rotates per EnableRemote with the token.

**Keep advertising the LAN IPv4 and treat internet as out of scope.** Rejected: that is the behavior that cannot reach a phone off Wi-Fi.

## Consequences

Remote no longer opens an inbound LAN port or a Windows firewall rule. Failure to download `cloudflared`, verify it, or obtain a `trycloudflare.com` URL fails EnableRemote instead of falling back to a LAN-only QR. Quick Tunnel hostnames are Cloudflare's ephemeral testing hosts; a Cloudflare outage or policy change makes EnableRemote fail until another publisher replaces `openPublicTunnel`. Tests inject that function and never download the binary.

## Testing

`internal/remote` unit tests inject `openPublicTunnel`, assert the advertised URL, cookie gate, tunnel stop, log-line hostname parse, and SHA-256 helper. `remote-chip.client.spec.tsx` still drives the panel copy, including the internet warning.

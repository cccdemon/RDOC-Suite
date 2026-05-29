# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This directory contains end-user/admin documentation and the merge planning log. There is no code here. For code architecture and build commands, read the root [`CLAUDE.md`](../CLAUDE.md) first.

## Files in this directory

| File | Purpose |
| --- | --- |
| [`RDOC-SUITE-MERGELOG.md`](RDOC-SUITE-MERGELOG.md) | Live planning + handover log for the ongoing merge of RDCC, RDOC-RTC, and RDOC-VoiceRelayBots into RDOC-Suite. **Primary source of truth for what is queued, in-flight, and done.** |
| [`admin-guide.md`](admin-guide.md) | Server administrator walkthrough (Discord app setup, bot invite, slash-command config, credential management) |
| [`commander-guide.md`](commander-guide.md) | Commander end-user walkthrough (install companion, sign in, hotkey, troubleshooting) |
| [`privacy.md`](privacy.md) | Data inventory and Discord ToS compliance notes |

## Rule: mergelog first, always

**Before doing anything in this project — any code change, config change, or doc edit — add a "Queued / Planned Step" entry to `RDOC-SUITE-MERGELOG.md` first.** No exceptions.

## RDOC-SUITE-MERGELOG.md protocol

The merge log uses a strict two-section pattern — follow it exactly:

- **Queued / Planned Step**: add an entry (with `YYYY-MM-DD:` prefix) *before* touching code, describing what will change and why.
- **Completed Steps**: after the work is committed, move or copy the entry here with the commit hash appended.
- **Open Decisions**: architectural questions that are not yet answered. Remove when resolved; add when new blockers surface.

Never skip the "Queued" entry and write only "Completed" — future agents must be able to resume mid-task from the log.

## Open decisions (as of 2026-05-27)

These are blocking or near-blocking for the merge; resolve before implementing the affected areas:

1. **Package namespace**: `@dccc/*` → `@rdoc-suite/*` or `@rdoc-sc/*`? Affects every workspace and Dockerfile.
2. **Admiral tools in Companion**: based on `AdminUser` whitelist (RDCC model) or separate API keys (RDOC-RTC model)?
3. **Voice-to-All permission**: Commander role, separate Discord role, or admin-only?
4. **Session model**: invite-based operation rooms separate from normal guild SquadLink, or unified with extra invite links?

## When to update docs alongside code changes

- `admin-guide.md`: update when slash-command names, required intents, or the credential-issuance flow changes.
- `commander-guide.md`: update when the companion UI, hotkey system, or sign-in flow changes.
- `privacy.md`: update when any new data field is persisted or any existing field is removed.
- Always update `RDOC-SUITE-MERGELOG.md` when completing a merge step, regardless of how small.

## Naming and URL conventions (decided 2026-05-27)

- Public web interface: `https://suite.raumdock.org`
- LiveKit signaling: `wss://voice.raumdock.org`
- Docker image/container prefix: `rdoc-suite-<part>` (e.g. `rdoc-suite-bridge`, `rdoc-suite-bot`)
- `PUBLIC_BASE_PATH` is empty (`""`); no `/dccc` prefix anywhere.

The admin-guide still references `localhost:8787` for local dev — that is intentional and correct for the developer quickstart.

// DCCC Admin UI — minimal client JS. No build step, no framework.
// Reads window.__DCCC_NAV_BASE__ to find the admin URL prefix.

(function () {
  "use strict";
  const NAV = window.__DCCC_NAV_BASE__ || "/admin";

  // ── Optimistic UI state for Channel-Mirror moves ────────────
  // userId → targetChannelId for moves we've issued but the server's
  // /admin/api/live hasn't yet reflected. While an entry is here,
  // every render pins the user in the optimistic target so the
  // polling window (max 5s) doesn't make drag-drop feel laggy.
  // Entry is cleared 1.5s after the mutation succeeds, giving the
  // bot's voiceStateUpdate-HTTP-push time to land (~200-500ms).
  const PENDING_MOVES = new Map();
  // Cache the last successful /admin/api/live payload so optimistic
  // updates can re-render the Channel-Mirror without hitting the
  // server. tick() writes; the drop handler reads.
  let LAST_DATA = null;
  // Set by startDashboardPolling() — exposes tick() to the drop
  // handler so it can trigger an immediate refetch after a successful
  // move instead of waiting up to 5s for the next interval.
  let pollNow = () => {};

  function applyPendingMoves(data) {
    if (PENDING_MOVES.size === 0 || !data || !data.channelMirror) return data;
    const byChannel = new Map();
    for (const ch of data.channelMirror) {
      byChannel.set(ch.channelId, { ...ch, members: [...(ch.members || [])] });
    }
    for (const [userId, targetChannelId] of PENDING_MOVES) {
      let movedUser = null;
      for (const ch of byChannel.values()) {
        const idx = ch.members.findIndex((m) => m.userId === userId);
        if (idx >= 0) {
          if (!movedUser) movedUser = ch.members[idx];
          ch.members.splice(idx, 1);
        }
      }
      if (movedUser) {
        const target = byChannel.get(targetChannelId);
        if (target) target.members.push(movedUser);
      }
    }
    return { ...data, channelMirror: Array.from(byChannel.values()) };
  }

  function findUserChannel(userId) {
    if (!LAST_DATA || !LAST_DATA.channelMirror) return null;
    for (const ch of LAST_DATA.channelMirror) {
      if ((ch.members || []).some((m) => m.userId === userId)) return ch.channelId;
    }
    return null;
  }

  function rerenderChannelMirrorFromCache() {
    if (!LAST_DATA) return;
    const mirrorEl = document.getElementById("channel-mirror");
    const mirrorCountEl = document.getElementById("channel-mirror-count");
    if (!mirrorEl) return;
    const adjusted = applyPendingMoves(LAST_DATA);
    pruneSelectionAgainstData(adjusted);
    renderChannelMirror(mirrorEl, adjusted);
    if (mirrorCountEl)
      mirrorCountEl.textContent = String(adjusted.channelMirror.length);
    wireChannelMirrorHandlers(adjusted);
  }

  // ── Touch-mode detection + tap-to-move support ─────────
  // Coarse pointer = primarily-touch device (phone, tablet). Used
  // both to swap drag-drop for tap-to-move and to apply small UX
  // tweaks. matchMedia is live, but we read it at boot — the input
  // method rarely changes mid-session.
  const IS_TOUCH =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(pointer: coarse)").matches;

  function ensureTapMoveBar() {
    let bar = document.getElementById("tap-move-bar");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "tap-move-bar";
    bar.className = "tap-move-bar";
    bar.innerHTML =
      '<div class="tmb-label"><strong id="tmb-count">0</strong> Member markiert &mdash; Channel antippen</div>' +
      '<button type="button" class="tmb-cancel">ABBRECHEN</button>';
    document.body.appendChild(bar);
    bar.querySelector(".tmb-cancel").addEventListener("click", cancelTapMove);
    return bar;
  }

  function updateTapMoveBar() {
    if (!IS_TOUCH) return;
    const n = SELECTED_USERS.size;
    if (n === 0) {
      const bar = document.getElementById("tap-move-bar");
      if (bar) bar.classList.remove("is-open");
      document
        .querySelectorAll(".cm-card.tap-target")
        .forEach((c) => c.classList.remove("tap-target"));
      return;
    }
    const bar = ensureTapMoveBar();
    const countEl = bar.querySelector("#tmb-count");
    if (countEl) countEl.textContent = String(n);
    bar.classList.add("is-open");
    document
      .querySelectorAll(".cm-card")
      .forEach((c) => c.classList.add("tap-target"));
  }

  function cancelTapMove() {
    SELECTED_USERS.clear();
    document
      .querySelectorAll(".cm-member.is-selected")
      .forEach((el) => el.classList.remove("is-selected"));
    updateStrategyChannelButton();
    updateTapMoveBar();
  }

  // ── Shared member-move executor ────────────────────────
  // Both drag-drop (desktop) and tap-to-move (touch) funnel into
  // this. Optimistic UI via PENDING_MOVES, parallel fetch, partial-
  // failure handling, selection cleanup on multi-move.
  async function executeMemberMoves(userIds, targetChannel) {
    if (!userIds || userIds.length === 0 || !targetChannel) return;
    // Skip users already in the target — saves needless Discord calls.
    const todo = userIds.filter((uid) => findUserChannel(uid) !== targetChannel);
    if (todo.length === 0) return;
    // Optimistic pin all targets at once.
    todo.forEach((uid) => PENDING_MOVES.set(uid, targetChannel));
    rerenderChannelMirrorFromCache();
    const results = await Promise.allSettled(
      todo.map((uid) =>
        fetch(`${NAV}/api/members/${encodeURIComponent(uid)}/move`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channelId: targetChannel }),
        }),
      ),
    );
    if (todo.length > 1) {
      SELECTED_USERS.clear();
      updateStrategyChannelButton();
      updateTapMoveBar();
    }
    const failures = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        failures.push({ uid: todo[i], status: 0, err: null });
      } else if (r.value && !r.value.ok) {
        const err = await r.value.json().catch(() => ({}));
        failures.push({ uid: todo[i], status: r.value.status, err });
      }
    }
    if (failures.length === 0) {
      pollNow();
      setTimeout(() => {
        todo.forEach((uid) => PENDING_MOVES.delete(uid));
        rerenderChannelMirrorFromCache();
      }, 1500);
      return;
    }
    failures.forEach((f) => PENDING_MOVES.delete(f.uid));
    rerenderChannelMirrorFromCache();
    const successUids = todo.filter(
      (uid) => !failures.some((f) => f.uid === uid),
    );
    if (successUids.length > 0) {
      pollNow();
      setTimeout(() => {
        successUids.forEach((uid) => PENDING_MOVES.delete(uid));
        rerenderChannelMirrorFromCache();
      }, 1500);
    }
    const first = failures[0];
    const detail =
      failures.length === 1
        ? formatMutationError("Verschieben fehlgeschlagen", first.err || {}, first.status)
        : `${failures.length} von ${todo.length} Move(s) fehlgeschlagen.\n\nErster Fehler: ${formatMutationError("", first.err || {}, first.status)}`;
    alert(detail);
  }

  // ── Channel-tile reorder ────────────────────────────────
  // Moves the dragged channel BEFORE the drop target. Optimistically
  // reorders LAST_DATA.channelMirror + repaints, then POSTs the new
  // full order to the bridge. On failure: refetch state to undo.
  async function reorderChannels(draggedId, beforeId) {
    if (!LAST_DATA || !LAST_DATA.channelMirror) return;
    const ids = LAST_DATA.channelMirror.map((c) => c.channelId);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(beforeId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const next = ids.slice();
    next.splice(fromIdx, 1);
    // After the splice, indices >= fromIdx shift left by one. So if the
    // target was right of the source, we adjust the insertion index.
    const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
    next.splice(insertAt, 0, draggedId);
    // Optimistic UI.
    const byId = new Map(LAST_DATA.channelMirror.map((c) => [c.channelId, c]));
    LAST_DATA = {
      ...LAST_DATA,
      channelMirror: next.map((id) => byId.get(id)).filter(Boolean),
    };
    rerenderChannelMirrorFromCache();
    // Persist.
    let r;
    try {
      r = await fetch(`${NAV}/api/channels/reorder`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ordered: next }),
      });
    } catch (e) {
      alert("Netzwerkfehler beim Speichern der Reihenfolge.");
      pollNow();
      return;
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(formatMutationError("Channels neu anordnen fehlgeschlagen", err, r.status));
      // Bridge has the canonical order — refetch will revert the
      // optimistic local change if it conflicts.
      pollNow();
    }
    // On success: SSE will deliver the canonical state. No further
    // local action needed.
  }

  // ── Dashboard: SSE-pushed state (with polling fallback) ──────
  // Primary transport: EventSource at /admin/api/live-stream. Bridge
  // pushes a frame on every guild-state change (member move, role
  // mutation, channel rename, voice-state change from the bot, WS
  // connect/disconnect), debounced to 100 ms per guild.
  // Fallback: if the EventSource errors (proxy timeout, bridge restart,
  // network blip), drop to 5 s polling until SSE reconnects.
  function startDashboardPolling() {
    const activeEl = document.getElementById("active-commanders");
    const activeCountEl = document.getElementById("active-count");
    const membersEl = document.getElementById("commander-members");
    const memberCountEl = document.getElementById("member-count");
    const mirrorEl = document.getElementById("channel-mirror");
    const mirrorCountEl = document.getElementById("channel-mirror-count");
    if (!activeEl && !membersEl && !mirrorEl) return; // not on dashboard

    function applyData(data) {
      LAST_DATA = data;
      const adjusted = applyPendingMoves(data);
      if (activeEl) {
        activeEl.innerHTML = data.activeCommanders.length
          ? data.activeCommanders
              .map(
                (c) =>
                  `<li class="commander-row ${c.speaking ? "speaking" : ""}"><span class="cmd-name">${escapeHtml(c.displayName || c.userId)}</span><span class="cmd-status">${c.speaking ? "TALKING" : "IDLE"}</span></li>`,
              )
              .join("")
          : `<li class="empty">— niemand verbunden —</li>`;
        if (activeCountEl) activeCountEl.textContent = String(data.activeCommanders.length);
      }
      if (membersEl) {
        membersEl.innerHTML = data.commanderRoleMembers.length
          ? data.commanderRoleMembers
              .map(
                (m) =>
                  `<li class="member-row" data-user-id="${escapeHtml(m.userId)}"><span class="m-name">${escapeHtml(m.displayName)}</span><span class="m-state ${m.inAllowedChannel ? "ok" : m.inVoice ? "warn" : "off"}">${m.inAllowedChannel ? "IN VOICE" : m.inVoice ? "OTHER CHANNEL" : "OFFLINE"}</span><button class="btn btn-sm btn-red m-strip" data-strip-commander="${escapeHtml(m.userId)}" data-name="${escapeHtml(m.displayName)}" title="Commander-Rolle entziehen">ROLLE ENTZIEHEN</button></li>`,
              )
              .join("")
          : `<li class="empty">— noch keine Mitglieder mit Commander-Rolle bekannt —</li>`;
        if (memberCountEl)
          memberCountEl.textContent = String(data.commanderRoleMembers.length);
        // Buttons get re-created on every paint — rebind their handlers.
        wireStripCommanderButtons();
      }
      if (mirrorEl) {
        pruneSelectionAgainstData(adjusted);
        renderChannelMirror(mirrorEl, adjusted);
        if (mirrorCountEl)
          mirrorCountEl.textContent = String(adjusted.channelMirror.length);
        wireChannelMirrorHandlers(adjusted);
      }
    }

    async function pollOnce() {
      try {
        const res = await fetch(`${NAV}/api/live`, { credentials: "include" });
        if (!res.ok) return;
        applyData(await res.json());
      } catch (e) {
        // silent — caller retries on schedule
      }
    }
    pollNow = pollOnce;

    let pollTimer = null;
    function startPollingFallback() {
      if (pollTimer) return;
      pollTimer = setInterval(pollOnce, 5000);
    }
    function stopPollingFallback() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    let es = null;
    let sseRetryTimer = null;
    function connectSSE() {
      if (sseRetryTimer) {
        clearTimeout(sseRetryTimer);
        sseRetryTimer = null;
      }
      try {
        es = new EventSource(`${NAV}/api/live-stream`, { withCredentials: true });
      } catch (e) {
        startPollingFallback();
        sseRetryTimer = setTimeout(connectSSE, 5000);
        return;
      }
      es.addEventListener("open", () => {
        // Connected — kill the fallback poller.
        stopPollingFallback();
      });
      es.addEventListener("message", (ev) => {
        if (!ev.data) return;
        try {
          applyData(JSON.parse(ev.data));
        } catch (e) {
          // ignore malformed frames
        }
      });
      es.addEventListener("error", () => {
        // Connection broken — close it, fall back to polling, retry SSE in 5s.
        if (es) {
          es.close();
          es = null;
        }
        startPollingFallback();
        sseRetryTimer = setTimeout(connectSSE, 5000);
      });
    }

    // SSE sends the initial snapshot on connect — no need for a separate
    // first paint. If SSE can't even initialise, the fallback poller will
    // paint within 5 s.
    connectSSE();
  }

  // ── Channel-Mirror error formatter (Etappe 4) ──────────────
  // Turns the backend's { error, detail } pairs into a UX message
  // that explains the situation in human terms. detail is usually the
  // raw Discord JSON body — useful for debugging, useless for user
  // dialogs as-is.
  function formatMutationError(prefix, err, httpStatus) {
    const code = err && err.error;
    const detail = err && err.detail;
    if (code === "discord_rate_limited") {
      // Discord throttled us. detail is JSON like
      // {"message":"...","retry_after":9.374,"global":false}.
      let secs = null;
      try {
        const parsed = typeof detail === "string" ? JSON.parse(detail) : detail;
        if (parsed && typeof parsed.retry_after === "number") {
          secs = Math.ceil(parsed.retry_after);
        }
      } catch {}
      const wait = secs ? ` (~${secs} Sekunden warten)` : "";
      return `${prefix}: Discord drosselt diese Aktion${wait}. Channel-Umbenennen ist auf 2 pro 10 Minuten pro Channel begrenzt — Discord-Limit, nichts was wir umgehen können.`;
    }
    if (code === "missing_manage_channels") {
      return `${prefix}: Dem Bot fehlt die Berechtigung "Kanäle verwalten" auf diesem Server. In den Discord-Server-Einstellungen → Rollen → Bot-Rolle aktivieren.`;
    }
    if (code === "missing_manage_roles") {
      return `${prefix}: Dem Bot fehlt die Berechtigung "Rollen verwalten" — und die Bot-Rolle muss in der Hierarchie ÜBER der zu vergebenden Rolle stehen.`;
    }
    if (code === "missing_move_members") {
      return `${prefix}: Dem Bot fehlt die Berechtigung "Mitglieder verschieben".`;
    }
    if (code === "dm_closed_by_user") {
      return `${prefix}: Der User hat DMs von Server-Mitgliedern deaktiviert. Geh in Discord auf Server → Privatsphäre-Einstellungen.`;
    }
    if (code === "user_not_in_voice") {
      return `${prefix}: Der User ist gerade in keinem Voice-Channel — Discord erlaubt nur Move, wenn er bereits verbunden ist.`;
    }
    if (code === "discord_bad_request") {
      return `${prefix}: Discord lehnt den Request ab (z. B. ungültiger Name). Details:\n${detail || "(keine)"}`;
    }
    if (code === "discord_not_found") {
      return `${prefix}: Discord findet das Ziel nicht (Channel/User/Rolle gelöscht?).`;
    }
    return `${prefix}: ${code || "HTTP " + httpStatus}${detail ? "\n\n" + detail : ""}`;
  }

  // ── Command-Panel selection state ─────────────────────────────
  // Module-scoped so it persists across polling re-renders. Ctrl+Click
  // on a member toggles them in here; right-click on a selected
  // member fans role-actions out to all of them in parallel.
  const SELECTED_USERS = new Set();

  function pruneSelectionAgainstData(data) {
    if (!data || !data.channelMirror) return;
    const present = new Set();
    for (const ch of data.channelMirror) {
      for (const m of ch.members || []) {
        if (!m.isBot) present.add(m.userId);
      }
    }
    for (const id of [...SELECTED_USERS]) {
      if (!present.has(id)) SELECTED_USERS.delete(id);
    }
    updateStrategyChannelButton();
  }

  function updateStrategyChannelButton() {
    const btn = document.getElementById("strategy-channel-btn");
    const countEl = document.getElementById("strategy-channel-count");
    if (btn) {
      const n = SELECTED_USERS.size;
      btn.disabled = n === 0;
      if (countEl) countEl.textContent = String(n);
    }
    // The tap-to-move bar tracks the same selection — keep it in sync
    // here so every existing call site updates both UI affordances.
    updateTapMoveBar();
  }

  // ── Command-Panel / Channel-Mirror (Etappe 4) ─────────────────
  // Renders one tile per allowed voice channel. Real users get drag-
  // and-drop between tiles (= Move) and a right-click menu with the
  // commander-role add/remove actions. Bot-members (funkrelais …) get
  // a stripped-down render below a separator with no actions.
  function renderChannelMirror(el, data) {
    if (!data.channelMirror || data.channelMirror.length === 0) {
      el.innerHTML = `<div class="empty">— keine Voice-Channels freigeschaltet —</div>`;
      return;
    }
    el.innerHTML = data.channelMirror
      .map((ch) => {
        const humans = (ch.members || []).filter((m) => !m.isBot);
        const bots = (ch.members || []).filter((m) => m.isBot);
        const humanRows = humans.length
          ? humans
              .map((m) => {
                // Green/red name colour: ONLY the primary commander
                // role (first entry in admin → KONFIG → commanderRoleIds)
                // counts. So "RDOC-CC at the top" lights the names up.
                const primary = data.primaryCommanderRoleId;
                const hasPrimary =
                  !!primary &&
                  Array.isArray(m.currentCommanderRoleIds) &&
                  m.currentCommanderRoleIds.indexOf(primary) >= 0;
                const nameClass = primary
                  ? hasPrimary
                    ? "cmm-name has-cmd"
                    : "cmm-name no-cmd"
                  : "cmm-name";
                const selectedAttr = SELECTED_USERS.has(m.userId) ? " is-selected" : "";
                return `<li class="cm-member${selectedAttr}" draggable="true" data-user-id="${escapeHtml(m.userId)}" data-name="${escapeHtml(m.displayName)}" data-source-channel="${escapeHtml(ch.channelId)}" title="Drag = verschieben · Strg+Klick = mehrere markieren · Rechtsklick = Rolle">
                    <span class="${nameClass}">${escapeHtml(m.displayName)}</span>
                    <button class="btn btn-sm btn-cy cmm-dm" data-dm-user="${escapeHtml(m.userId)}" data-name="${escapeHtml(m.displayName)}" title="Companion-Download-Link per DM senden">DM LINK</button>
                  </li>`;
              })
              .join("")
          : `<li class="cm-empty">— keine User —</li>`;
        const botRows = bots.length
          ? `<li class="cm-bot-sep">RELAIS-BOTS</li>` +
            bots
              .map(
                (m) =>
                  `<li class="cm-member cm-bot" data-user-id="${escapeHtml(m.userId)}">
                    <span class="cmm-name">${escapeHtml(m.displayName)}</span>
                    <span class="cmm-bot-tag">BOT</span>
                  </li>`,
              )
              .join("")
          : "";
        return `<div class="cm-card" data-channel-id="${escapeHtml(ch.channelId)}">
          <div class="cm-head">
            <span class="cm-grip" draggable="true" data-channel-id="${escapeHtml(ch.channelId)}" title="Channel verschieben — vor anderen Channel ziehen">⋮⋮</span>
            <span class="cm-name" data-rename-channel="${escapeHtml(ch.channelId)}" data-current-name="${escapeHtml(ch.channelName)}" title="Klick zum Umbenennen">${escapeHtml(ch.channelName)}</span>
            <span class="cm-count">${humans.length}</span>
          </div>
          <ul class="cm-members">${humanRows}${botRows}</ul>
        </div>`;
      })
      .join("");
  }

  function wireChannelMirrorHandlers(data) {
    // Channel rename: click on the name → prompt → POST rename.
    document.querySelectorAll("[data-rename-channel]").forEach((el) => {
      if (el.__wired) return;
      el.__wired = true;
      el.addEventListener("click", async () => {
        const channelId = el.getAttribute("data-rename-channel");
        const current = el.getAttribute("data-current-name") || "";
        const next = await openRenameDialog(current);
        if (next === null || next.trim() === "" || next === current) return;
        const r = await fetch(
          `${NAV}/api/channels/${encodeURIComponent(channelId)}/rename`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: next.trim() }),
          },
        );
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          alert(formatMutationError("Umbenennen fehlgeschlagen", err, r.status));
        }
      });
    });

    // Click on a member row → toggle in selection set (Ctrl is no
    // longer required, plain click works too — both have the same
    // toggle behaviour). Clicks on the DM button itself are ignored
    // here so the action fires without also flipping the mark.
    document.querySelectorAll(".cm-member[draggable=\"true\"]").forEach((row) => {
      if (row.__wiredSelect) return;
      row.__wiredSelect = true;
      row.addEventListener("click", (ev) => {
        if (ev.target.closest(".cmm-dm")) return;
        // Prevent the document-level "click outside → clear" handler
        // below from interpreting this as outside.
        ev.stopPropagation();
        const userId = row.getAttribute("data-user-id");
        if (SELECTED_USERS.has(userId)) {
          SELECTED_USERS.delete(userId);
          row.classList.remove("is-selected");
        } else {
          SELECTED_USERS.add(userId);
          row.classList.add("is-selected");
        }
        updateStrategyChannelButton();
      });
    });

    // Click anywhere OUTSIDE a member row or the context menu clears
    // the whole selection. Wired ONCE on document — polling re-renders
    // don't need to rebind it because the listener targets the live
    // DOM via .closest() lookups.
    if (!document.__cmDocCleanerWired) {
      document.__cmDocCleanerWired = true;
      document.addEventListener("click", (ev) => {
        const t = ev.target;
        if (!t || typeof t.closest !== "function") return;
        if (
          t.closest(".cm-member") ||
          t.closest(".cm-ctx-menu") ||
          t.closest("#strategy-channel-btn") ||
          t.closest(".dccc-modal-backdrop")
        )
          return;
        if (SELECTED_USERS.size === 0) return;
        SELECTED_USERS.clear();
        document
          .querySelectorAll(".cm-member.is-selected")
          .forEach((el) => el.classList.remove("is-selected"));
        updateStrategyChannelButton();
      });
    }

    // Channel grip: each .cm-grip is draggable on its own. Drag payload
    // type is "application/x-dccc-channel"; member-drag uses "text/plain"
    // so the two never overlap in the drop handler.
    document.querySelectorAll(".cm-grip[draggable=\"true\"]").forEach((grip) => {
      if (grip.__wiredGrip) return;
      grip.__wiredGrip = true;
      grip.addEventListener("dragstart", (ev) => {
        ev.stopPropagation();
        ev.dataTransfer.effectAllowed = "move";
        const channelId = grip.getAttribute("data-channel-id");
        ev.dataTransfer.setData("application/x-dccc-channel", channelId);
        // Some browsers refuse a drag with no text/* type — include the
        // channelId there too as a fallback. The drop handler keys off
        // the x-dccc-channel type first.
        ev.dataTransfer.setData("text/x-dccc-channel", channelId);
        const card = grip.closest(".cm-card");
        if (card) card.classList.add("channel-dragging");
      });
      grip.addEventListener("dragend", () => {
        document
          .querySelectorAll(".cm-card.channel-dragging")
          .forEach((el) => el.classList.remove("channel-dragging"));
      });
    });

    // Drag-and-Drop for member-move. Bot-members are NOT draggable
    // (renderChannelMirror omits the draggable attribute for them)
    // so this handler silently ignores them.
    document.querySelectorAll(".cm-member[draggable=\"true\"]").forEach((row) => {
      if (row.__wired) return;
      row.__wired = true;
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.effectAllowed = "move";
        const draggedId = row.getAttribute("data-user-id");
        // If the dragged user is part of an active multi-selection,
        // take all selected users along. Otherwise just this one.
        const payload =
          SELECTED_USERS.has(draggedId) && SELECTED_USERS.size > 1
            ? Array.from(SELECTED_USERS)
            : [draggedId];
        ev.dataTransfer.setData("text/plain", JSON.stringify(payload));
        ev.dataTransfer.setData(
          "application/x-dccc-source-channel",
          row.getAttribute("data-source-channel") || "",
        );
        // Visual feedback on all carried rows, not just the one under the cursor.
        payload.forEach((uid) => {
          const r = document.querySelector(`.cm-member[data-user-id="${CSS.escape(uid)}"]`);
          if (r) r.classList.add("dragging");
        });
      });
      row.addEventListener("dragend", () => {
        document.querySelectorAll(".cm-member.dragging").forEach((r) => r.classList.remove("dragging"));
      });
    });
    document.querySelectorAll(".cm-card").forEach((card) => {
      if (card.__wiredDrop) return;
      card.__wiredDrop = true;
      card.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        const types = ev.dataTransfer.types;
        if (types && types.indexOf && types.indexOf("application/x-dccc-channel") >= 0) {
          card.classList.add("channel-drop-before");
        } else {
          card.classList.add("drop-target");
        }
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("drop-target");
        card.classList.remove("channel-drop-before");
      });
      card.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        card.classList.remove("drop-target");
        card.classList.remove("channel-drop-before");
        const targetChannel = card.getAttribute("data-channel-id");
        if (!targetChannel) return;
        // Channel-tile reorder takes precedence over member-move.
        const draggedChannelId = ev.dataTransfer.getData("application/x-dccc-channel");
        if (draggedChannelId) {
          if (draggedChannelId !== targetChannel) {
            void reorderChannels(draggedChannelId, targetChannel);
          }
          return;
        }
        const raw = ev.dataTransfer.getData("text/plain");
        if (!raw) return;
        // dragstart now serializes an array. Tolerate the old single-
        // string form for safety (e.g. a foreign drag source).
        let userIds;
        try {
          const parsed = JSON.parse(raw);
          userIds = Array.isArray(parsed) ? parsed : [String(parsed)];
        } catch {
          userIds = [raw];
        }
        await executeMemberMoves(userIds, targetChannel);
      });
      // Tap-to-Move: on touch devices, tapping anywhere on a card
      // (outside member rows + interactive children) with an active
      // multi-selection commits the move. No drag required.
      card.addEventListener("click", async (ev) => {
        if (!IS_TOUCH) return;
        if (SELECTED_USERS.size === 0) return;
        if (
          ev.target.closest(".cm-member") ||
          ev.target.closest(".cmm-dm") ||
          ev.target.closest(".cm-grip") ||
          ev.target.closest("[data-rename-channel]") ||
          ev.target.closest("#strategy-channel-btn")
        )
          return;
        const targetChannel = card.getAttribute("data-channel-id");
        if (!targetChannel) return;
        const userIds = Array.from(SELECTED_USERS);
        await executeMemberMoves(userIds, targetChannel);
      });
    });

    // Right-click → context menu with role add/remove for the
    // commander-roles whitelist only. Bot-members aren't draggable
    // and the human-row contextmenu suppresses the default browser
    // menu by event.preventDefault().
    const ctxMenu = document.getElementById("cm-ctx-menu");
    if (ctxMenu) {
      const commanderRoles = (data && data.commanderRoles) || [];
      const memberRowSelector = '.cm-member[draggable="true"]';
      document.querySelectorAll(memberRowSelector).forEach((row) => {
        if (row.__wiredCtx) return;
        row.__wiredCtx = true;
        row.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          const userId = row.getAttribute("data-user-id");
          const name = row.getAttribute("data-name") || userId;
          // If the right-clicked row is part of an active multi-
          // selection, fan the action out to ALL selected users.
          // Otherwise treat it as a normal single-user action.
          const targets =
            SELECTED_USERS.has(userId) && SELECTED_USERS.size > 1
              ? Array.from(SELECTED_USERS)
              : [userId];
          // For role visibility check we need the role-state per user
          // across the data set. The context menu's add/remove labels
          // are based on "do ALL selected users already have this role":
          // if yes → only "Entferne X" makes sense, if no → only "Vergebe X".
          const userRolesByUser = new Map();
          if (data && data.channelMirror) {
            for (const ch of data.channelMirror) {
              for (const m of ch.members || []) {
                userRolesByUser.set(m.userId, m.currentCommanderRoleIds || []);
              }
            }
          }
          openCtxMenu(ctxMenu, ev.clientX, ev.clientY, {
            targets,
            displayLabel:
              targets.length > 1 ? `${targets.length} User` : name,
            commanderRoles,
            userRolesByUser,
          });
        });
      });
    }

    // DM download link: click → POST + alert.
    document.querySelectorAll("[data-dm-user]").forEach((btn) => {
      if (btn.__wired) return;
      btn.__wired = true;
      btn.addEventListener("click", async () => {
        const userId = btn.getAttribute("data-dm-user");
        const name = btn.getAttribute("data-name") || userId;
        const ok = await openConfirmDialog({
          title: "DM SENDEN",
          message: `"${name}" einen Companion-Download-Link per DM schicken?`,
          confirmLabel: "SENDEN",
        });
        if (!ok) return;
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = "...";
        const r = await fetch(
          `${NAV}/api/members/${encodeURIComponent(userId)}/dm-download-link`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        btn.disabled = false;
        if (r.ok) {
          btn.textContent = "GESENDET";
          setTimeout(() => {
            btn.textContent = orig;
          }, 1500);
        } else {
          btn.textContent = orig;
          const err = await r.json().catch(() => ({}));
          alert(formatMutationError("DM-Versand fehlgeschlagen", err, r.status));
        }
      });
    });
  }

  /** Position + populate the context menu, then attach
   *  click-outside-to-close. Each item POSTs to the role-action
   *  endpoint for every target user in parallel (Promise.allSettled,
   *  so a single Discord rate-limit doesn't block the rest). */
  function openCtxMenu(ctxMenu, x, y, opts) {
    const itemsHtml = opts.commanderRoles.length
      ? opts.commanderRoles
          .map((r) => {
            // Group-action label: "Vergebe X" if NOT ALL targets
            // already have it, "Entferne X" if ALL targets have it.
            // That way a mixed selection adds the role to the people
            // missing it on first click (rather than removing it from
            // the ones who have it, which is the surprising option).
            const allHave = opts.targets.every((uid) =>
              (opts.userRolesByUser.get(uid) || []).indexOf(r.roleId) >= 0,
            );
            const action = allHave ? "remove" : "add";
            const label = (allHave ? "Entferne " : "Vergebe ") + r.roleName;
            return `<button class="cm-ctx-item ${action}" data-role-id="${escapeHtml(r.roleId)}" data-action="${action}">${escapeHtml(label)}</button>`;
          })
          .join("")
      : `<div class="cm-ctx-empty">— keine Commander-Rollen in der Konfig —</div>`;
    ctxMenu.innerHTML = `<div class="cm-ctx-head">${escapeHtml(opts.displayLabel)}</div>${itemsHtml}`;
    ctxMenu.style.left = `${x}px`;
    ctxMenu.style.top = `${y}px`;
    ctxMenu.hidden = false;
    ctxMenu.querySelectorAll("[data-role-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const roleId = btn.getAttribute("data-role-id");
        const action = btn.getAttribute("data-action");
        closeCtxMenu(ctxMenu);
        const results = await Promise.allSettled(
          opts.targets.map((uid) =>
            fetch(`${NAV}/api/members/${encodeURIComponent(uid)}/role`, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ roleId, action }),
            }).then(async (r) => ({
              uid,
              ok: r.ok,
              status: r.status,
              err: r.ok ? null : await r.json().catch(() => ({})),
            })),
          ),
        );
        const failures = [];
        for (const res of results) {
          if (res.status === "fulfilled" && res.value.ok) continue;
          if (res.status === "fulfilled") {
            failures.push({ uid: res.value.uid, err: res.value.err, status: res.value.status });
          } else {
            failures.push({ uid: "?", err: {}, status: 0 });
          }
        }
        if (failures.length === 0) {
          // Optional: clear selection after a successful batch.
          if (opts.targets.length > 1) {
            SELECTED_USERS.clear();
            updateStrategyChannelButton();
          }
          return;
        }
        const summary =
          failures.length === opts.targets.length
            ? `Alle ${opts.targets.length} Aktionen fehlgeschlagen.`
            : `${failures.length} von ${opts.targets.length} fehlgeschlagen.`;
        alert(
          formatMutationError(
            (action === "add" ? "Rolle vergeben" : "Rolle entziehen") + " — " + summary,
            failures[0].err,
            failures[0].status,
          ),
        );
      });
    });
    // Close on outside click or escape.
    setTimeout(() => {
      const onDocClick = (e) => {
        if (!ctxMenu.contains(e.target)) {
          closeCtxMenu(ctxMenu);
          document.removeEventListener("click", onDocClick, true);
          document.removeEventListener("keydown", onKey, true);
        }
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          closeCtxMenu(ctxMenu);
          document.removeEventListener("click", onDocClick, true);
          document.removeEventListener("keydown", onKey, true);
        }
      };
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
  }

  function closeCtxMenu(ctxMenu) {
    ctxMenu.hidden = true;
    ctxMenu.innerHTML = "";
  }

  /** Promise-based replacement for window.prompt() with the site's
   *  chaos-crew look. Resolves to the typed string when the user
   *  confirms (Enter / "Umbenennen" button), or null on Escape /
   *  Cancel / backdrop click. */
  /** Brand-styled confirm dialog. Returns a Promise<boolean> — true if
   *  the user clicked the confirm button, false otherwise (cancel,
   *  Escape, backdrop click). Reuses the .dccc-modal* styling from
   *  the rename dialog so we don't need new CSS. Pass danger: true
   *  to colour the confirm button red for destructive actions. */
  function openConfirmDialog(opts) {
    const title = opts.title || "BESTAETIGEN";
    const message = opts.message || "";
    const confirmLabel = opts.confirmLabel || "OK";
    const cancelLabel = opts.cancelLabel || "ABBRECHEN";
    const confirmClass = opts.danger ? "btn-red" : "btn-cyan";
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "dccc-modal-backdrop";
      backdrop.innerHTML = `
        <div class="dccc-modal" role="dialog" aria-modal="true">
          <div class="dccc-modal-title">${escapeHtml(title)}</div>
          <div class="dccc-modal-body">
            <div class="dccc-modal-hint">${escapeHtml(message)}</div>
          </div>
          <div class="dccc-modal-actions">
            <button type="button" class="btn btn-ghost dccc-modal-cancel">${escapeHtml(cancelLabel)}</button>
            <button type="button" class="btn ${confirmClass} dccc-modal-ok">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);
      const okBtn = backdrop.querySelector(".dccc-modal-ok");
      okBtn.focus();
      let done = false;
      function close(result) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          close(false);
        } else if (e.key === "Enter") {
          e.preventDefault();
          close(true);
        }
      }
      document.addEventListener("keydown", onKey, true);
      backdrop.querySelector(".dccc-modal-cancel").addEventListener("click", () => close(false));
      okBtn.addEventListener("click", () => close(true));
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close(false);
      });
    });
  }

  /** Brand-styled prompt for creating a Strategy-Channel. Returns the
   *  typed name when the user confirms, or null on cancel/Escape.
   *  Default name is "STRATEGY-{HH:MM}" of the local time. */
  function openStrategyChannelDialog(userCount) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const defaultName = `STRATEGY-${hh}${mm}`;
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "dccc-modal-backdrop";
      backdrop.innerHTML = `
        <div class="dccc-modal" role="dialog" aria-modal="true">
          <div class="dccc-modal-title">STRATEGY-CHANNEL ERZEUGEN</div>
          <div class="dccc-modal-body">
            <div class="dccc-modal-hint">${userCount} markierte Member werden in einen neuen Voice-Channel gezogen. Wird automatisch geloescht, sobald er 15 Minuten leer ist.</div>
            <input type="text" class="dccc-modal-input" maxlength="100" />
          </div>
          <div class="dccc-modal-actions">
            <button type="button" class="btn btn-ghost dccc-modal-cancel">ABBRECHEN</button>
            <button type="button" class="btn btn-cyan dccc-modal-ok">ERZEUGEN</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);
      const input = backdrop.querySelector(".dccc-modal-input");
      input.value = defaultName;
      input.focus();
      input.select();
      let done = false;
      function close(result) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          close(null);
        } else if (e.key === "Enter") {
          e.preventDefault();
          close(input.value);
        }
      }
      document.addEventListener("keydown", onKey, true);
      backdrop.querySelector(".dccc-modal-cancel").addEventListener("click", () => close(null));
      backdrop.querySelector(".dccc-modal-ok").addEventListener("click", () => close(input.value));
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close(null);
      });
    });
  }

  // ── Strategy-Channel button handler ──────────────────────────
  function wireStrategyChannelButton() {
    const btn = document.getElementById("strategy-channel-btn");
    if (!btn) return;
    if (btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (SELECTED_USERS.size === 0) return;
      const selectedIds = Array.from(SELECTED_USERS);
      const name = await openStrategyChannelDialog(selectedIds.length);
      if (name === null || name.trim() === "") return;
      btn.disabled = true;
      const orig = btn.innerHTML;
      btn.textContent = "...";
      let r;
      try {
        r = await fetch(`${NAV}/api/strategy-channels`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim(), userIds: selectedIds }),
        });
      } catch (e) {
        btn.disabled = false;
        btn.innerHTML = orig;
        updateStrategyChannelButton();
        alert("Netzwerkfehler beim Erzeugen des Strategy-Channels.");
        return;
      }
      btn.innerHTML = orig;
      if (!r.ok) {
        btn.disabled = false;
        updateStrategyChannelButton();
        const err = await r.json().catch(() => ({}));
        alert(formatMutationError("Strategy-Channel erzeugen fehlgeschlagen", err, r.status));
        return;
      }
      const data = await r.json().catch(() => ({}));
      // Channel created — drop selection, let SSE repaint pick up the
      // new tile + the moved users.
      SELECTED_USERS.clear();
      document
        .querySelectorAll(".cm-member.is-selected")
        .forEach((el) => el.classList.remove("is-selected"));
      updateStrategyChannelButton();
      if (data.moveFailures && data.moveFailures.length > 0) {
        // Channel was created but some moves failed (rate-limit, not-in-voice, ...).
        // Surface the first failure but don't roll back — channel is real.
        const first = data.moveFailures[0];
        alert(
          `Strategy-Channel "${data.name}" wurde erstellt, aber ${data.moveFailures.length} von ${selectedIds.length} Move(s) fehlgeschlagen.\n\nErster Fehler: ${formatMutationError("", { error: "user_not_in_voice", detail: first.message }, first.status)}`,
        );
      }
    });
  }

  function openRenameDialog(currentName) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "dccc-modal-backdrop";
      backdrop.innerHTML = `
        <div class="dccc-modal" role="dialog" aria-modal="true">
          <div class="dccc-modal-title">CHANNEL UMBENENNEN</div>
          <div class="dccc-modal-body">
            <div class="dccc-modal-hint">Aktueller Name: <strong>${escapeHtml(currentName)}</strong></div>
            <input type="text" class="dccc-modal-input" maxlength="100" />
          </div>
          <div class="dccc-modal-actions">
            <button type="button" class="btn btn-ghost dccc-modal-cancel">ABBRECHEN</button>
            <button type="button" class="btn btn-cyan dccc-modal-ok">UMBENENNEN</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);
      const input = backdrop.querySelector(".dccc-modal-input");
      input.value = currentName;
      input.focus();
      input.select();
      let done = false;
      function close(result) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          close(null);
        } else if (e.key === "Enter") {
          e.preventDefault();
          close(input.value);
        }
      }
      document.addEventListener("keydown", onKey, true);
      backdrop.querySelector(".dccc-modal-cancel").addEventListener("click", () => close(null));
      backdrop.querySelector(".dccc-modal-ok").addEventListener("click", () => close(input.value));
      // Click on the backdrop (outside the card) = cancel.
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close(null);
      });
    });
  }

  // ── Config-Form: JSON-POST on submit ─────────────────────────
  function wireConfigForm() {
    const form = document.getElementById("config-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = {
        enabled: form.elements.enabled.checked,
        commanderRoleIds: parseLines(form.elements.commanderRoleIds.value),
        allowedVoiceChannelIds: parseLines(form.elements.allowedVoiceChannelIds.value),
      };
      const res = await fetch(`${NAV}/api/config`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        location.href = `${NAV}/config?saved=1`;
      } else {
        const err = await res.json().catch(() => ({}));
        alert(
          "Fehler beim Speichern: " + (err.error || res.status) +
            (err.issues ? "\n" + err.issues.join("\n") : ""),
        );
      }
    });
  }

  // ── Invite-Form: create + show URL ───────────────────────────
  function wireInviteForm() {
    const form = document.getElementById("invite-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const label = form.elements.label.value.trim();
      const roleEl = form.querySelector('input[name="role"]:checked');
      const role = roleEl ? roleEl.value : "vice_admiral";
      if (!label) return;
      const res = await fetch(`${NAV}/api/invites`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, role }),
      });
      if (!res.ok) {
        alert("Fehler beim Erstellen: HTTP " + res.status);
        return;
      }
      const data = await res.json();
      const exp = Math.floor(new Date(data.expiresAt).getTime() / 1000);
      location.href =
        `${NAV}/admins?fresh=${encodeURIComponent(data.token)}` +
        `&fresh_exp=${exp}&fresh_role=${encodeURIComponent(data.role)}`;
    });
  }

  // ── Companion-Download-Links ─────────────────────────────────
  function wireDownloadCard() {
    const card = document.getElementById("downloads-card");
    if (!card) return;
    const form = document.getElementById("download-form");
    const list = document.getElementById("download-list");
    const meta = document.getElementById("release-meta");

    function fmtDate(s) {
      if (!s) return "—";
      const d = new Date(s);
      return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
    }

    async function refreshRelease() {
      try {
        const r = await fetch(`${NAV}/api/companion-release`, { credentials: "include" });
        if (!r.ok) { meta.textContent = "release: ?"; return; }
        const d = await r.json();
        if (!d.configured) {
          meta.textContent = "GitHub-Repo nicht konfiguriert";
          meta.style.color = "var(--red)";
          return;
        }
        if (!d.release) {
          meta.textContent = `${d.repo} — kein Release`;
          meta.style.color = "var(--red)";
          return;
        }
        const a = d.release.asset;
        meta.textContent = a
          ? `${d.release.tagName} · ${a.name} · ${(a.size / 1048576).toFixed(1)} MB`
          : `${d.release.tagName} — kein passendes Asset`;
        meta.style.color = a ? "var(--cyan)" : "var(--red)";
      } catch (e) {
        meta.textContent = "release: error";
      }
    }

    function urlFor(plaintext) {
      // Build the full download URL from the raw token.
      return `${location.origin}${NAV.replace(/\/admin$/, "")}/download/companion/${plaintext}`;
    }

    async function refreshList() {
      const r = await fetch(`${NAV}/api/companion-downloads`, { credentials: "include" });
      if (!r.ok) {
        list.innerHTML = `<li class="empty">Fehler beim Laden (HTTP ${r.status})</li>`;
        return;
      }
      const d = await r.json();
      const items = d.tokens || [];
      if (items.length === 0) {
        list.innerHTML = `<li class="empty">— noch keine Links erzeugt —</li>`;
        return;
      }
      list.innerHTML = items.map((t) => {
        const state = t.usedAt
          ? `USED ${fmtDate(t.usedAt)}`
          : `EXPIRES ${fmtDate(t.expiresAt)}`;
        const tone = t.usedAt ? "used" : "live";
        const actions = t.usedAt
          ? ""
          : (t.plaintext
              ? `<button class="btn btn-sm btn-cyan" data-copy-download="${escapeHtml(t.plaintext)}" title="Link in die Zwischenablage kopieren">KOPIEREN</button>`
              : "") +
            `<button class="btn btn-sm btn-red" data-revoke-download="${escapeHtml(t.id)}">REVOKE</button>`;
        return `<li class="invite-row ${tone}"><span class="i-label">${escapeHtml(t.label)}</span><span class="i-state">${escapeHtml(state)}</span>${actions}</li>`;
      }).join("");
      list.querySelectorAll("[data-copy-download]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const url = urlFor(btn.getAttribute("data-copy-download"));
          try {
            await navigator.clipboard.writeText(url);
            const orig = btn.textContent;
            btn.textContent = "OK!";
            setTimeout(() => { btn.textContent = orig; }, 1200);
          } catch {
            prompt("Link kopieren:", url);
          }
        });
      });
      list.querySelectorAll("[data-revoke-download]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const ok = await openConfirmDialog({
            title: "DOWNLOAD-LINK LOESCHEN",
            message: "Diesen offenen Download-Link wirklich loeschen?",
            confirmLabel: "LOESCHEN",
            danger: true,
          });
          if (!ok) return;
          const id = btn.getAttribute("data-revoke-download");
          const r = await fetch(`${NAV}/api/companion-downloads/${encodeURIComponent(id)}`, {
            method: "DELETE",
            credentials: "include",
          });
          if (r.ok) refreshList();
          else alert("Fehler: HTTP " + r.status);
        });
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const label = form.elements.label.value.trim();
      if (!label) return;
      const r = await fetch(`${NAV}/api/companion-downloads`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        alert("Fehler: " + (err.detail || err.error || `HTTP ${r.status}`));
        return;
      }
      const data = await r.json();
      // One-shot reveal: copy to clipboard + alert. Also refresh the list.
      try { await navigator.clipboard.writeText(data.url); } catch {}
      alert(
        `Download-Link erstellt (in Zwischenablage kopiert):\n\n${data.url}\n\nGültig bis ${fmtDate(data.expiresAt)}. Einmal verwendbar.`,
      );
      form.elements.label.value = "";
      refreshList();
    });

    refreshRelease();
    refreshList();
  }

  // ── Admin-Row Actions: set-role + remove ─────────────────────
  function wireAdminActions() {
    document.querySelectorAll("[data-set-role]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const userId = btn.getAttribute("data-set-role");
        const newRole = btn.getAttribute("data-new-role");
        const label = newRole === "admiral" ? "ADMIRAL" : "VICE ADMIRAL";
        const ok = await openConfirmDialog({
          title: "ADMIN-ROLLE AENDERN",
          message: `Rolle dieses Admins auf ${label} aendern?`,
          confirmLabel: "AENDERN",
        });
        if (!ok) return;
        const res = await fetch(
          `${NAV}/api/admins/${encodeURIComponent(userId)}/role`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ role: newRole }),
          },
        );
        if (res.ok) location.reload();
        else {
          const err = await res.json().catch(() => ({}));
          alert("Fehler: " + (err.error || res.status));
        }
      });
    });
    document.querySelectorAll("[data-remove-admin]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const userId = btn.getAttribute("data-remove-admin");
        const ok = await openConfirmDialog({
          title: "ADMIN ENTFERNEN",
          message: "Diesen Admin wirklich entfernen?",
          confirmLabel: "ENTFERNEN",
          danger: true,
        });
        if (!ok) return;
        const res = await fetch(`${NAV}/api/admins/${encodeURIComponent(userId)}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (res.ok) location.reload();
        else {
          const err = await res.json().catch(() => ({}));
          alert("Fehler: " + (err.error || res.status));
        }
      });
    });
  }

  // ── Commander-Rolle entziehen (dashboard) ────────────────────
  function wireStripCommanderButtons() {
    document.querySelectorAll("[data-strip-commander]").forEach((btn) => {
      if (btn.__wired) return;
      btn.__wired = true;
      btn.addEventListener("click", async () => {
        const userId = btn.getAttribute("data-strip-commander");
        const name = btn.getAttribute("data-name") || userId;
        const ok = await openConfirmDialog({
          title: "COMMANDER-ROLLE ENTZIEHEN",
          message: `Soll "${name}" wirklich die Commander-Rolle entzogen werden? Der Bot entfernt sie sofort in Discord.`,
          confirmLabel: "ENTZIEHEN",
          danger: true,
        });
        if (!ok) return;
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = "...";
        const res = await fetch(
          `${NAV}/api/commander-roles/${encodeURIComponent(userId)}`,
          { method: "DELETE", credentials: "include" },
        );
        if (res.ok) {
          btn.textContent = "OK";
          // Dashboard tick (5s) will redraw the row without this user.
        } else {
          const err = await res.json().catch(() => ({}));
          btn.disabled = false;
          btn.textContent = orig;
          alert(
            "Fehler beim Entziehen: " +
              (err.error || res.status) +
              (err.failed && err.failed.length
                ? `\n(Bot konnte ${err.failed.length} Rolle(n) nicht entfernen — meist hat er nicht genug Berechtigung in der Rollen-Hierarchie.)`
                : ""),
          );
        }
      });
    });
  }

  // ── Revoke-Invite-Buttons ────────────────────────────────────
  function wireRevokeButtons() {
    document.querySelectorAll("[data-revoke-invite]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ok = await openConfirmDialog({
          title: "INVITE-LINK LOESCHEN",
          message: "Diesen offenen Invite-Link wirklich loeschen?",
          confirmLabel: "LOESCHEN",
          danger: true,
        });
        if (!ok) return;
        const id = btn.getAttribute("data-revoke-invite");
        const res = await fetch(`${NAV}/api/invites/${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (res.ok) location.reload();
        else alert("Fehler beim Revoke: HTTP " + res.status);
      });
    });
  }

  // ── Copy-Button für fresh invite-URL ─────────────────────────
  function wireCopyFresh() {
    const btn = document.getElementById("copy-fresh");
    const input = document.getElementById("fresh-url");
    if (!btn || !input) return;
    btn.addEventListener("click", () => {
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        const orig = btn.textContent;
        btn.textContent = "COPIED!";
        setTimeout(() => {
          btn.textContent = orig;
        }, 1200);
      });
    });
  }

  // ── Helpers ──────────────────────────────────────────────────
  function parseLines(text) {
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // ── Guild switcher: dropdown (desktop) / bottom-sheet (touch) ──
  // The inline dropdown inside the nav's horizontal-scroll container
  // is too fragile on iOS Safari. Touch devices get a full bottom-
  // sheet modal cloned from the menu's items, attached to body so
  // there's no nested-scroll, z-index, or overflow-clipping in play.
  function wireGuildSwitcher() {
    const btn = document.getElementById("guild-switcher-btn");
    const menu = document.getElementById("guild-switcher-menu");
    if (!btn || !menu) return;
    if (IS_TOUCH) {
      function openSheet(e) {
        e.preventDefault();
        e.stopPropagation();
        if (document.getElementById("guild-sheet-backdrop")) return; // already open
        const items = Array.from(menu.querySelectorAll(".cc-switcher-item")).map(
          (a) => ({
            url: a.getAttribute("href"),
            html: a.innerHTML,
            isBotless: a.classList.contains("is-botless"),
          }),
        );
        const backdrop = document.createElement("div");
        backdrop.id = "guild-sheet-backdrop";
        backdrop.className = "guild-sheet-backdrop";
        backdrop.innerHTML =
          '<div class="guild-sheet">' +
            '<div class="guild-sheet-title">SERVER WECHSELN</div>' +
            '<ul class="guild-sheet-list">' +
              items
                .map(
                  (i) =>
                    `<li><a href="${escapeHtml(i.url || "")}" class="guild-sheet-item${i.isBotless ? " is-botless" : ""}">${i.html}</a></li>`,
                )
                .join("") +
            "</ul>" +
            '<button type="button" class="guild-sheet-cancel">ABBRECHEN</button>' +
          "</div>";
        document.body.appendChild(backdrop);
        function close() {
          backdrop.remove();
        }
        backdrop
          .querySelector(".guild-sheet-cancel")
          .addEventListener("click", close);
        backdrop.addEventListener("click", (ev) => {
          if (ev.target === backdrop) close();
        });
      }
      btn.addEventListener("click", openSheet);
      btn.addEventListener("touchend", openSheet, { passive: false });
      return;
    }
    // Desktop: original inline dropdown.
    function toggle(e) {
      e.preventDefault();
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    }
    btn.addEventListener("click", toggle);
    function clickOutside(e) {
      const t = e.target;
      if (btn.contains(t) || menu.contains(t)) return;
      menu.hidden = true;
    }
    document.addEventListener("click", clickOutside);
  }

  // ── Relay Bots: config form ──────────────────────────────────
  function wireRelayBotsForm() {
    const configCard = document.getElementById("relay-config-card");
    if (!configCard) return;
    const canSeeTokens = configCard.dataset.canSeeTokens !== "0";

    // Seed the working bot array from the server-rendered rows.
    let bots = [];
    document.querySelectorAll("#relay-bot-rows .bot-row").forEach((row) => {
      bots.push({
        name: row.querySelector(".bot-name").value,
        channelId: row.querySelector(".bot-channel").value,
        token: row.querySelector(".bot-token").value,
      });
    });

    function renderBotRows() {
      const container = document.getElementById("relay-bot-rows");
      if (!container) return;
      const tokenDisabled = canSeeTokens ? "" : " disabled title=\"Nur Admirale können Bot-Tokens sehen\"";
      container.innerHTML = bots
        .map(
          (b, i) =>
            `<div class="bot-row" data-bot-index="${i}">` +
            `<div class="field field-inline"><label>Name</label><input type="text" class="bot-name" value="${escapeHtml(b.name)}" maxlength="100"></div>` +
            `<div class="field field-inline"><label>Channel ID</label><input type="text" class="bot-channel" value="${escapeHtml(b.channelId)}"></div>` +
            `<div class="field field-inline field-grow"><label>Token</label><input type="password" class="bot-token" value="${escapeHtml(b.token)}"${tokenDisabled}></div>` +
            `<button type="button" class="btn btn-sm btn-red btn-remove-bot" data-index="${i}">ENTFERNEN</button>` +
            `</div>`,
        )
        .join("");
      const countEl = document.getElementById("relay-bot-count");
      if (countEl) countEl.textContent = String(bots.length);
      container.querySelectorAll(".btn-remove-bot").forEach((btn) => {
        btn.addEventListener("click", () => {
          bots.splice(parseInt(btn.getAttribute("data-index"), 10), 1);
          renderBotRows();
        });
      });
    }

    document.getElementById("relay-add-bot")?.addEventListener("click", () => {
      bots.push({ name: "", channelId: "", token: "" });
      renderBotRows();
    });

    const saveBtn = document.getElementById("relay-save");
    const errorEl = document.getElementById("relay-save-error");
    saveBtn?.addEventListener("click", async () => {
      if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
      // Re-read inputs before submitting (user may have typed without triggering a re-render).
      const container = document.getElementById("relay-bot-rows");
      if (container) {
        bots = [];
        container.querySelectorAll(".bot-row").forEach((row) => {
          bots.push({
            name: (row.querySelector(".bot-name")?.value ?? "").trim(),
            channelId: (row.querySelector(".bot-channel")?.value ?? "").trim(),
            token: row.querySelector(".bot-token")?.value ?? "",
          });
        });
      }
      const body = {
        livekitUrl: (document.getElementById("relay-lk-url")?.value ?? "").trim(),
        roomName: (document.getElementById("relay-lk-room")?.value ?? "").trim(),
        livekitApiKey: (document.getElementById("relay-lk-key")?.value ?? "").trim(),
        livekitApiSecret: document.getElementById("relay-lk-secret")?.value ?? "",
        guildId: (document.getElementById("relay-guild-id")?.value ?? "").trim(),
        bots,
      };
      saveBtn.disabled = true;
      try {
        const res = await fetch(`${NAV}/relay-bots/config`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        if (res.ok) {
          location.href = `${NAV}/relay-bots?saved=1`;
        } else {
          const err = await res.json().catch(() => ({}));
          if (errorEl) {
            errorEl.textContent = "Fehler: " + (err.error || "HTTP " + res.status);
            errorEl.style.display = "";
          }
        }
      } catch (e) {
        if (errorEl) { errorEl.textContent = "Fehler: " + e.message; errorEl.style.display = ""; }
      } finally {
        saveBtn.disabled = false;
      }
    });

    document.getElementById("relay-restart")?.addEventListener("click", async () => {
      if (!confirm("Relay Bots wirklich neu starten?")) return;
      const btn = document.getElementById("relay-restart");
      if (btn) btn.disabled = true;
      try {
        const res = await fetch(`${NAV}/relay-bots/restart`, {
          method: "POST",
          credentials: "include",
        });
        if (res.ok) {
          alert("Relay Bots werden neu gestartet.");
        } else {
          const err = await res.json().catch(() => ({}));
          alert("Fehler: " + (err.error || "HTTP " + res.status));
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  // ── Relay Bots: live metrics polling ─────────────────────────
  function wireRelayBotsMetrics() {
    const globalEl = document.getElementById("relay-metrics-global");
    const botsEl = document.getElementById("relay-metrics-bots");
    if (!globalEl && !botsEl) return;

    // 1 s stereo s16le at 48 kHz — must match MAX_BUFFER_BYTES in bot.ts
    const MAX_BUF = 48_000 * 2 * 2 * 1;

    function fmtBytes(b) {
      if (b < 1024) return b + " B";
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
      return (b / 1024 / 1024).toFixed(1) + " MB";
    }

    function fmtDuration(ms) {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) return h + "h " + (m % 60) + "m";
      if (m > 0) return m + "m " + (s % 60) + "s";
      return s + "s";
    }

    function svcChip(label, extra, cls) {
      return `<span class="health-svc${cls ? " " + cls : ""}"><span class="health-dot"></span>${escapeHtml(label)}${extra ? ": " + escapeHtml(String(extra)) : ""}</span>`;
    }

    async function tickMetrics() {
      try {
        const res = await fetch(`${NAV}/relay-bots/metrics`, { credentials: "include" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const m = await res.json();

        if (m.offline) {
          if (globalEl) globalEl.innerHTML = svcChip("OFFLINE", null, "error");
          if (botsEl) botsEl.innerHTML = "";
          return;
        }

        if (globalEl) {
          const lastAudio = m.lastAudioAt
            ? Math.round((Date.now() - m.lastAudioAt) / 1000) + " s ago"
            : "—";
          const p = m.process || {};
          const restarts = m.watchdogRestarts || 0;
          globalEl.innerHTML =
            svcChip("UPTIME", fmtDuration(m.uptimeMs || 0), "ok") +
            svcChip("FRAMES", (m.framesReceived || 0).toLocaleString(), "") +
            svcChip("AUDIO IN", fmtBytes(m.bytesReceived || 0), "") +
            svcChip("LAST AUDIO", lastAudio, "") +
            svcChip("WATCHDOG ↻", restarts, restarts > 0 ? "error" : "") +
            svcChip("RSS", fmtBytes(p.rssBytes || 0), "");
        }

        if (botsEl && Array.isArray(m.bots)) {
          botsEl.innerHTML = m.bots
            .map((b) => {
              const pct = Math.min(100, ((b.bufferBytes || 0) / MAX_BUF) * 100);
              const fillCls = pct < 40 ? "buf-ok" : pct < 75 ? "buf-warn" : "buf-crit";
              const stateCls =
                b.playerState === "playing"
                  ? "s-playing"
                  : b.playerState === "buffering"
                  ? "s-buffering"
                  : b.playerState === "autopaused"
                  ? "s-autopaused"
                  : "s-idle";
              const connText = b.voiceConnected ? (b.speaking ? "SPK" : "IDLE") : "OFFLINE";
              const connCls = b.voiceConnected ? (b.speaking ? "ok" : "") : "error";
              const overflowHtml =
                b.bufferOverflows > 0
                  ? `<span style="font-size:11px;color:#f87171">⚠ ${b.bufferOverflows} ovfl</span>`
                  : "";
              const reconnectHtml =
                b.reconnectCount > 0
                  ? `<span style="font-size:11px;color:#94a3b8">↻ ${b.reconnectCount}</span>`
                  : "";
              return (
                `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">` +
                `<span class="health-svc ${connCls}" style="min-width:110px"><span class="health-dot"></span>${escapeHtml(b.name || "?")}</span>` +
                `<span class="${stateCls}" style="font-size:11px;padding:2px 6px;border-radius:3px">${escapeHtml(b.playerState || "?")}</span>` +
                `<span class="badge ${b.voiceConnected ? "on" : "off"}" style="font-size:10px">${connText}</span>` +
                `<div style="flex:1;min-width:80px">` +
                `<div style="font-size:10px;color:#64748b;margin-bottom:2px">buf ${fmtBytes(b.bufferBytes || 0)}</div>` +
                `<div style="height:4px;background:#0f131b;border-radius:2px"><div class="${fillCls}" style="height:100%;border-radius:2px;width:${pct.toFixed(1)}%"></div></div>` +
                `</div>` +
                reconnectHtml +
                overflowHtml +
                `</div>`
              );
            })
            .join("");
        }
      } catch {
        // silent — retry next tick
      }
    }

    tickMetrics();
    setInterval(tickMetrics, 3000);
  }

  // ── Boot ─────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  function boot() {
    startDashboardPolling();
    wireConfigForm();
    wireInviteForm();
    wireRevokeButtons();
    wireCopyFresh();
    wireGuildSwitcher();
    wireAdminActions();
    wireStripCommanderButtons();
    wireDownloadCard();
    wireStrategyChannelButton();
    updateStrategyChannelButton();
    wireRelayBotsForm();
    wireRelayBotsMetrics();
  }
})();

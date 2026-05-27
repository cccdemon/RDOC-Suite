// DCCC Admin UI — minimal client JS. No build step, no framework.
// Reads window.__DCCC_NAV_BASE__ to find the admin URL prefix.

(function () {
  "use strict";
  const NAV = window.__DCCC_NAV_BASE__ || "/admin";

  // ── Dashboard: 5s polling of /admin/api/live ─────────────────
  function startDashboardPolling() {
    const activeEl = document.getElementById("active-commanders");
    const activeCountEl = document.getElementById("active-count");
    const membersEl = document.getElementById("commander-members");
    const memberCountEl = document.getElementById("member-count");
    const mirrorEl = document.getElementById("channel-mirror");
    const mirrorCountEl = document.getElementById("channel-mirror-count");
    if (!activeEl && !membersEl && !mirrorEl) return; // not on dashboard

    async function tick() {
      try {
        const res = await fetch(`${NAV}/api/live`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
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
          // Buttons get re-created on every tick — rebind their handlers.
          wireStripCommanderButtons();
        }
        if (mirrorEl) {
          pruneSelectionAgainstData(data);
          renderChannelMirror(mirrorEl, data);
          if (mirrorCountEl)
            mirrorCountEl.textContent = String(data.channelMirror.length);
          wireChannelMirrorHandlers(data);
        }
      } catch (e) {
        // silent — next tick retries
      }
    }
    tick();
    setInterval(tick, 5000);
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

  // ── Raid-Planer selection state ─────────────────────────────
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
  }

  // ── Raid-Planer / Channel-Mirror (Etappe 4) ─────────────────
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
        if (t.closest(".cm-member") || t.closest(".cm-ctx-menu")) return;
        if (SELECTED_USERS.size === 0) return;
        SELECTED_USERS.clear();
        document
          .querySelectorAll(".cm-member.is-selected")
          .forEach((el) => el.classList.remove("is-selected"));
      });
    }

    // Drag-and-Drop for member-move. Bot-members are NOT draggable
    // (renderChannelMirror omits the draggable attribute for them)
    // so this handler silently ignores them.
    document.querySelectorAll(".cm-member[draggable=\"true\"]").forEach((row) => {
      if (row.__wired) return;
      row.__wired = true;
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", row.getAttribute("data-user-id"));
        ev.dataTransfer.setData(
          "application/x-dccc-source-channel",
          row.getAttribute("data-source-channel") || "",
        );
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
    });
    document.querySelectorAll(".cm-card").forEach((card) => {
      if (card.__wiredDrop) return;
      card.__wiredDrop = true;
      card.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        card.classList.add("drop-target");
      });
      card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
      card.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        card.classList.remove("drop-target");
        const userId = ev.dataTransfer.getData("text/plain");
        const sourceChannel = ev.dataTransfer.getData(
          "application/x-dccc-source-channel",
        );
        const targetChannel = card.getAttribute("data-channel-id");
        if (!userId || !targetChannel || sourceChannel === targetChannel) return;
        const r = await fetch(
          `${NAV}/api/members/${encodeURIComponent(userId)}/move`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ channelId: targetChannel }),
          },
        );
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          alert(formatMutationError("Verschieben fehlgeschlagen", err, r.status));
        }
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
        if (!confirm(`"${name}" einen Companion-Download-Link per DM schicken?`)) return;
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
          if (opts.targets.length > 1) SELECTED_USERS.clear();
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
          if (!confirm("Diesen offenen Download-Link wirklich löschen?")) return;
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
        if (!confirm(`Rolle dieses Admins auf ${label} ändern?`)) return;
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
        if (!confirm("Diesen Admin wirklich entfernen?")) return;
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
        if (
          !confirm(
            `Soll "${name}" wirklich die Commander-Rolle entzogen werden? Das macht der Bot direkt in Discord — die Rolle ist sofort weg.`,
          )
        )
          return;
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
        if (!confirm("Diesen offenen Invite-Link wirklich löschen?")) return;
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

  // ── Guild switcher dropdown ──────────────────────────────────
  function wireGuildSwitcher() {
    const btn = document.getElementById("guild-switcher-btn");
    const menu = document.getElementById("guild-switcher-menu");
    if (!btn || !menu) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target) && e.target !== btn) menu.hidden = true;
    });
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
  }
})();

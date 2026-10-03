/* ══════════════════════════════════════════════════════════════════════════
   Dialog – Ersatz für die schlichten Browser-Popups (confirm/prompt/alert).
   Die Fenster sind im Stil des Spiels gehalten.

   Verwendung (immer mit await, da die Antwort erst nach dem Klick kommt):

     if (await Dialog.confirm("Wirklich löschen?")) { ... }

     const name = await Dialog.prompt("Name des Tokens?", "Ork");
     if (name !== null) { ... }                 // null = abgebrochen

     await Dialog.alert("Der DM hat dich entfernt.");

   Optionen (2. bzw. 3. Argument):
     { title, icon, okText, cancelText, danger, hint, placeholder }
   ══════════════════════════════════════════════════════════════════════════ */
const Dialog = (() => {

  let _open = null;   // aktuell offener Dialog (nur einer gleichzeitig)

  // Baut das Fenster auf und liefert ein Versprechen auf das Ergebnis.
  function _show({ kind, message, value, opts }) {
    // Einen bereits offenen Dialog zuerst schließen (kein Stapeln).
    if (_open) _open.cancel();

    const o = Object.assign({
      title:       null,
      icon:        null,
      okText:      "OK",
      cancelText:  "Abbrechen",
      danger:      false,
      hint:        "",
      placeholder: "",
    }, opts || {});

    // Sinnvolle Vorgaben je nach Art des Dialogs
    if (!o.title) {
      o.title = kind === "confirm" ? "Bist du sicher?"
              : kind === "prompt"  ? "Eingabe"
              :                      "Hinweis";
    }
    if (!o.icon) {
      o.icon = o.danger            ? "⚠️"
             : kind === "confirm"  ? "❓"
             : kind === "prompt"   ? "✍️"
             :                       "📜";
    }
    if (kind === "confirm" && o.okText === "OK") o.okText = "Ja";
    if (kind === "confirm" && o.cancelText === "Abbrechen") o.cancelText = "Nein";

    const backdrop = document.createElement("div");
    backdrop.className = "dlg-backdrop";

    const dlg = document.createElement("div");
    dlg.className = "dlg" + (o.danger ? " danger" : "");
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");

    // Kopf
    const head = document.createElement("div");
    head.className = "dlg-head";
    const ic = document.createElement("div");
    ic.className = "dlg-icon";
    ic.textContent = o.icon;
    const ti = document.createElement("div");
    ti.className = "dlg-title";
    ti.textContent = o.title;
    head.append(ic, ti);

    // Inhalt
    const body = document.createElement("div");
    body.className = "dlg-body";
    // Die Nachricht darf mehrzeilig sein (\n wird zu Absätzen).
    String(message ?? "").split("\n").forEach(line => {
      const p = document.createElement("p");
      p.textContent = line;
      body.appendChild(p);
    });

    let input = null;
    if (kind === "prompt") {
      input = document.createElement("input");
      input.className = "dlg-input";
      input.type = o.inputType || "text";
      input.value = value ?? "";
      if (o.placeholder) input.placeholder = o.placeholder;
      body.appendChild(input);
    }
    if (o.hint) {
      const h = document.createElement("div");
      h.className = "dlg-hint";
      h.textContent = o.hint;
      body.appendChild(h);
    }

    // Fuß mit Knöpfen
    const foot = document.createElement("div");
    foot.className = "dlg-foot";

    let btnCancel = null;
    if (kind !== "alert") {
      btnCancel = document.createElement("button");
      btnCancel.className = "dlg-btn";
      btnCancel.textContent = o.cancelText;
      foot.appendChild(btnCancel);
    }
    const btnOk = document.createElement("button");
    btnOk.className = "dlg-btn " + (o.danger ? "destructive" : "primary");
    btnOk.textContent = o.okText;
    foot.appendChild(btnOk);

    dlg.append(head, body, foot);
    backdrop.appendChild(dlg);
    document.body.appendChild(backdrop);

    // Einblenden (im nächsten Bild, damit die Animation greift)
    requestAnimationFrame(() => backdrop.classList.add("open"));

    return new Promise(resolve => {
      let done = false;

      function close(result) {
        if (done) return;
        done = true;
        _open = null;
        document.removeEventListener("keydown", onKey, true);
        backdrop.classList.remove("open");
        setTimeout(() => backdrop.remove(), 180);
        resolve(result);
      }

      // Abbruch liefert: false (confirm) / null (prompt) / undefined (alert)
      const cancelValue = kind === "prompt" ? null
                        : kind === "confirm" ? false
                        : undefined;

      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault(); e.stopPropagation();
          close(cancelValue);
        } else if (e.key === "Enter" && kind !== "alert") {
          // Bei mehrzeiligen Eingaben nicht abschicken
          if (input && input.tagName === "TEXTAREA") return;
          e.preventDefault(); e.stopPropagation();
          close(kind === "prompt" ? input.value : true);
        }
      }
      document.addEventListener("keydown", onKey, true);

      btnOk.addEventListener("click", () =>
        close(kind === "prompt" ? input.value : (kind === "alert" ? undefined : true)));
      if (btnCancel) btnCancel.addEventListener("click", () => close(cancelValue));
      // Klick auf den Hintergrund = abbrechen
      backdrop.addEventListener("mousedown", e => {
        if (e.target === backdrop) close(cancelValue);
      });

      _open = { cancel: () => close(cancelValue) };

      // Fokus setzen: Eingabefeld, sonst der Bestätigen-Knopf
      setTimeout(() => {
        if (input) { input.focus(); input.select(); }
        else btnOk.focus();
      }, 60);
    });
  }

  const _api = {
    /** Ja/Nein-Rückfrage → true (bestätigt) oder false (abgebrochen) */
    confirm(message, opts) {
      return _show({ kind: "confirm", message, opts });
    },
    /** Texteingabe → eingegebener Text oder null (abgebrochen) */
    prompt(message, defaultValue = "", opts) {
      return _show({ kind: "prompt", message, value: defaultValue, opts });
    },
    /** Reine Mitteilung → wartet auf Bestätigung */
    alert(message, opts) {
      return _show({ kind: "alert", message, opts });
    },
    /** Rückfrage mit rotem Bestätigen-Knopf (Löschen o. Ä.) */
    confirmDanger(message, opts) {
      return _show({ kind: "confirm", message,
                     opts: Object.assign({ danger: true, okText: "Löschen" }, opts || {}) });
    },
    /** Zahleneingabe → Zahl oder null. Ungültige Eingaben ergeben null. */
    async promptNumber(message, defaultValue = "", opts) {
      const raw = await _show({
        kind: "prompt", message, value: defaultValue,
        opts: Object.assign({ inputType: "number" }, opts || {}),
      });
      if (raw === null || String(raw).trim() === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    },

    /** Auswahl aus mehreren Werten → gewählter Wert oder null (abgebrochen).
     *  choices: ["8","10"] oder [{value:8, label:"8 (Schwach)"}, ...] */
    choose(message, choices, opts) {
      return _showChoice({ message, choices, opts });
    },
  };

  // Auswahl-Dialog: zeigt die Möglichkeiten als anklickbare Knöpfe.
  function _showChoice({ message, choices, opts }) {
    if (_open) _open.cancel();
    const o = Object.assign({
      title: "Auswählen", icon: "🎯", cancelText: "Abbrechen", hint: "",
    }, opts || {});

    const backdrop = document.createElement("div");
    backdrop.className = "dlg-backdrop";
    const dlg = document.createElement("div");
    dlg.className = "dlg";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");

    const head = document.createElement("div");
    head.className = "dlg-head";
    const ic = document.createElement("div");
    ic.className = "dlg-icon"; ic.textContent = o.icon;
    const ti = document.createElement("div");
    ti.className = "dlg-title"; ti.textContent = o.title;
    head.append(ic, ti);

    const body = document.createElement("div");
    body.className = "dlg-body";
    if (message) {
      const p = document.createElement("p");
      p.textContent = message;
      body.appendChild(p);
    }
    const grid = document.createElement("div");
    grid.className = "dlg-choices";
    body.appendChild(grid);
    if (o.hint) {
      const h = document.createElement("div");
      h.className = "dlg-hint"; h.textContent = o.hint;
      body.appendChild(h);
    }

    const foot = document.createElement("div");
    foot.className = "dlg-foot";
    const btnCancel = document.createElement("button");
    btnCancel.className = "dlg-btn";
    btnCancel.textContent = o.cancelText;
    foot.appendChild(btnCancel);

    dlg.append(head, body, foot);
    backdrop.appendChild(dlg);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("open"));

    return new Promise(resolve => {
      let done = false;
      function close(result) {
        if (done) return;
        done = true;
        _open = null;
        document.removeEventListener("keydown", onKey, true);
        backdrop.classList.remove("open");
        setTimeout(() => backdrop.remove(), 180);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); close(null); }
      }
      document.addEventListener("keydown", onKey, true);

      (choices || []).forEach(c => {
        const value = (c && typeof c === "object") ? c.value : c;
        const label = (c && typeof c === "object") ? (c.label ?? c.value) : c;
        const b = document.createElement("button");
        b.className = "dlg-choice";
        b.textContent = label;
        b.addEventListener("click", () => close(value));
        grid.appendChild(b);
      });

      btnCancel.addEventListener("click", () => close(null));
      backdrop.addEventListener("mousedown", e => {
        if (e.target === backdrop) close(null);
      });
      _open = { cancel: () => close(null) };
      setTimeout(() => { const f = grid.querySelector(".dlg-choice"); if (f) f.focus(); }, 60);
    });
  }

  return _api;
})();

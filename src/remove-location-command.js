const { Modal, Notice, MarkdownView } = require("obsidian");
const { planLocationRemoval, mapPositionAfterRemoval } = require("./location-removal");
const { addEditorCommand } = require("./editor-command");

function confirmRemoval(plugin, state) {
  return new Promise(resolve => {
    const modal = new Modal(plugin.app);
    state.modal = modal;
    let confirmed = false;
    modal.onOpen = () => {
      modal.contentEl.createEl("h2", { text: "מחיקת נקודת הפניה של SmartPaste" });
      modal.contentEl.createEl("p", {
        text: "מחיקת נקודת ההפניה תבטל קישורים חיצוניים וקישורי בלוק קיימים שמפנים אליה. למחוק?"
      });
      const cancel = modal.contentEl.createEl("button", { text: "ביטול" });
      cancel.addEventListener("click", () => modal.close());
      const remove = modal.contentEl.createEl("button", { text: "מחק נקודת הפניה", cls: "mod-warning" });
      remove.addEventListener("click", () => { confirmed = true; modal.close(); });
      cancel.focus();
    };
    modal.onClose = () => {
      state.modal = null;
      modal.contentEl.empty();
      resolve(confirmed);
    };
    modal.open();
  });
}

function registerLocationRemoval(plugin) {
  const state = { busy: false, disposed: false, modal: null };
  plugin.register(() => { state.disposed = true; state.modal?.close(); });
  addEditorCommand(plugin, {
    id: "remove-smartpaste-location-point",
    name: "מחק נקודת הפניה של SmartPaste מהפסקה",
    editorCallback: async (editor, view) => {
      if (state.disposed || state.busy) return;
      state.busy = true;
      let edited = false;
      try {
        if (!(view instanceof MarkdownView) || !view.file || view.file.extension !== "md" || view.editor !== editor) {
          new Notice("יש לפתוח פתק Markdown במצב עריכה."); return;
        }
        const snapshot = editor.getValue();
        const selections = editor.listSelections();
        if (selections.length !== 1) { new Notice("יש לבחור מיקום יחיד למחיקה."); return; }
        const edit = planLocationRemoval(snapshot, editor.getCursor());
        if (!edit) { new Notice("לא נמצאה בבלוק נקודת הפניה שניתן למחוק בבטחה בשם SmartPaste."); return; }
        const file = view.file, path = file.path;
        const selectionSnapshot = JSON.stringify(selections);
        const unchanged = () => !state.disposed && view.file === file && file.path === path &&
          view.editor === editor && editor.getValue() === snapshot &&
          JSON.stringify(editor.listSelections()) === selectionSnapshot;
        const saved = await plugin.app.vault.read(file);
        if (!unchanged()) { if (!state.disposed) new Notice("הפתק או הסמן השתנו. יש להפעיל את הפקודה שוב."); return; }
        if (saved !== snapshot) {
          new Notice("הפתק טרם נשמר או שסופי השורות שונים. לא בוצע שינוי."); return;
        }
        if (!await confirmRemoval(plugin, state)) return;
        // Confirmation is asynchronous: never apply an old range to edited text,
        // a different note, or a cursor moved to another block while it was open.
        if (!unchanged()) { if (!state.disposed) new Notice("הפתק או הסמן השתנו. יש להפעיל את הפקודה שוב."); return; }
        const latestSaved = await plugin.app.vault.read(file);
        if (!unchanged() || latestSaved !== snapshot) {
          if (!state.disposed) new Notice("הפתק השתנה בזמן האישור. לא בוצע שינוי."); return;
        }
        const lineOffset = snapshot.split("\n").slice(0, edit.from.line)
          .reduce((offset, line) => offset + line.length + 1, 0);
        const expected = snapshot.slice(0, lineOffset + edit.from.ch) + snapshot.slice(lineOffset + edit.to.ch);
        editor.transaction({
          changes: [{ from: edit.from, to: edit.to, text: "" }],
          selections: selections.map(({ anchor, head }) => ({
            from: mapPositionAfterRemoval(anchor, edit), to: mapPositionAfterRemoval(head, edit)
          }))
        }, "aag-smart-paste-remove-location-point");
        edited = true;
        if (view.file !== file || view.editor !== editor || file.path !== path || editor.getValue() !== expected) {
          new Notice("הפתק השתנה במהלך העריכה. לא בוצעו תיקונים אוטומטיים; ניתן להשתמש ב־Undo."); return;
        }
        await view.save();
        if (editor.getValue() !== expected || await plugin.app.vault.read(file) !== expected) {
          new Notice("לא ניתן לאמת את שמירת המחיקה. יש לבדוק את הפתק; ניתן להשתמש ב־Undo."); return;
        }
        new Notice("נקודת ההפניה של SmartPaste נמחקה.");
      } catch (_) {
        new Notice(edited
          ? "נקודת ההפניה הוסרה בעורך, אך השמירה נכשלה. ניתן לבטל את העריכה באמצעות Undo."
          : "לא ניתן למחוק את נקודת ההפניה בבטחה. לא בוצע שינוי.");
      } finally { state.busy = false; }
    }
  });
}

module.exports = { registerLocationRemoval };

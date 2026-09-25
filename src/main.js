const { Plugin, Notice, MarkdownView, editorLivePreviewField } = require("obsidian");
const { LocationLinkError, buildBlockUri, planLocationLink } = require("./location-links");
const { createBlockIdVisibilityExtension } = require("./block-id-visibility");
const { registerProtocolNavigation } = require("./protocol-navigation");
const { registerLocationRemoval } = require("./remove-location-command");
const { addEditorCommand } = require("./editor-command");
const { cleanHtml, smallToBraces, smallToColors } = require("./html-transform");

module.exports = class AAGSmartPastePlugin extends Plugin {
  async onload() {
    this.unloading = false;
    registerLocationRemoval(this);

    addEditorCommand(this, {
      id: "copy-external-link-to-current-location",
      name: "העתק קישור חיצוני למיקום הנוכחי",
      editorCallback: (editor, view) => this.copyLocationLink(editor, view)
    });

    addEditorCommand(this, {
      id: "associate-current-location-with-anki",
      name: "Associate this location with Anki",
      editorCallback: (editor, view) => this.copyLocationLink(editor, view, true)
    });

    addEditorCommand(this, {
      id: "paste-html-with-font-sizes",
      name: "Paste HTML With Font Sizes",
      editorCallback: (editor, view) =>
        this.pasteWithStableContext(editor, view, cleanHtml)
    });

    addEditorCommand(this, {
      id: "paste-small-as-braces",
      name: "Paste Small Text As Braces",
      editorCallback: (editor, view) =>
        this.pasteWithStableContext(editor, view, smallToBraces)
    });

    addEditorCommand(this, {
      id: "paste-small-as-colors",
      name: "Paste Small Text As Colors",
      editorCallback: (editor, view) =>
        this.pasteWithStableContext(editor, view, smallToColors)
    });

    addEditorCommand(this, {
      id: "replace-square-brackets-in-selection",
      name: "Replace [] With () In Selection",
      editorCallback: (editor) => {
        const selected = editor.getSelection();

        if (!selected) {
          new Notice("No text selected.");
          return;
        }

        editor.replaceSelection(this.fixSquareBrackets(selected));
      }
    });

    // Optional integrations must not dispose unrelated commands on load failure.
    for (const [name, initialize] of [
      ["תצוגת מזהי הבלוקים", () => this.registerEditorExtension(createBlockIdVisibilityExtension(editorLivePreviewField))],
      ["ניווט מקישורים חיצוניים", () => registerProtocolNavigation(this)]
    ]) {
      try { initialize(); }
      catch (error) {
        new Notice(`SmartPaste: לא ניתן להפעיל את ${name}. שאר הפקודות זמינות.`);
        console.error(`AAG Smart Paste: ${name} initialization failed`, error);
      }
    }
  }

  onunload() {
    this.unloading = true;
  }

  capturePasteContext(editor, view) {
    return {
      editor,
      view,
      file: view?.file ?? null,
      path: view?.file?.path ?? null,
      text: editor.getValue(),
      selections: JSON.stringify(editor.listSelections())
    };
  }

  pasteContextIsCurrent(context) {
    return !this.unloading &&
      context.file &&
      context.view?.file === context.file &&
      context.file.path === context.path &&
      context.view.editor === context.editor &&
      context.editor.getValue() === context.text &&
      JSON.stringify(context.editor.listSelections()) === context.selections;
  }

  async pasteWithStableContext(editor, view, transformHtml) {
    const context = this.capturePasteContext(editor, view);
    let html = "";
    let plainText = null;
    try {
      html = await this.getClipboardHtml();
      if (!html) plainText = await navigator.clipboard.readText();
    } catch (error) {
      console.error("AAG Smart Paste: clipboard read failed", error);
      new Notice("Could not read the clipboard.");
      return;
    }
    if (!this.pasteContextIsCurrent(context)) {
      new Notice("Paste cancelled because the note, selection, or text changed.");
      return;
    }
    const output = html ? transformHtml(html) : this.fixSquareBrackets(plainText ?? "");
    editor.replaceSelection(output);
    if (!html) new Notice("No HTML found. Pasted plain text.");
  }

  async copyLocationLink(editor, view, associate = false) {
    if (this.copyingLocationLink) {
      new Notice("העתקת הקישור כבר מתבצעת.");
      return;
    }
    this.copyingLocationLink = true;
    let inserted = false;
    let saved = false;
    try {
      const bridge = associate ? (this.app.plugins?.getPlugin?.("aag-anki-bridge") ||
        this.app.plugins?.plugins?.["aag-anki-bridge"]) : null;
      if (associate && typeof bridge?.associateObsidianLocation !== "function") {
        throw new LocationLinkError("Association requires the coordinated AAG Anki Bridge and AnkiSuit update.");
      }
      if (!(view instanceof MarkdownView) || !view.file || view.file.extension !== "md" || view.editor !== editor) {
        throw new LocationLinkError("יש לפתוח פתק Markdown במצב עריכה.");
      }
      const file = view.file;
      const path = file.path;
      // Retain the existing conservative filename policy for the copy command.
      // Protocol navigation separately validates exact vault-relative paths.
      if (/[#^|:]|%%|\[\[|\]\]/.test(path)) {
        throw new LocationLinkError("שם הקובץ או התיקייה מכיל תווים שאינם נתמכים בקישור בלוק של Obsidian.");
      }
      if (!associate && !globalThis.navigator?.clipboard?.writeText) {
        throw new LocationLinkError("אין גישה ללוח ההעתקה.");
      }
      const snapshot = editor.getValue();
      if (editor.listSelections().length !== 1) {
        throw new LocationLinkError("יש לבחור מיקום יחיד כדי לשמור על מצב הסמן והבחירה.");
      }
      const plan = planLocationLink(snapshot, editor.getCursor());
      const uri = buildBlockUri(this.app.vault.getName(), path, plan.id);
      const selectionsBeforeRead = JSON.stringify(editor.listSelections());
      const beforeSave = await this.app.vault.read(file);
      if (view.file !== file || file.path !== path || editor.getValue() !== snapshot ||
        JSON.stringify(editor.listSelections()) !== selectionsBeforeRead) {
        throw new LocationLinkError("הפתק או הבחירה השתנו בזמן ההעתקה. יש להפעיל את הפקודה שוב.");
      }
      // A normalized editor snapshot must never silently rewrite on-disk CRLF.
      // Users can still copy an already-saved ID without any save operation.
      const savedEquivalent = beforeSave === snapshot ||
        (!plan.edit && beforeSave.replace(/\r\n/g, "\n") === snapshot);
      const needsSave = Boolean(plan.edit);
      if ((needsSave || !savedEquivalent) && beforeSave.includes("\r") && beforeSave !== snapshot) {
        throw new LocationLinkError("לא ניתן לשמור בבטחה את סיומות השורה המקוריות. לא בוצע שינוי.");
      }
      if (!savedEquivalent) {
        throw new LocationLinkError("הפתק השתנה או טרם נשמר. יש להמתין לשמירה ולנסות שוב; לא בוצע שינוי.");
      }
      let expected = snapshot;
      if (plan.edit) {
        // A narrow editor edit retains undo history and all unrelated content.
        const selections = editor.listSelections();
        const mapPosition = (position) => {
          const { from, text } = plan.edit;
          if (position.line < from.line || (position.line === from.line && position.ch <= from.ch)) return position;
          const addedLines = text.split(/\r?\n/);
          return {
            line: position.line + addedLines.length - 1,
            ch: position.line !== from.line ? position.ch
              : (addedLines.length === 1 ? position.ch + text.length : position.ch - from.ch + addedLines[addedLines.length - 1].length)
          };
        };
        const offset = snapshot.split("\n").slice(0, plan.edit.from.line)
          .reduce((total, line) => total + line.length + 1, 0) + plan.edit.from.ch;
        expected = snapshot.slice(0, offset) + plan.edit.text + snapshot.slice(offset);
        editor.transaction({
          changes: [{ from: plan.edit.from, text: plan.edit.text }],
          selections: selections.map(({ anchor, head }) => ({
            from: mapPosition(anchor), to: mapPosition(head)
          }))
        }, "aag-smart-paste-location-link");
        inserted = true;
        if (editor.getValue() !== expected) {
          throw new LocationLinkError("תוכן הפתק השתנה במהלך העריכה. ההעתקה נעצרה; לא בוצעו תיקונים אוטומטיים.");
        }
      }
      if (needsSave) await view.save();
      saved = true;
      const persisted = await this.app.vault.read(file);
      if (view.file !== file || file.path !== path || editor.getValue() !== expected || persisted !== (needsSave ? expected : beforeSave)) {
        throw new LocationLinkError("הפתק השתנה בזמן ההעתקה. יש להפעיל את הפקודה שוב.");
      }
      if (associate) {
        // The bridge owns target selection, transport and semantic save confirmation.
        await bridge.associateObsidianLocation({ uri });
      } else {
        await navigator.clipboard.writeText(uri);
        new Notice(plan.structured ? "הקישור החיצוני לבלוק השלם הועתק." : "הקישור החיצוני למיקום הנוכחי הועתק.");
      }
    } catch (error) {
      if (error instanceof LocationLinkError) {
        new Notice(error.message);
      } else {
        if (associate) {
          new Notice("Anki association was not confirmed. Any saved block ID remains available for retry.");
          console.error("AAG Smart Paste: association failed", error);
          return;
        }
        new Notice(inserted
          ? (saved ? "הקישור לא הועתק. מזהה הבלוק נשמר; ניתן לנסות שוב." : "הקישור לא הועתק. מזהה הבלוק נוסף בעורך, אך השמירה נכשלה.")
          : "הקישור לא הועתק. יש לבדוק הרשאות שמירה ולוח העתקה ולנסות שוב.");
        console.error("AAG Smart Paste: location link failed", error);
      }
    } finally {
      this.copyingLocationLink = false;
    }
  }

  async getClipboardHtml() {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes("text/html")) {
        const blob = await item.getType("text/html");
        return await blob.text();
      }
    }
    return "";
  }

  async pastePlain(editor, view = null) {
    if (view) return this.pasteWithStableContext(editor, view, () => "");
    const text = this.fixSquareBrackets(await navigator.clipboard.readText());
    editor.replaceSelection(text);
    new Notice("No HTML found. Pasted plain text.");
  }

  fixSquareBrackets(text) {
    return text.replace(/\[/g, "(").replace(/\]/g, ")");
  }

  normalizeSpaces(text) {
    return text.replace(/[ \t]+/g, " ").replace(/\s+\{/g, " {")
      .replace(/\}\s+/g, "} ").replace(/\{\s+/g, "{").replace(/\s+\}/g, "}")
      .replace(/ {2,}/g, " ").trim();
  }

  cleanHtml(html) { return cleanHtml(html); }
  smallToBraces(html) { return smallToBraces(html); }
  smallToColors(html) { return smallToColors(html); }
};

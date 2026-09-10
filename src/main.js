const { Plugin, Notice, MarkdownView, editorLivePreviewField } = require("obsidian");
const { LocationLinkError, buildBlockUri, planLocationLink } = require("./location-links");
const { createBlockIdVisibilityExtension } = require("./block-id-visibility");
const { registerProtocolNavigation } = require("./protocol-navigation");
const { registerLocationRemoval } = require("./remove-location-command");
const { addEditorCommand } = require("./editor-command");

module.exports = class AAGSmartPastePlugin extends Plugin {
  async onload() {
    registerLocationRemoval(this);

    addEditorCommand(this, {
      id: "copy-external-link-to-current-location",
      name: "העתק קישור חיצוני למיקום הנוכחי",
      editorCallback: (editor, view) => this.copyLocationLink(editor, view)
    });

    addEditorCommand(this, {
      id: "paste-html-with-font-sizes",
      name: "Paste HTML With Font Sizes",
      editorCallback: async (editor) => {
        const html = await this.getClipboardHtml();
        if (!html) return this.pastePlain(editor);
        editor.replaceSelection(this.cleanHtml(html));
      }
    });

    addEditorCommand(this, {
      id: "paste-small-as-braces",
      name: "Paste Small Text As Braces",
      editorCallback: async (editor) => {
        const html = await this.getClipboardHtml();
        if (!html) return this.pastePlain(editor);
        editor.replaceSelection(this.smallToBraces(html));
      }
    });

    addEditorCommand(this, {
      id: "paste-small-as-colors",
      name: "Paste Small Text As Colors",
      editorCallback: async (editor) => {
        const html = await this.getClipboardHtml();
        if (!html) return this.pastePlain(editor);
        editor.replaceSelection(this.smallToColors(html));
      }
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

  async copyLocationLink(editor, view) {
    if (this.copyingLocationLink) {
      new Notice("העתקת הקישור כבר מתבצעת.");
      return;
    }
    this.copyingLocationLink = true;
    let inserted = false;
    let saved = false;
    try {
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
      if (!globalThis.navigator?.clipboard?.writeText) {
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
      await navigator.clipboard.writeText(uri);
      new Notice(plan.structured ? "הקישור החיצוני לבלוק השלם הועתק." : "הקישור החיצוני למיקום הנוכחי הועתק.");
    } catch (error) {
      if (error instanceof LocationLinkError) {
        new Notice(error.message);
      } else {
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
    try {
      const items = await navigator.clipboard.read();

      for (const item of items) {
        if (item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          return await blob.text();
        }
      }
    } catch (e) {
      new Notice("Clipboard permission failed. Try using the command palette.");
      console.error(e);
    }

    return "";
  }

  async pastePlain(editor) {
    let text = await navigator.clipboard.readText();
    text = this.fixSquareBrackets(text);
    editor.replaceSelection(text);
    new Notice("No HTML found. Pasted plain text.");
  }

  fixSquareBrackets(text) {
    return text
      .replace(/\[/g, "(")
      .replace(/\]/g, ")");
  }

  normalizeSpaces(text) {
    return text
      .replace(/[ \t]+/g, " ")
      .replace(/\s+\{/g, " {")
      .replace(/\}\s+/g, "} ")
      .replace(/\{\s+/g, "{")
      .replace(/\s+\}/g, "}")
      .replace(/ {2,}/g, " ")
      .trim();
  }

  cleanHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    doc.querySelectorAll("*").forEach((el) => {
      const style = el.getAttribute("style") || "";
      const fontSize = style.match(/font-size\s*:\s*[^;]+/i);
      const textAlign = style.match(/text-align\s*:\s*[^;]+/i);
      const direction = style.match(/direction\s*:\s*[^;]+/i);

      const keep = [];

      if (fontSize) keep.push(fontSize[0]);
      if (textAlign) keep.push(textAlign[0]);
      if (direction) keep.push(direction[0]);

      [...el.attributes].forEach(attr => el.removeAttribute(attr.name));

      if (keep.length) {
        el.setAttribute("style", keep.join("; "));
      }
    });

    let body = doc.body.innerHTML;

    body = body
      .replace(/<p/gi, "<div")
      .replace(/<\/p>/gi, "</div>")
      .replace(/<b>/gi, "<strong>")
      .replace(/<\/b>/gi, "</strong>");

    return this.fixSquareBrackets(body.trim());
  }

  smallToBraces(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    doc.querySelectorAll("small").forEach((small) => {
      const text = this.fixSquareBrackets(small.textContent.trim());
      small.replaceWith(" {" + text + "} ");
    });

    const result = this.fixSquareBrackets(doc.body.textContent);
    return this.normalizeSpaces(result);
  }

  smallToColors(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    doc.querySelectorAll("*").forEach((el) => {
      [...el.attributes].forEach(attr => el.removeAttribute(attr.name));
    });

    doc.querySelectorAll("small").forEach((small) => {
      const span = doc.createElement("span");
      span.setAttribute("style", "color:#2563eb;");
      span.textContent = this.fixSquareBrackets(small.textContent);
      small.replaceWith(span);
    });

    let body = doc.body.innerHTML.trim();
    body = this.fixSquareBrackets(body);

    return body;
  }
};

const { MarkdownView, Notice } = require("obsidian");

// Keep discovery independent of Obsidian's activeEditor availability filter.
// Resolve the editing context only when the user actually invokes the command.
function addEditorCommand(plugin, { editorCallback, ...command }) {
  return plugin.addCommand({
    ...command,
    callback: () => {
      const workspace = plugin.app.workspace;
      let view = workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        // Search/side panes can be active while the intended note stays visible.
        // Use the host's most recent main/floating leaf, never an arbitrary note.
        const leaf = workspace.getMostRecentLeaf();
        if (leaf && leaf.isVisible() && leaf.view instanceof MarkdownView) view = leaf.view;
      }
      if (!(view instanceof MarkdownView) || !view.file || view.file.extension !== "md" ||
          !view.editor || view.getMode() !== "source") {
        new Notice("יש לפתוח פתק Markdown במצב עריכה כדי להפעיל את הפקודה.");
        return;
      }
      return editorCallback(view.editor, view);
    }
  });
}

module.exports = { addEditorCommand };

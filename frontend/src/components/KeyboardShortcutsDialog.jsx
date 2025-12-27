import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Keyboard } from "lucide-react";

const SHORTCUTS = [
  {
    category: "Task Editing",
    shortcuts: [
      {
        keys: ["⌘", "Enter"],
        description: "Save task (in edit dialog)",
        windows: ["Ctrl", "Enter"],
      },
      {
        keys: ["Esc"],
        description: "Cancel / Close dialog",
      },
    ],
  },
  {
    category: "Navigation",
    shortcuts: [
      {
        keys: ["⌥", "1"],
        description: "Go to Inbox",
        windows: ["Alt", "1"],
      },
      {
        keys: ["⌥", "2"],
        description: "Go to Daily Calendar",
        windows: ["Alt", "2"],
      },
      {
        keys: ["⌥", "3"],
        description: "Go to Weekly Calendar",
        windows: ["Alt", "3"],
      },
      {
        keys: ["⌥", "4"],
        description: "Go to Completed",
        windows: ["Alt", "4"],
      },
      {
        keys: ["⌥", "5"],
        description: "Go to Dumps",
        windows: ["Alt", "5"],
      },
    ],
  },
  {
    category: "Quick Actions",
    shortcuts: [
      {
        keys: ["⌥", "N"],
        description: "Create new task",
        windows: ["Alt", "N"],
      },
      {
        keys: ["⌥", "B"],
        description: "Open Braindump / Voice",
        windows: ["Alt", "B"],
      },
      {
        keys: ["⌥", "K"],
        description: "Command palette (coming soon)",
        windows: ["Alt", "K"],
      },
      {
        keys: ["⌘", "/"],
        description: "Show keyboard shortcuts",
        windows: ["Ctrl", "/"],
      },
    ],
  },
  {
    category: "Task Actions",
    shortcuts: [
      {
        keys: ["Space"],
        description: "Toggle complete (when task focused)",
      },
      {
        keys: ["⌘", "D"],
        description: "Mark task as done",
        windows: ["Ctrl", "D"],
      },
      {
        keys: ["⌘", "E"],
        description: "Edit task (when task focused)",
        windows: ["Ctrl", "E"],
      },
      {
        keys: ["Delete"],
        description: "Delete task (when task focused)",
      },
    ],
  },
];

function KeyBadge({ keyValue, isMac = true }) {
  // Map special keys
  const keyMap = {
    "⌘": isMac ? "⌘" : "Ctrl",
    "⌥": isMac ? "⌥" : "Alt",
    "Enter": "Enter",
    "Esc": "Esc",
    "Space": "Space",
    "Delete": "Delete",
    "1": "1",
    "2": "2",
    "3": "3",
    "4": "4",
    "5": "5",
    "N": "N",
    "B": "B",
    "K": "K",
    "/": "/",
    "D": "D",
    "E": "E",
    "Alt": "Alt",
  };

  const displayKey = keyMap[keyValue] || keyValue;

  return (
    <Badge
      variant="outline"
      className="px-2 py-1 font-mono text-xs font-semibold min-w-[2rem] text-center"
    >
      {displayKey}
    </Badge>
  );
}

export default function KeyboardShortcutsDialog({ open, onOpenChange }) {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-primary" />
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {SHORTCUTS.map((category) => (
            <div key={category.category}>
              <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
                {category.category}
              </h3>
              <div className="space-y-2">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                  >
                    <span className="text-sm text-foreground">
                      {shortcut.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <div key={keyIndex} className="flex items-center gap-1">
                          {keyIndex > 0 && (
                            <span className="text-xs text-muted-foreground mx-1">
                              +
                            </span>
                          )}
                          <KeyBadge keyValue={key} isMac={isMac} />
                        </div>
                      ))}
                      {shortcut.windows && !isMac && (
                        <>
                          <span className="text-xs text-muted-foreground mx-2">
                            or
                          </span>
                          {shortcut.windows.map((key, keyIndex) => (
                            <div key={keyIndex} className="flex items-center gap-1">
                              {keyIndex > 0 && (
                                <span className="text-xs text-muted-foreground mx-1">
                                  +
                                </span>
                              )}
                              <KeyBadge keyValue={key} isMac={false} />
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-4 border-t text-xs text-muted-foreground text-center">
          <p>
            {isMac
              ? "⌘ = Command, ⌥ = Option"
              : "Ctrl = Control, Alt = Alt"} • Shortcuts work when no input is focused
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}


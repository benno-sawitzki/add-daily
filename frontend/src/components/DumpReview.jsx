import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X, FileText, Mic, Clock, Sparkles, ArrowRight, Clock as ClockIcon, BookOpen, Trash2, Calendar } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";

export default function DumpReview({ dump: initialDump, onClose, onRefresh }) {
  const [dump, setDump] = useState(initialDump);
  const [items, setItems] = useState(dump.items || []);
  const [loading, setLoading] = useState(false);
  const [clarifying, setClarifying] = useState(false);
  const [nextTodayCount, setNextTodayCount] = useState({ count: 0, cap: 5, remaining: 5 });
  const [snoozePopoverOpen, setSnoozePopoverOpen] = useState({});

  const createdAt = new Date(dump.created_at);

  // Fetch Next Today count on mount
  useEffect(() => {
    fetchNextTodayCount();
  }, []);

  const fetchNextTodayCount = async () => {
    try {
      const response = await apiClient.get('/next-today-count');
      setNextTodayCount(response.data);
    } catch (error) {
      console.error("Error fetching Next Today count:", error);
    }
  };

  const fetchItems = async () => {
    try {
      const response = await apiClient.get(`/dumps/${dump.id}/items`);
      setItems(response.data || []);
    } catch (error) {
      console.error("Error fetching items:", error);
    }
  };

  const handleClarify = async () => {
    if (dump.clarified_at) {
      toast.error("Dump already clarified");
      return;
    }

    setClarifying(true);
    try {
      const response = await apiClient.post(`/dumps/${dump.id}/clarify`);
      setDump(response.data.dump);
      setItems(response.data.items || []);
      toast.success(`Clarified into ${response.data.items.length} items`);
      fetchNextTodayCount(); // Refresh count in case items were auto-promoted
      fetchItems(); // Refresh items list
    } catch (error) {
      console.error("Error clarifying dump:", error);
      toast.error(handleApiError(error, "Failed to clarify dump"));
    } finally {
      setClarifying(false);
    }
  };

  const handlePromoteToNext = async (itemId) => {
    // Check cap client-side first
    if (nextTodayCount.remaining <= 0) {
      toast.error(`Next Today is full (${nextTodayCount.cap}). Finish or move something out first.`);
      return;
    }

    try {
      const response = await apiClient.post(`/dump-items/${itemId}/promote-to-next`);
      // Update item status
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? response.data.item : item
        )
      );
      toast.success("Promoted to Next Today");
      fetchNextTodayCount(); // Refresh count
      if (onRefresh) onRefresh(); // Refresh tasks list
    } catch (error) {
      console.error("Error promoting item:", error);
      toast.error(handleApiError(error, "Failed to promote item"));
      if (errorMsg.includes("full")) {
        fetchNextTodayCount(); // Refresh count in case it changed
      }
    }
  };

  const handleSnooze = async (itemId, date) => {
    try {
      const snoozeUntil = date.toISOString();
      const response = await apiClient.patch(`/dump-items/${itemId}/snooze`, {
        snooze_until: snoozeUntil
      });
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? response.data : item
        )
      );
      setSnoozePopoverOpen((prev) => ({ ...prev, [itemId]: false }));
      toast.success(`Snoozed until ${format(date, "MMM d, yyyy")}`);
    } catch (error) {
      console.error("Error snoozing item:", error);
      toast.error(handleApiError(error, "Failed to snooze item"));
    }
  };

  const handleSave = async (itemId) => {
    try {
      const response = await apiClient.patch(`/dump-items/${itemId}/save`);
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? response.data : item
        )
      );
      toast.success("Saved to Logbook");
    } catch (error) {
      console.error("Error saving item:", error);
      toast.error(handleApiError(error, "Failed to save item"));
    }
  };

  const handleTrash = async (itemId) => {
    try {
      const response = await apiClient.patch(`/dump-items/${itemId}/trash`);
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? response.data : item
        )
      );
      toast.success("Trashed");
    } catch (error) {
      console.error("Error trashing item:", error);
      toast.error(handleApiError(error, "Failed to trash item"));
    }
  };

  // Filter items: hide snoozed items that aren't due yet, hide trashed items
  const now = new Date();
  const visibleItems = items.filter((item) => {
    if (item.status === 'trashed') return false;
    if (item.status === 'snoozed' && item.snooze_until) {
      const snoozeUntil = new Date(item.snooze_until);
      return snoozeUntil <= now;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Dump Review</h2>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{format(createdAt, "MMM d, yyyy 'at' HH:mm")}</span>
            <div className="flex items-center gap-1">
              {dump.source === "voice" ? (
                <Mic className="w-4 h-4" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              <span className="capitalize">{dump.source}</span>
            </div>
            <span>{items.length} {items.length === 1 ? "item" : "items"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!dump.clarified_at && (
            <Button 
              onClick={handleClarify} 
              disabled={clarifying}
              variant="outline"
              className="gap-2"
            >
              <Sparkles className="w-4 h-4" />
              {clarifying ? "Clarifying..." : "Clarify"}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Next Today Slots */}
      <Card className="p-3 bg-primary/5 border-primary/20">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Next Today slots remaining:</span>
          <span className="text-sm font-semibold">
            {nextTodayCount.remaining}/{nextTodayCount.cap}
          </span>
        </div>
      </Card>

      {/* Raw Text */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Raw Text</h3>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {dump.raw_text}
        </p>
      </Card>

      {/* Items List */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Items</h3>
        {visibleItems.length === 0 ? (
          <Card className="p-8 border-2 border-dashed">
            <p className="text-center text-muted-foreground">
              {dump.clarified_at
                ? "No items to show. Items may be snoozed or trashed."
                : "No items yet. Click 'Clarify' to extract items from raw text."}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {visibleItems.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm mb-2">{item.text}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                        {item.status}
                      </span>
                      {item.linked_task_id && (
                        <span className="text-xs text-muted-foreground">
                          ✓ In Next Today
                        </span>
                      )}
                      {item.status === 'snoozed' && item.snooze_until && (
                        <span className="text-xs text-muted-foreground">
                          Until {format(new Date(item.snooze_until), "MMM d")}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Action Buttons */}
                  {item.status === 'new' && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handlePromoteToNext(item.id)}
                        disabled={nextTodayCount.remaining <= 0}
                        className="gap-1"
                        title={nextTodayCount.remaining <= 0 ? "Next Today is full" : "Add to Next Today"}
                      >
                        <ArrowRight className="w-3 h-3" />
                        Next
                      </Button>
                      
                      <Popover
                        open={snoozePopoverOpen[item.id] || false}
                        onOpenChange={(open) =>
                          setSnoozePopoverOpen((prev) => ({ ...prev, [item.id]: open }))
                        }
                      >
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                          >
                            <ClockIcon className="w-3 h-3" />
                            Snooze
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                          <CalendarComponent
                            mode="single"
                            onSelect={(date) => {
                              if (date) {
                                handleSnooze(item.id, date);
                              }
                            }}
                            disabled={(date) => date < new Date()}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSave(item.id)}
                        className="gap-1"
                      >
                        <BookOpen className="w-3 h-3" />
                        Save
                      </Button>
                      
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTrash(item.id)}
                        className="gap-1 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


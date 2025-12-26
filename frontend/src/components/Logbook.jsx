import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  BookOpen, 
  CheckCircle2, 
  Search, 
  Archive,
  ArrowRight,
  FileText,
  Mic,
  X,
  RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";

export default function Logbook({ 
  userId, 
  completedTasks = [], 
  onRestoreTask,
  onRefreshTasks,
  allTasks = [] // Pass all tasks to find legacy inbox tasks
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [savedItems, setSavedItems] = useState([]);
  const [archivedDumps, setArchivedDumps] = useState([]);
  const [legacyInboxTasks, setLegacyInboxTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [nextTodayCount, setNextTodayCount] = useState({ count: 0, cap: 5, remaining: 5 });

  // Fetch Next Today count
  const fetchNextTodayCount = async () => {
    try {
      const response = await apiClient.get('/next-today-count');
      setNextTodayCount(response.data);
    } catch (error) {
      console.error("Error fetching Next Today count:", error);
    }
  };
  
  // Fetch legacy inbox tasks (status='inbox')
  const fetchLegacyInboxTasks = () => {
    const inbox = allTasks.filter(t => t.status === 'inbox');
    setLegacyInboxTasks(inbox);
  };

  // Fetch saved items
  const fetchSavedItems = async () => {
    if (!userId) return;
    
    try {
      const dumpsResponse = await apiClient.get('/dumps', {
        params: { archived: false }
      });
      
      const allItems = [];
      for (const dump of dumpsResponse.data) {
        try {
          const itemsResponse = await apiClient.get(`/dumps/${dump.id}/items`);
          const savedItems = (itemsResponse.data || []).filter(
            (item) => item.status === 'saved'
          );
          allItems.push(...savedItems.map(item => ({ ...item, dump })));
        } catch (error) {
          console.error(`Error fetching items for dump ${dump.id}:`, error);
        }
      }
      
      allItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setSavedItems(allItems);
    } catch (error) {
      console.error("Error fetching saved items:", error);
    }
  };

  // Fetch archived dumps
  const fetchArchivedDumps = async () => {
    if (!userId) return;
    
    try {
      const response = await apiClient.get('/dumps', {
        params: { archived: true }
      });
      setArchivedDumps(response.data || []);
    } catch (error) {
      console.error("Error fetching archived dumps:", error);
    }
  };

  useEffect(() => {
    fetchNextTodayCount();
    fetchSavedItems();
    fetchArchivedDumps();
    fetchLegacyInboxTasks();
  }, [userId, allTasks]);

  // Search filtering
  const filterItems = (items, query) => {
    if (!query.trim()) return items;
    const lowerQuery = query.toLowerCase();
    return items.filter((item) => {
      const text = item.title || item.text || "";
      const description = item.description || "";
      return (
        text.toLowerCase().includes(lowerQuery) ||
        description.toLowerCase().includes(lowerQuery)
      );
    });
  };

  const filteredCompletedTasks = useMemo(
    () => filterItems(completedTasks, searchQuery),
    [completedTasks, searchQuery]
  );

  const filteredSavedItems = useMemo(
    () => filterItems(savedItems, searchQuery),
    [savedItems, searchQuery]
  );

  const filteredArchivedDumps = useMemo(
    () => {
      if (!searchQuery.trim()) return archivedDumps;
      const lowerQuery = searchQuery.toLowerCase();
      return archivedDumps.filter((dump) =>
        dump.raw_text.toLowerCase().includes(lowerQuery)
      );
    },
    [archivedDumps, searchQuery]
  );

  // Send saved item to Next Today
  const handleSendToNext = async (itemId) => {
    if (nextTodayCount.remaining <= 0) {
      toast.error(`Next Today is full (${nextTodayCount.cap}). Finish or move something out first.`);
      return;
    }

    try {
      const response = await apiClient.post(`/dump-items/${itemId}/promote-to-next`);
      setSavedItems((prev) => prev.filter((item) => item.id !== itemId));
      toast.success("Sent to Next Today");
      fetchNextTodayCount();
      if (onRefreshTasks) onRefreshTasks();
    } catch (error) {
      console.error("Error sending to Next Today:", error);
      toast.error(handleApiError(error, "Failed to send to Next Today"));
      if (error.response?.data?.detail?.includes("full")) {
        fetchNextTodayCount();
      }
    }
  };

  // Restore archived dump (unarchive it)
  const handleRestoreDump = async (dumpId) => {
    try {
      await apiClient.patch(`/dumps/${dumpId}`, {
        archived_at: null
      });
      setArchivedDumps((prev) => prev.filter((dump) => dump.id !== dumpId));
      toast.success("Dump restored to Inbox");
      fetchSavedItems(); // Refresh in case items changed
      if (onRefreshTasks) onRefreshTasks(); // Refresh tasks in case dump restoration affects anything
    } catch (error) {
      console.error("Error restoring dump:", error);
      toast.error(handleApiError(error, "Failed to restore dump"));
    }
  };

  // Filter legacy inbox tasks for search
  const filteredLegacyInboxTasks = useMemo(() => {
    if (!searchQuery.trim()) return legacyInboxTasks;
    const lowerQuery = searchQuery.toLowerCase();
    return legacyInboxTasks.filter((task) =>
      (task.title || '').toLowerCase().includes(lowerQuery) ||
      (task.description || '').toLowerCase().includes(lowerQuery)
    );
  }, [legacyInboxTasks, searchQuery]);

  const hasResults = filteredCompletedTasks.length > 0 || 
                     filteredSavedItems.length > 0 || 
                     filteredArchivedDumps.length > 0 ||
                     filteredLegacyInboxTasks.length > 0;
  const totalCount = completedTasks.length + savedItems.length + archivedDumps.length + legacyInboxTasks.length;

  return (
    <div className="space-y-6" data-testid="logbook">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <BookOpen className="w-6 h-6" />
            Logbook
          </h2>
          <p className="text-muted-foreground mt-1">
            {totalCount} {totalCount === 1 ? "item" : "items"} total
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search logbook..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Results */}
      {searchQuery && !hasResults && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No results found for "{searchQuery}"</p>
        </div>
      )}

      {/* Done Section */}
      {filteredCompletedTasks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <h3 className="text-lg font-semibold">Done</h3>
            <span className="text-sm text-muted-foreground">
              ({filteredCompletedTasks.length})
            </span>
          </div>
          <div className="space-y-2">
            {filteredCompletedTasks.map((task) => (
              <Card key={task.id} className="p-4 bg-card/30">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h4 className="font-medium text-foreground/70 line-through">
                      {task.title}
                    </h4>
                    {task.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {task.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      {task.completed_at && (
                        <span>
                          {format(new Date(task.completed_at), "MMM d, yyyy")}
                        </span>
                      )}
                    </div>
                  </div>
                  {onRestoreTask && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRestoreTask(task.id, { status: "inbox" })}
                      className="gap-1"
                    >
                      <ArrowRight className="w-3 h-3" />
                      Restore
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Saved Section */}
      {filteredSavedItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-500" />
            <h3 className="text-lg font-semibold">Saved</h3>
            <span className="text-sm text-muted-foreground">
              ({filteredSavedItems.length})
            </span>
          </div>
          <div className="space-y-2">
            {filteredSavedItems.map((item) => {
              const createdAt = new Date(item.created_at);
              return (
                <Card key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm mb-2">{item.text}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{format(createdAt, "MMM d, yyyy")}</span>
                        {item.dump && (
                          <span className="flex items-center gap-1">
                            {item.dump.source === "voice" ? (
                              <Mic className="w-3 h-3" />
                            ) : (
                              <FileText className="w-3 h-3" />
                            )}
                            <span className="capitalize">{item.dump.source} dump</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSendToNext(item.id)}
                        disabled={nextTodayCount.remaining <= 0}
                        className="gap-1"
                        title={nextTodayCount.remaining <= 0 ? "Next Today is full" : "Send to Next Today"}
                      >
                        <ArrowRight className="w-3 h-3" />
                        Next
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Legacy Inbox Tasks Section */}
      {filteredLegacyInboxTasks.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-orange-500" />
            <h3 className="text-lg font-semibold">Legacy Inbox Tasks</h3>
            <span className="text-sm text-muted-foreground">
              ({filteredLegacyInboxTasks.length})
            </span>
          </div>
          <div className="space-y-2">
            {filteredLegacyInboxTasks.map((task) => (
              <Card key={task.id} className="p-4 bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm mb-2">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {task.description}
                      </p>
                    )}
                    <span className="text-xs text-muted-foreground">
                      Created {format(new Date(task.created_at), "MMM d, yyyy")}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        // Convert to dump - create a dump with one item
                        const response = await apiClient.post('/dumps', {
                          source: 'text',
                          raw_text: `${task.title}${task.description ? '\n' + task.description : ''}`,
                        });
                        // Delete the legacy task
                        await apiClient.delete(`/tasks/${task.id}`);
                        // Refresh
                        fetchLegacyInboxTasks();
                        if (onRefreshTasks) onRefreshTasks();
                        toast.success("Migrated to dump");
                      } catch (error) {
                        toast.error(handleApiError(error, "Failed to migrate task"));
                      }
                    }}
                    className="gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Migrate to Dump
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Archived Dumps Section */}
      {filteredArchivedDumps.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-orange-500" />
            <h3 className="text-lg font-semibold">Dumps</h3>
            <span className="text-sm text-muted-foreground">
              ({filteredArchivedDumps.length})
            </span>
          </div>
          <div className="space-y-2">
            {filteredArchivedDumps.map((dump) => {
              const createdAt = new Date(dump.created_at);
              return (
                <Card key={dump.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium">Dump</span>
                        <span className="text-xs text-muted-foreground">
                          {format(createdAt, "MMM d, yyyy 'at' HH:mm")}
                        </span>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          {dump.source === "voice" ? (
                            <Mic className="w-3 h-3" />
                          ) : (
                            <FileText className="w-3 h-3" />
                          )}
                          <span className="capitalize">{dump.source}</span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {dump.raw_text}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRestoreDump(dump.id)}
                      className="gap-1"
                    >
                      <ArrowRight className="w-3 h-3" />
                      Restore
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!searchQuery && totalCount === 0 && (
        <div className="flex flex-col items-center justify-center py-20" data-testid="logbook-empty">
          <div className="w-20 h-20 rounded-full bg-card flex items-center justify-center mb-6">
            <BookOpen className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Logbook is empty</h3>
          <p className="text-muted-foreground text-center max-w-md">
            Completed tasks, saved items, and archived dumps will appear here.
          </p>
        </div>
      )}
    </div>
  );
}


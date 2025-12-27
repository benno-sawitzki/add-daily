import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Mic, FileText, Loader2, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";

export default function DumpsListPage({ userId }) {
  const navigate = useNavigate();
  const [dumps, setDumps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [deletingId, setDeletingId] = useState(null);
  const [selectedDumps, setSelectedDumps] = useState(new Set());
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const limit = 20;

  const fetchDumps = async (reset = false) => {
    if (!userId) {
      console.log("DumpsListPage: No userId, skipping fetch");
      return;
    }
    
    const currentOffset = reset ? 0 : offset;
    setLoading(true);
    
    try {
      const response = await apiClient.get('/dumps', {
        params: { limit, offset: currentOffset },
      });
      
      const fetchedDumps = response.data || [];
      
      if (reset) {
        setDumps(fetchedDumps);
        setSelectedDumps(new Set()); // Clear selection when resetting
      } else {
        setDumps(prev => [...prev, ...fetchedDumps]);
      }
      
      setHasMore(fetchedDumps.length === limit);
      setOffset(currentOffset + fetchedDumps.length);
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to load dumps");
      
      if (error.response?.status === 401) {
        toast.error("Please sign in to view dumps", { duration: 5000 });
      } else {
        toast.error(errorMessage, { duration: 5000 });
      }
      
      setDumps([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDumps(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Listen for dump-created event to refresh list
  useEffect(() => {
    const handleDumpCreated = () => {
      fetchDumps(true);
    };

    window.addEventListener('dump-created', handleDumpCreated);
    return () => {
      window.removeEventListener('dump-created', handleDumpCreated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDumpClick = (dumpId) => {
    navigate(`/app/dumps/${dumpId}`);
  };

  const handleLoadMore = () => {
    fetchDumps(false);
  };

  const handleDelete = async (dumpId, e) => {
    e.stopPropagation(); // Prevent navigation when clicking delete
    
    setDeletingId(dumpId);
    try {
      await apiClient.delete(`/dumps/${dumpId}`);
      toast.success("Dump deleted successfully");
      // Remove from local state
      setDumps(prev => prev.filter(dump => dump.id !== dumpId));
      // Remove from selected if it was selected
      setSelectedDumps(prev => {
        const next = new Set(prev);
        next.delete(dumpId);
        return next;
      });
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to delete dump");
      toast.error(errorMessage);
    } finally {
      setDeletingId(null);
    }
  };


  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedDumps(new Set(dumps.map(dump => dump.id)));
    } else {
      setSelectedDumps(new Set());
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedDumps.size === 0) return;
    
    if (!window.confirm(`Delete ${selectedDumps.size} dump${selectedDumps.size > 1 ? 's' : ''}?`)) {
      return;
    }

    setIsDeletingSelected(true);
    const selectedIds = Array.from(selectedDumps);
    let successCount = 0;
    let errorCount = 0;

    try {
      // Delete all selected dumps in parallel
      await Promise.all(
        selectedIds.map(async (dumpId) => {
          try {
            await apiClient.delete(`/dumps/${dumpId}`);
            successCount++;
          } catch (error) {
            console.error(`Failed to delete dump ${dumpId}:`, error);
            errorCount++;
          }
        })
      );

      // Remove deleted dumps from local state
      setDumps(prev => prev.filter(dump => !selectedDumps.has(dump.id)));
      setSelectedDumps(new Set());

      if (errorCount === 0) {
        toast.success(`Deleted ${successCount} dump${successCount > 1 ? 's' : ''} successfully`);
      } else {
        toast.warning(`Deleted ${successCount} dump${successCount > 1 ? 's' : ''}, ${errorCount} failed`);
      }
    } catch (error) {
      toast.error("Error deleting dumps");
    } finally {
      setIsDeletingSelected(false);
    }
  };

  const isAllSelected = dumps.length > 0 && selectedDumps.size === dumps.length;
  const isSomeSelected = selectedDumps.size > 0 && selectedDumps.size < dumps.length;

  if (loading && dumps.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (dumps.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20" data-testid="dumps-empty">
        <div className="w-20 h-20 rounded-full bg-card flex items-center justify-center mb-6">
          <FileText className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-semibold mb-2">No dumps yet</h3>
        <p className="text-muted-foreground text-center max-w-md">
          Create a dump from text or voice to start capturing your thoughts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="dumps-list-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Dumps</h2>
          <p className="text-sm text-muted-foreground mt-1">
            History of all capture sessions
          </p>
        </div>
        {selectedDumps.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {selectedDumps.size} selected
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelected}
              disabled={isDeletingSelected}
            >
              {isDeletingSelected ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Selected
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Use same grid layout as inbox view - match inbox column exactly (1/3 width) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Container matching inbox container (8 columns) */}
        <div className="lg:col-span-8">
          {/* Inner grid matching InboxSplitView structure */}
          <div className="grid grid-cols-12 gap-6">
            {/* Dumps list (6 columns = 1/3 of total width, matching inbox column) */}
            <div className="col-span-12 lg:col-span-6">
              {/* Select All checkbox */}
              {dumps.length > 0 && (
                <div className="flex items-center gap-2 mb-4 pb-3 border-b">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={handleSelectAll}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-muted-foreground">
                    Select all ({dumps.length} dumps)
                  </span>
                </div>
              )}
              <div className="grid gap-4">
        {dumps.map((dump) => {
          const isSelected = selectedDumps.has(dump.id);
          const createdAt = new Date(dump.created_at);
          const preview = dump.raw_text.length > 150 
            ? dump.raw_text.substring(0, 150) + '...' 
            : dump.raw_text;
          const displayTitle = dump.title || preview;
          
          return (
            <Card
              key={dump.id}
              className={`p-4 hover:bg-card/50 transition-colors cursor-pointer ${isSelected ? 'ring-2 ring-primary' : ''}`}
              onClick={() => handleDumpClick(dump.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => {
                    setSelectedDumps(prev => {
                      const next = new Set(prev);
                      if (next.has(dump.id)) {
                        next.delete(dump.id);
                      } else {
                        next.add(dump.id);
                      }
                      return next;
                    });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 mt-1 flex-shrink-0"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-medium">
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
                  {dump.title ? (
                    <h3 className="text-base font-semibold text-foreground mb-1 line-clamp-1">
                      {dump.title}
                    </h3>
                  ) : null}
                  <p className={`text-sm ${dump.title ? 'text-muted-foreground' : 'text-foreground'} mb-2 line-clamp-3`}>
                    {dump.title ? preview : displayTitle}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                  onClick={(e) => handleDelete(dump.id, e)}
                  disabled={deletingId === dump.id}
                  title="Delete dump"
                >
                  {deletingId === dump.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </Card>
          );
        })}
              </div>

              {hasMore && (
                <div className="flex justify-center pt-4">
                  <Button 
                    variant="outline" 
                    onClick={handleLoadMore}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load More'
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


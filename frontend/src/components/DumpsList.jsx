import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, FileText, Clock, Archive } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import DumpReview from "./DumpReview";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";

export default function DumpsList({ userId, onDumpsNeedingReviewChange }) {
  const [dumps, setDumps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDump, setSelectedDump] = useState(null);

  const fetchDumps = async () => {
    if (!userId) {
      console.log("DumpsList: No userId, skipping fetch");
      return;
    }
    
    setLoading(true);
    try {
      const response = await apiClient.get('/dumps', {
        params: { archived: false },
      });
      console.log("DumpsList: Received response", response.data);
      const allDumps = response.data || [];
      setDumps(allDumps);
      
      // Calculate dumps needing review: not clarified OR have untriaged items
      if (onDumpsNeedingReviewChange && allDumps.length > 0) {
        const reviewPromises = allDumps.map(async (dump) => {
          if (!dump.clarified_at) return true; // Not clarified yet
          
          try {
            const itemsResponse = await apiClient.get(`/dumps/${dump.id}/items`);
            const items = itemsResponse.data || [];
            // Check if any items are still "new" (untriaged)
            return items.some(item => item.status === 'new');
          } catch {
            return false;
          }
        });
        
        const reviewResults = await Promise.all(reviewPromises);
        const countNeedingReview = reviewResults.filter(Boolean).length;
        onDumpsNeedingReviewChange(countNeedingReview);
      } else if (onDumpsNeedingReviewChange) {
        onDumpsNeedingReviewChange(0);
      }
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to load dumps");
      
      if (error.response?.status === 401) {
        toast.error("Please sign in to view dumps", { duration: 5000 });
      } else {
        toast.error(errorMessage, { duration: 8000 });
      }
      
      // Set empty array so UI doesn't break
      setDumps([]);
      if (onDumpsNeedingReviewChange) onDumpsNeedingReviewChange(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDumps();
  }, [userId]);

  const handleDumpClick = async (dump) => {
    try {
      // Fetch dump with items
      const [dumpResponse, itemsResponse] = await Promise.all([
        apiClient.get(`/dumps/${dump.id}`),
        apiClient.get(`/dumps/${dump.id}/items`)
      ]);
      
      setSelectedDump({
        ...dumpResponse.data,
        items: itemsResponse.data || []
      });
    } catch (error) {
      console.error("Error fetching dump details:", error);
      toast.error(handleApiError(error, "Failed to load dump details"));
    }
  };

  const handleCloseReview = () => {
    setSelectedDump(null);
    fetchDumps(); // Refresh list
  };

  if (selectedDump) {
    return (
      <DumpReview
        dump={selectedDump}
        onClose={handleCloseReview}
        onRefresh={fetchDumps}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading dumps...</p>
      </div>
    );
  }

  if (dumps.length === 0) {
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

  const handleDumpCreated = (newDump) => {
    setDumps((prev) => [newDump, ...prev]);
  };

  return (
    <div className="space-y-4" data-testid="dumps-list">
      <CreateDump userId={userId} onDumpCreated={handleDumpCreated} />
      
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Inbox</h2>
        <p className="text-muted-foreground">{dumps.length} {dumps.length === 1 ? "dump" : "dumps"}</p>
      </div>

      <div className="grid gap-4">
        {dumps.map((dump) => {
          const createdAt = new Date(dump.created_at);
          const itemCount = dump.items?.length || 0;
          
          return (
            <Card
              key={dump.id}
              className="p-4 hover:bg-card/50 transition-colors cursor-pointer"
              onClick={() => handleDumpClick(dump)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium">Dump</span>
                    <span className="text-xs text-muted-foreground">
                      {format(createdAt, "MMM d, HH:mm")}
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
                  <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                    {dump.raw_text}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(createdAt, { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


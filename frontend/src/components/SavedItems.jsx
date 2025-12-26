import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import apiClient from "@/lib/apiClient";

export default function SavedItems({ userId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchSavedItems = async () => {
    if (!userId) return;
    
    setLoading(true);
    try {
      // Get all dumps and their saved items
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
      
      // Sort by created_at, newest first
      allItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setItems(allItems);
    } catch (error) {
      console.error("Error fetching saved items:", error);
      toast.error("Failed to load saved items");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSavedItems();
  }, [userId]);

  const handleTrash = async (itemId) => {
    try {
      await apiClient.patch(`/dump-items/${itemId}/trash`);
      setItems((prev) => prev.filter((item) => item.id !== itemId));
      toast.success("Removed from Logbook");
    } catch (error) {
      console.error("Error trashing item:", error);
      toast.error("Failed to remove item");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading saved items...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20" data-testid="saved-empty">
        <div className="w-20 h-20 rounded-full bg-card flex items-center justify-center mb-6">
          <BookOpen className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-semibold mb-2">No saved items yet</h3>
        <p className="text-muted-foreground text-center max-w-md">
          Items you save from dumps will appear here in your Logbook.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="saved-items">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Logbook</h2>
        <p className="text-muted-foreground">{items.length} {items.length === 1 ? "item" : "items"}</p>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const createdAt = new Date(item.created_at);
          return (
            <Card key={item.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm mb-2">{item.text}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{format(createdAt, "MMM d, yyyy")}</span>
                    {item.dump && (
                      <span className="capitalize">
                        From {item.dump.source} dump
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleTrash(item.id)}
                  className="gap-1 text-destructive hover:text-destructive"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


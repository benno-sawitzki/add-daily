import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function ProcessingPage({ userId }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [promoting, setPromoting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [bulkTarget, setBulkTarget] = useState("inbox");

  const fetchItems = async () => {
    if (!userId) return;
    
    setLoading(true);
    try {
      const response = await apiClient.get('/dump-items?status=new');
      setItems(response.data || []);
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to load items");
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const fetchTasks = async () => {
    if (!userId) return;
    
    try {
      const response = await apiClient.get('/tasks?status=inbox');
      setTasks(response.data || []);
    } catch (error) {
      // Silently fail for tasks - not critical
      console.error("Failed to load tasks:", error);
    }
  };

  useEffect(() => {
    fetchItems();
    fetchTasks();
  }, [userId]);

  const handlePromote = async (itemId, target) => {
    if (!itemId) return;
    
    setPromoting(true);
    try {
      await apiClient.post(`/dump-items/${itemId}/promote`, { target });
      
      // Optimistic update: remove item from list immediately for instant feedback
      setItems(prev => prev.filter(item => item.id !== itemId));
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
      
      // Show success toast immediately
      const targetLabel = target === 'inbox' ? 'Inbox' 
        : target === 'next_today' ? 'Next Today' 
        : 'Later';
      toast.success(`Promoted to ${targetLabel}`);
      
      // Refresh tasks preview in background (non-blocking)
      fetchTasks().catch(err => console.error("Failed to refresh tasks preview:", err));
      
      // Dispatch event to trigger MainApp task refresh (for menu badge counter)
      window.dispatchEvent(new CustomEvent('refresh-tasks'));
    } catch (error) {
      // Handle 409 Conflict (inbox full) with specific message
      if (error.response?.status === 409) {
        const message = error.response?.data?.detail || "Inbox is full. Promote to Later or Next Today.";
        toast.error(message);
      } else {
        const errorMessage = handleApiError(error, "Failed to promote item");
        toast.error(errorMessage);
      }
      // Refresh items on error
      await fetchItems();
    } finally {
      setPromoting(false);
    }
  };

  const handleDismiss = async (itemId) => {
    if (!itemId) return;
    
    setDismissing(true);
    try {
      await apiClient.post(`/dump-items/${itemId}/dismiss`);
      
      // Optimistic update: remove item from list
      setItems(prev => prev.filter(item => item.id !== itemId));
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
      
      toast.success("Item dismissed");
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to dismiss item");
      toast.error(errorMessage);
      // Refresh items on error
      await fetchItems();
    } finally {
      setDismissing(false);
    }
  };

  const handleBulkPromote = async () => {
    if (selectedItems.size === 0) return;
    
    const itemIds = Array.from(selectedItems);
    setPromoting(true);
    try {
      await apiClient.post('/dump-items/promote-bulk', {
        item_ids: itemIds,
        target: bulkTarget,
      });
      
      // Optimistic update: remove items from list immediately for instant feedback
      setItems(prev => prev.filter(item => !itemIds.includes(item.id)));
      setSelectedItems(new Set());
      
      // Show success toast immediately
      const targetLabel = bulkTarget === 'inbox' ? 'Inbox' 
        : bulkTarget === 'next_today' ? 'Next Today' 
        : 'Later';
      toast.success(`Promoted ${itemIds.length} items to ${targetLabel}`);
      
      // Refresh tasks preview in background (non-blocking)
      fetchTasks().catch(err => console.error("Failed to refresh tasks preview:", err));
      
      // Dispatch event to trigger MainApp task refresh (for menu badge counter)
      window.dispatchEvent(new CustomEvent('refresh-tasks'));
    } catch (error) {
      // Handle 409 Conflict (inbox full) with specific message
      if (error.response?.status === 409) {
        const message = error.response?.data?.detail || "Inbox is full. Promote to Later or Next Today.";
        toast.error(message);
      } else {
        const errorMessage = handleApiError(error, "Failed to promote items");
        toast.error(errorMessage);
      }
      // Refresh items on error
      await fetchItems();
    } finally {
      setPromoting(false);
    }
  };

  const handleBulkDismiss = async () => {
    if (selectedItems.size === 0) return;
    
    const itemIds = Array.from(selectedItems);
    setDismissing(true);
    try {
      await apiClient.post('/dump-items/dismiss-bulk', {
        item_ids: itemIds,
      });
      
      // Optimistic update: remove items from list immediately for instant feedback
      setItems(prev => prev.filter(item => !itemIds.includes(item.id)));
      setSelectedItems(new Set());
      
      // Show success toast immediately
      toast.success(`Dismissed ${itemIds.length} items`);
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to dismiss items");
      toast.error(errorMessage);
      // Refresh items on error
      await fetchItems();
    } finally {
      setDismissing(false);
    }
  };

  const toggleItemSelection = (itemId) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    const allSelected = items.length > 0 && items.every(item => selectedItems.has(item.id));
    
    if (allSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map(item => item.id)));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasSelected = selectedItems.size > 0;

  return (
    <div className="flex gap-6 h-full" data-testid="processing-page">
      {/* Left Column: To Triage */}
      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">To Triage</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSelectAll}
              disabled={items.length === 0}
            >
              {items.length > 0 && items.every(item => selectedItems.has(item.id)) 
                ? 'Deselect All' 
                : 'Select All'}
            </Button>
          </div>
        </div>

        {/* Bulk Actions */}
        {hasSelected && (
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {selectedItems.size} selected
              </span>
              <Select value={bulkTarget} onValueChange={setBulkTarget}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbox">Inbox</SelectItem>
                  <SelectItem value="next_today">Next Today</SelectItem>
                  <SelectItem value="later">Later</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={handleBulkPromote}
                disabled={promoting}
                size="sm"
              >
                {promoting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Promote Selected'}
              </Button>
              <Button
                onClick={handleBulkDismiss}
                disabled={dismissing}
                variant="outline"
                size="sm"
              >
                {dismissing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Dismiss Selected'}
              </Button>
            </div>
          </Card>
        )}

        {/* Items List */}
        {items.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">No items to triage</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const isSelected = selectedItems.has(item.id);
              
              return (
                <Card
                  key={item.id}
                  className={`p-4 ${isSelected ? 'ring-2 ring-primary' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleItemSelection(item.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <p className="text-sm text-foreground">{item.text}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handlePromote(item.id, 'inbox')}
                        disabled={promoting || dismissing}
                        size="sm"
                        variant="outline"
                      >
                        Inbox
                      </Button>
                      <Button
                        onClick={() => handlePromote(item.id, 'next_today')}
                        disabled={promoting || dismissing}
                        size="sm"
                        variant="outline"
                      >
                        Next Today
                      </Button>
                      <Button
                        onClick={() => handlePromote(item.id, 'later')}
                        disabled={promoting || dismissing}
                        size="sm"
                        variant="outline"
                      >
                        Later
                      </Button>
                      <Button
                        onClick={() => handleDismiss(item.id)}
                        disabled={promoting || dismissing}
                        size="sm"
                        variant="ghost"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Column: Current Inbox Preview */}
      <div className="w-80 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Current Inbox</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/app/inbox')}
          >
            View All
          </Button>
        </div>
        
        <Card className="p-4">
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No tasks in inbox
            </p>
          ) : (
            <div className="space-y-2">
              {tasks.slice(0, 10).map((task) => (
                <div key={task.id} className="text-sm">
                  <p className="text-foreground">{task.title}</p>
                </div>
              ))}
              {tasks.length > 10 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  +{tasks.length - 10} more
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}



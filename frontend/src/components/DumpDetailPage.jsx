import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Sparkles, ExternalLink, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";

export default function DumpDetailPage({ userId }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dump, setDump] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchDump = async () => {
    if (!userId || !id) return;
    
    setLoading(true);
    try {
      const response = await apiClient.get(`/dumps/${id}`);
      const data = response.data;
      
      // Handle both response formats:
      // - New format: {dump: {...}, items: [...]}
      // - Old format: {...} (dump object directly)
      let dumpData = data.dump || data;
      const fetchedItems = data.items || [];
      
      // Ensure dump has an id (use route param if missing)
      if (!dumpData.id && id) {
        dumpData = { ...dumpData, id };
      }
      
      setDump(dumpData);
      setItems(fetchedItems);
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to load dump");
      toast.error(errorMessage);
      navigate('/app/dumps');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userId]);

  const handleExtract = async () => {
    if (!id) return;
    
    setExtracting(true);
    try {
      const response = await apiClient.post(`/dumps/${id}/extract`);
      // Refresh the dump data to get updated items
      await fetchDump();
      const itemCount = response.data.items?.length || 0;
      toast.success(`Extracted ${itemCount} item${itemCount !== 1 ? 's' : ''}`);
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to extract items");
      toast.error(errorMessage);
    } finally {
      setExtracting(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    
    setDeleting(true);
    try {
      await apiClient.delete(`/dumps/${id}`);
      toast.success("Dump deleted successfully");
      navigate('/app/dumps');
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to delete dump");
      toast.error(errorMessage);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!dump) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Dump not found</p>
        <Button variant="outline" onClick={() => navigate('/app/dumps')} className="mt-4">
          Back to Dumps
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="dump-detail-page">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/app/dumps')}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-semibold">Dump Details</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {format(new Date(dump.created_at), "MMM d, yyyy 'at' HH:mm")} • {dump.source}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Deleting...
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </>
          )}
        </Button>
      </div>

      {/* Use same grid layout as inbox view - match inbox column exactly (1/3 width) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Container matching inbox container (8 columns) */}
        <div className="lg:col-span-8">
          {/* Inner grid matching InboxSplitView structure */}
          <div className="grid grid-cols-12 gap-6">
            {/* Dump content and items (6 columns = 1/3 of total width, matching inbox column) */}
            <div className="col-span-12 lg:col-span-6">
          {/* Raw Text */}
          <Card className="p-6 mb-6">
            <h3 className="text-lg font-semibold mb-3">Raw Text</h3>
            <p className="text-sm text-foreground whitespace-pre-wrap">{dump.raw_text}</p>
          </Card>

          {/* Extract Items Button - only show if no items exist yet */}
          {items.length === 0 && (
            <Card className="p-4">
              <Button
                onClick={handleExtract}
                disabled={extracting}
                className="gap-2"
              >
                {extracting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Extract Items
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                Extract individual items from the raw text. After extraction, promote items to tasks from the Processing page.
              </p>
            </Card>
          )}

          {/* Items List */}
          {items.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  Extracted Items ({items.length})
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/app/process')}
                >
                  Triage Items
                </Button>
              </div>

              <div className="space-y-2">
            {items.map((item, index) => {
              const status = item.status || 'new';
              const isPromoted = status === 'promoted';
              const isDismissed = status === 'dismissed';
              
              return (
                <Card
                  key={item.id}
                  className={`p-4 ${
                    isPromoted 
                      ? 'bg-emerald-500/10 border-emerald-500/20' 
                      : isDismissed
                        ? 'opacity-60 bg-muted/30'
                        : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-muted-foreground">
                          #{index + 1}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          status === 'promoted'
                            ? 'bg-emerald-500/20 text-emerald-500'
                            : status === 'dismissed'
                              ? 'bg-gray-500/20 text-gray-500'
                              : 'bg-blue-500/20 text-blue-500'
                        }`}>
                          {status === 'promoted' ? 'Promoted' : status === 'dismissed' ? 'Dismissed' : 'New'}
                        </span>
                        {isPromoted && item.created_task_id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => navigate(`/app/inbox`)}
                          >
                            View Task
                            <ExternalLink className="w-3 h-3 ml-1" />
                          </Button>
                        )}
                      </div>
                      <p className="text-sm font-medium text-foreground">{item.text || 'Untitled Item'}</p>
                      {isPromoted && item.created_task_id && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Task ID: {item.created_task_id}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
              </div>
            </div>
          )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

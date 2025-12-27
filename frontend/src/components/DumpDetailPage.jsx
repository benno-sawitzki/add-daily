import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Loader2, Sparkles, ExternalLink, Trash2, Pencil, Check, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";
import DumpItemCard from "./DumpItemCard";

export default function DumpDetailPage({ userId }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dump, setDump] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");

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
      setTitleValue(dumpData.title || "");
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

  const handleTitleSave = async () => {
    if (!id || !dump) return;
    
    try {
      const response = await apiClient.patch(`/dumps/${id}`, { title: titleValue || null });
      setDump({ ...dump, title: response.data.title });
      setIsEditingTitle(false);
      toast.success("Title updated");
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to update title");
      toast.error(errorMessage);
    }
  };

  const handleTitleCancel = () => {
    setTitleValue(dump?.title || "");
    setIsEditingTitle(false);
  };

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
          {/* Title - Editable */}
          {isEditingTitle ? (
            <div className="flex items-center gap-2 max-w-[33.333%]">
              <Input
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleTitleSave();
                  if (e.key === "Escape") handleTitleCancel();
                }}
                placeholder="Enter dump title..."
                className="text-2xl font-semibold h-auto py-1"
                autoFocus
              />
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleTitleSave}>
                <Check className="w-4 h-4 text-emerald-500" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleTitleCancel}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div 
              className="flex items-center gap-2 group cursor-pointer"
              onClick={() => setIsEditingTitle(true)}
            >
              <h2 className="text-2xl font-semibold">
                {dump.title || "Untitled Dump"}
              </h2>
              <Pencil className="w-4 h-4 opacity-0 group-hover:opacity-50 transition-opacity" />
            </div>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            {format(new Date(dump.created_at), "MMM d, yyyy 'at' HH:mm")} • {dump.source}
            {dump.extraction_status && (
              <span className="ml-2">
                • Extraction: {dump.extraction_status}
                {dump.extraction_item_count !== null && dump.extraction_item_count !== undefined && (
                  <span> ({dump.extraction_item_count} items)</span>
                )}
              </span>
            )}
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

              <div className="space-y-3">
                {items.map((item) => (
                  <DumpItemCard
                    key={item.id}
                    item={item}
                    onUpdate={fetchDump}
                    onDelete={fetchDump}
                  />
                ))}
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

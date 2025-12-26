import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { FileText, Send } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";

export default function CreateDump({ userId, onDumpCreated }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!text.trim()) {
      toast.error("Please enter some text");
      return;
    }

    if (!userId) {
      toast.error("Please sign in to create a dump");
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post('/dumps', {
        source: "text",
        raw_text: text.trim(),
      });

      toast.success("Dump created!");
      setText("");
      if (onDumpCreated) {
        onDumpCreated(response.data);
      }
    } catch (error) {
      console.error("Error creating dump:", error);
      toast.error(handleApiError(error, "Failed to create dump"));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <Card className="p-4 mb-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Create Dump</h3>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type or paste your thoughts here... (Cmd/Ctrl+Enter to create)"
          className="min-h-[100px] resize-none"
        />
        <div className="flex justify-end">
          <Button
            onClick={handleCreate}
            disabled={!text.trim() || loading}
            size="sm"
            className="gap-2"
          >
            <Send className="w-4 h-4" />
            Create Dump
          </Button>
        </div>
      </div>
    </Card>
  );
}


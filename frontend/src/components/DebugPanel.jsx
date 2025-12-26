import { useState, useEffect } from "react";
import { X, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import API_BASE from "@/lib/apiBase";

// Global state for last API call (set by apiClient interceptor)
let lastApiCall = {
  method: null,
  url: null,
  status: null,
  responseData: null,
  error: null,
};

// Function to update last API call (called from apiClient interceptor)
// This is exposed on window so apiClient can call it
if (typeof window !== 'undefined') {
  window.updateLastApiCall = (info) => {
    lastApiCall = { ...lastApiCall, ...info };
    // Trigger re-render of all DebugPanel instances
    if (window.debugPanelUpdateCallback) {
      window.debugPanelUpdateCallback();
    }
  };
}

const DEBUG_MODE = process.env.NODE_ENV === 'development' || process.env.REACT_APP_DEBUG_API === 'true';

export default function DebugPanel() {
  const [isOpen, setIsOpen] = useState(DEBUG_MODE);
  const [apiInfo, setApiInfo] = useState(lastApiCall);

  useEffect(() => {
    // Register callback to update this component
    window.debugPanelUpdateCallback = () => {
      setApiInfo({ ...lastApiCall });
    };

    // Poll for updates (fallback)
    const interval = setInterval(() => {
      setApiInfo({ ...lastApiCall });
    }, 500);

    return () => {
      clearInterval(interval);
      window.debugPanelUpdateCallback = null;
    };
  }, []);

  if (!DEBUG_MODE) return null;

  // Use single source of truth for API base URL
  // In development with proxy, show the resolved browser URL
  const API_BASE_URL = API_BASE.startsWith('/') 
    ? `${window.location.origin}${API_BASE}`
    : API_BASE;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {isOpen ? (
        <Card className="w-96 p-4 bg-card/95 backdrop-blur-sm border-2 border-primary/20 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bug className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">API Debug</h3>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsOpen(false)}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
          
          <div className="space-y-2 text-xs font-mono">
            <div>
              <span className="text-muted-foreground">API_BASE_URL:</span>
              <div className="text-foreground break-all mt-1">{API_BASE_URL}</div>
            </div>
            
            {apiInfo.url && (
              <>
                <div className="pt-2 border-t border-border">
                  <span className="text-muted-foreground">Last Request:</span>
                  <div className="text-foreground mt-1">
                    <span className="font-semibold">{apiInfo.method || 'UNKNOWN'}</span>{' '}
                    <span className="break-all">{apiInfo.url}</span>
                  </div>
                </div>
                
                {apiInfo.status && (
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <span className={`ml-2 font-semibold ${
                      apiInfo.status >= 200 && apiInfo.status < 300 ? 'text-green-500' :
                      apiInfo.status >= 400 ? 'text-red-500' : 'text-yellow-500'
                    }`}>
                      {apiInfo.status} {apiInfo.statusText || ''}
                    </span>
                  </div>
                )}
                
                {apiInfo.error && (
                  <div>
                    <span className="text-muted-foreground">Error:</span>
                    <div className="text-red-500 mt-1 break-all">{apiInfo.error}</div>
                  </div>
                )}
                
                {apiInfo.responseData && (
                  <div>
                    <span className="text-muted-foreground">Response:</span>
                    <pre className="text-foreground mt-1 text-xs bg-muted/50 p-2 rounded overflow-auto max-h-32">
                      {typeof apiInfo.responseData === 'string' 
                        ? apiInfo.responseData 
                        : JSON.stringify(apiInfo.responseData, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}
            
            {!apiInfo.url && (
              <div className="text-muted-foreground italic">No API calls yet</div>
            )}
          </div>
        </Card>
      ) : (
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 rounded-full shadow-lg"
          onClick={() => setIsOpen(true)}
          title="Show API Debug Panel"
        >
          <Bug className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}


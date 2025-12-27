import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getRangeBounds } from "@/utils/dateRanges";
import apiClient from "@/lib/apiClient";

export default function CommandCenter({ 
  nextTasks = [],
  focusTasks = [],
  currentEnergy,
  onEnergyChange,
  userId,
  refreshTrigger 
}) {
  const [range, setRange] = useState("today");
  const [metrics, setMetrics] = useState({
    done: 0,
    focusSessions: 0,
    deepWorkMinutes: 0,
    nextTodayCount: nextTasks.length,
    focusCount: focusTasks.length,
  });
  const [loading, setLoading] = useState(false);
  // Removed metricsError state - errors are logged to console only

  // Fetch metrics when range changes or refreshTrigger changes
  useEffect(() => {
    if (!userId) {
      // Reset to defaults if no user
      setMetrics({
        done: 0,
        focusSessions: 0,
        deepWorkMinutes: 0,
        nextTodayCount: nextTasks.length,
        focusCount: focusTasks.length,
      });
      return;
    }
    
    const fetchMetrics = async () => {
      setLoading(true);
      try {
        const { start, end } = getRangeBounds(range);
        
        // Fetch done tasks count - don't throw on error
        let doneCount = 0;
        try {
          // Send full ISO datetime strings to backend to preserve timezone information
          // The backend can handle both YYYY-MM-DD and full ISO strings
          const startDate = start.split('T')[0];
          const endDate = end.split('T')[0];
          
          console.log('[CommandCenter] Fetching done metrics:', { 
            start: startDate, 
            end: endDate, 
            range,
            startISO: start,
            endISO: end
          });
          
          // Try sending full ISO strings first (backend handles both formats)
          const doneResponse = await apiClient.get('/metrics/done', {
            params: { start: start, end: end },
          });
          doneCount = doneResponse.data.count || 0;
          
          console.log('[CommandCenter] Done metrics response:', { 
            count: doneCount, 
            error: doneResponse.data._error,
            fullResponse: doneResponse.data,
            debug: doneResponse.data._debug
          });
          
          // If we have debug info, log it prominently
          if (doneResponse.data._debug) {
            console.log('🔍 [CommandCenter] Debug info:', doneResponse.data._debug);
          }
          
          // Log error if present in response (console only, no UI display)
          if (doneResponse.data._error) {
            console.error("❌ [CommandCenter] Metrics done returned error:", doneResponse.data._error);
            // In development, also log to console with more visibility
            if (process.env.NODE_ENV === 'development') {
              console.error("Metrics endpoint error details:", {
                error: doneResponse.data._error,
                start: startDate,
                end: endDate,
                range
              });
            }
          }
        } catch (error) {
          const errorDetails = {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
          };
          console.error("❌ [CommandCenter] Failed to fetch done metrics:", errorDetails);
          doneCount = 0;
          
          // In development, log full error details
          if (process.env.NODE_ENV === 'development') {
            console.error("Full error details:", {
              error: errorDetails,
              start: start.split('T')[0],
              end: end.split('T')[0],
              range
            });
          }
        }
        
        // Fetch focus sessions - don't throw on error
        let focusCount = 0;
        let deepWorkMinutes = 0;
        try {
          // Convert ISO date strings to YYYY-MM-DD format for backend
          const startDate = start.split('T')[0];
          const endDate = end.split('T')[0];
          
          const focusResponse = await apiClient.get('/metrics/focus', {
            params: { start: startDate, end: endDate },
          });
          focusCount = focusResponse.data.count || 0;
          deepWorkMinutes = focusResponse.data.totalMinutes || 0;
          
          // Log error if present in response (console only, no UI display)
          if (focusResponse.data._error) {
            console.warn("Metrics focus returned error:", focusResponse.data._error);
          }
        } catch (error) {
          const errorDetails = {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
          };
          console.warn("Failed to fetch focus metrics (non-blocking):", errorDetails);
          focusCount = 0;
          deepWorkMinutes = 0;
        }
        
        setMetrics({
          done: doneCount,
          focusSessions: focusCount,
          deepWorkMinutes: deepWorkMinutes,
          nextTodayCount: nextTasks.length,
          focusCount: focusTasks.length,
        });
      } catch (error) {
        // This should never happen, but if it does, log and continue
        console.error("Unexpected error in fetchMetrics:", error);
        // Don't show toast - metrics are non-critical
      } finally {
        setLoading(false);
      }
    };
    
    fetchMetrics();
  }, [range, userId, nextTasks.length, focusTasks.length, refreshTrigger]);

  // Update Next Today and Focus counts when they change
  useEffect(() => {
    setMetrics(prev => ({
      ...prev,
      nextTodayCount: nextTasks.length,
      focusCount: focusTasks.length,
    }));
  }, [nextTasks.length, focusTasks.length]);

  const handleEnergyChange = async (value) => {
    if (onEnergyChange) {
      onEnergyChange(value);
    }
    
    // Persist to backend
    try {
      await apiClient.post('/user/preferences', { energy_level: value });
    } catch (error) {
      console.error("Error saving energy preference:", error);
      // Don't show error toast - it's not critical
    }
  };

  return (
    <div className="lg:sticky lg:top-24 flex flex-col gap-8 px-6 pb-6 pt-0 h-fit">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-2xl font-semibold">Command Center</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Your productivity metrics
        </p>
      </div>

      {/* Range Selector */}
      <div>
        <Tabs value={range} onValueChange={setRange} className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-9">
            <TabsTrigger value="today" className="text-xs px-2">Today</TabsTrigger>
            <TabsTrigger value="thisWeek" className="text-xs px-2">Week</TabsTrigger>
            <TabsTrigger value="lastWeek" className="text-xs px-2">Last</TabsTrigger>
            <TabsTrigger value="thisMonth" className="text-xs px-2">Month</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-6">
        <MetricCard 
          label="Done" 
          value={loading ? "—" : metrics.done} 
        />
        <MetricCard 
          label="Focus" 
          value={loading ? "—" : `${metrics.focusCount}/1`} 
        />
        <MetricCard 
          label="Deep Work" 
          value={loading ? "—" : `${metrics.deepWorkMinutes}m`} 
        />
        <MetricCard 
          label="Next Today" 
          value={`${metrics.nextTodayCount}/5`} 
        />
      </div>

      {/* Energy Selector */}
      <div>
        <Select 
          value={currentEnergy || "medium"} 
          onValueChange={handleEnergyChange}
        >
          <SelectTrigger className="w-full h-10">
            <SelectValue>
              {currentEnergy === "low" ? "⚡ Low" : currentEnergy === "medium" ? "⚡⚡ Medium" : "⚡⚡⚡ High"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">⚡ Low</SelectItem>
            <SelectItem value="medium">⚡⚡ Medium</SelectItem>
            <SelectItem value="high">⚡⚡⚡ High</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
        {label}
      </p>
      <p className="text-[32px] font-semibold text-foreground leading-none">
        {value}
      </p>
    </div>
  );
}


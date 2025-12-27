import { useState, useEffect, useRef } from "react";
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
  const isFirstLoadRef = useRef(true);
  // Removed metricsError state - errors are logged to console only

  // Update Next Today and Focus counts immediately when they change (no API call needed)
  useEffect(() => {
    setMetrics(prev => ({
      ...prev,
      nextTodayCount: nextTasks.length,
      focusCount: focusTasks.length,
    }));
  }, [nextTasks.length, focusTasks.length]);

  // Fetch metrics when range changes or refreshTrigger changes
  useEffect(() => {
    if (!userId) {
      // Only reset if this is the first load, otherwise keep previous values
      if (isFirstLoadRef.current) {
        setMetrics(prev => ({
          ...prev,
          done: 0,
          focusSessions: 0,
          deepWorkMinutes: 0,
        }));
      }
      return;
    }
    
    const fetchMetrics = async () => {
      // Never set loading state - always keep previous values visible
      // This prevents the jarring "—" to value jump
      
      try {
        const { start, end } = getRangeBounds(range);
        const startDate = start.split('T')[0];
        const endDate = end.split('T')[0];
        
        // Make both API calls in parallel for faster loading
        const [doneResponse, focusResponse] = await Promise.allSettled([
          // Fetch done tasks count
          apiClient.get('/metrics/done', {
            params: { start: start, end: end },
          }).catch(error => {
            const errorDetails = {
              message: error.message,
              response: error.response?.data,
              status: error.response?.status,
            };
            console.error("❌ [CommandCenter] Failed to fetch done metrics:", errorDetails);
            return { data: { count: 0, _error: errorDetails } };
          }),
          
          // Fetch focus sessions
          apiClient.get('/metrics/focus', {
            params: { start: startDate, end: endDate },
          }).catch(error => {
            const errorDetails = {
              message: error.message,
              response: error.response?.data,
              status: error.response?.status,
            };
            console.warn("Failed to fetch focus metrics (non-blocking):", errorDetails);
            return { data: { count: 0, totalMinutes: 0, _error: errorDetails } };
          }),
        ]);
        
        // Extract results
        let doneCount = 0;
        if (doneResponse.status === 'fulfilled') {
          const response = doneResponse.value;
          doneCount = response.data?.count || 0;
          
          if (response.data?._error) {
            console.error("❌ [CommandCenter] Metrics done returned error:", response.data._error);
          }
          if (response.data?._debug) {
            console.log('🔍 [CommandCenter] Debug info:', response.data._debug);
          }
        }
        
        let focusCount = 0;
        let deepWorkMinutes = 0;
        if (focusResponse.status === 'fulfilled') {
          const response = focusResponse.value;
          focusCount = response.data?.count || 0;
          deepWorkMinutes = response.data?.totalMinutes || 0;
          
          if (response.data?._error) {
            console.warn("Metrics focus returned error:", response.data._error);
          }
        }
        
        setMetrics(prev => ({
          ...prev,
          done: doneCount,
          focusSessions: focusCount,
          deepWorkMinutes: deepWorkMinutes,
        }));
        
        isFirstLoadRef.current = false;
      } catch (error) {
        // This should never happen, but if it does, log and continue
        console.error("Unexpected error in fetchMetrics:", error);
        // Don't show toast - metrics are non-critical
      }
    };
    
    fetchMetrics();
  }, [range, userId, refreshTrigger]);

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

      {/* Range Selector - aligned with task cards in Inbox/Next Today columns */}
      <div className="-mt-8">
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
          value={metrics.done} 
        />
        <MetricCard 
          label="Focus" 
          value={`${metrics.focusCount}/1`} 
        />
        <MetricCard 
          label="Deep Work" 
          value={`${metrics.deepWorkMinutes}m`} 
        />
        <MetricCard 
          label="Next Today" 
          value={`${metrics.nextTodayCount}/1`} 
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
  // Ensure value is always a string or number, never undefined
  const displayValue = value !== undefined && value !== null ? String(value) : "0";
  
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
        {label}
      </p>
      <p className="text-[32px] font-semibold text-foreground leading-none">
        {displayValue}
      </p>
    </div>
  );
}


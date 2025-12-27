import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TabsList } from "@/components/ui/tabs";
import {
  Inbox,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Archive,
} from "lucide-react";

const STORAGE_KEY = "nav-tabs-order";

// Define all available tabs with their metadata
const ALL_TABS = [
  {
    id: "inbox",
    value: "inbox",
    label: "Inbox",
    icon: Inbox,
    route: "/app/inbox",
    dataTestId: "tab-inbox",
  },
  {
    id: "weekly",
    value: "weekly",
    label: "Week",
    icon: Calendar,
    route: "/app/weekly",
    dataTestId: "tab-weekly",
  },
  {
    id: "daily",
    value: "daily",
    label: "Day",
    icon: CalendarDays,
    route: "/app/daily",
    dataTestId: "tab-daily",
  },
  {
    id: "completed",
    value: "completed",
    label: "Done",
    icon: CheckCircle2,
    route: "/app/completed",
    dataTestId: "tab-completed",
  },
  {
    id: "dumps",
    value: "dumps",
    label: "Dumps",
    icon: Archive,
    route: "/app/dumps",
    dataTestId: "tab-dumps",
  },
];

// Get tab order from localStorage or use default
function getTabOrder() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const order = JSON.parse(stored);
      // Validate that all tabs are present
      const allTabIds = ALL_TABS.map(t => t.id);
      const hasAllTabs = allTabIds.every(id => order.includes(id));
      const hasNoExtra = order.every(id => allTabIds.includes(id));
      if (hasAllTabs && hasNoExtra && order.length === allTabIds.length) {
        return order;
      }
    }
  } catch (e) {
    console.error("Error loading tab order:", e);
  }
  // Default order
  return ALL_TABS.map(t => t.id);
}

// Save tab order to localStorage
function saveTabOrder(order) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch (e) {
    console.error("Error saving tab order:", e);
  }
}

// Sortable tab trigger component
function SortableTabTrigger({ tab, activeView, onNavigate, badgeCount, badgeColor, draggedItem, isMobile = false }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const Icon = tab.icon;
  const isActive = activeView === tab.value;

  if (isMobile) {
    // Mobile: Vertical layout, full width items
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`relative group flex items-center justify-between gap-3 px-4 py-3 text-base font-medium rounded-lg transition-colors w-full ${
          isActive
            ? "text-foreground bg-accent border-l-4 border-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        } ${isDragging ? "z-50 cursor-grabbing" : "cursor-pointer"}`}
        data-testid={tab.dataTestId}
        {...attributes}
        {...listeners}
        onClick={(e) => {
          if (!isDragging && draggedItem !== tab.id) {
            onNavigate(tab.route, tab.id);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5" />
          <span>{tab.label}</span>
        </div>
        <span className={`px-2.5 py-1 text-xs rounded-full font-semibold min-w-[2rem] text-center ${badgeCount !== undefined && badgeCount > 0 ? (badgeColor || "bg-primary/20 text-primary") : "invisible"}`}>
          {badgeCount !== undefined && badgeCount > 0 ? badgeCount : "0"}
        </span>
      </div>
    );
  }

  // Desktop: Horizontal layout
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center justify-center px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex-1 ${
        isActive
          ? "text-foreground bg-accent border-b-2 border-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      } ${isDragging ? "z-50 cursor-grabbing" : "cursor-pointer"}`}
      data-testid={tab.dataTestId}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Navigate on click (prevent if this tab was just dragged)
        if (!isDragging && draggedItem !== tab.id) {
          onNavigate(tab.route, tab.id);
        }
      }}
    >
      <div className={`flex items-center gap-1.5 ${badgeCount !== undefined && badgeCount > 0 ? 'justify-center' : (tab.id === 'weekly' || tab.id === 'dumps') ? 'justify-center ml-0' : 'justify-center -ml-2'}`}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <span>{tab.label}</span>
        {badgeCount !== undefined && badgeCount > 0 && (
          <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${badgeColor || "bg-primary/20 text-primary"}`}>
            {badgeCount}
          </span>
        )}
      </div>
    </div>
  );
}

export default function SortableNavTabs({ activeView, inboxCount, completedCount, isMobile = false }) {
  const navigate = useNavigate();
  const [tabOrder, setTabOrder] = useState(() => getTabOrder());
  const [draggedItem, setDraggedItem] = useState(null);

  // Load order from localStorage on mount
  useEffect(() => {
    const order = getTabOrder();
    setTabOrder(order);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Require 5px of movement before starting drag (allows clicks to work)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Get tabs in the current order
  const orderedTabs = tabOrder
    .map(id => ALL_TABS.find(tab => tab.id === id))
    .filter(Boolean);

  const handleDragStart = (event) => {
    setDraggedItem(event.active.id);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = tabOrder.indexOf(active.id);
      const newIndex = tabOrder.indexOf(over.id);

      const newOrder = arrayMove(tabOrder, oldIndex, newIndex);
      setTabOrder(newOrder);
      saveTabOrder(newOrder);
    }
    
    // Clear dragged item after a short delay to allow click events to be prevented
    setTimeout(() => {
      setDraggedItem(null);
    }, 100);
  };

  const handleNavigate = (route, tabId) => {
    // Don't navigate if this tab was just dragged
    if (draggedItem === tabId) {
      return;
    }
    navigate(route);
    // Close mobile menu on navigation
    if (isMobile && onNavigateCallback) {
      onNavigateCallback();
    }
  };

  if (isMobile) {
    // Mobile: Vertical layout
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="space-y-2" data-testid="view-tabs-mobile">
          <SortableContext items={tabOrder} strategy={verticalListSortingStrategy}>
            {orderedTabs.map((tab) => {
              let badgeCount;
              let badgeColor;
              
              if (tab.id === "inbox") {
                badgeCount = inboxCount;
                badgeColor = "bg-primary/20 text-primary";
              } else if (tab.id === "completed") {
                badgeCount = completedCount;
                badgeColor = "bg-emerald-500/20 text-emerald-500";
              }

              return (
                <SortableTabTrigger
                  key={tab.id}
                  tab={tab}
                  activeView={activeView}
                  onNavigate={handleNavigate}
                  badgeCount={badgeCount}
                  badgeColor={badgeColor}
                  draggedItem={draggedItem}
                  isMobile={true}
                />
              );
            })}
          </SortableContext>
        </div>
      </DndContext>
    );
  }

  // Desktop: Horizontal layout
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <TabsList className="bg-card/50 p-0.5 flex w-full" data-testid="view-tabs">
        <SortableContext items={tabOrder} strategy={horizontalListSortingStrategy}>
          {orderedTabs.map((tab) => {
            let badgeCount;
            let badgeColor;
            
            if (tab.id === "inbox") {
              badgeCount = inboxCount;
              badgeColor = "bg-primary/20 text-primary";
            } else if (tab.id === "completed") {
              badgeCount = completedCount;
              badgeColor = "bg-emerald-500/20 text-emerald-500";
            }

            return (
              <SortableTabTrigger
                key={tab.id}
                tab={tab}
                activeView={activeView}
                onNavigate={handleNavigate}
                badgeCount={badgeCount}
                badgeColor={badgeColor}
                draggedItem={draggedItem}
                isMobile={false}
              />
            );
          })}
        </SortableContext>
      </TabsList>
    </DndContext>
  );
}


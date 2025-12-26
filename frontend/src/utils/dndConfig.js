import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";

/**
 * Premium DnD configuration for consistent drag-and-drop experience
 */

// Premium sensor configuration: requires 300ms hold + 5px movement tolerance
// Note: This delay matches the progress ring animation duration in SortableTaskCard.
// The 300ms delay provides clear feedback before drag activates.
export const usePremiumSensors = () => {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 300,
        tolerance: 5,
      },
    })
  );
};

// Premium drop animation configuration
// Using a simple object that matches @dnd-kit/core's dropAnimation API
export const premiumDropAnimation = {
  duration: 200,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
};

// DragOverlay styling for premium feel
export const dragOverlayStyles = {
  transform: "scale(1.02)",
  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
  cursor: "grabbing",
};


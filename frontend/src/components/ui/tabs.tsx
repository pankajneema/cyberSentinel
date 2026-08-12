import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * Scrollable by default so an overflowing tab bar never silently hides
 * tabs off-screen with no indicator (customers never discovered them).
 * Fade edges + arrow buttons appear only when there's actually more to
 * scroll to, and the active tab is auto-scrolled into view on every
 * change (click, keyboard, or a parent driving `value` programmatically).
 */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, forwardedRef) => {
  // The scroll container is a plain div we own, never exposed via `className`.
  // Several pages pass `min-w-full`/`inline-flex` overrides on TabsList itself
  // (from the old per-page overflow-wrapper pattern) that make the list size
  // exactly to its own content — it never overflows *itself*, so measuring
  // scrollWidth/clientWidth on the List element is unreliable. Measuring on
  // this wrapper instead works regardless of what any page's className does.
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);

  const updateScrollState = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();

    el.addEventListener("scroll", updateScrollState, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);

    // Radix flips data-state on the active trigger for clicks, keyboard
    // nav, and parent-driven `value` changes alike — observing it here
    // is the one hook that catches all three without prop drilling. React
    // can reapply the same data-state value on unrelated re-renders, which
    // still fires the observer — track identity so a no-op mutation can't
    // yank the view back to the active tab while the user is mid-scroll.
    let lastActive: HTMLElement | null = el.querySelector<HTMLElement>('[data-state="active"]');
    const mutationObserver = new MutationObserver(() => {
      updateScrollState();
      const active = el.querySelector<HTMLElement>('[data-state="active"]');
      if (active && active !== lastActive) {
        lastActive = active;
        active.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
      }
    });
    mutationObserver.observe(el, { attributes: true, attributeFilter: ["data-state"], subtree: true });

    return () => {
      el.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [updateScrollState]);

  const scrollByStep = (direction: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: direction * 160, behavior: "smooth" });
  };

  return (
    <div className="relative min-w-0">
      {canScrollLeft && (
        <>
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-muted to-transparent rounded-l-md" />
          <button
            type="button"
            aria-label="Scroll tabs left"
            onClick={() => scrollByStep(-1)}
            className="absolute left-0.5 top-1/2 -translate-y-1/2 z-20 grid place-items-center w-6 h-6 rounded-full bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </>
      )}
      <div
        ref={scrollRef}
        className="overflow-x-auto scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <TabsPrimitive.List
          ref={forwardedRef}
          className={cn(
            "inline-flex h-10 w-max items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
            className,
          )}
          {...props}
        >
          {children}
        </TabsPrimitive.List>
      </div>
      {canScrollRight && (
        <>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-muted to-transparent rounded-r-md" />
          <button
            type="button"
            aria-label="Scroll tabs right"
            onClick={() => scrollByStep(1)}
            className="absolute right-0.5 top-1/2 -translate-y-1/2 z-20 grid place-items-center w-6 h-6 rounded-full bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, forceMount = true, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    forceMount={forceMount}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=inactive]:hidden",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };

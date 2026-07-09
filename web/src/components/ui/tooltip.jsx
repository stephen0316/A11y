import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils.js';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef(({ className, sideOffset = 8, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      side="top"
      sideOffset={sideOffset}
      className={cn(
        'tooltip-content z-[100] max-w-[320px] rounded-md border border-border bg-popover px-3 py-2 text-sm font-semibold leading-relaxed text-popover-foreground shadow-xl',
        className,
      )}
      {...props}
    >
      {children}
      <span className="tooltip-arrow" aria-hidden="true" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };

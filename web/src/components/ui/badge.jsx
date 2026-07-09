import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold', {
  variants: {
    variant: {
      default: 'bg-muted text-muted-foreground',
      blocker: 'bg-red-50 text-red-700',
      major: 'bg-amber-100 text-amber-800',
      minor: 'bg-blue-50 text-blue-700',
      suggestion: 'bg-violet-50 text-violet-700',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

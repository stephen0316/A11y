import * as React from 'react';
import { cn } from '../../lib/utils.js';

const Input = React.forwardRef(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-11 w-full rounded-md border border-input bg-white px-3 text-sm font-semibold text-foreground shadow-sm transition-colors placeholder:text-muted-foreground hover:border-slate-400 focus-visible:border-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export { Input };

import { cn } from './utils';

export function MultilineCn({ active }: { active: boolean }) {
  return (
    <button
      className={cn(
        'flex items-center',
        active && 'bg-gray-500',
        'p-4',
        'rounded-md',
      )}
    >
      Click
    </button>
  );
}

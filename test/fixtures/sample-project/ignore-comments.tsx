import { cn } from './utils';

// design-token-lint-ignore
const wrapperClass = cn('ring-offset-blue-500', 'flex');

export function IgnoreComments() {
  return (
    <div className={wrapperClass}>
      {/* design-token-lint-ignore */}
      <span className="p-4">Ignored violation</span>
      <span className="mt-8">Not ignored</span>
      {/* not a real ignore comment */}
      <span className="bg-gray-500">Also not ignored</span>
    </div>
  );
}

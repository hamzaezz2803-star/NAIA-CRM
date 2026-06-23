export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-9 w-64 animate-pulse rounded-md bg-stone-200" />
      <div className="h-24 animate-pulse rounded-lg bg-stone-100" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-36 animate-pulse rounded-lg bg-stone-100" />
        <div className="h-36 animate-pulse rounded-lg bg-stone-100" />
        <div className="h-36 animate-pulse rounded-lg bg-stone-100" />
      </div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded border border-dashed border-border px-4 py-6 text-center text-muted">
      {message}
    </p>
  );
}

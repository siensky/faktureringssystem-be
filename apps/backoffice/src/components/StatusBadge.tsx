const COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  credited: "bg-slate-100 text-slate-500",
  superseded: "bg-slate-100 text-slate-400",
  settled: "bg-slate-100 text-slate-700",
  none: "bg-slate-100 text-slate-500",
  queued: "bg-amber-100 text-amber-700",
  delivered: "bg-green-100 text-green-700",
  bounced: "bg-red-100 text-red-700",
  failed: "bg-red-100 text-red-700",
};

export function StatusBadge({ value }: { value: string }) {
  const className = COLORS[value] ?? "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {value}
    </span>
  );
}

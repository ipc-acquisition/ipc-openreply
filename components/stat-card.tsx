/**
 * Stat Card
 *
 * Metric panel with a mono label, a tabular value, and an optional trend,
 * following the Media Kit's metric badges.
 */

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
}

export default function StatCard({ label, value, trend, trendUp }: StatCardProps) {
  return (
    <div className="panel rounded-xl p-4 sm:p-5 transition-colors duration-150 hover:border-border-hover">
      <p className="eyebrow truncate">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {trend && (
        <p
          className={`tabular mt-2 inline-flex rounded px-1.5 py-0.5 text-xs ${
            trendUp ? "bg-success/10 text-success" : "bg-error/10 text-error"
          }`}
        >
          <span aria-hidden="true">{trendUp ? "▲" : "▼"}</span>&nbsp;{trend}
        </p>
      )}
    </div>
  );
}

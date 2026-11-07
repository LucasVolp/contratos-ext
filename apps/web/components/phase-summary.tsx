"use client";
/** A thin proportion bar for phase summaries; segments are drawn in order and empty ones are skipped. */
export function SegmentBar({
  label,
  segments,
}: {
  label: string;
  segments: Array<{ value: number; tone: "done" | "warn" | "rest" | "off" }>;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div className="phase-summary-bar segmented" role="img" aria-label={label}>
      {total > 0 &&
        segments
          .filter((segment) => segment.value > 0)
          .map((segment, index) => (
            <i
              key={index}
              className={segment.tone}
              style={{ width: `${(segment.value / total) * 100}%` }}
            />
          ))}
    </div>
  );
}

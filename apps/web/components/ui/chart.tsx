"use client";
import type { ComponentProps } from "react";
import { ResponsiveContainer } from "recharts";
import { clsx } from "clsx";

/** Adapted from shadcn/ui: shared responsive chart surface; application tokens own the palette. */
export function ChartContainer({
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  children: ComponentProps<typeof ResponsiveContainer>["children"];
}) {
  return (
    <div data-slot="chart" className={clsx("ui-chart", className)} {...props}>
      <ResponsiveContainer initialDimension={{ width: 320, height: 260 }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption, EChartsType } from "echarts";

type EChartProps = {
  option: EChartsOption;
  className?: string;
  style?: CSSProperties;
};

export function EChart({ option, className, style }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const resize = () => chart.resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    window.addEventListener("resize", resize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={containerRef} className={className} style={style} />;
}

/**
 * NetWorthTrendChart — reusable net worth trend line chart.
 * Extracted from Dashboard and Reports to eliminate duplicated ECharts code.
 */
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { NET_WORTH_COLORS, NET_WORTH_AREA_GRADIENT } from '@shared/constants/chart-colors';

interface NetWorthRecord {
  date: string;
  net_worth: number;
  total_cash: number;
  total_investments: number;
}

interface Props {
  data: NetWorthRecord[];
  height?: number;
  /** Show x-axis date labels with rotation (default true) */
  showDateLabels?: boolean;
  /** Format dates as MM-DD instead of YYYY-MM-DD (default false) */
  shortDates?: boolean;
  /** Bottom padding for legend (default 35) */
  legendBottom?: number;
}

export function NetWorthTrendChart({
  data,
  height = 320,
  showDateLabels = true,
  shortDates = false,
  legendBottom = 35,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;
    const chart = echarts.init(chartRef.current);

    const dates = data.map((r) => r.date);
    const nwValues = data.map((r) => r.net_worth);
    const cashValues = data.map((r) => r.total_cash);
    const invValues = data.map((r) => r.total_investments);

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          let html = `<b>${params[0].axisValue}</b><br/>`;
          params.forEach((p: any) => {
            html += `${p.marker} ${p.seriesName}: ¥ ${p.value.toLocaleString()}<br/>`;
          });
          return html;
        },
      },
      legend: { data: ['净资产', '现金', '投资'], bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: `${legendBottom}px`, top: '10px', containLabel: true },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: showDateLabels ? {
          fontSize: shortDates ? 10 : 11,
          rotate: shortDates ? 30 : 0,
          formatter: shortDates ? (v: string) => v.slice(5) : undefined,
        } : { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + '万' },
        splitLine: { lineStyle: { color: '#f0f0f0' } },
      },
      series: [
        {
          name: '净资产', type: 'line', data: nwValues, smooth: true,
          lineStyle: { color: NET_WORTH_COLORS.netWorth, width: 3 },
          itemStyle: { color: NET_WORTH_COLORS.netWorth },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [...NET_WORTH_AREA_GRADIENT]),
          },
        },
        {
          name: '现金', type: 'line', data: cashValues, smooth: true,
          lineStyle: { color: NET_WORTH_COLORS.cash, width: 1.5, type: 'dashed' },
          itemStyle: { color: NET_WORTH_COLORS.cash },
        },
        {
          name: '投资', type: 'line', data: invValues, smooth: true,
          lineStyle: { color: NET_WORTH_COLORS.investment, width: 1.5, type: 'dashed' },
          itemStyle: { color: NET_WORTH_COLORS.investment },
        },
      ],
    });

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => { chart.dispose(); window.removeEventListener('resize', handleResize); };
  }, [data, showDateLabels, shortDates, legendBottom]);

  return <div ref={chartRef} style={{ height: `${height}px` }} />;
}

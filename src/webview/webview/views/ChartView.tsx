import React, { useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { ViewProps } from './viewUtils';

/**
 * 图表视图：
 *  - 对象数组：以第一个字符串字段为 X 轴，所有数值字段为 Y 系列
 *  - 纯数字数组：索引为 X 轴，值为 Y
 *  - key=>数字 的对象：key 作为 X 轴
 */
export const ChartView: React.FC<ViewProps> = ({ data }) => {
  const parsed = useMemo(() => toChartData(data), [data]);

  if (!parsed) {
    return <div className="jr-empty">Chart view requires numeric array / record or object-array.</div>;
  }

  const { rows, xKey, series } = parsed;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h3 style={{ margin: '0 0 8px' }}>Bar</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey={xKey} />
            <YAxis />
            <Tooltip />
            <Legend />
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px' }}>Line</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey={xKey} />
            <YAxis />
            <Tooltip />
            <Legend />
            {series.map((s, i) => (
              <Line key={s} dataKey={s} stroke={PALETTE[i % PALETTE.length]} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const PALETTE = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1'];

function toChartData(data: unknown): { rows: any[]; xKey: string; series: string[] } | null {
  // number[] 
  if (Array.isArray(data) && data.every((x) => typeof x === 'number')) {
    return {
      rows: (data as number[]).map((v, i) => ({ index: i, value: v })),
      xKey: 'index',
      series: ['value'],
    };
  }
  // Record<string, number>
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length && entries.every(([, v]) => typeof v === 'number')) {
      return {
        rows: entries.map(([k, v]) => ({ name: k, value: v })),
        xKey: 'name',
        series: ['value'],
      };
    }
  }
  // Object[]
  if (Array.isArray(data) && data.length && data.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    const sample = data[0] as Record<string, unknown>;
    const keys = Object.keys(sample);
    const stringKey = keys.find((k) => typeof sample[k] === 'string') || keys[0];
    const numberKeys = keys.filter((k) => (data as any[]).every((r) => typeof r[k] === 'number'));
    if (numberKeys.length === 0) return null;
    return { rows: data as any[], xKey: stringKey, series: numberKeys };
  }
  return null;
}

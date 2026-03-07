import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Repeat2, AlertTriangle } from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend
} from 'recharts';
import { cn } from '../lib/utils';

// 리텐션율 → 셀 색상
function retentionColor(rate) {
    if (rate === 0)    return { bg: '#f8fafc', text: '#94a3b8' };
    if (rate <= 10)    return { bg: '#ede9fe', text: '#7c3aed' };
    if (rate <= 20)    return { bg: '#c4b5fd', text: '#5b21b6' };
    if (rate <= 35)    return { bg: '#a78bfa', text: '#4c1d95' };
    if (rate <= 50)    return { bg: '#7c3aed', text: '#ffffff' };
    if (rate <= 70)    return { bg: '#6d28d9', text: '#ffffff' };
    return                    { bg: '#4c1d95', text: '#ffffff' };
}

// Period 0(첫 구매월)은 항상 100% → 진한 indigo 고정
function cellStyle(rate, period) {
    if (period === 0) return { backgroundColor: '#4338ca', color: '#ffffff' };
    const { bg, text } = retentionColor(rate);
    return { backgroundColor: bg, color: text };
}

// 리텐션 커브 차트용 색상 팔레트
const LINE_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#f97316','#06b6d4'];

export default function Cohort({ period, customRange }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const getDates = () => {
        if (period === 'custom' && customRange?.start && customRange?.end)
            return { start: customRange.start, end: customRange.end };
        const end = new Date();
        const start = new Date();
        if (period !== 'today') {
            const offset = period === '90' ? 89 : (parseInt(period) || 89);
            start.setDate(end.getDate() - offset);
        }
        const fmt = d => d.toISOString().split('T')[0];
        return { start: fmt(start), end: fmt(end) };
    };

    useEffect(() => {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 60000);
        const load = async () => {
            setLoading(true); setError(null);
            const { start, end } = getDates();
            try {
                const res = await fetch(`/api/cohort?start_date=${start}&end_date=${end}`, { signal: controller.signal });
                if (!res.ok) throw new Error('서버 오류');
                setData(await res.json());
            } catch (e) {
                if (e.name !== 'AbortError') setError(e.message);
                else setError('로딩 시간 초과. 기간을 줄여 주세요.');
            } finally { clearTimeout(tid); setLoading(false); }
        };
        load();
        return () => { controller.abort(); clearTimeout(tid); };
    }, [period, customRange]);

    const { cohorts = [], max_periods = 0, avg_retention = [] } = data || {};

    if (loading && !data) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4" />
            <p className="text-slate-700 font-bold">코호트 분석 중...</p>
            <p className="text-slate-400 text-xs mt-1">첫 구매월 기준 재구매 리텐션 계산</p>
        </div>
    );
    if (error) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <AlertTriangle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-slate-800 font-bold mb-1">데이터를 불러오지 못했습니다</p>
            <p className="text-slate-400 text-xs">{error}</p>
        </div>
    );
    if (cohorts.length === 0) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <Users className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-slate-500 font-bold">분석 가능한 코호트 없음</p>
            <p className="text-slate-400 text-xs mt-1">회원 주문 데이터가 필요합니다</p>
        </div>
    );

    const totalMembers = cohorts.reduce((s, c) => s + c.size, 0);
    const m1Avg = avg_retention[1] ?? 0;
    const m2Avg = avg_retention[2] ?? 0;
    const bestCohort = cohorts.reduce(
        (best, c) => (c.cells[1]?.rate ?? 0) > (best.cells[1]?.rate ?? 0) ? c : best,
        cohorts[0]
    );

    // 리텐션 커브 데이터 (period 1~)
    const curveData = Array.from({ length: max_periods }, (_, i) => {
        const point = { period: `M${i + 1}` };
        cohorts.forEach(c => {
            point[c.label_short] = c.cells[i + 1]?.rate ?? null;
        });
        point['평균'] = avg_retention[i + 1] ?? null;
        return point;
    });

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">

            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: "코호트 수", value: `${cohorts.length}개월`, icon: Repeat2, color: "text-indigo-600", bg: "bg-indigo-50" },
                    { label: "분석 회원 수", value: `${totalMembers.toLocaleString()}명`, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
                    { label: "평균 1개월 리텐션", value: `${m1Avg}%`, icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-50" },
                    { label: "평균 2개월 리텐션", value: `${m2Avg}%`, icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
                ].map((k, i) => (
                    <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-start gap-4">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", k.bg)}>
                            <k.icon className={cn("w-5 h-5", k.color)} />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{k.label}</p>
                            <p className="text-xl font-bold text-slate-900">{k.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* 코호트 테이블 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900">코호트 리텐션 테이블</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                        첫 구매월(M0) 기준 이후 월별 재구매 고객 비율 · 색상이 진할수록 리텐션 높음
                    </p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50">
                                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">코호트</th>
                                <th className="px-3 py-3 text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">고객 수</th>
                                {Array.from({ length: max_periods + 1 }, (_, p) => (
                                    <th key={p} className="px-2 py-3 text-[10px] font-bold text-slate-500 uppercase text-center whitespace-nowrap">
                                        M{p}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {cohorts.map((cohort) => (
                                <tr key={cohort.label} className="hover:bg-slate-50/50">
                                    <td className="px-4 py-3 text-xs font-bold text-slate-700 whitespace-nowrap">
                                        {cohort.label}
                                    </td>
                                    <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">
                                        {cohort.size.toLocaleString()}명
                                    </td>
                                    {cohort.cells.map((cell) => (
                                        <td key={cell.period} className="px-1 py-2 text-center">
                                            <div
                                                className="mx-auto w-14 h-9 rounded-lg flex flex-col items-center justify-center transition-all"
                                                style={cellStyle(cell.rate, cell.period)}
                                            >
                                                <span className="text-[11px] font-black leading-none">{cell.rate}%</span>
                                                <span className="text-[8px] leading-none mt-0.5 opacity-80">{cell.count.toLocaleString()}</span>
                                            </div>
                                        </td>
                                    ))}
                                    {/* 빈 셀 패딩 (짧은 코호트용) */}
                                    {Array.from({ length: max_periods - cohort.cells.length + 1 }, (_, i) => (
                                        <td key={`empty-${i}`} className="px-1 py-2">
                                            <div className="mx-auto w-14 h-9 rounded-lg bg-slate-50" />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            {/* 평균 행 */}
                            <tr className="bg-slate-50/80 border-t-2 border-slate-200">
                                <td className="px-4 py-3 text-xs font-black text-slate-700">평균</td>
                                <td className="px-3 py-3 text-xs text-slate-400">-</td>
                                {avg_retention.map((rate, p) => (
                                    <td key={p} className="px-1 py-2 text-center">
                                        <div
                                            className="mx-auto w-14 h-9 rounded-lg flex items-center justify-center font-black text-[11px]"
                                            style={cellStyle(rate, p)}
                                        >
                                            {rate}%
                                        </div>
                                    </td>
                                ))}
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* 리텐션 커브 */}
            {curveData.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">코호트별 리텐션 커브</h3>
                    <p className="text-[10px] text-slate-400 mb-4">M1 이후 월별 재구매율 추이</p>
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={curveData} margin={{ left: -8, right: 16 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                            <YAxis
                                tickFormatter={v => `${v}%`}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                axisLine={false} tickLine={false}
                                domain={[0, 100]}
                            />
                            <Tooltip
                                formatter={(v, name) => v != null ? [`${v}%`, name] : ['—', name]}
                                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                            />
                            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                            {cohorts.map((c, i) => (
                                <Line
                                    key={c.label}
                                    type="monotone"
                                    dataKey={c.label_short}
                                    stroke={LINE_COLORS[i % LINE_COLORS.length]}
                                    strokeWidth={1.5}
                                    dot={{ r: 3 }}
                                    connectNulls={false}
                                />
                            ))}
                            <Line
                                type="monotone"
                                dataKey="평균"
                                stroke="#1e293b"
                                strokeWidth={2.5}
                                strokeDasharray="6 3"
                                dot={{ r: 4, fill: '#1e293b' }}
                                connectNulls={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

        </div>
    );
}

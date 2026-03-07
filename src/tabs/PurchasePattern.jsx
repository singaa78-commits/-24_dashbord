import React, { useState, useEffect, useMemo } from 'react';
import { Clock, Calendar, RefreshCw, Users, AlertTriangle } from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, AreaChart, Area, Cell
} from 'recharts';
import { cn } from '../lib/utils';

const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i}시`);

// 히트맵 셀 색상 (0~max 사이 indigo 강도)
function heatColor(val, max) {
    if (max === 0) return '#f8fafc';
    const t = val / max;
    if (t === 0) return '#f8fafc';
    if (t < 0.2)  return '#e0e7ff';
    if (t < 0.4)  return '#a5b4fc';
    if (t < 0.6)  return '#818cf8';
    if (t < 0.8)  return '#6366f1';
    return '#4338ca';
}

function Heatmap({ heatmap }) {
    const max = useMemo(() => Math.max(...heatmap.flatMap(r => r)), [heatmap]);
    return (
        <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
                {/* 요일 헤더 */}
                <div className="flex ml-10 mb-1">
                    {WEEKDAY_LABELS.map((d, i) => (
                        <div key={i} className={cn(
                            "flex-1 text-center text-[10px] font-bold",
                            i >= 5 ? "text-indigo-400" : "text-slate-500"
                        )}>
                            {d}
                        </div>
                    ))}
                </div>
                {/* 시간 × 요일 행 */}
                {heatmap.map((row, h) => (
                    <div key={h} className="flex items-center mb-0.5">
                        <div className="w-9 text-right pr-1.5 text-[9px] text-slate-400 font-medium flex-shrink-0">
                            {h % 3 === 0 ? `${h}시` : ''}
                        </div>
                        {row.map((val, d) => (
                            <div
                                key={d}
                                title={`${WEEKDAY_LABELS[d]} ${h}시 · ${val.toLocaleString()}건`}
                                className="flex-1 h-4 rounded-sm mx-0.5 transition-all cursor-default"
                                style={{ backgroundColor: heatColor(val, max) }}
                            />
                        ))}
                    </div>
                ))}
                {/* 범례 */}
                <div className="flex items-center justify-end gap-1 mt-2 ml-10">
                    <span className="text-[9px] text-slate-400">적음</span>
                    {['#e0e7ff', '#a5b4fc', '#818cf8', '#6366f1', '#4338ca'].map(c => (
                        <div key={c} className="w-4 h-3 rounded-sm" style={{ backgroundColor: c }} />
                    ))}
                    <span className="text-[9px] text-slate-400">많음</span>
                </div>
            </div>
        </div>
    );
}

export default function PurchasePattern({ period, customRange }) {
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
                const res = await fetch(`/api/purchase-pattern?start_date=${start}&end_date=${end}`, { signal: controller.signal });
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

    const { heatmap = [], by_hour = [], by_weekday = [], monthly_trend = [], interval_hist = [], summary = {} } = data || {};

    if (loading && !data) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4" />
            <p className="text-slate-700 font-bold">구매 패턴 분석 중...</p>
            <p className="text-slate-400 text-xs mt-1">주문 시간대 · 요일 · 재구매 간격 분석</p>
        </div>
    );
    if (error) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <AlertTriangle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-slate-800 font-bold mb-1">데이터를 불러오지 못했습니다</p>
            <p className="text-slate-400 text-xs">{error}</p>
        </div>
    );

    const repeatRate = summary.total_customers > 0
        ? Math.round(summary.repeat_customers / summary.total_customers * 100)
        : 0;

    const peakHourData = by_hour.length > 0 ? by_hour.reduce((a, b) => b.count > a.count ? b : a, by_hour[0]) : null;
    const peakDayData  = by_weekday.length > 0 ? by_weekday.reduce((a, b) => b.count > a.count ? b : a, by_weekday[0]) : null;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">

            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: "최다 주문 요일", value: summary.peak_day ? `${summary.peak_day}요일` : '-', icon: Calendar, color: "text-indigo-600", bg: "bg-indigo-50" },
                    { label: "최다 주문 시간대", value: summary.peak_hour != null ? `${summary.peak_hour}시` : '-', icon: Clock, color: "text-blue-600", bg: "bg-blue-50" },
                    { label: "평균 재구매 간격", value: summary.avg_interval ? `${summary.avg_interval}일` : '-', icon: RefreshCw, color: "text-violet-600", bg: "bg-violet-50" },
                    { label: "재구매 고객 비율", value: `${repeatRate}%`, icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
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

            {/* 요일별 + 시간대별 */}
            <div className="grid grid-cols-2 gap-6">
                {/* 요일별 주문 수 */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">요일별 주문 건수</h3>
                    <p className="text-[10px] text-slate-400 mb-4">월~일 분포</p>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={by_weekday} margin={{ left: -16, right: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                            <Tooltip
                                formatter={(v, name) => [
                                    name === 'count' ? `${v.toLocaleString()}건` : `₩${v.toLocaleString()}`,
                                    name === 'count' ? '주문 수' : '매출'
                                ]}
                                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                            />
                            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={36}>
                                {by_weekday.map((d, i) => (
                                    <Cell key={i} fill={
                                        peakDayData && d.day === peakDayData.day ? '#6366f1' :
                                        i >= 5 ? '#a5b4fc' : '#c7d2fe'
                                    } />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* 시간대별 주문 수 */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">시간대별 주문 건수</h3>
                    <p className="text-[10px] text-slate-400 mb-4">0~23시 분포</p>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={by_hour} margin={{ left: -16, right: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis
                                dataKey="hour"
                                tickFormatter={h => h % 6 === 0 ? `${h}시` : ''}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                axisLine={false} tickLine={false}
                            />
                            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                            <Tooltip
                                formatter={(v) => [`${v.toLocaleString()}건`, '주문 수']}
                                labelFormatter={h => `${h}시`}
                                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                            />
                            <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={18}>
                                {by_hour.map((d, i) => (
                                    <Cell key={i} fill={
                                        peakHourData && d.hour === peakHourData.hour ? '#6366f1' : '#c7d2fe'
                                    } />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* 히트맵 */}
            {heatmap.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">시간대 × 요일 히트맵</h3>
                    <p className="text-[10px] text-slate-400 mb-5">주문이 집중되는 시간대를 색상 강도로 표시</p>
                    <Heatmap heatmap={heatmap} />
                </div>
            )}

            {/* 월별 추이 + 재구매 간격 */}
            <div className="grid grid-cols-2 gap-6">
                {/* 월별 주문 추이 */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">월별 주문 추이</h3>
                    <p className="text-[10px] text-slate-400 mb-4">기간 내 월별 건수 · 매출</p>
                    {monthly_trend.length === 0 ? (
                        <p className="text-center text-slate-400 text-sm py-16">데이터 없음</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={220}>
                            <AreaChart data={monthly_trend} margin={{ left: -16, right: 8 }}>
                                <defs>
                                    <linearGradient id="monthGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    formatter={(v, name) => [
                                        name === 'count' ? `${v.toLocaleString()}건` : `₩${v.toLocaleString()}`,
                                        name === 'count' ? '주문 수' : '매출'
                                    ]}
                                    contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                                />
                                <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#monthGrad)" dot={{ r: 3, fill: '#6366f1' }} />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* 재구매 간격 히스토그램 */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">재구매 간격 분포</h3>
                    <p className="text-[10px] text-slate-400 mb-4">
                        첫 구매 이후 다음 구매까지 소요 기간 · 평균 <span className="font-bold text-indigo-600">{summary.avg_interval || 0}일</span>
                    </p>
                    {interval_hist.every(b => b.count === 0) ? (
                        <p className="text-center text-slate-400 text-sm py-16">재구매 데이터 없음</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={interval_hist} margin={{ left: -16, right: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    formatter={(v) => [`${v.toLocaleString()}건`, '재구매 횟수']}
                                    contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                                />
                                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
                                    {interval_hist.map((_, i) => (
                                        <Cell key={i} fill={['#6366f1','#818cf8','#a5b4fc','#c7d2fe','#ddd6fe','#ede9fe'][i]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

        </div>
    );
}

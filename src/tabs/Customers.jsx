import React, { useState, useEffect } from 'react';
import { Users, TrendingUp, Clock, ShoppingCart, AlertTriangle, Crown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { cn } from '../lib/utils';

const SEGMENT_META = {
    "Champions":    { label: "VIP 챔피언",  color: "#6366f1", bg: "bg-indigo-50",  text: "text-indigo-700",  desc: "최근, 자주, 많이 구매하는 최상위 고객" },
    "Loyal":        { label: "충성 고객",    color: "#3b82f6", bg: "bg-blue-50",    text: "text-blue-700",    desc: "자주 구매하며 브랜드 충성도 높음" },
    "New Customer": { label: "신규 고객",    color: "#10b981", bg: "bg-emerald-50", text: "text-emerald-700", desc: "최근에 첫 구매한 잠재 우량 고객" },
    "Potential":    { label: "잠재 고객",    color: "#8b5cf6", bg: "bg-violet-50",  text: "text-violet-700",  desc: "최근 구매했으나 아직 빈도 낮음" },
    "At Risk":      { label: "위험 고객",    color: "#f59e0b", bg: "bg-amber-50",   text: "text-amber-700",   desc: "구매 빈도 있으나 최근 방문 없음" },
    "Can't Lose":   { label: "이탈 위기",    color: "#f97316", bg: "bg-orange-50",  text: "text-orange-700",  desc: "우량 고객이었으나 오랫동안 미구매" },
    "Hibernating":  { label: "휴면 고객",    color: "#94a3b8", bg: "bg-slate-50",   text: "text-slate-600",   desc: "최근성·빈도 모두 낮음" },
    "Lost":         { label: "이탈 고객",    color: "#ef4444", bg: "bg-red-50",     text: "text-red-600",     desc: "오랫동안 구매 이력 없음" },
};

const ScoreDot = ({ score }) => {
    const colors = ['', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-blue-400', 'bg-indigo-500'];
    return (
        <div className="flex gap-0.5">
            {[1,2,3,4,5].map(i => (
                <div key={i} className={cn("w-2 h-2 rounded-full", i <= score ? colors[score] : 'bg-slate-200')} />
            ))}
        </div>
    );
};

export default function Customers({ period, customRange }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeSegment, setActiveSegment] = useState(null);

    const getDates = () => {
        if (period === 'custom' && customRange?.start && customRange?.end)
            return { start: customRange.start, end: customRange.end };
        const end = new Date();
        const start = new Date();
        if (period !== 'today') {
            const offset = period === '90' ? 89 : (parseInt(period) || 89); // Cafe24 90-day hard limit
            start.setDate(end.getDate() - offset);
        }
        const fmt = (d) => d.toISOString().split('T')[0];
        return { start: fmt(start), end: fmt(end) };
    };

    useEffect(() => {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 60000);
        const load = async () => {
            setLoading(true); setError(null);
            const { start, end } = getDates();
            try {
                const res = await fetch(`/api/rfm?start_date=${start}&end_date=${end}`, { signal: controller.signal });
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

    const { summary = {}, segments = [], customers = [] } = data || {};

    const filteredCustomers = activeSegment
        ? customers.filter(c => c.segment === activeSegment)
        : customers;

    const chartData = segments.map(s => ({
        name: SEGMENT_META[s.id]?.label || s.id,
        count: s.count,
        color: SEGMENT_META[s.id]?.color || '#94a3b8',
    }));

    if (loading && !data) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4" />
            <p className="text-slate-700 font-bold">고객 데이터 분석 중...</p>
            <p className="text-slate-400 text-xs mt-1">주문 이력 기반 RFM 분석</p>
        </div>
    );
    if (error) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <AlertTriangle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-slate-800 font-bold mb-1">데이터를 불러오지 못했습니다</p>
            <p className="text-slate-400 text-xs">{error}</p>
        </div>
    );

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">

            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: "분석 고객 수", value: `${(summary.total_customers||0).toLocaleString()}명`, icon: Users, color: "text-indigo-600", bg: "bg-indigo-50" },
                    { label: "평균 최근 구매", value: `${summary.avg_recency||0}일 전`, icon: Clock, color: "text-blue-600", bg: "bg-blue-50" },
                    { label: "평균 주문 횟수", value: `${summary.avg_frequency||0}회`, icon: ShoppingCart, color: "text-violet-600", bg: "bg-violet-50" },
                    { label: "평균 구매액 (LTV)", value: `₩${(summary.avg_monetary||0).toLocaleString()}`, icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
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

            {/* Segment Cards + Bar Chart */}
            <div className="grid grid-cols-3 gap-6">
                {/* Segment Cards */}
                <div className="col-span-2 grid grid-cols-4 gap-3">
                    {segments.map((seg) => {
                        const meta = SEGMENT_META[seg.id] || {};
                        const isActive = activeSegment === seg.id;
                        return (
                            <button
                                key={seg.id}
                                onClick={() => setActiveSegment(isActive ? null : seg.id)}
                                className={cn(
                                    "text-left p-4 rounded-2xl border-2 transition-all",
                                    isActive
                                        ? "border-indigo-400 shadow-md shadow-indigo-100"
                                        : "border-transparent bg-white hover:border-slate-200 shadow-sm"
                                )}
                                style={{ borderColor: isActive ? meta.color : undefined }}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span
                                        className="text-[9px] font-black px-1.5 py-0.5 rounded text-white"
                                        style={{ backgroundColor: meta.color }}
                                    >
                                        {seg.pct}%
                                    </span>
                                    {seg.id === 'Champions' && <Crown className="w-3.5 h-3.5 text-indigo-400" />}
                                </div>
                                <p className="text-lg font-black text-slate-900">{seg.count.toLocaleString()}<span className="text-xs font-medium text-slate-400 ml-0.5">명</span></p>
                                <p className={cn("text-[11px] font-bold mt-0.5", meta.text)}>{meta.label}</p>
                                <p className="text-[9px] text-slate-400 mt-1 leading-tight line-clamp-2">{meta.desc}</p>
                                <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-[9px] text-slate-400 font-medium">
                                    <span>F {seg.avg_frequency}회</span>
                                    <span>₩{(seg.avg_monetary/1000).toFixed(0)}K</span>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Bar Chart */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-sm font-bold text-slate-900 mb-1">세그먼트 분포</h3>
                    <p className="text-[10px] text-slate-400 mb-4">고객 수 기준</p>
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 16 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={62} />
                            <Tooltip
                                formatter={(v) => [`${v.toLocaleString()}명`, '고객 수']}
                                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                            />
                            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}>
                                {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Customer Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">
                            {activeSegment ? `${SEGMENT_META[activeSegment]?.label} 고객 목록` : '상위 고객 목록'}
                        </h3>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                            {activeSegment ? '세그먼트 클릭으로 필터 해제' : '총 구매액 기준 상위 50명 · 세그먼트 카드 클릭으로 필터링'}
                        </p>
                    </div>
                    {activeSegment && (
                        <button onClick={() => setActiveSegment(null)} className="text-xs font-bold text-indigo-600 hover:underline">
                            필터 해제
                        </button>
                    )}
                </div>
                {filteredCustomers.length === 0 ? (
                    <p className="p-12 text-center text-slate-400 text-sm">데이터가 없습니다.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50">
                                <tr>
                                    {['#', '고객', '최근 구매', '주문 수', '총 구매액', 'R', 'F', 'M', '세그먼트'].map(h => (
                                        <th key={h} className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredCustomers.map((c, i) => {
                                    const meta = SEGMENT_META[c.segment] || {};
                                    return (
                                        <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-4 py-3 text-[10px] font-bold text-slate-400">{i + 1}</td>
                                            <td className="px-4 py-3">
                                                <p className="text-xs font-bold text-slate-800">{c.name || c.id}</p>
                                                <p className="text-[9px] text-slate-400 font-mono">{c.id}</p>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-600">{c.recency}일 전</td>
                                            <td className="px-4 py-3 text-xs font-bold text-slate-900">{c.frequency}회</td>
                                            <td className="px-4 py-3 text-xs font-bold text-indigo-600">₩{c.monetary.toLocaleString()}</td>
                                            <td className="px-4 py-3"><ScoreDot score={c.r_score} /></td>
                                            <td className="px-4 py-3"><ScoreDot score={c.f_score} /></td>
                                            <td className="px-4 py-3"><ScoreDot score={c.m_score} /></td>
                                            <td className="px-4 py-3">
                                                <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", meta.bg, meta.text)}>
                                                    {meta.label || c.segment}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

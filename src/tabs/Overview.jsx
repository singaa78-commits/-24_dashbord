import React, { useState, useEffect } from 'react';
import {
    ComposedChart, Area, Bar, Line,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
    AlertCircle, Loader2, ArrowRight, BarChart3, ArrowUpRight
} from 'lucide-react';
import { cn } from '../lib/utils';

// ── 섹션 헤더 보드 ──────────────────────────────────────
function Board({ title, color, children }) {
    const border = { blue: 'border-blue-200', green: 'border-emerald-200', purple: 'border-violet-200' }[color];
    const header = { blue: 'bg-blue-600', green: 'bg-emerald-600', purple: 'bg-violet-600' }[color];
    return (
        <div className={`rounded-2xl border ${border} overflow-hidden`}>
            <div className={`${header} px-5 py-2.5`}>
                <span className="text-[11px] font-black tracking-widest uppercase text-white">{title}</span>
            </div>
            <div className="p-4 bg-white">{children}</div>
        </div>
    );
}

// ── KPI 미니 카드 ────────────────────────────────────────
function MiniKPI({ label, value, sub, color }) {
    const colors = {
        blue:    { icon: 'text-blue-500',    bg: 'bg-blue-50' },
        green:   { icon: 'text-emerald-500', bg: 'bg-emerald-50' },
        purple:  { icon: 'text-violet-500',  bg: 'bg-violet-50' },
        indigo:  { icon: 'text-indigo-500',  bg: 'bg-indigo-50' },
    }[color] || { icon: 'text-slate-500', bg: 'bg-slate-50' };
    return (
        <div className={`${colors.bg} rounded-xl p-4`}>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
            <p className="text-xl font-black text-slate-900">{value}</p>
            {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
        </div>
    );
}

// ── 재구매율 카드 ────────────────────────────────────────
function RepurchaseCard({ days, rate }) {
    const isNull = rate === null || rate === undefined;
    return (
        <div className="bg-violet-50 rounded-xl p-4 text-center">
            <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wider mb-2">{days}일 재구매율</p>
            {isNull
                ? <p className="text-sm font-bold text-slate-400">기간 부족</p>
                : <>
                    <p className="text-2xl font-black text-violet-700">{rate}%</p>
                    <div className="mt-2 h-1.5 bg-violet-100 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(rate, 100)}%` }} />
                    </div>
                </>
            }
        </div>
    );
}

export default function Overview({ period, customRange }) {
    const [data, setData]         = useState(null);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState(null);
    const [trendMode, setTrendMode] = useState('daily');

    const getDates = (p) => {
        if (p === 'custom' && customRange?.start && customRange?.end)
            return { start: customRange.start, end: customRange.end };
        const end = new Date(), start = new Date();
        if (p !== 'today') {
            const offset = p === '90' ? 89 : parseInt(p);
            start.setDate(end.getDate() - offset);
        }
        const fmt = d => d.toISOString().split('T')[0];
        return { start: fmt(start), end: fmt(end) };
    };

    useEffect(() => {
        const load = async () => {
            const { start, end } = getDates(period);
            setLoading(true); setError(null);
            try {
                const res = await fetch(`/api/overview-data?start_date=${start}&end_date=${end}`);
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
                setData(await res.json());
            } catch (e) {
                setError(e.message === 'Failed to fetch' ? '서버 연결 실패' : e.message);
            } finally { setLoading(false); }
        };
        load();
    }, [period, customRange]);

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-40">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
            <p className="text-slate-500 font-medium animate-pulse">카페24 데이터를 실시간 분석 중...</p>
        </div>
    );
    if (error) return (
        <div className="p-6 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-3 text-rose-600">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="font-medium">{error}</p>
        </div>
    );

    const kpi = data?.kpi || {};
    const trendData = trendMode === 'weekly'  ? data?.weekly_trend || []
                    : trendMode === 'monthly' ? data?.monthly_trend || []
                    : data?.daily_trend || [];
    const newVsRepeat   = data?.new_vs_repeat || [];
    const repPeriods    = data?.repurchase_periods || {};
    const funnel        = data?.funnel || [];

    return (
        <div className="space-y-6 animate-in fade-in duration-700">

            {/* ── 1-2 매출 성장 보드 ─────────────────────── */}
            <Board title="Sales Growth · 매출 성장 보드" color="blue">
                <div className="grid grid-cols-4 gap-3">
                    <MiniKPI label="총매출 (REVENUE)"   value={`₩${(kpi.revenue||0).toLocaleString()}`}   sub="결제 완료 기준"           color="blue" />
                    <MiniKPI label="주문수 (ORDERS)"    value={`${(kpi.orders||0).toLocaleString()}건`}    sub="취소·반품 제외"           color="blue" />
                    <MiniKPI label="객단가 (AOV)"       value={`₩${(kpi.aov||0).toLocaleString()}`}       sub="총매출 ÷ 주문수"          color="blue" />
                    <MiniKPI label="신규 매출 비중"     value={`${kpi.new_revenue_ratio||0}%`}             sub={`₩${(kpi.new_revenue||0).toLocaleString()}`} color="blue" />
                </div>
            </Board>

            {/* ── 1-3 고객 성장 보드 ─────────────────────── */}
            <Board title="Customer Growth · 고객 성장 보드" color="green">
                <div className="grid grid-cols-4 gap-3">
                    <MiniKPI label="신규 고객수"        value={`${(kpi.new_customers||0).toLocaleString()}명`} sub="기간 내 첫 구매"  color="green" />
                    <MiniKPI label="재구매율 (RETENTION)" value={`${kpi.repurchase_rate||0}%`}              sub="2회+ 구매자 비율" color="green" />
                    <MiniKPI label="평균 구매 횟수"     value={`${kpi.avg_frequency||0}회`}                  sub="1인당 평균"       color="green" />
                    <MiniKPI label="LTV (기간 내)"      value={`₩${(kpi.ltv||0).toLocaleString()}`}          sub="고객 1인당 평균"  color="green" />
                </div>
            </Board>

            {/* ── 1-4 기간별 재구매율 ────────────────────── */}
            <Board title="Repurchase Rate by Period · 기간별 재구매율" color="purple">
                <div className="grid grid-cols-4 gap-3">
                    {[30, 60, 90, 120].map(d => (
                        <RepurchaseCard key={d} days={d} rate={repPeriods[String(d)]} />
                    ))}
                </div>
            </Board>

            {/* ── 1-5 매출 트렌드 + Insight ──────────────── */}
            <div className="grid grid-cols-3 gap-6">
                <div className="col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-base font-bold text-slate-900">매출 트렌드</h3>
                            <p className="text-[11px] text-slate-400">매출(左) · 주문수(右) 이중 Y축</p>
                        </div>
                        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
                            {[['daily','일별'],['weekly','주별'],['monthly','월별']].map(([k, l]) => (
                                <button key={k} onClick={() => setTrendMode(k)}
                                    className={cn('px-3 py-1 text-xs font-semibold rounded-md transition-all',
                                        trendMode === k ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'
                                    )}>{l}</button>
                            ))}
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height={300}>
                        <ComposedChart data={trendData} margin={{ left: 0, right: 0 }}>
                            <defs>
                                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="#4F46E5" stopOpacity={0.12} />
                                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis dataKey="label" axisLine={false} tickLine={false}
                                tick={{ fill: '#94a3b8', fontSize: 10 }}
                                interval={trendMode === 'daily' ? Math.max(0, Math.floor(trendData.length / 8) - 1) : 0}
                            />
                            <YAxis yAxisId="left"  axisLine={false} tickLine={false}
                                tick={{ fill: '#94a3b8', fontSize: 10 }}
                                tickFormatter={v => `₩${(v/1000000).toFixed(0)}M`}
                            />
                            <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false}
                                tick={{ fill: '#94a3b8', fontSize: 10 }}
                                tickFormatter={v => `${v}건`}
                            />
                            <Tooltip
                                contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.08)', fontSize: 11 }}
                                formatter={(v, name) => name === 'orders'
                                    ? [`${v.toLocaleString()}건`, '주문수']
                                    : [`₩${v.toLocaleString()}`, '매출']
                                }
                            />
                            <Area yAxisId="left" type="monotone" dataKey="revenue"
                                stroke="#4F46E5" strokeWidth={2}
                                fill="url(#revGrad)" dot={false} name="revenue"
                            />
                            <Line yAxisId="right" type="monotone" dataKey="orders"
                                stroke="#10b981" strokeWidth={2} dot={false} name="orders"
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* AI Insight */}
                <div className="bg-indigo-900 rounded-2xl p-6 text-white flex flex-col justify-between shadow-xl shadow-indigo-100 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <BarChart3 className="w-28 h-28" />
                    </div>
                    <div className="relative z-10">
                        <h3 className="text-base font-bold mb-5 flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-indigo-300" /> AI Insight Box
                        </h3>
                        <div className="space-y-4">
                            <div className="bg-white/10 p-3.5 rounded-xl border border-white/10">
                                <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1.5">Primary Alert</p>
                                <p className="text-xs leading-relaxed">
                                    🚨 신규 매출 비중 {kpi.new_revenue_ratio||0}% — 재구매 고객 확보를 위한 리텐션 캠페인이 필요합니다.
                                </p>
                            </div>
                            <div className="bg-white/10 p-3.5 rounded-xl border border-white/10">
                                <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1.5">Growth Opportunity</p>
                                <p className="text-xs leading-relaxed">
                                    📈 객단가(AOV) ₩{(kpi.aov||0).toLocaleString()} — 묶음 상품 구성으로 AOV 개선 여지가 있습니다.
                                </p>
                            </div>
                        </div>
                    </div>
                    <button className="mt-6 w-full py-2.5 bg-white text-indigo-900 rounded-xl font-bold text-sm hover:bg-indigo-50 transition-colors relative z-10 flex items-center justify-center gap-2">
                        <ArrowUpRight className="w-4 h-4" /> 상세 리포트
                    </button>
                </div>
            </div>

            {/* ── 1-6 신규 vs 재구매 추이 ────────────────── */}
            {newVsRepeat.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                    <h3 className="text-base font-bold text-slate-900 mb-1">신규 vs 재구매 고객 추이</h3>
                    <p className="text-[11px] text-slate-400 mb-4">월별 신규(파랑) · 재구매(초록) 고객 수 · 재구매 비중%(보라 선)</p>
                    <ResponsiveContainer width="100%" height={240}>
                        <ComposedChart data={newVsRepeat} margin={{ left: 0, right: 24 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                            <YAxis yAxisId="left"  axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                            <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false}
                                tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} domain={[0, 100]}
                            />
                            <Tooltip
                                contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 11 }}
                                formatter={(v, name) => {
                                    if (name === 'rate') return [`${v}%`, '재구매 비중'];
                                    if (name === 'new')    return [`${v}명`, '신규'];
                                    if (name === 'repeat') return [`${v}명`, '재구매'];
                                    return [v, name];
                                }}
                            />
                            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                                formatter={n => ({ new: '신규', repeat: '재구매', rate: '재구매 비중%' }[n] || n)}
                            />
                            <Bar yAxisId="left" dataKey="new"    stackId="a" fill="#3b82f6" radius={[0,0,0,0]} maxBarSize={48} name="new" />
                            <Bar yAxisId="left" dataKey="repeat" stackId="a" fill="#10b981" radius={[4,4,0,0]} maxBarSize={48} name="repeat" />
                            <Line yAxisId="right" type="monotone" dataKey="rate"
                                stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 4, fill: '#8b5cf6' }} name="rate"
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* ── 1-7 구매 퍼널 ──────────────────────────── */}
            {funnel.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                    <h3 className="text-base font-bold text-slate-900 mb-1">구매 퍼널 (Conversion Funnel)</h3>
                    <p className="text-[11px] text-slate-400 mb-6">
                        방문자·상품조회·장바구니는 Cafe24 Analytics 연동 시 측정 가능
                    </p>
                    <div className="flex items-stretch gap-0">
                        {funnel.map((step, i) => {
                            const prev = funnel[i - 1];
                            const conv = step.available && prev?.available && prev.count
                                ? Math.round(step.count / prev.count * 100) : null;
                            const maxCount = Math.max(...funnel.filter(s => s.available).map(s => s.count), 1);
                            const barH = step.available ? Math.max(20, Math.round(step.count / maxCount * 100)) : 20;

                            return (
                                <React.Fragment key={step.stage}>
                                    {i > 0 && (
                                        <div className="flex flex-col items-center justify-center px-2 gap-1 flex-shrink-0">
                                            <ArrowRight className="w-4 h-4 text-slate-300" />
                                            {conv && (
                                                <span className="text-[10px] font-black text-slate-500">{conv}%</span>
                                            )}
                                        </div>
                                    )}
                                    <div className="flex-1 flex flex-col items-center gap-2">
                                        {/* 막대 */}
                                        <div className="w-full flex items-end justify-center" style={{ height: 80 }}>
                                            <div
                                                className={cn(
                                                    'w-full max-w-[80px] rounded-t-lg transition-all',
                                                    step.available ? 'bg-indigo-500' : 'bg-slate-200'
                                                )}
                                                style={{ height: `${barH}%` }}
                                            />
                                        </div>
                                        {/* 수치 */}
                                        <p className={cn('text-base font-black', step.available ? 'text-indigo-700' : 'text-slate-400')}>
                                            {step.available ? step.count.toLocaleString() + '건' : '—'}
                                        </p>
                                        <p className="text-[11px] font-bold text-slate-600">{step.stage}</p>
                                        {!step.available && (
                                            <span className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">측정 불가</span>
                                        )}
                                    </div>
                                </React.Fragment>
                            );
                        })}
                    </div>
                    {/* 주문→결제 전환율 강조 */}
                    {funnel[3]?.available && funnel[4]?.available && funnel[3].count > 0 && (
                        <div className="mt-5 flex gap-4 justify-end">
                            <div className="bg-indigo-50 rounded-xl px-4 py-2 text-center">
                                <p className="text-[10px] text-indigo-500 font-bold">최종 결제 전환율</p>
                                <p className="text-xl font-black text-indigo-700">
                                    {Math.round(funnel[4].count / funnel[3].count * 100)}%
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}

        </div>
    );
}

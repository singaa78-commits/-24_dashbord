import React, { useState, useEffect } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Legend, AreaChart, Area
} from 'recharts';
import { AlertCircle, ArrowUpRight, Loader2, BarChart3 } from 'lucide-react';
import KPICard from '../components/KPICard';

export default function Overview({ period, customRange }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const getDates = (p) => {
        if (p === 'custom' && customRange?.start && customRange?.end) {
            return { start: customRange.start, end: customRange.end };
        }
        const end = new Date();
        const start = new Date();
        if (p === 'today') {
            // keep today
        } else {
            // Cafe24 API 90-day limit is strict. Use 89 for safety.
            const offset = (p === '90') ? 89 : parseInt(p);
            start.setDate(end.getDate() - offset);
        }
        const format = (d) => d.toISOString().split('T')[0];
        return { start: format(start), end: format(end) };
    };

    const isInvalidRange = (start, end) => {
        if (!start || !end) return false;
        const s = new Date(start);
        const e = new Date(end);
        const diff = (e - s) / (1000 * 60 * 60 * 24);
        return diff > 90 || diff < 0;
    };

    useEffect(() => {
        const fetchData = async () => {
            const { start, end } = getDates(period);

            if (period === 'custom' && isInvalidRange(start, end)) {
                setError("조회 기간은 최대 90일 이내로 설정 가능합니다.");
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);
            try {
                console.log(`[Fetch] Requesting overview data for ${start} ~ ${end}`);
                const res = await fetch(`/api/overview-data?start_date=${start}&end_date=${end}`);
                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error || `Server Error (${res.status})`);
                }
                const result = await res.json();
                console.log("[Fetch] Success:", result);
                setData(result);
            } catch (err) {
                console.error("[Fetch] Failed:", err);
                setError(err.message === "Failed to fetch"
                    ? "서버 연결에 실패했습니다. 인터넷 연결이나 서버 상태를 확인해주세요."
                    : err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [period, customRange]);

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-40">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
            <p className="text-slate-500 font-medium animate-pulse">카페24 데이터를 실시간 분석 중입니다...</p>
        </div>
    );

    if (error) return (
        <div className="p-6 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-3 text-rose-600">
            <AlertCircle className="w-5 h-5" />
            <p className="font-medium">데이터를 불러오지 못했습니다: {error}</p>
        </div>
    );

    const kpi = data?.kpi || {};
    const trendData = data?.seasonal?.monthly_trend || [];

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* KPI Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KPICard
                    title="총매출 (REVENUE)"
                    value={`₩${(kpi.revenue || 0).toLocaleString()}`}
                    trend={0}
                    category="blue"
                    subValue="결제 완료 기준"
                />
                <KPICard
                    title="주문수 (ORDERS)"
                    value={`${(kpi.orders || 0).toLocaleString()}건`}
                    category="blue"
                    subValue="취소/반품 제외"
                />
                <KPICard
                    title="신규 고객수"
                    value={`${(kpi.new_customers || 0).toLocaleString()}명`}
                    category="green"
                    subValue="기간 내 첫 구매"
                />
                <KPICard
                    title="재구매율"
                    value={`${(kpi.repurchase_rate || 0).toFixed(1)}%`}
                    category="green"
                    subValue="2회 이상 구매자 비율"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Chart */}
                <div className="lg:col-span-2 bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">매출 성장 트렌드</h3>
                            <p className="text-sm text-slate-500">
                                {period === 'custom'
                                    ? `${customRange.start} ~ ${customRange.end} 분석`
                                    : (period === 'today' ? '오늘 실시간' : `최근 ${period === '90' ? '3개월' : period === '30' ? '1개월' : period === '7' ? '1주일' : period + '일'} 내`)} 매출 및 성장 추이
                            </p>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold">
                            <ArrowUpRight className="w-4 h-4" />
                            라이브 데이터
                        </div>
                    </div>

                    <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trendData}>
                                <defs>
                                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                <XAxis
                                    dataKey="month"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#64748B', fontSize: 12 }}
                                    dy={10}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#64748B', fontSize: 12 }}
                                    tickFormatter={(value) => `₩${(value / 1000000).toFixed(0)}M`}
                                />
                                <Tooltip
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                    formatter={(value) => [`₩${value.toLocaleString()}`, '매출']}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="revenue"
                                    stroke="#4F46E5"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#colorRev)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Insight Box */}
                <div className="bg-indigo-900 rounded-2xl p-8 text-white flex flex-col justify-between shadow-xl shadow-indigo-100 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <BarChart3 className="w-32 h-32" />
                    </div>

                    <div className="relative z-10">
                        <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-indigo-300" />
                            AI Insight Box
                        </h3>

                        <div className="space-y-6">
                            <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/10">
                                <p className="text-xs font-bold text-indigo-200 uppercase tracking-widest mb-2">Primary Alert</p>
                                <p className="text-sm leading-relaxed">
                                    🚨 신규 매출 비중이 {(kpi.new_customers_ratio || 96).toFixed(1)}%로 매우 높습니다.
                                    대부분의 매출이 첫 구매자에게서 발생하고 있어, 고정 고객 확보를 위한 리텐션 캠페인이 시급합니다.
                                </p>
                            </div>

                            <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/10">
                                <p className="text-xs font-bold text-indigo-200 uppercase tracking-widest mb-2">Growth Opportunity</p>
                                <p className="text-sm leading-relaxed">
                                    📈 객단가(AOV)가 ₩{(kpi.aov || 0).toLocaleString()} 수준입니다.
                                    장바구니 쿠폰 혹은 묶음 상품 구성을 통해 AOV를 15% 이상 개선할 여지가 보입니다.
                                </p>
                            </div>
                        </div>
                    </div>

                    <button className="mt-8 w-full py-3 bg-white text-indigo-900 rounded-xl font-bold hover:bg-indigo-50 transition-colors relative z-10">
                        상세 리포트 보기
                    </button>
                </div>
            </div>
        </div>
    );
}

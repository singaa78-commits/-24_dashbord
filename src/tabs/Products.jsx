import React, { useState, useEffect } from 'react';
import { Search, TrendingUp, AlertTriangle, Layers, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area } from 'recharts';

const Products = ({ period, customRange }) => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [searchList, setSearchList] = useState([]);
    const [dateRange, setDateRange] = useState('');
    const [basketBaseProduct, setBasketBaseProduct] = useState(null);

    // Product tab range expansion (allowing up to 180 days)
    const getDates = () => {
        const end = new Date();
        const start = new Date();
        if (period === 'custom' && customRange?.start && customRange?.end) {
            // Enforce 180-day cap for custom
            const s = new Date(customRange.start);
            const e = new Date(customRange.end);
            const diff = Math.round((e - s) / 86400000);
            if (diff <= 180) {
                return { start: customRange.start, end: customRange.end };
            }
            // Clamp to last 180 days of the custom range
            const capped = new Date(e);
            capped.setDate(e.getDate() - 179);
            return { start: capped.toISOString().split('T')[0], end: customRange.end };
        }
        // Use 180 days as default or requested period (capped at 180)
        const days = period === 'today' ? 0 : Math.min(parseInt(period) || 179, 179);
        start.setDate(end.getDate() - days);
        const format = (d) => d.toISOString().split('T')[0];
        return { start: format(start), end: format(end) };
    };

    useEffect(() => {
        const fetchProductSearch = async () => {
            try {
                const res = await fetch(`/api/product-search?q=${encodeURIComponent(searchTerm)}`);
                const result = await res.json();
                setSearchList(result.products || []);
            } catch (e) {
                console.error("Search failed", e);
            }
        };
        const timer = setTimeout(fetchProductSearch, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    useEffect(() => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s hard timeout

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            const { start, end } = getDates();
            setDateRange(`${start} ~ ${end}`);
            try {
                const url = `/api/product-analysis?start_date=${start}&end_date=${end}` +
                    (selectedProduct ? `&product_name=${encodeURIComponent(selectedProduct)}` : '');
                const res = await fetch(url, { signal: controller.signal });
                if (!res.ok) throw new Error('서버 오류가 발생했습니다.');
                const result = await res.json();
                setData(result);
            } catch (err) {
                if (err.name === 'AbortError') {
                    setError('데이터 로딩 시간이 초과되었습니다. 더 짧은 기간을 선택해 주세요.');
                } else {
                    setError(err.message);
                }
            } finally {
                clearTimeout(timeoutId);
                setLoading(false);
            }
        };
        fetchData();
        return () => { controller.abort(); clearTimeout(timeoutId); };
    }, [period, customRange, selectedProduct]);

    // ── 모든 hooks / 파생값은 conditional return 이전에 ──
    const { products = [], basket = [], basket_by_product = {}, all_products = [], daily_trend = [], product_orders = {}, summary = {} } = data || {};

    // Initialize / reset basket base product when data loads
    useEffect(() => {
        if (all_products.length > 0) {
            setBasketBaseProduct(prev => (prev && all_products.includes(prev) ? prev : all_products[0]));
        }
    }, [all_products]);

    // Pairs for selected base product from precomputed per-product basket
    const basePairs = (basketBaseProduct && basket_by_product[basketBaseProduct]) || [];
    const baseOrderCount = product_orders[basketBaseProduct] || 1;

    const formatDate = (d) => d ? d.slice(5) : ''; // "2026-03-01" → "03-01"
    const formatRevenue = (v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v;

    if (loading && !data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                <p className="text-slate-700 font-bold">상품 데이터를 분석 중입니다...</p>
                {dateRange && <p className="text-slate-400 text-xs mt-1">조회 기간: {dateRange} (최대 180일)</p>}
                <p className="text-slate-400 text-xs mt-1">최초 수집 시 약 1~3분이 소요될 수 있습니다. (이후 즉시 로드)</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                </div>
                <p className="text-slate-800 font-bold mb-1">데이터를 불러오지 못했습니다</p>
                <p className="text-slate-400 text-xs">{error}</p>
            </div>
        );
    }

    const TrendChart = () => (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-bold text-slate-900">
                        {selectedProduct ? `'${selectedProduct.length > 20 ? selectedProduct.slice(0, 20) + '…' : selectedProduct}' 판매 추이` : '전체 상품 판매 추이'}
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{dateRange} · 일별 판매 수량 / 매출액</p>
                </div>
                <TrendingUp className="w-5 h-5 text-indigo-200" />
            </div>
            {daily_trend.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-sm">데이터가 없습니다.</div>
            ) : (
                <div className="p-6">
                    <ResponsiveContainer width="100%" height={220}>
                        <ComposedChart data={daily_trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                            <YAxis yAxisId="left" orientation="left" tickFormatter={(v) => v} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={30} />
                            <YAxis yAxisId="right" orientation="right" tickFormatter={formatRevenue} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={40} />
                            <Tooltip
                                formatter={(value, name) => name === 'revenue' ? [`₩${value.toLocaleString()}`, '매출액'] : [value, '판매 수량']}
                                labelFormatter={(label) => `날짜: ${label}`}
                                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                            />
                            <Bar yAxisId="left" dataKey="sales" fill="#c7d2fe" radius={[3, 3, 0, 0]} maxBarSize={24} name="sales" />
                            <Area yAxisId="right" type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} fill="url(#revenueGrad)" dot={false} name="revenue" />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );

    const renderMainContent = () => {
        if (loading) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-2xl border border-slate-200">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4"></div>
                    <p className="text-slate-700 font-bold text-sm">상품 데이터를 분석 중입니다...</p>
                    {dateRange && <p className="text-slate-400 text-xs mt-1">조회 기간: {dateRange} (최대 180일)</p>}
                    <p className="text-slate-400 text-xs mt-1">최초 수집 시 약 1~3분이 소요됩니다. (이후 즉시 로드)</p>
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-2xl border border-slate-200">
                    <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mb-4">
                        <AlertTriangle className="w-7 h-7 text-red-500" />
                    </div>
                    <p className="text-slate-800 font-bold mb-1">데이터를 불러오지 못했습니다</p>
                    <p className="text-slate-400 text-xs">{error}</p>
                </div>
            );
        }

        return (
            <div className="space-y-6">
                {/* Sales Trend Chart */}
                <TrendChart />

                {/* Stats Cards */}
                <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <p className="text-xs font-bold text-slate-500 mb-1">분석 상품 수</p>
                        <h3 className="text-2xl font-bold text-slate-900">{(summary.total_items || 0).toLocaleString()}개</h3>
                    </div>
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <p className="text-xs font-bold text-slate-500 mb-1">총 판매 수량</p>
                        <h3 className="text-2xl font-bold text-slate-900">{(summary.total_sales || 0).toLocaleString()}건</h3>
                    </div>
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <p className="text-xs font-bold text-slate-500 mb-1">최고 매출 품목</p>
                        <h3 className="text-sm font-bold text-indigo-600 line-clamp-2">{products[0]?.name || '-'}</h3>
                    </div>
                </div>

                {/* Sales Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-900">상품별 상세 성과</h3>
                        <span className="text-[10px] font-bold px-2 py-1 bg-slate-100 text-slate-500 rounded uppercase tracking-wider">Top 10 items</span>
                    </div>
                    {products.length === 0 ? (
                        <div className="p-12 text-center text-slate-400 text-sm">데이터가 없습니다.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase">상품명</th>
                                        <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase text-right">판매수량</th>
                                        <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase text-right">매출액</th>
                                        <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase text-center">환불율</th>
                                        <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase text-center">재구매율</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {products.map((p, i) => (
                                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-6 py-4 flex items-center gap-3">
                                                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400 flex-shrink-0">{i + 1}</div>
                                                <span className="text-xs font-bold text-slate-800 line-clamp-2">{p.name}</span>
                                            </td>
                                            <td className="px-6 py-4 text-right text-xs font-bold text-slate-900">{p.sales.toLocaleString()}</td>
                                            <td className="px-6 py-4 text-right text-xs font-bold text-indigo-600">₩{Math.round(p.revenue).toLocaleString()}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={cn("px-2 py-1 rounded-full text-[10px] font-bold", p.return_rate > 10 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600")}>
                                                    {p.return_rate}%
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className="text-xs font-bold text-slate-500">{p.repurchase_rate}%</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Basket Analysis */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    {/* Header */}
                    <div className="p-6 border-b border-slate-100">
                        <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="text-sm font-bold text-slate-900">연관 구매 분석</h3>
                            <span className="text-[10px] text-slate-400 font-medium">(Basket Analysis)</span>
                            <Layers className="w-4 h-4 text-slate-300 ml-auto" />
                        </div>
                        <p className="text-xs text-slate-400 font-medium">어떤 상품을 보고 계신가요? (기준 상품 선택)</p>
                    </div>

                    {basket.length === 0 ? (
                        <div className="p-12 text-center text-slate-400 text-sm">연관 구매 데이터가 없습니다.</div>
                    ) : (
                        <div className="p-6 space-y-6">
                            {/* Section A — 기준 상품 선택 드롭다운 */}
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-[10px] font-black text-white bg-indigo-500 px-2 py-0.5 rounded leading-tight">A</span>
                                    <span className="text-xs font-bold text-slate-700">상품 연관 구매</span>
                                </div>
                                <div className="relative">
                                    <select
                                        value={basketBaseProduct || ''}
                                        onChange={(e) => setBasketBaseProduct(e.target.value)}
                                        className="w-full appearance-none bg-white border-2 border-indigo-500 rounded-xl px-4 py-3 pr-10 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                                    >
                                        {all_products.map((p, i) => (
                                            <option key={i} value={p}>{p}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 pointer-events-none" />
                                </div>
                            </div>

                            {/* Section B — 연관 구매 많은 순서 */}
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-[10px] font-black text-white bg-slate-500 px-2 py-0.5 rounded leading-tight">B</span>
                                    <span className="text-xs font-bold text-slate-700">
                                        함께 구매한 상품 Top {basePairs.length} (확률순)
                                    </span>
                                </div>
                                {basePairs.length === 0 ? (
                                    <p className="text-xs text-slate-400 py-4 text-center">선택한 상품의 연관 데이터가 없습니다.</p>
                                ) : (
                                    <div className="space-y-5">
                                        {basePairs.map((pair, i) => {
                                            const prob = Math.min((pair.count / baseOrderCount) * 100, 100);
                                            return (
                                                <div key={i}>
                                                    <div className="flex items-center justify-between mb-1.5">
                                                        <span className="text-sm font-bold text-slate-700 flex-1 truncate pr-4">{pair.companion}</span>
                                                        <span className="text-sm font-bold text-indigo-600 flex-shrink-0">{prob.toFixed(1)}%</span>
                                                    </div>
                                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1">
                                                        <div
                                                            className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                                                            style={{ width: `${prob}%` }}
                                                        />
                                                    </div>
                                                    <p className="text-[10px] text-slate-400 text-right">{pair.count.toLocaleString()}회 함께 구매됨</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="flex gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Sidebar — always visible */}
            <div className="w-72 flex-shrink-0 flex flex-col gap-4">
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <Search className="w-4 h-4 text-indigo-600" />
                        상품 검색
                    </h3>
                    <div className="relative mb-4">
                        <input
                            type="text"
                            placeholder="상품명 입력..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    </div>
                    <div className="space-y-1 max-h-[420px] overflow-y-auto">
                        <button
                            onClick={() => setSelectedProduct(null)}
                            className={cn("w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all", !selectedProduct ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50")}
                        >
                            전체 상품 보기
                        </button>
                        {searchList.length === 0 && !searchTerm && (
                            <p className="text-[10px] text-slate-400 px-3 pt-2">상품 목록을 불러오는 중...</p>
                        )}
                        {searchList.map((p, i) => (
                            <button
                                key={i}
                                onClick={() => setSelectedProduct(p.name)}
                                className={cn("w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all", selectedProduct === p.name ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50")}
                            >
                                <span className="line-clamp-2">{p.name}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="bg-indigo-600 rounded-2xl p-5 text-white shadow-xl shadow-indigo-200">
                    <TrendingUp className="w-7 h-7 mb-3 opacity-80" />
                    <h4 className="text-sm font-bold mb-1">인사이트</h4>
                    <p className="text-indigo-100 text-xs leading-relaxed">
                        {selectedProduct
                            ? `'${selectedProduct.slice(0, 20)}...' 상품을 집중 분석 중입니다.`
                            : '판매 순위 기반 상위 10개 상품을 분석합니다.'}
                    </p>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
                {renderMainContent()}
            </div>
        </div>
    );
};

export default Products;

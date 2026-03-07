import React, { useState, useEffect } from 'react';
import { ShoppingCart, Search, TrendingUp, RefreshCcw, AlertTriangle, ArrowRight, Layers } from 'lucide-react';
import { cn } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';

const Products = ({ period, customRange }) => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [searchList, setSearchList] = useState([]);

    const getDates = () => {
        if (period === 'custom' && customRange?.start && customRange?.end) {
            return { start: customRange.start, end: customRange.end };
        }
        const end = new Date();
        const start = new Date();
        if (period === 'today') {
            // keep today
        } else {
            const offset = (period === '90') ? 89 : parseInt(period);
            start.setDate(end.getDate() - offset);
        }
        const format = (d) => d.toISOString().split('T')[0];
        return { start: format(start), end: format(end) };
    };

    useEffect(() => {
        const fetchProductSearch = async () => {
            try {
                const res = await fetch(`/api/product-search?q=${searchTerm}`);
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
        const fetchData = async () => {
            setLoading(true);
            const { start, end } = getDates();
            try {
                const url = `/api/product-analysis?start_date=${start}&end_date=${end}` +
                    (selectedProduct ? `&product_name=${encodeURIComponent(selectedProduct)}` : '');
                const res = await fetch(url);
                if (!res.ok) throw new Error('Failed to fetch data');
                const result = await res.json();
                setData(result);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [period, customRange, selectedProduct]);

    if (loading && !data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                <p className="text-slate-500 font-medium">상품 데이터를 분석 중입니다...</p>
            </div>
        );
    }

    const { products = [], basket = [], summary = {} } = data || {};

    return (
        <div className="flex gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Sidebar */}
            <div className="w-80 flex-shrink-0 flex flex-col gap-4">
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
                    <div className="space-y-1 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        <button
                            onClick={() => setSelectedProduct(null)}
                            className={cn(
                                "w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all",
                                !selectedProduct ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
                            )}
                        >
                            전체 상품 보기
                        </button>
                        {searchList.map((p, i) => (
                            <button
                                key={i}
                                onClick={() => setSelectedProduct(p.name)}
                                className={cn(
                                    "w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all truncate",
                                    selectedProduct === p.name ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"
                                )}
                            >
                                {p.name}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl shadow-indigo-200">
                    <TrendingUp className="w-8 h-8 mb-4 opacity-80" />
                    <h4 className="text-lg font-bold mb-1">인사이트</h4>
                    <p className="text-indigo-100 text-xs leading-relaxed">
                        {selectedProduct
                            ? `현재 '${selectedProduct}' 상품을 집중 분석하고 있습니다. 검색을 통해 다른 상품의 지표를 비교해 보세요.`
                            : "실시간 판매 순위 기반으로 매출 기여도가 높은 상품들을 필터링하고 있습니다."}
                    </p>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 space-y-6">
                {/* Stats Cards */}
                <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <p className="text-xs font-bold text-slate-500 mb-1">분석 상품 수</p>
                        <h3 className="text-2xl font-bold text-slate-900">{summary.total_items?.toLocaleString()}개</h3>
                    </div>
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <p className="text-xs font-bold text-slate-500 mb-1">총 판매 수량</p>
                        <h3 className="text-2xl font-bold text-slate-900">{summary.total_sales?.toLocaleString()}건</h3>
                    </div>
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <p className="text-xs font-bold text-slate-500 mb-1">최고 매출 품목</p>
                        <h3 className="text-lg font-bold text-indigo-600 truncate">{products[0]?.name || '-'}</h3>
                    </div>
                </div>

                {/* Sales Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-900">상품별 상세 성과</h3>
                        <span className="text-[10px] font-bold px-2 py-1 bg-slate-100 text-slate-500 rounded uppercase tracking-wider">Top 10 items</span>
                    </div>
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
                                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400">
                                                {i + 1}
                                            </div>
                                            <span className="text-xs font-bold text-slate-800 line-clamp-1">{p.name}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right text-xs font-bold text-slate-900">{p.sales.toLocaleString()}</td>
                                        <td className="px-6 py-4 text-right text-xs font-bold text-indigo-600">₩{p.revenue.toLocaleString()}</td>
                                        <td className="px-6 py-4 text-center">
                                            <span className={cn(
                                                "px-2 py-1 rounded-full text-[10px] font-bold",
                                                p.return_rate > 10 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
                                            )}>
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
                </div>

                {/* Basket Analysis */}
                <div className="grid grid-cols-2 gap-6">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900">함께 많이 구매한 상품</h3>
                                <p className="text-[10px] text-slate-500 mt-0.5 font-medium">장바구니 조합 분석 (Basket Affinity)</p>
                            </div>
                            <Layers className="w-5 h-5 text-indigo-200" />
                        </div>
                        <div className="space-y-3">
                            {basket.map((pair, i) => (
                                <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                    <div className="flex-1 min-w-0 flex items-center gap-4">
                                        <span className="text-xs font-bold text-slate-800 truncate block flex-1">{pair.p1}</span>
                                        <ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0" />
                                        <span className="text-xs font-bold text-slate-800 truncate block flex-1">{pair.p2}</span>
                                    </div>
                                    <div className="ml-4 px-2 py-1 bg-white border border-slate-200 rounded text-[10px] font-bold text-indigo-600">
                                        {pair.count}건
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-4">
                            <AlertTriangle className="w-8 h-8 text-amber-500" />
                        </div>
                        <h4 className="text-sm font-bold text-slate-900 mb-2">교차 판매 기회</h4>
                        <p className="text-xs text-slate-500 max-w-[240px] leading-relaxed font-medium mb-4">
                            왼쪽의 데이터는 같은 고객이 한 주문에서 동시에 구매한 상위 품목들입니다.
                            해당 상품들을 묶음 상품(Bundle)으로 구성하거나 추천 상품으로 설정해 보세요.
                        </p>
                        <button className="text-[10px] font-bold text-white bg-slate-900 px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors">
                            분석 보고서 다운로드
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Products;

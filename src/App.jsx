import React, { useState } from 'react';
import { LayoutDashboard, Users, ShoppingBag, Layers, BarChart3, Filter } from 'lucide-react';
import { cn } from './lib/utils';
import Overview from './tabs/Overview';
import Products from './tabs/Products';

const TABS = [
    { id: 'overview', label: '종합 분석', icon: LayoutDashboard },
    { id: 'customer', label: '고객/RFM', icon: Users },
    { id: 'product', label: '상품/장바구니', icon: ShoppingBag },
    { id: 'cohort', label: '코호트', icon: Layers },
    { id: 'pattern', label: '구매 패턴', icon: BarChart3 },
];

function App() {
    const [activeTab, setActiveTab] = useState('overview');
    const [period, setPeriod] = useState('90');
    const [customRange, setCustomRange] = useState({
        start: '',
        end: new Date().toISOString().split('T')[0]
    });
    const [showCustom, setShowCustom] = useState(false);

    const handlePeriodChange = (p) => {
        setPeriod(p);
        setShowCustom(false);
    };

    const renderTab = () => {
        const props = { period, customRange: period === 'custom' ? customRange : null };
        switch (activeTab) {
            case 'overview': return <Overview {...props} />;
            case 'product': return <Products {...props} />;
            default: return (
                <div className="flex flex-col items-center justify-center p-20 text-gray-400">
                    <div className="text-xl font-medium mb-2">{TABS.find(t => t.id === activeTab)?.label} 탭 준비 중</div>
                    <p>Phase 2 및 3에서 구현될 예정입니다.</p>
                </div>
            );
        }
    };

    return (
        <div className="min-h-screen bg-[#F8FAFC]">
            {/* Top Header */}
            <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
                <div className="max-w-[1600px] mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-200">
                            <BarChart3 className="text-white w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-900">Cafe24 Insight Engine</h1>
                            <p className="text-xs text-slate-500 font-medium">Growth Marketing Dashboard</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex items-center bg-slate-100 p-1 rounded-lg">
                            {['today', '7', '30', '90'].map((p) => (
                                <button
                                    key={p}
                                    onClick={() => handlePeriodChange(p)}
                                    className={cn(
                                        "px-4 py-1.5 text-xs font-semibold rounded-md transition-all",
                                        (period === p && !showCustom)
                                            ? "bg-white text-indigo-600 shadow-sm"
                                            : "text-slate-500 hover:text-slate-800"
                                    )}
                                >
                                    {p === 'today' ? '오늘' : `${p}일`}
                                </button>
                            ))}
                        </div>

                        {showCustom && (
                            <div className="flex items-center gap-2 bg-white border border-slate-200 p-1 rounded-lg shadow-sm animate-in fade-in zoom-in duration-200">
                                <input
                                    type="date"
                                    value={customRange.start}
                                    onChange={(e) => {
                                        setCustomRange(prev => ({ ...prev, start: e.target.value }));
                                        setPeriod('custom');
                                    }}
                                    className="text-xs font-medium text-slate-600 bg-transparent border-none focus:ring-0 px-2 cursor-pointer"
                                />
                                <span className="text-slate-300">~</span>
                                <input
                                    type="date"
                                    value={customRange.end}
                                    onChange={(e) => {
                                        setCustomRange(prev => ({ ...prev, end: e.target.value }));
                                        setPeriod('custom');
                                    }}
                                    className="text-xs font-medium text-slate-600 bg-transparent border-none focus:ring-0 px-2 cursor-pointer"
                                />
                            </div>
                        )}

                        <button
                            onClick={() => setShowCustom(!showCustom)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-md",
                                (showCustom || period === 'custom')
                                    ? "bg-indigo-600 text-white shadow-indigo-100"
                                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 shadow-none"
                            )}
                        >
                            <Filter className="w-4 h-4" />
                            {period === 'custom' ? '맞춤 기간' : '직접 입력'}
                        </button>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="max-w-[1600px] mx-auto px-6 overflow-x-auto scrollbar-hide">
                    <div className="flex gap-8">
                        {TABS.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        "flex items-center gap-2 py-4 border-b-2 font-semibold text-sm transition-all whitespace-nowrap",
                                        isActive
                                            ? "border-indigo-600 text-indigo-600"
                                            : "border-transparent text-slate-500 hover:text-slate-800"
                                    )}
                                >
                                    <Icon className={cn("w-4 h-4", isActive ? "text-indigo-600" : "text-slate-400")} />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-[1600px] mx-auto p-6 lg:p-8">
                {renderTab()}
            </main>
        </div>
    );
}

export default App;

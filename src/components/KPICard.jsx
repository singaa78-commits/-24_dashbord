import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../lib/utils';

export default function KPICard({ title, value, subValue, trend, category = 'blue' }) {
    const getColors = () => {
        switch (category) {
            case 'green': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
            case 'purple': return 'text-violet-600 bg-violet-50 border-violet-100';
            case 'orange': return 'text-orange-600 bg-orange-50 border-orange-100';
            default: return 'text-indigo-600 bg-indigo-50 border-indigo-100';
        }
    };

    return (
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-4">
                <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border", getColors())}>
                    {category === 'blue' ? 'Sales' : category === 'green' ? 'Customer' : 'Retention'}
                </span>
                {trend && (
                    <div className={cn(
                        "flex items-center gap-1 text-xs font-bold",
                        trend > 0 ? "text-emerald-500" : "text-rose-500"
                    )}>
                        {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {Math.abs(trend)}%
                    </div>
                )}
            </div>

            <div className="space-y-1">
                <h3 className="text-slate-500 text-sm font-medium">{title}</h3>
                <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-slate-900 tracking-tight">{value}</span>
                </div>
                {subValue && <p className="text-xs text-slate-400 font-medium">{subValue}</p>}
            </div>

            <div className="mt-4 h-1 w-full bg-slate-50 rounded-full overflow-hidden">
                <div
                    className={cn("h-full transition-all duration-1000",
                        category === 'green' ? "bg-emerald-500" : category === 'purple' ? "bg-violet-500" : "bg-indigo-500"
                    )}
                    style={{ width: '65%' }}
                />
            </div>
        </div>
    );
}

import random
import time
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse, JSONResponse, FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from auth import client
import uvicorn
from datetime import datetime, timedelta
import os


import json
import threading
import os

_FETCH_LOCK = threading.Lock()
_CACHE = {}
_CACHE_FILE = "orders_cache.json"

if os.path.exists(_CACHE_FILE):
    try:
        with open(_CACHE_FILE, "r") as f:
            _CACHE = json.load(f)
            print(f"[CACHE] Loaded {len(_CACHE)} cache entries from disk.")
    except Exception as e:
        print(f"[CACHE] Failed to load disk cache: {e}")

def fetch_all_orders(params: dict) -> list:
    """Cafe24 API는 최대 100건씩 페이지네이션. 전체 주문을 offset으로 모두 가져옴.
    429 Rate Limit 발생 시 최대 3회 재시도 (2초 대기).
    15000건 이상의 데이터 요청 시 422 에러 발생 대응."""
    cache_key = json.dumps(params, sort_keys=True)
    
    with _FETCH_LOCK:
        if cache_key in _CACHE:
            entry = _CACHE[cache_key]
            # 2 hours cache (7200s)
            if time.time() - entry["time"] < 7200:
                print(f"[CACHE HIT] Returning {len(entry['data'])} orders for params: {params}")
                return entry["data"]
                
        print(f"[FETCH START] Fetching orders with params: {params}")
        all_orders = []
        offset = 0
        per_page = 100
        base_params = {**params, "limit": per_page}
        while True:
            base_params["offset"] = offset
            for attempt in range(3):
                try:
                    data = client.call_api("orders", params=base_params)
                    break
                except Exception as e:
                    if "429" in str(e) and attempt < 2:
                        print(f"[RATE LIMIT] Hit rate limit on offset {offset}, retrying...")
                        time.sleep(2 ** attempt + 1)
                    elif "422" in str(e):
                        print(f"[API LIMIT] Max offset reached at {offset}. Stopping fetch gracefully.")
                        data = {"orders": []}
                        break
                    else:
                        raise
            
            batch = data.get("orders", [])
            all_orders.extend(batch)
            print(f"[FETCH BATCH] Received {len(batch)} orders at offset {offset}. Total: {len(all_orders)}")
            
            if len(batch) < per_page or offset >= 15000:
                break
            offset += per_page
            time.sleep(0.55)
            
        _CACHE[cache_key] = {"time": time.time(), "data": all_orders}
        try:
            with open(_CACHE_FILE, "w") as f:
                json.dump(_CACHE, f)
        except Exception as e:
            print(f"[CACHE ERROR] Could not save to disk: {e}")
            
        print(f"[FETCH COMPLETE] Finished fetching {len(all_orders)} total orders.")
        return all_orders


def order_revenue(order: dict) -> float:
    """관리자 결제합계 기준 주문 매출.
    = initial_order_amount.payment_amount + naver_point + initial_order_amount.points_spent_amount"""
    ioa = order.get("initial_order_amount") or {}
    initial_payment = float(ioa.get("payment_amount", 0) or 0)
    points_spent = float(ioa.get("points_spent_amount", 0) or 0)
    naver_point = float(order.get("naver_point", 0) or 0)
    return initial_payment + points_spent + naver_point


def paid_only(orders: list) -> list:
    """결제가 이루어진 주문 필터.
    카페24 관리자 '결제합계'는 취소/환불된 주문도 포함한 그로스 금액이므로,
    canceled 여부와 무관하게 paid=='T' 이거나 payment_amount>0인 주문을 포함."""
    return [
        o for o in orders
        if o.get("paid") in ("T", True)
        or float(o.get("payment_amount", 0) or 0) > 0
    ]


def parse_order_date(order_date_str: str) -> datetime:
    """KST(+09:00) 포함 ISO 형식의 order_date를 naive datetime으로 변환"""
    if "+" in order_date_str:
        return datetime.fromisoformat(order_date_str[:-6])
    return datetime.fromisoformat(order_date_str)

app = FastAPI(title="Cafe24 Growth Marketing Dashboard API")

# Update 1: Triggering reload for env change
# Setup CORS to allow the frontend to access the API if served separately
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files (dashboard.html, css, js if any) from the current directory
app.mount("/static", StaticFiles(directory="."), name="static")

@app.get("/")
def read_root():
    """Serve the dashboard HTML"""
    return FileResponse("dashboard.html")

@app.get("/dashboard.html")
def read_dashboard():
    """Serve the dashboard HTML"""
    return FileResponse("dashboard.html")

@app.get("/auth/login")
def login(request: Request):
    """Redirect to Cafe24 OAuth URL with localtunnel bypass"""
    url = client.get_authorize_url()
    # Adding meta refresh and header to bypass localtunnel warning
    content = f'<html><head><meta http-equiv="refresh" content="0;url={url}"></head><body>Redirecting to Cafe24...</body></html>'
    return HTMLResponse(content=content, headers={"Bypass-Tunnel-Reminder": "true"})

from fastapi.responses import HTMLResponse
from typing import Optional

@app.get("/callback")
def callback(code: Optional[str] = None, error: Optional[str] = None, error_description: Optional[str] = None):
    """Receive authorization code, fetch token and store it"""
    if error:
        return JSONResponse(status_code=400, content={"error": error, "description": error_description, "message": "Cafe24 returned an error during authorization. Did you use the identical Redirect URI?"})
    
    if not code:
        return JSONResponse(status_code=400, content={"error": "missing_code", "message": "Authorization code is missing from the request."})

    try:
        # Fetch token with auth code
        token_data = client.fetch_token(code)
        # Redirect back to the dashboard frontend hosted by this FastAPI server
        return RedirectResponse(url="/dashboard.html")
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": "token_fetch_failed", "details": str(e)})

@app.get("/api/debug/orders")
def debug_orders():
    """Debug endpoint to inspect raw order field names from Cafe24 API"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})

    try:
        orders_data = client.call_api("orders", params={
            "start_date": "2026-01-01",
            "end_date": "2026-03-03",
            "limit": 1
        })
        orders = orders_data.get('orders', [])
        if not orders:
            return {"message": "No orders found", "raw_response_keys": list(orders_data.keys()), "full_response": orders_data}

        # Return ALL fields of the first order so we can find the payment field
        first_order = orders[0]
        payment_fields = {k: v for k, v in first_order.items()
                          if any(x in k.lower() for x in ['amount', 'price', 'payment', 'total', 'money', 'member', 'billing', 'buyer', 'customer'])}
        status_fields = {k: first_order.get(k) for k in ('paid', 'canceled', 'order_date', 'first_order', 'order_place_name')}
        return {
            "all_keys": list(first_order.keys()),
            "status_fields": status_fields,
            "payment_related_fields": payment_fields
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e), "access_token_set": bool(client.access_token)})


@app.get("/api/debug/customers")
def debug_customers(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Test customers API to find correct params for new member count"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})

    today = datetime.now().strftime("%Y-%m-%d")
    s = start_date or today
    e = end_date or today
    results = {}

    tests = {
        "customers/count+join": ("customers/count", {"shop_no": 1, "join_start_date": s, "join_end_date": e}),
        "customers/count+created": ("customers/count", {"shop_no": 1, "created_start_date": s, "created_end_date": e}),
        "customers/count_only": ("customers/count", {"shop_no": 1}),
        "customers+member_type_p+join": ("customers", {"shop_no": 1, "member_type": "p", "join_start_date": s, "join_end_date": e, "limit": 10}),
        "customers+member_type_n+join": ("customers", {"shop_no": 1, "member_type": "n", "join_start_date": s, "join_end_date": e, "limit": 10}),
        "analytics/members": ("analytics/members", {"shop_no": 1, "start_date": s, "end_date": e}),
    }
    for label, (endpoint, params) in tests.items():
        try:
            data = client.call_api(endpoint, params=params)
            results[label] = {"response_keys": list(data.keys()), "data": data}
        except Exception as ex:
            results[label] = {"error": str(ex)}

    return {"date_range": {"start": s, "end": e}, "results": results}


@app.get("/api/debug/revenue")
def debug_revenue(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Compare different payment fields to find which matches admin 결제합계"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})

    try:
        today = datetime.now().strftime("%Y-%m-%d")
        s = start_date or today
        e = end_date or today
        orders = fetch_all_orders({"start_date": s, "end_date": e})
        paid_orders = paid_only(orders)

        def to_float(val):
            try:
                return float(val or 0) if val not in (None, "") else 0.0
            except (ValueError, TypeError):
                return 0.0

        def sum_nested(orders, key):
            total = {}
            for o in orders:
                block = o.get(key) or {}
                if isinstance(block, dict):
                    for k, v in block.items():
                        total[k] = total.get(k, 0.0) + to_float(v)
            return total

        actual_sums = sum_nested(paid_orders, "actual_order_amount")
        initial_sums = sum_nested(paid_orders, "initial_order_amount")

        p = sum(to_float(o.get("payment_amount")) for o in paid_orders)
        naver = sum(to_float(o.get("naver_point")) for o in paid_orders)

        # Try salesreport API (direct admin stats)
        salesreport = None
        try:
            sr = client.call_api("salesreport/daily", params={"start_date": s, "end_date": e})
            salesreport = sr
        except Exception as se:
            salesreport = {"error": str(se)}

        return {
            "order_count": len(paid_orders),
            "date_range": {"start": s, "end": e},
            "candidate_totals": {
                "payment_amount (top-level)": round(p),
                "payment + naver_point": round(p + naver),
                "actual.payment_amount": round(actual_sums.get("payment_amount", 0)),
                "actual.payment + points + credits": round(
                    actual_sums.get("payment_amount", 0)
                    + actual_sums.get("points_spent_amount", 0)
                    + actual_sums.get("credits_spent_amount", 0)
                ),
                "initial.payment_amount": round(initial_sums.get("payment_amount", 0)),
                "initial.payment + points + credits": round(
                    initial_sums.get("payment_amount", 0)
                    + initial_sums.get("points_spent_amount", 0)
                    + initial_sums.get("credits_spent_amount", 0)
                ),
                "initial.order_price + shipping - coupon": round(
                    initial_sums.get("order_price_amount", 0)
                    + initial_sums.get("shipping_fee", 0)
                    - initial_sums.get("coupon_discount_price", 0)
                    - initial_sums.get("coupon_shipping_fee_amount", 0)
                    - initial_sums.get("membership_discount_amount", 0)
                ),
            },
            "actual_order_sums_nonzero": {k: round(v) for k, v in actual_sums.items() if v != 0},
            "initial_order_sums_nonzero": {k: round(v) for k, v in initial_sums.items() if v != 0},
            "salesreport_api": salesreport,
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/kpi")

def get_kpi(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Return summary KPI data using real Cafe24 API"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
        
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        start = start_date or today
        end = end_date or today

        # 전체 주문을 페이지네이션으로 가져옴
        orders = fetch_all_orders({"start_date": start, "end_date": end})
        paid_orders = paid_only(orders)

        total_revenue = sum(order_revenue(o) for o in paid_orders)
        total_orders = len(paid_orders)

        # 신규 구매 회원: 해당 기간 첫 구매한 고유 회원 수 (first_order == 'T')
        # 관리자 '신규회원수'(가입 기준)와 다를 수 있음 - Cafe24 API 제약상(customers/count 404) 대안
        new_customers = len({
            o.get('member_id') for o in paid_orders
            if o.get('first_order') in ('T', True) and o.get('member_id')
        })

        # 재구매율: 해당 기간 2회 이상 주문한 회원 비율
        from collections import Counter
        buyer_counts = Counter(o.get('member_id', '') for o in paid_orders if o.get('member_id'))
        repeat_buyers = sum(1 for cnt in buyer_counts.values() if cnt > 1)
        repurchase_rate = round((repeat_buyers / len(buyer_counts) * 100), 1) if buyer_counts else 0

        return {
            "total_revenue": total_revenue,
            "total_orders": total_orders,
            "new_customers": new_customers,
            "repurchase_rate": repurchase_rate
        }
    except Exception as e:
        return {
            "total_revenue": 0,
            "total_orders": 0,
            "new_customers": 0,
            "repurchase_rate": 0,
            "message": f"Real-time sync error or no data: {str(e)}"
        }

@app.get("/api/revenue")
def get_revenue(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Return daily revenue trend using real Cafe24 order data"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    
    try:
        s = start_date or (datetime.now() - timedelta(days=29)).strftime("%Y-%m-%d")
        e = end_date or datetime.now().strftime("%Y-%m-%d")
        orders = fetch_all_orders({"start_date": s, "end_date": e})
        paid_orders = paid_only(orders)

        # Group by date
        daily_revenue = {}
        for o in paid_orders:
            d = o.get('order_date', '')[:10]
            if not d:
                continue
            amt = order_revenue(o)
            daily_revenue[d] = daily_revenue.get(d, 0) + amt
            
        sorted_dates = sorted(daily_revenue.keys())
        return {
            "labels": sorted_dates,
            "data": [daily_revenue[d] for d in sorted_dates]
        }
    except Exception as e:
        return {"labels": [], "data": [], "error": str(e)}

@app.get("/api/customers")
def get_customers(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Return customer data based on real order history (Cohort & LTV)"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    
    try:
        sd = (datetime.now() - timedelta(days=89)).strftime("%Y-%m-%d")
        ed = datetime.now().strftime("%Y-%m-%d")
        orders = fetch_all_orders({"start_date": sd, "end_date": ed})
        paid_orders = paid_only(orders)

        customer_revenue = {}
        customer_first_month = {}
        customer_active_months = {}

        for o in paid_orders:
            cid = o.get('member_id')
            if not cid or cid == 'Guest': continue
            
            d_str = o.get('order_date', '')
            if not d_str: continue
            
            d = parse_order_date(d_str)
            month_str = d.strftime("%Y-%m")
            amt = order_revenue(o)
            
            customer_revenue[cid] = customer_revenue.get(cid, 0) + amt
            if cid not in customer_first_month or d < customer_first_month[cid]:
                customer_first_month[cid] = d
                
            if cid not in customer_active_months:
                customer_active_months[cid] = set()
            customer_active_months[cid].add(month_str)

        ltv_counts = [0, 0, 0, 0] # 0-100k, 100k-500k, 500k-1M, 1M+
        for amt in customer_revenue.values():
            if amt < 100000: ltv_counts[0] += 1
            elif amt < 500000: ltv_counts[1] += 1
            elif amt < 1000000: ltv_counts[2] += 1
            else: ltv_counts[3] += 1

        cohort_data = {}
        for cid, first_d in customer_first_month.items():
            first_m = first_d.strftime("%Y-%m")
            if first_m not in cohort_data:
                cohort_data[first_m] = {"total": 0, "m0": 0, "m1": 0, "m2": 0, "m3": 0}
            
            cohort_data[first_m]["total"] += 1
            
            for m_offset in range(4):
                target_d = first_d + timedelta(days=30 * m_offset)
                target_m = target_d.strftime("%Y-%m")
                if target_m in customer_active_months[cid]:
                    cohort_data[first_m][f"m{m_offset}"] += 1

        cohort_list = []
        for m in sorted(cohort_data.keys())[-6:]: # Last 6 months
            d = cohort_data[m]
            t = d["total"]
            if t == 0: continue
            cohort_list.append({
                "month": m,
                "m0": round((d["m0"]/t)*100),
                "m1": round((d["m1"]/t)*100),
                "m2": round((d["m2"]/t)*100),
                "m3": round((d["m3"]/t)*100)
            })

        return {
            "ltv_segments": ["0-10만", "10-50만", "50-100만", "100만+"],
            "ltv_data": ltv_counts,
            "cohort": cohort_list
        }
    except Exception as e:
        return {"ltv_segments": [], "ltv_data": [], "cohort": [], "error": str(e)}


@app.get("/api/channels")
def get_channels(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Channel performance requires external GA4 sync. Returning empty for now."""
    return {
        "channels": [],
        "revenue": [],
        "message": "Ad source tracking requires GA4 integration."
    }

@app.get("/api/rfm")
def get_rfm():
    """Calculate RFM analysis from real order history"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})

    try:
        sd = (datetime.now() - timedelta(days=89)).strftime("%Y-%m-%d")
        ed = datetime.now().strftime("%Y-%m-%d")
        orders = fetch_all_orders({"start_date": sd, "end_date": ed})
        paid_orders = paid_only(orders)

        # Calculate RFM per customer
        customer_stats = {}
        now = datetime.now()

        for o in paid_orders:
            cid = o.get('member_id', 'Guest')
            if not cid or cid == 'Guest': continue

            d = parse_order_date(o.get('order_date', ''))
            amt = float(o.get('payment_amount', 0) or 0)

            if not d:
                continue
            if cid not in customer_stats:
                customer_stats[cid] = {"name": o.get('billing_name', cid), "last": d, "freq": 0, "monetary": 0}

            customer_stats[cid]["freq"] += 1
            customer_stats[cid]["monetary"] += amt
            if d > customer_stats[cid]["last"]:
                customer_stats[cid]["last"] = d

        # Segmenting...
        segment_names = ["Champions", "Loyal", "Promising", "At Risk", "Lost", "New"]
        segments = {k: {"count": 0, "total": 0} for k in segment_names}
        details = []

        for cid, stat in customer_stats.items():
            recency = (now - stat["last"]).days
            freq = stat["freq"]
            monetary = stat["monetary"]

            # User defined thresholds
            rank = "New"
            if recency <= 90 and freq >= 3 and monetary >= 120000: rank = "Champions"
            elif recency <= 180 and freq >= 2 and monetary >= 70000: rank = "Loyal"
            elif recency <= 180 and freq == 1 and monetary >= 30000: rank = "Promising"
            elif 180 < recency <= 270 and freq >= 2 and monetary >= 70000: rank = "At Risk"
            elif recency > 270: rank = "Lost"

            segments[rank]["count"] += 1
            segments[rank]["total"] += monetary
            if len(details) < 10: # Limit detail list
                details.append({"name": stat["name"], "rank": rank, "last_order": stat["last"].strftime("%Y-%m-%d"), "monetary": monetary})

        avg_order = []
        for k in segment_names:
            cnt = segments[k]["count"]
            total = segments[k]["total"]
            avg_order.append(round(total / cnt) if cnt > 0 else 0)

        return {
            "groups": segment_names,
            "counts": [segments[k]["count"] for k in segment_names],
            "avg_order": avg_order,
            "customers": details
        }
    except Exception as e:
        return {"groups": [], "counts": [], "avg_order": [], "customers": [], "error": str(e)}

@app.get("/api/churn")
def get_churn():
    """Identify churn risk customers from real data (>90 days since last purchase)"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})

    try:
        start_date = (datetime.now() - timedelta(days=89)).strftime("%Y-%m-%d")
        end_date = datetime.now().strftime("%Y-%m-%d")
        orders = fetch_all_orders({"start_date": start_date, "end_date": end_date})
        paid_orders = paid_only(orders)

        customer_last = {}
        now = datetime.now()
        for o in paid_orders:
            cid = o.get('member_id')
            if not cid or cid == 'Guest': continue
            d = parse_order_date(o.get('order_date', ''))
            amt = float(o.get('payment_amount', 0) or 0)
            if cid not in customer_last or d > customer_last[cid]["date"]:
                customer_last[cid] = {"name": o.get('billing_name', cid), "date": d, "total": 0, "monetary": 0}
            customer_last[cid]["total"] += 1
            customer_last[cid]["monetary"] += amt

        churners = []
        for cid, info in customer_last.items():
            days = (now - info["date"]).days
            if days >= 90:
                # Derive simple risk rank from days elapsed
                if days > 270:
                    rank = "Lost"
                elif days > 180:
                    rank = "At Risk"
                else:
                    rank = "Dormant"
                churners.append({
                    "name": info["name"],
                    "last_order": info["date"].strftime("%Y-%m-%d"),
                    "total_orders": info["total"],
                    "days": days,
                    "rank": rank
                })

        return {
            "summary": {"target_count": len(churners)},
            "customers": sorted(churners, key=lambda x: x['days'], reverse=True)[:20]
        }
    except Exception as e:
        return {"summary": {"target_count": 0}, "customers": [], "error": str(e)}

@app.get("/api/products")
def get_products(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Verifiable product insights"""
    if not client.access_token: return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        sd = (datetime.now() - timedelta(days=89)).strftime("%Y-%m-%d")
        orders = fetch_all_orders({"start_date": sd})
        paid_orders = paid_only(orders)

        from collections import defaultdict
        product_buyers = defaultdict(set)
        product_returns = defaultdict(int)
        product_sales = defaultdict(int)
        
        for o in paid_orders:
            cid = o.get('member_id')
            if not cid or cid == 'Guest': continue
            
            for item in o.get('items', []):
                pname = item.get('product_name')
                if not pname: continue
                
                product_sales[pname] += 1
                product_buyers[pname].add(cid)
                if item.get('order_status') in ('C40', 'C41', 'R40', 'E40'): # Returns/Cancellations
                    product_returns[pname] += 1

        repurchase = {}
        returns = {}
        for p, sales in product_sales.items():
            if sales > 5: # Threshold
                buyers = len(product_buyers[p])
                repurchase[p] = round((sales - buyers) / sales * 100, 1)
                returns[p] = round((product_returns[p] / sales) * 100, 1)
                
        # Top 10
        top_rep = sorted(repurchase.items(), key=lambda x: x[1], reverse=True)[:10]
        top_ret = sorted(returns.items(), key=lambda x: x[1], reverse=True)[:10]

        return {
            "repurchase_top10": {"labels": [x[0][:15]+".." if len(x[0])>15 else x[0] for x in top_rep], "data": [x[1] for x in top_rep]},
            "return_rates": {"labels": [x[0][:15]+".." if len(x[0])>15 else x[0] for x in top_ret], "data": [x[1] for x in top_ret]}
        }
    except Exception as e:
        return {"repurchase_top10": {"labels": [], "data": []}, "return_rates": {"labels": [], "data": []}, "error": str(e)}

@app.get("/api/seasonal")
def get_seasonal(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Verifiable seasonal growth based on order history"""
    if not client.access_token: return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        sd = (datetime.now() - timedelta(days=89)).strftime("%Y-%m-%d")
        ed = datetime.now().strftime("%Y-%m-%d")
        orders = fetch_all_orders({"start_date": sd, "end_date": ed})
        paid_orders = paid_only(orders)

        from collections import defaultdict
        monthly = defaultdict(float)
        heatmap = [[0] * 7 for _ in range(24)]

        for o in paid_orders:
            d_str = o.get('order_date', '')
            if not d_str: continue
            d = parse_order_date(d_str)
            amt = order_revenue(o)
            
            monthly[d.month] += amt
            heatmap[d.hour][d.weekday()] += 1

        m_trend = [monthly.get(i, 0) for i in range(1, 13)]
        return {
            "monthly_trend": m_trend,
            "heatmap": heatmap,
            "seasonal_growth": {"봄(3-5월)": sum(m_trend[2:5]), "여름(6-8월)": sum(m_trend[5:8]), "가을(9-11월)": sum(m_trend[8:11]), "겨울(12-2월)": m_trend[11]+m_trend[0]+m_trend[1]}
        }
    except Exception as e:
        return {"monthly_trend": [0]*12, "heatmap": [[0]*7 for _ in range(24)], "error": str(e)}

@app.get("/api/coupons")
def get_coupons(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Verifiable coupon analysis"""
    if not client.access_token: return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        sd = (datetime.now() - timedelta(days=89)).strftime("%Y-%m-%d")
        ed = datetime.now().strftime("%Y-%m-%d")
        orders = fetch_all_orders({"start_date": sd, "end_date": ed})
        paid_orders = paid_only(orders)

        used, unused = 0, 0
        used_rev, unused_rev = 0, 0
        contrib = {"0%": 0, "10%": 0, "20%": 0, "30%+": 0}

        for o in paid_orders:
            amt = order_revenue(o)
            initial = o.get("initial_order_amount") or {}
            cpn = float(initial.get("coupon_discount_price", 0) or 0)
            
            if cpn > 0:
                used += 1
                used_rev += amt
                pct = cpn / (amt + cpn) if (amt + cpn) > 0 else 0
                if pct > 0.3: contrib["30%+"] += amt
                elif pct > 0.2: contrib["20%"] += amt
                elif pct > 0.1: contrib["10%"] += amt
                else: contrib["0%"] += amt
            else:
                unused += 1
                unused_rev += amt
                contrib["0%"] += amt

        tot = used + unused
        rate = round(used / tot * 100) if tot > 0 else 0
        return {
            "usage_rate": rate,
            "aov_comparison": {"labels": ["쿠폰 사용", "쿠폰 미사용"], "data": [round(used_rev/used) if used else 0, round(unused_rev/unused) if unused else 0]},
            "contribution": {"labels": list(contrib.keys()), "data": list(contrib.values())}
        }
    except Exception as e:
        return {"usage_rate": 0, "aov_comparison": {"labels": [], "data": []}, "contribution": {"labels": [], "data": []}, "error": str(e)}

if __name__ == "__main__":
    uvicorn.run("api:app", host="localhost", port=3000, reload=False)

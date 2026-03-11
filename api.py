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
import hashlib

_FETCH_LOCK = threading.Lock()
_FETCHING_KEYS = set()
_CACHE = {}

def slim_order(o: dict) -> dict:
    """분석에 불필요한 필드를 제거하여 캐시 크기 최적화"""
    ioa = o.get("initial_order_amount") or {}
    return {
        "order_id": o.get("order_id"),
        "order_date": o.get("order_date"),
        "member_id": o.get("member_id"),
        "billing_name": o.get("billing_name"),
        "payment_amount": o.get("payment_amount"),
        "first_order": o.get("first_order"),
        "paid": o.get("paid"),
        "initial_order_amount": {
            "payment_amount": ioa.get("payment_amount"),
            "points_spent_amount": ioa.get("points_spent_amount"),
            "coupon_discount_price": ioa.get("coupon_discount_price")
        },
        "items": [
            {
                "product_name": i.get("product_name"),
                "quantity": i.get("quantity"),
                "product_price": i.get("product_price"),
                "order_status": i.get("order_status")
            } for i in o.get("items", [])
        ] if "items" in o else None
    }

def get_cache_path(key: str) -> str:
    import hashlib
    h = hashlib.md5(key.encode()).hexdigest()
    return os.path.join("cache", f"{h}.json")

def split_date_range(start_str: str, end_str: str, interval_days: int = 7) -> list:
    """Cafe24 API 제한 대응: 7일 단위로 분할하여 속도와 안정성 균형 (offset 10000 제한 회피)"""
    try:
        fmt = "%Y-%m-%d"
        s = datetime.strptime(start_str[:10], fmt)
        e = datetime.strptime(end_str[:10], fmt)
    except:
        return [(start_str, end_str)]
    
    ranges = []
    curr_e = e
    while curr_e >= s:
        curr_s = max(s, curr_e - timedelta(days=interval_days - 1))
        ranges.append((curr_s.strftime(fmt), curr_e.strftime(fmt)))
        curr_e = curr_s - timedelta(days=1)
    return ranges

def fetch_all_orders_internal(params: dict) -> list:
    """Original fetch logic for a single range"""
    cache_key = json.dumps(params, sort_keys=True)
    # Cache logic remains here for internal use
    # ... (Wait, I can just update the main functions to call a private fetcher)
    pass

def fetch_all_orders(params: dict) -> list:
    """90일 분할 조회 지원 버전"""
    s_date = params.get("start_date")
    e_date = params.get("end_date")
    if not s_date or not e_date:
        return fetch_all_orders_chunk(params)
    
    ranges = split_date_range(s_date, e_date)
    if len(ranges) <= 1:
        return fetch_all_orders_chunk(params)
    
    print(f"[FETCH SPLIT] Range {s_date} ~ {e_date} -> {len(ranges)} chunks", flush=True)
    all_combined = []
    seen_oids = set()
    
    for rs, re in ranges:
        print(f"[FETCH SPLIT] Processing chunk {rs} ~ {re}", flush=True)
        p = {**params, "start_date": rs, "end_date": re}
        batch = fetch_all_orders_chunk(p)
        for o in batch:
            oid = o.get("order_id")
            if oid not in seen_oids:
                all_combined.append(o)
                seen_oids.add(oid)
    print(f"[FETCH SPLIT] Completed all chunks. Total: {len(all_combined)}", flush=True)
    return all_combined

def fetch_all_orders_chunk(params: dict) -> list:
    """분할된 개별 구간에 대한 주문 조회 및 캐싱"""
    cache_key = json.dumps(params, sort_keys=True)
    
    # Check memory cache first
    if cache_key in _CACHE:
        entry = _CACHE[cache_key]
        if time.time() - entry["time"] < 7200:
            return entry["data"]

    # Lock briefly to coordinate fetching
    with _FETCH_LOCK:
        if cache_key in _FETCHING_KEYS:
            pass
        else:
            _FETCHING_KEYS.add(cache_key)

    try:
        # Check local disk cache
        cache_path = get_cache_path(cache_key)
        if os.path.exists(cache_path):
            try:
                with open(cache_path, "r") as f:
                    entry = json.load(f)
                    if time.time() - entry["time"] < 7200:
                        _CACHE[cache_key] = entry
                        print(f"[CACHE HIT] Loaded from disk: {cache_path}", flush=True)
                        return entry["data"]
            except: pass

        print(f"[FETCH START] params: {params}", flush=True)
        all_orders = []
        offset = 0
        per_page = 100
        base_params = {**params, "limit": per_page}
        error_occurred = False
        
        while True:
            base_params["offset"] = offset
            success = False
            for attempt in range(3):
                try:
                    data = client.call_api("orders", params=base_params)
                    success = True
                    break
                except Exception as e:
                    if "429" in str(e) and attempt < 2:
                        print(f"[RATE LIMIT] Hit rate limit on offset {offset}, retrying after 2s...", flush=True)
                        time.sleep(2.0)
                    elif "422" in str(e):
                        if offset > 0:
                            print(f"[API LIMIT] Max offset reached at {offset} for this 7-day chunk. Stopping fetch.", flush=True)
                            success = True
                        else:
                            print(f"[API ERROR] 422 at offset 0: {e}. Possible invalid params.", flush=True)
                            error_occurred = True
                        data = {"orders": []}
                        break
                    else:
                        print(f"[API ERROR] Unexpected error: {e}")
                        error_occurred = True
                        break
            
            if error_occurred: break
                
            batch = data.get("orders", [])
            all_orders.extend([slim_order(o) for o in batch])
            
            if not success or len(batch) < per_page or offset >= 10000:
                break
            offset += per_page
            print(f"  [PROGRESS] Offset {offset} reached...", flush=True)
            time.sleep(0.1) 
            
        if not error_occurred:
            with _FETCH_LOCK:
                entry = {"time": time.time(), "data": all_orders}
                _CACHE[cache_key] = entry
                try:
                    with open(get_cache_path(cache_key), "w") as f:
                        json.dump(entry, f)
                except: pass
        return all_orders
    finally:
        with _FETCH_LOCK:
            if cache_key in _FETCHING_KEYS:
                _FETCHING_KEYS.remove(cache_key)


def fetch_orders_with_items(start_date: str, end_date: str) -> list:
    """90일 분할 조회 지원 버전 (embed=items)"""
    ranges = split_date_range(start_date, end_date)
    if len(ranges) <= 1:
        return fetch_orders_with_items_chunk(start_date, end_date)
    
    print(f"[FETCH ITEMS SPLIT] Splitting into {len(ranges)} chunks.")
    all_combined = []
    seen_oids = set()
    for rs, re in ranges:
        batch = fetch_orders_with_items_chunk(rs, re)
        for o in batch:
            oid = o.get("order_id")
            if oid not in seen_oids:
                all_combined.append(o)
                seen_oids.add(oid)
    return all_combined

def fetch_orders_with_items_chunk(start_date: str, end_date: str) -> list:
    """Original fetch logic with embed=items (renamed and improved)"""
    cache_key = f"items_{start_date}_{end_date}"
    
    if cache_key in _CACHE:
        entry = _CACHE[cache_key]
        if time.time() - entry["time"] < 7200:
            return entry["data"]

    # Disk cache check
    cache_path = get_cache_path(cache_key)
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r") as f:
                entry = json.load(f)
                if time.time() - entry["time"] < 7200:
                    _CACHE[cache_key] = entry
                    print(f"[CACHE HIT ITEMS] Loaded from disk: {cache_path}", flush=True)
                    return entry["data"]
        except: pass

    print(f"[FETCH ITEMS] Fetching orders+items {start_date} ~ {end_date}", flush=True)
    all_orders = []
    offset = 0
    per_page = 100
    error_occurred = False
    
    while True:
        params = {
            "start_date": start_date,
            "end_date": end_date,
            "embed": "items",
            "limit": per_page,
            "offset": offset
        }
        success = False
        for attempt in range(3):
            try:
                data = client.call_api("orders", params=params)
                success = True
                break
            except Exception as e:
                if "429" in str(e) and attempt < 2:
                    print(f"[RATE LIMIT ITEMS] Hit rate limit on offset {offset}, retrying after 3s...", flush=True)
                    time.sleep(3.0)
                elif "422" in str(e):
                    if offset > 0:
                        print(f"[API LIMIT ITEMS] Max offset reached at {offset}. Stopping fetch.", flush=True)
                        success = True
                    else:
                        print(f"[API ERROR ITEMS] 422 at offset 0: {e}. Possible invalid params.", flush=True)
                        error_occurred = True
                    data = {"orders": []}
                    break
                else:
                    print(f"[ITEMS ERROR] Unexpected error: {e}", flush=True)
                    error_occurred = True
                    break
        
        if error_occurred: break
            
        batch = data.get("orders", [])
        all_orders.extend([slim_order(o) for o in batch])
        
        if not success or len(batch) < per_page or offset >= 10000:
            break
        offset += per_page
        print(f"  [PROGRESS ITEMS] Offset {offset} reached...", flush=True)
        time.sleep(0.15) # Slightly slower for items to be safe
    
    if not error_occurred:
        with _FETCH_LOCK:
            entry = {"time": time.time(), "data": all_orders}
            _CACHE[cache_key] = entry
            try:
                with open(cache_path, "w") as f:
                    json.dump(entry, f)
            except: pass
            
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

# Serve static files from React build directory
if os.path.exists("dist"):
    app.mount("/assets", StaticFiles(directory="dist/assets"), name="assets")

@app.get("/")
def read_root():
    """Serve the modern React dashboard with localtunnel bypass"""
    if os.path.exists("dist/index.html"):
        return FileResponse("dist/index.html", headers={"Bypass-Tunnel-Reminder": "true"})
    return FileResponse("dashboard.html")

@app.get("/legacy")
def read_legacy_dashboard():
    """Serve the legacy Chart.js dashboard"""
    return FileResponse("dashboard.html")

@app.get("/dashboard.html")
def read_dashboard():
    """Serve the legacy dashboard HTML"""
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
        return RedirectResponse(url="/")
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
            "revenue": total_revenue,
            "orders": total_orders,
            "new_customers": new_customers,
            "repurchase_rate": repurchase_rate,
            "aov": round(total_revenue / total_orders, 0) if total_orders > 0 else 0,
            "new_customers_ratio": round((new_customers / len(buyer_counts) * 100), 1) if buyer_counts else 0,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/overview-data")
def get_overview_data(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Unified endpoint for the overview tab"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        from collections import defaultdict, Counter
        today = datetime.now()
        ed = end_date or today.strftime("%Y-%m-%d")
        sd = start_date or (today - timedelta(days=179)).strftime("%Y-%m-%d")
        ref_end = parse_order_date(ed + "T23:59:59+09:00") or today

        orders = fetch_all_orders({"start_date": sd, "end_date": ed})
        paid = paid_only(orders)

        # ── KPIs ──────────────────────────────────────────────
        total_revenue = sum(order_revenue(o) for o in paid)
        total_orders  = len(paid)
        buyer_ids     = {o.get('member_id') for o in paid if o.get('member_id')}
        buyer_counts  = Counter(o.get('member_id') for o in paid if o.get('member_id'))
        repeat_buyers = sum(1 for c in buyer_counts.values() if c > 1)

        new_customers = len({o.get('member_id') for o in paid
                             if o.get('first_order') in ('T', True) and o.get('member_id')})
        new_revenue   = sum(order_revenue(o) for o in paid
                            if o.get('first_order') in ('T', True))

        kpi = {
            "revenue":            round(total_revenue),
            "orders":             total_orders,
            "new_customers":      new_customers,
            "repurchase_rate":    round(repeat_buyers / len(buyer_counts) * 100, 1) if buyer_counts else 0,
            "aov":                round(total_revenue / total_orders, 0) if total_orders else 0,
            "ltv":                round(total_revenue / len(buyer_ids), 0) if buyer_ids else 0,
            "avg_frequency":      round(total_orders / len(buyer_ids), 2) if buyer_ids else 0,
            "new_revenue":        round(new_revenue),
            "new_revenue_ratio":  round(new_revenue / total_revenue * 100, 1) if total_revenue else 0,
            "new_customers_ratio": round(new_customers / len(buyer_ids) * 100, 1) if buyer_ids else 0,
        }

        # ── 트렌드 (일별/주별/월별) ───────────────────────────
        daily_map   = defaultdict(lambda: {"revenue": 0.0, "orders": 0})
        weekly_map  = defaultdict(lambda: {"revenue": 0.0, "orders": 0})
        monthly_map = defaultdict(lambda: {"revenue": 0.0, "orders": 0})
        monthly_new    = defaultdict(set)
        monthly_repeat = defaultdict(set)
        cust_dates  = defaultdict(list)

        for o in paid:
            d = parse_order_date(o.get('order_date', ''))
            if not d: continue
            amt = order_revenue(o)
            mid = o.get('member_id', '')

            day_k   = d.strftime("%Y-%m-%d")
            iso     = d.isocalendar()
            week_k  = f"{iso[0]}-W{iso[1]:02d}"
            month_k = d.strftime("%Y-%m")

            daily_map[day_k]["revenue"]   += amt
            daily_map[day_k]["orders"]    += 1
            weekly_map[week_k]["revenue"] += amt
            weekly_map[week_k]["orders"]  += 1
            monthly_map[month_k]["revenue"] += amt
            monthly_map[month_k]["orders"]  += 1

            if mid:
                cust_dates[mid].append(d)
                if o.get('first_order') in ('T', True):
                    monthly_new[month_k].add(mid)
                else:
                    monthly_repeat[month_k].add(mid)

        def trend_list(m, label_fn):
            return [{"date": k, "label": label_fn(k), "revenue": round(v["revenue"]), "orders": v["orders"]}
                    for k, v in sorted(m.items())]

        daily_trend   = trend_list(daily_map,   lambda k: k[5:])
        weekly_trend  = trend_list(weekly_map,  lambda k: k)
        monthly_trend = trend_list(monthly_map, lambda k: k[5:] + "월")

        # ── 신규 vs 재구매 월별 ───────────────────────────────
        all_months  = sorted(set(list(monthly_new) + list(monthly_repeat)))
        new_vs_repeat = []
        for m in all_months:
            nc = len(monthly_new[m]); rc = len(monthly_repeat[m]); tc = nc + rc
            new_vs_repeat.append({
                "month": m, "label": m[5:] + "월",
                "new": nc, "repeat": rc,
                "rate": round(rc / tc * 100, 1) if tc else 0,
            })

        # ── 기간별 재구매율 ───────────────────────────────────
        def safe_days(d1, d2):
            try:    return (d2 - d1).days
            except: return (d2.replace(tzinfo=None) - d1.replace(tzinfo=None)).days

        repurchase_periods = {}
        for days in [30, 60, 90, 120, 150, 180]:
            eligible = repurchased = 0
            for mid, dates in cust_dates.items():
                ds = sorted(dates)
                try:
                    avail = safe_days(ds[0], ref_end)
                except Exception:
                    continue
                if avail < days:
                    continue
                eligible += 1
                if any(0 < safe_days(ds[0], d) <= days for d in ds[1:]):
                    repurchased += 1
            repurchase_periods[str(days)] = round(repurchased / eligible * 100, 1) if eligible else None

        # ── 구매 퍼널 ─────────────────────────────────────────
        funnel = [
            {"stage": "방문자",    "count": None, "available": False},
            {"stage": "상품 조회", "count": None, "available": False},
            {"stage": "장바구니",  "count": None, "available": False},
            {"stage": "주문 접수", "count": len(orders), "available": True},
            {"stage": "결제 완료", "count": total_orders, "available": True},
        ]

        return {
            "kpi":                kpi,
            "daily_trend":        daily_trend,
            "weekly_trend":       weekly_trend,
            "monthly_trend":      monthly_trend,
            "new_vs_repeat":      new_vs_repeat,
            "repurchase_periods": repurchase_periods,
            "funnel":             funnel,
            # legacy key
            "seasonal": {"monthly_trend": [{"month": m["label"], "revenue": m["revenue"], "orders": m["orders"]}
                                            for m in monthly_trend]},
        }
    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/revenue")
def get_revenue(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Return daily revenue trend using real Cafe24 order data"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    
    try:
        today = datetime.now()
        s = start_date or (today - timedelta(days=179)).strftime("%Y-%m-%d")
        e = end_date or today.strftime("%Y-%m-%d")
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
        today = datetime.now()
        sd = start_date or (today - timedelta(days=179)).strftime("%Y-%m-%d")
        ed = end_date or today.strftime("%Y-%m-%d")
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
def get_rfm(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """RFM analysis with quintile-based scoring (1-5 per dimension)"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        import bisect
        today = datetime.now()
        ed = end_date or today.strftime("%Y-%m-%d")
        sd = start_date or (today - timedelta(days=179)).strftime("%Y-%m-%d")
        ref_date = parse_order_date(ed + "T23:59:59+09:00") or today

        orders = fetch_all_orders({"start_date": sd, "end_date": ed})
        paid_orders = paid_only(orders)

        # Per-customer stats
        cstats = {}
        for o in paid_orders:
            cid = o.get('member_id', '')
            if not cid: continue
            d = parse_order_date(o.get('order_date', ''))
            if not d: continue
            amt = order_revenue(o)
            if cid not in cstats:
                cstats[cid] = {"name": o.get('billing_name', cid), "last": d, "freq": 0, "monetary": 0.0}
            cstats[cid]["freq"] += 1
            cstats[cid]["monetary"] += amt
            if d > cstats[cid]["last"]:
                cstats[cid]["last"] = d

        if not cstats:
            return {"summary": {}, "segments": [], "customers": []}

        # Build raw values
        raw = []
        for cid, s in cstats.items():
            raw.append({"id": cid, "name": s["name"],
                        "recency": max(0, (ref_date - s["last"]).days),
                        "frequency": s["freq"], "monetary": s["monetary"]})

        # Quintile scorer
        def qscore(val, sorted_vals, reverse=False):
            n = len(sorted_vals)
            idx = bisect.bisect_left(sorted_vals, val)
            s = min(5, int(idx / n * 5) + 1)
            return (6 - s) if reverse else s

        r_sorted = sorted(c["recency"] for c in raw)
        f_sorted = sorted(c["frequency"] for c in raw)
        m_sorted = sorted(c["monetary"] for c in raw)

        def segment_label(r, f, m):
            if r >= 4 and f >= 4: return "Champions"
            if f >= 4 or (r >= 3 and f >= 3 and m >= 3): return "Loyal"
            if r >= 4 and f == 1: return "New Customer"
            if r >= 3 and f >= 2: return "Potential"
            if r <= 2 and f >= 4: return "Can't Lose"
            if r <= 2 and f >= 2: return "At Risk"
            if r == 1 and f == 1: return "Lost"
            return "Hibernating"

        for c in raw:
            c["r_score"] = qscore(c["recency"], r_sorted, reverse=True)
            c["f_score"] = qscore(c["frequency"], f_sorted)
            c["m_score"] = qscore(c["monetary"], m_sorted)
            c["segment"] = segment_label(c["r_score"], c["f_score"], c["m_score"])
            c["monetary"] = round(c["monetary"])

        # Segment aggregation
        seg_map = {}
        for c in raw:
            seg = c["segment"]
            if seg not in seg_map:
                seg_map[seg] = {"count": 0, "r_sum": 0, "f_sum": 0, "m_sum": 0}
            seg_map[seg]["count"] += 1
            seg_map[seg]["r_sum"] += c["recency"]
            seg_map[seg]["f_sum"] += c["frequency"]
            seg_map[seg]["m_sum"] += c["monetary"]

        total = len(raw)
        seg_order = ["Champions", "Loyal", "New Customer", "Potential", "At Risk", "Can't Lose", "Hibernating", "Lost"]
        segments = []
        for seg in seg_order:
            if seg not in seg_map: continue
            d = seg_map[seg]
            cnt = d["count"]
            segments.append({
                "id": seg,
                "count": cnt,
                "pct": round(cnt / total * 100, 1),
                "avg_recency": round(d["r_sum"] / cnt),
                "avg_frequency": round(d["f_sum"] / cnt, 1),
                "avg_monetary": round(d["m_sum"] / cnt),
            })

        summary = {
            "total_customers": total,
            "avg_recency": round(sum(c["recency"] for c in raw) / total),
            "avg_frequency": round(sum(c["frequency"] for c in raw) / total, 1),
            "avg_monetary": round(sum(c["monetary"] for c in raw) / total),
        }

        top_customers = sorted(raw, key=lambda x: -x["monetary"])[:50]
        return {"summary": summary, "segments": segments, "customers": top_customers}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/churn")
def get_churn():
    """Identify churn risk customers from real data (>180 days since last purchase)"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})

    try:
        today = datetime.now()
        start_date = (today - timedelta(days=179)).strftime("%Y-%m-%d")
        end_date = today.strftime("%Y-%m-%d")
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
            if days >= 180:
                # Derive simple risk rank from days elapsed
                if days > 540:
                    rank = "Lost"
                elif days > 360:
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

@app.get("/api/product-search")
def search_products(q: Optional[str] = None):
    """Return a list of unique product names for the search sidebar"""
    if not client.access_token: return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        # Fetch recent products from the last 30 days with embed=items
        today = datetime.now()
        sd = (today - timedelta(days=30)).strftime("%Y-%m-%d")
        ed = today.strftime("%Y-%m-%d")
        orders = fetch_orders_with_items(sd, ed)
        
        products = set()
        for o in orders:
            for item in o.get('items', []):
                pname = item.get('product_name')
                if pname: products.add(pname)
        
        plist = sorted(list(products))
        if q:
            plist = [p for p in plist if q.lower() in p.lower()]
            
        return {"products": [{"name": p} for p in plist[:50]]}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/product-analysis")
def get_product_analysis(start_date: Optional[str] = None, end_date: Optional[str] = None, product_name: Optional[str] = None):
    """Unified endpoint for Phase 2 Product Analysis tab"""
    if not client.access_token: return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        today = datetime.now()
        s = start_date or (today - timedelta(days=179)).strftime("%Y-%m-%d")
        e = end_date or today.strftime("%Y-%m-%d")
        
        # Use embed=items to get item-level data in a single call
        orders = fetch_orders_with_items(s, e)
        paid_orders = paid_only(orders)

        from collections import defaultdict, Counter
        
        # Product Metrics
        p_stats = defaultdict(lambda: {"sales": 0, "revenue": 0, "returns": 0, "buyers": set()})
        basket_pairs = Counter() # (Product A, Product B) -> Count
        basket_order_counts = defaultdict(set)  # product -> set of order_ids (for probability)

        daily_trend = defaultdict(lambda: {"sales": 0, "revenue": 0})

        for o in paid_orders:
            cid = o.get('member_id', 'Guest')
            items = o.get('items', [])
            date_key = (o.get('order_date') or '')[:10]  # "2026-03-01"

            # Extract distinct items in this cart for basket analysis
            cart_item_names = sorted(list({item.get('product_name') for item in items if item.get('product_name')}))

            # Update metrics per item
            for item in items:
                pname = item.get('product_name')
                if not pname: continue

                # If product_name filter is applied, only focus on that
                if product_name and product_name.lower() not in pname.lower():
                    continue

                qty = int(item.get('quantity', 1))
                price = float(item.get('product_price', 0))

                p_stats[pname]["sales"] += qty
                p_stats[pname]["revenue"] += (price * qty)
                p_stats[pname]["buyers"].add(cid)

                if item.get('order_status') in ('C40', 'C41', 'R40', 'E40'):
                    p_stats[pname]["returns"] += qty

                # Daily trend accumulation
                if date_key:
                    daily_trend[date_key]["sales"] += qty
                    daily_trend[date_key]["revenue"] += price * qty

            # Basket combinations (only if no product filter is applied, or if the filter matches one of the items)
            if not product_name or any(product_name.lower() in name.lower() for name in cart_item_names):
                oid = o.get('order_id', date_key)
                for name in cart_item_names:
                    basket_order_counts[name].add(oid)
                for i in range(len(cart_item_names)):
                    for j in range(i + 1, len(cart_item_names)):
                        basket_pairs[(cart_item_names[i], cart_item_names[j])] += 1

        daily_trend_list = [
            {"date": d, "sales": v["sales"], "revenue": round(v["revenue"])}
            for d, v in sorted(daily_trend.items())
        ]

        # Format stats for frontend
        products_list = []
        for name, stat in p_stats.items():
            sales = stat["sales"]
            buyers = len(stat["buyers"])
            products_list.append({
                "name": name,
                "sales": sales,
                "revenue": stat["revenue"],
                "return_rate": round((stat["returns"] / sales * 100), 1) if sales > 0 else 0,
                "repurchase_rate": round(((sales - buyers) / sales * 100), 1) if sales > 0 else 0
            })

        # Top 10 products by revenue
        top_products = sorted(products_list, key=lambda x: x["revenue"], reverse=True)[:10]

        # Basket Affinity Matrix — global top 15 for Section B
        top_pairs = []
        for (p1, p2), count in basket_pairs.most_common(15):
            top_pairs.append({"p1": p1, "p2": p2, "count": count})

        # Per-product basket (top 500 global pairs → top 5 companions per product)
        basket_by_product = {}
        for (p1, p2), count in basket_pairs.most_common(500):
            for pname, companion in [(p1, p2), (p2, p1)]:
                if pname not in basket_by_product:
                    basket_by_product[pname] = []
                if len(basket_by_product[pname]) < 5:
                    basket_by_product[pname].append({"companion": companion, "count": count})

        # Product order counts for probability (all products with basket data)
        product_orders = {
            pname: len(basket_order_counts.get(pname, set()))
            for pname in basket_by_product
        }

        # All products sorted by revenue (for basket dropdown)
        all_products = [p["name"] for p in sorted(products_list, key=lambda x: -x["revenue"])]

        return {
            "products": top_products,
            "basket": top_pairs,
            "basket_by_product": basket_by_product,
            "all_products": all_products[:200],
            "product_orders": product_orders,
            "daily_trend": daily_trend_list,
            "summary": {
                "total_items": len(products_list),
                "total_sales": sum(p["sales"] for p in products_list)
            }
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/products")
def get_products_legacy(start_date: Optional[str] = None, end_date: Optional[str] = None):
    # Keep original for compatibility if needed, but point to logic or keep it
    return get_product_analysis(start_date, end_date)

@app.get("/api/seasonal")
def get_seasonal(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Verifiable seasonal growth based on order history"""
    if not client.access_token: return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        # Use provided dates or default to last 180 days
        today = datetime.now()
        ed = end_date or today.strftime("%Y-%m-%d")
        sd = start_date or (today - timedelta(days=179)).strftime("%Y-%m-%d")
        
        orders = fetch_all_orders({"start_date": sd, "end_date": ed})
        paid_orders = paid_only(orders)

        from collections import defaultdict
        monthly_rev = defaultdict(float)
        monthly_ord = defaultdict(int)
        heatmap = [[0] * 7 for _ in range(24)]

        for o in paid_orders:
            d_str = o.get('order_date', '')
            if not d_str: continue
            d = parse_order_date(d_str)
            amt = order_revenue(o)
            
            monthly_rev[d.month] += amt
            monthly_ord[d.month] += 1
            heatmap[d.hour][d.weekday()] += 1

        m_trend = []
        # 현재 월부터 과거 3개월만 표시하거나 전체 표시 (React 차트 데이터 형식에 맞춤)
        for i in range(1, 13):
            if monthly_rev.get(i, 0) > 0 or monthly_ord.get(i, 0) > 0:
                m_trend.append({
                    "month": f"{i}월",
                    "revenue": monthly_rev.get(i, 0),
                    "orders": monthly_ord.get(i, 0)
                })

        return {
            "monthly_trend": m_trend,
            "heatmap": heatmap,
            "seasonal_growth": {
                "봄(3-5월)": sum(monthly_rev.get(i, 0) for i in range(3, 6)),
                "여름(6-8월)": sum(monthly_rev.get(i, 0) for i in range(6, 9)),
                "가을(9-11월)": sum(monthly_rev.get(i, 0) for i in range(9, 12)),
                "겨울(12-2월)": monthly_rev.get(12, 0) + monthly_rev.get(1, 0) + monthly_rev.get(2, 0)
            }
        }
    except Exception as e:
        return {"monthly_trend": [], "heatmap": [[0]*7 for _ in range(24)], "error": str(e)}

@app.get("/api/coupons")
def get_coupons(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Verifiable coupon analysis"""
    if not client.access_token: return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        today = datetime.now()
        sd = (today - timedelta(days=179)).strftime("%Y-%m-%d")
        ed = today.strftime("%Y-%m-%d")
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

@app.get("/api/cohort")
def get_cohort(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """코호트 리텐션 분석: 첫 구매월 기준 월별 재구매율"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        from collections import defaultdict
        today = datetime.now()
        ed = end_date or today.strftime("%Y-%m-%d")
        sd = start_date or (today - timedelta(days=179)).strftime("%Y-%m-%d")

        orders = fetch_all_orders({"start_date": sd, "end_date": ed})
        paid = paid_only(orders)

        # 고객별 주문일 목록
        customer_orders: dict = defaultdict(list)
        for o in paid:
            mid = o.get('member_id', '')
            if not mid:
                continue
            d = parse_order_date(o.get('order_date', ''))
            if d:
                customer_orders[mid].append(d)

        if not customer_orders:
            return {"cohorts": [], "max_periods": 0, "avg_retention": []}

        # 첫 구매월로 코호트 배정
        first_purchase = {mid: min(dates) for mid, dates in customer_orders.items()}

        # matrix[cohort_ym][period_offset] = set of member_ids
        matrix: dict = defaultdict(lambda: defaultdict(set))
        cohort_members: dict = defaultdict(set)

        for mid, dates in customer_orders.items():
            fp = first_purchase[mid]
            cohort_ym = fp.strftime("%Y-%m")
            cohort_members[cohort_ym].add(mid)
            for d in dates:
                period = (d.year - fp.year) * 12 + (d.month - fp.month)
                matrix[cohort_ym][period].add(mid)

        sorted_cohorts = sorted(cohort_members.keys())
        max_periods = max(
            (max(matrix[c].keys()) for c in sorted_cohorts if matrix[c]),
            default=0
        )

        cohorts = []
        for c in sorted_cohorts:
            size = len(cohort_members[c])
            cells = []
            for p in range(max_periods + 1):
                count = len(matrix[c].get(p, set()))
                cells.append({
                    "period": p,
                    "count": count,
                    "rate": round(count / size * 100, 1) if size > 0 else 0
                })
            cohorts.append({
                "label": c,
                "label_short": c[5:] + "월",
                "size": size,
                "cells": cells
            })

        # 기간별 평균 리텐션 (period>0 이고 데이터 있는 코호트만)
        avg_retention = []
        for p in range(max_periods + 1):
            rates = [
                c["cells"][p]["rate"]
                for c in cohorts
                if p < len(c["cells"]) and (p == 0 or c["cells"][p]["count"] > 0)
            ]
            avg_retention.append(round(sum(rates) / len(rates), 1) if rates else 0)

        return {
            "cohorts": cohorts,
            "max_periods": max_periods,
            "avg_retention": avg_retention,
        }
    except Exception as e:
        return {"cohorts": [], "max_periods": 0, "avg_retention": [], "error": str(e)}


@app.get("/api/purchase-pattern")
def get_purchase_pattern(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """구매 패턴 분석: 히트맵, 요일별/시간대별/월별 집계, 재구매 간격"""
    if not client.access_token:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    try:
        from collections import defaultdict
        today = datetime.now()
        ed = end_date or today.strftime("%Y-%m-%d")
        sd = start_date or (today - timedelta(days=179)).strftime("%Y-%m-%d")

        orders = fetch_all_orders({"start_date": sd, "end_date": ed})
        paid = paid_only(orders)

        # 집계 컨테이너
        heatmap = [[0] * 7 for _ in range(24)]   # heatmap[hour][weekday]
        by_hour = [{"hour": h, "count": 0, "revenue": 0.0} for h in range(24)]
        by_weekday = [{"day": d, "label": l, "count": 0, "revenue": 0.0}
                      for d, l in enumerate(['월', '화', '수', '목', '금', '토', '일'])]
        monthly = defaultdict(lambda: {"count": 0, "revenue": 0.0})
        cust_dates = defaultdict(list)   # member_id → [datetime, ...]

        for o in paid:
            d = parse_order_date(o.get('order_date', ''))
            if not d:
                continue
            amt = order_revenue(o)

            heatmap[d.hour][d.weekday()] += 1
            by_hour[d.hour]["count"] += 1
            by_hour[d.hour]["revenue"] += amt
            by_weekday[d.weekday()]["count"] += 1
            by_weekday[d.weekday()]["revenue"] += amt

            month_key = d.strftime("%Y-%m")
            monthly[month_key]["count"] += 1
            monthly[month_key]["revenue"] += amt

            mid = o.get('member_id', '')
            if mid:
                cust_dates[mid].append(d)

        # 월별 추이 (정렬)
        monthly_trend = [
            {"month": k, "label": k[5:] + "월", "count": v["count"], "revenue": round(v["revenue"])}
            for k, v in sorted(monthly.items())
        ]

        # 재구매 간격 히스토그램
        buckets = [
            {"label": "1주 이내",  "min": 1,  "max": 7,   "count": 0},
            {"label": "2주",       "min": 8,  "max": 14,  "count": 0},
            {"label": "1개월",     "min": 15, "max": 30,  "count": 0},
            {"label": "2개월",     "min": 31, "max": 60,  "count": 0},
            {"label": "3개월",     "min": 61, "max": 90,  "count": 0},
            {"label": "4개월",     "min": 91, "max": 120, "count": 0},
            {"label": "5개월",     "min": 121, "max": 150, "count": 0},
            {"label": "6개월+",     "min": 151, "max": 9999,"count": 0},
        ]
        interval_days = []
        for dates in cust_dates.values():
            if len(dates) < 2:
                continue
            dates_sorted = sorted(dates)
            for i in range(1, len(dates_sorted)):
                diff = (dates_sorted[i] - dates_sorted[i - 1]).days
                if diff > 0:
                    interval_days.append(diff)
                    for b in buckets:
                        if b["min"] <= diff <= b["max"]:
                            b["count"] += 1
                            break

        avg_interval = round(sum(interval_days) / len(interval_days)) if interval_days else 0

        # 라운드
        for h in by_hour:
            h["revenue"] = round(h["revenue"])
        for d in by_weekday:
            d["revenue"] = round(d["revenue"])

        # 정렬용 top 요일/시간
        peak_hour = max(by_hour, key=lambda x: x["count"])["hour"]
        peak_day = max(by_weekday, key=lambda x: x["count"])["day"]
        weekday_labels = ['월', '화', '수', '목', '금', '토', '일']

        return {
            "heatmap": heatmap,
            "by_hour": by_hour,
            "by_weekday": by_weekday,
            "monthly_trend": monthly_trend,
            "interval_hist": buckets,
            "summary": {
                "peak_hour": peak_hour,
                "peak_day": weekday_labels[peak_day],
                "avg_interval": avg_interval,
                "repeat_customers": len([d for d in cust_dates.values() if len(d) >= 2]),
                "total_customers": len(cust_dates),
            }
        }
    except Exception as e:
        return {"heatmap": [], "by_hour": [], "by_weekday": [], "monthly_trend": [],
                "interval_hist": [], "summary": {}, "error": str(e)}


if __name__ == "__main__":
    uvicorn.run("api:app", host="localhost", port=3000, reload=False)

# Cafe24 Growth Marketing Dashboard

A Cafe24 growth marketing dashboard that tracks KPIs, revenue, customer data, funnel conversion, and channel performance.
This project uses FastAPI for the backend to authenticate via Cafe24 OAuth 2.0 and serve mock data for the dashboard.
The frontend is a single HTML file visualizing the data with Chart.js.

## Prerequisites
- Python 3.8+
- [Cafe24 Developer Center](https://developer.cafe24.com/) app registered with specific Mall ID

## Getting Started

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Run the FastAPI backend server:
   ```bash
   uvicorn api:app --reload --port 3000
   ```

3. Open `dashboard.html` in your browser.
   For example, you can start a simple local server if needed, or simply double-click the `dashboard.html` file to open it in your browser. Or, you can serve it via python:
   ```bash
   python -m http.server 8080
   ```
   and access `http://localhost:8080/dashboard.html`.

   **Note on Localtunnel**: If you are using localtunnel and see a security warning, enter the Bypass IP: **`119.66.176.50`**.

   The frontend will automatically redirect you to Cafe24 to authenticate and redirect back upon success.

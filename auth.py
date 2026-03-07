import os
import json
import requests
from dotenv import load_dotenv

TOKEN_FILE = ".token_cache.json"

class Cafe24Client:
    def __init__(self):
        load_dotenv(override=True)
        self.mall_id = os.getenv("CAFE24_MALL_ID")
        self.client_id = os.getenv("CAFE24_CLIENT_ID")
        self.client_secret = os.getenv("CAFE24_CLIENT_SECRET")
        self.redirect_uri = os.getenv("REDIRECT_URI")
        self.base_url = f"https://{self.mall_id}.cafe24api.com/api/v2/admin"
        self.access_token = None
        self.refresh_token = None
        print(f"DEBUG: Cafe24Client initialized with Redirect URI: {self.redirect_uri}")
        self._load_token_from_file()

    def _load_token_from_file(self):
        """Load cached token from disk if it exists"""
        if os.path.exists(TOKEN_FILE):
            try:
                with open(TOKEN_FILE, 'r') as f:
                    data = json.load(f)
                    self.access_token = data.get('access_token')
                    self.refresh_token = data.get('refresh_token')
                    print(f"DEBUG: Loaded token from cache file")
            except Exception as e:
                print(f"DEBUG: Could not load token cache: {e}")

    def _save_token_to_file(self, token_data):
        """Persist token to disk so it survives server reloads"""
        try:
            with open(TOKEN_FILE, 'w') as f:
                json.dump({
                    'access_token': token_data.get('access_token'),
                    'refresh_token': token_data.get('refresh_token')
                }, f)
        except Exception as e:
            print(f"DEBUG: Could not save token cache: {e}")

    def get_authorize_url(self):
        # Scopes mapped from Developer Center screenshot:
        # 1. 앱 (Application): Read + Write -> mall.read_application mall.write_application
        # 2. 상품 (Product): Read -> mall.read_product
        # 3. 주문 (Order): Read -> mall.read_order
        # 4. 회원 (Customer): Read -> mall.read_customer
        # 5. 매출통계 (Salesreport): Read -> mall.read_salesreport
        # 6. 접속통계 (Analytics): Read -> mall.read_analytics
        scope = "mall.read_application mall.write_application mall.read_product mall.read_order mall.read_customer mall.read_salesreport mall.read_analytics"
        import uuid
        state = str(uuid.uuid4()) # Added state for CSRF
        url = (
            f"https://{self.mall_id}.cafe24api.com/api/v2/oauth/authorize"
            f"?response_type=code"
            f"&client_id={self.client_id}"
            f"&state={state}"
            f"&redirect_uri={self.redirect_uri}"
            f"&scope={scope}"
        )
        return url

    def fetch_token(self, code):
        import base64
        url = f"https://{self.mall_id}.cafe24api.com/api/v2/oauth/token"
        
        # Cafe24 requires Basic Auth with base64 encoded client_id:client_secret
        auth_str = f"{self.client_id}:{self.client_secret}"
        encoded_auth = base64.b64encode(auth_str.encode()).decode()
        
        headers = {
            "Authorization": f"Basic {encoded_auth}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.redirect_uri
        }
        response = requests.post(url, headers=headers, data=data)
        
        if response.status_code != 200:
            print(f"Token Fetch Error: {response.status_code} - {response.text}")
        response.raise_for_status()
        
        token_data = response.json()
        self.access_token = token_data.get("access_token")
        self.refresh_token = token_data.get("refresh_token")
        self._save_token_to_file(token_data)
        return token_data

    def refresh_access_token(self):
        if not self.refresh_token:
            raise Exception("No refresh token available")
            
        import base64
        url = f"https://{self.mall_id}.cafe24api.com/api/v2/oauth/token"
        auth_str = f"{self.client_id}:{self.client_secret}"
        encoded_auth = base64.b64encode(auth_str.encode()).decode()
        
        headers = {
            "Authorization": f"Basic {encoded_auth}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = {
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token
        }
        response = requests.post(url, headers=headers, data=data)
        
        if response.status_code != 200:
            print(f"Token Refresh Error: {response.status_code} - {response.text}")
        response.raise_for_status()
        
        token_data = response.json()
        self.access_token = token_data.get("access_token")
        # Cafe24 might return a new refresh token
        if "refresh_token" in token_data:
            self.refresh_token = token_data.get("refresh_token")
        self._save_token_to_file(token_data)
        return token_data

    def get_headers(self):
        if not self.access_token:
            raise Exception("No access token available. Please authenticate first.")
        # Cafe24 requires Authorization header with Bearer token
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }

    def call_api(self, endpoint, method="GET", params=None, data=None):
        url = f"{self.base_url}/{endpoint}"
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self.get_headers(),
                params=params,
                json=data,
                timeout=30
            )
            if response.status_code == 401:
                # Token might be expired, try refreshing
                self.refresh_access_token()
                response = requests.request(
                    method=method,
                    url=url,
                    headers=self.get_headers(),
                    params=params,
                    json=data
                )
            # Will raise for status except 401 to handle separately
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"API Call Failed: {e}")
            raise

# Global singleton client 
client = Cafe24Client()

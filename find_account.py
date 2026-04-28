import urllib.request
import json

import os

url = f"{os.getenv('SUPABASE_URL', '')}/auth/v1/token?grant_type=password"
headers = {
    "apikey": os.getenv("SUPABASE_ANON_KEY", ""),
    "Content-Type": "application/json"
}

import time
import concurrent.futures

def check_login(i):
    email = f"testpw{i}@pw.com"
    data = json.dumps({"email": email, "password": "pass123456"}).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        urllib.request.urlopen(req)
        return email
    except Exception as e:
        return None

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    futures = [executor.submit(check_login, i) for i in range(100, 1000)]
    for future in concurrent.futures.as_completed(futures):
        res = future.result()
        if res:
            print("FOUND:", res)
            executor.shutdown(wait=False, cancel_futures=True)
            break

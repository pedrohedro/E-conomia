import urllib.request
import json

import os

url = os.getenv("SUPABASE_URL", "") + "/rest/v1/profiles?select=*"
req = urllib.request.Request(url, headers={
    "apikey": os.getenv("SUPABASE_ANON_KEY", ""),
    "Authorization": f"Bearer {os.getenv('SUPABASE_ANON_KEY', '')}"
})

try:
    with urllib.request.urlopen(req) as response:
        print(response.read().decode())
except urllib.error.URLError as e:
    print(e.read().decode())

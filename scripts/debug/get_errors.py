from playwright.sync_api import sync_playwright
import sys

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        
        errors = []
        page.on("pageerror", lambda err: errors.append(f"PageError: {err}"))
        page.on("console", lambda msg: errors.append(f"Console {msg.type}: {msg.text}") if msg.type in ['error', 'warning'] else None)
        
        url = "https://e-conomia-crm-gamma.vercel.app/login.html"
        print(f"Navigating to {url}")
        page.goto(url, wait_until="networkidle")
        
        page.screenshot(path="artifacts/error_state.png")
        print("\n--- BROWSER ERRORS ---")
        for e in errors:
            print(e)
            
        browser.close()

if __name__ == "__main__":
    run()

from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        url = "https://e-conomia-crm-gamma.vercel.app"
        print(f"Navigating to {url}/login.html...")
        page.goto(f"{url}/login.html")
        
        # Display the registration tab directly using JS
        page.evaluate("document.getElementById('tab-register').style.display='block'")
        page.evaluate("document.getElementById('tab-login').style.display='none'")
        
        page.wait_for_timeout(500)
            
        print("Registering test account...")
        import random
        test_email = f"testpw{random.randint(100,999)}@pw.com"
        page.fill("#reg-name", "Test User PW")
        page.fill("#reg-email", test_email)
        page.fill("#reg-org", "Test PW Corp")
        page.fill("#reg-password", "pass123456")
        
        # We need to find the correct criate account button inside the register tab
        page.click("#tab-register button")
        
        print("Waiting for redirect...")
        try:
            page.wait_for_url("**/dashboard.html*", timeout=10000)
        except:
            print("Did not redirect, checking if success message showed up.")
            
        print("Forcing navigation to /vendas.html...")
        page.goto(f"{url}/vendas.html", wait_until="networkidle")
        page.wait_for_timeout(3000)
        
        print("Taking initial screenshot...")
        page.screenshot(path="artifacts/vendas_initial.png")
        
        print("Testing Theme Button...")
        page.click("#themeToggle")
        page.wait_for_timeout(1000)
        page.screenshot(path="artifacts/vendas_dark_mode.png")
        
        print("Testing 'Este Mês' Filter...")
        try:
            page.click("button[data-period='month']")
            page.wait_for_timeout(2000)
        except Exception as e:
            print("No filter button found:", e)
            
        page.screenshot(path="artifacts/vendas_filter.png")
        
        print("✅ Validation complete! Artifacts saved.")
        browser.close()

if __name__ == "__main__":
    run()

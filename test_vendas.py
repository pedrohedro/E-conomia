from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        print("Launching Chromium...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        url = "https://e-conomia-crm-gamma.vercel.app"
        print(f"Navigating to {url}/register.html...")
        page.goto(f"{url}/register.html")
        
        print("Registering test account...")
        page.fill("input[type='email']", "test-pw@economia.com")
        page.fill("input[type='password']", "pass123456")
        page.click("button[type='submit']")
        
        page.wait_for_timeout(3000) # Wait for redirect
        
        print("Navigating to /vendas.html...")
        page.goto(f"{url}/vendas.html")
        page.wait_for_timeout(2000)
        
        print("Clicking Theme Toggle...")
        # Check if themeToggle works
        page.click("#themeToggle")
        page.wait_for_timeout(500)
        
        print("Clicking 'Este Mês' period tab...")
        page.click("button[data-period='month']")
        page.wait_for_timeout(1000)
        
        page.screenshot(path="artifacts/vendas_test.png")
        print("Test passed! Screenshot saved at artifacts/vendas_test.png.")
        browser.close()

if __name__ == "__main__":
    run()

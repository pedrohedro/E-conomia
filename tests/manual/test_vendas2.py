from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        print("Launching Chromium...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        url = "https://e-conomia-crm-gamma.vercel.app"
        print(f"Navigating to {url}/login.html...")
        page.goto(f"{url}/login.html")
        
        print("Switching to Cadastro tab...")
        try:
            page.click("button:has-text('Criar conta')", timeout=3000)
        except:
            page.click("button.tab-btn:nth-child(2)") # Assuming it's the second tab for Cadastro
            
        page.wait_for_timeout(500)
            
        print("Registering test account...")
        import random
        r = random.randint(1000, 9999)
        test_email = f"test{r}@pw.com"
        page.fill("#reg-name", "Test User")
        page.fill("#reg-email", test_email)
        page.fill("#reg-org", "Test Company")
        page.fill("#reg-password", "pass123456")
        
        page.click("button:has-text('Criar conta')")
        
        # Wait for redirect to index or dashboard
        page.wait_for_url("**/dashboard.html*", timeout=10000)
        
        print("Navigating to /vendas.html...")
        page.goto(f"{url}/vendas.html", wait_until="networkidle")
        page.wait_for_timeout(2000)
        
        print("Clicking Theme Toggle...")
        page.click("#themeToggle")
        page.wait_for_timeout(500)
        page.screenshot(path="artifacts/vendas_test_theme.png")
        print("Screenshot of dark mode toggled saved to artifacts/vendas_test_theme.png.")
        
        print("Clicking 'Este Mês' period tab...")
        page.click("button[data-period='month']")
        page.wait_for_timeout(1000)
        
        page.screenshot(path="artifacts/vendas_test_filters.png")
        print("Screenshot of 'Este Mês' filter saved to artifacts/vendas_test_filters.png.")
        print("Test finished successfully!")
        
        browser.close()

if __name__ == "__main__":
    run()

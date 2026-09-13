from playwright.sync_api import sync_playwright

def fill_requisition(page):
    # 1. Log in first
    page.goto("http://localhost:3000")
    page.get_by_label("Email Address").fill("requestor@gmail.com")
    page.get_by_label("Password").fill("requestor123")
    page.get_by_role("button", name="Enter", exact=True).click()
    page.wait_for_load_state("networkidle")

    # 2. Go to the CapDev requests page for this project
    page.goto("http://localhost:3000/portal/capdev/10/requests")

    # 3. Click "Add Request" to open the form dialog
    page.get_by_role("button", name="Add Request").click()
    page.wait_for_selector("text=Description")

    # 4. "Setting" dropdown (MUI Select)
    page.get_by_label("Setting").click()
    page.get_by_role("option", name="Internal").click()

    # 5. Text fields -- instant fill, paced by slow_mo between each one
    page.get_by_label("Description").fill("Sample training session for staff")
    page.get_by_label("Requested Budget").fill("5000")
    page.get_by_label("Title").fill("Q3 Skills Training")
    page.get_by_label("Department").fill("IT")
    page.get_by_label("II. Target Participants").fill("Faculty Members")
    page.get_by_label("I. Rationale").fill("To upskill staff on new tools")
    page.get_by_label("III. Duration Methodology").fill("3.5 hrs")
    page.get_by_label("IV. PerformanceObjectives").fill("Improve proficiency in X")
    page.get_by_label("Unit Cost").fill("300")
    page.get_by_label("V. Learning Objectives").fill("Understand core concepts of X")
    page.get_by_label("Total").fill("15000")
    page.get_by_label("No. of  Pax").fill("5")
    page.get_by_label("Particulars").fill("Honorarium")
    page.get_by_label("No. of Days").fill("3")

    # 6. Save
    page.get_by_role("button", name="Save Request").click()

    print("Form filled and submitted.")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=1200)
    page = browser.new_page()
    fill_requisition(page)
    input("Press Enter to close the browser...")
    browser.close()
    

Author: Sudip Kundu

# 🌾 Offline Field Data App

I built this fully offline Progressive Web App (PWA) to solve a daily frustration in my breeding programs: collecting reliable field data without an internet connection. 

I was tired of dealing with soggy paper field books, messy data transcription, and heavy software that freezes when it loses signal. I needed a lightweight, flexible tool that works flawlessly in remote locations, allows for quick sub-sampling of traits, and feeds my raw data directly into my R and Python analytics pipelines.

---

## ✨ Why I Built This (Core Features)

* **📡 100% Offline-First:** Powered by Service Workers and IndexedDB. I can stand in the middle of a trial field with zero bars of service, and the app won't miss a beat.
* **📂 Dynamic Workspaces:** I can snap between different projects (like a Wheat MLT or a Mustard F4 trial) instantly. Each workspace gets its own isolated database.
* **🗺️ Flexible Trial Mapping:** I didn't want to force a specific Excel template. You just upload your existing CSV trial map, and the app dynamically aligns your Plot, Genotype, and Replication columns.
* **🌱 Sub-Sample Engine:** We rarely measure just one plant per plot. I built a dynamic sub-sampling tool so I can easily record 3, 5, or 10 observations for a single trait, keeping the raw data preserved for intra-plot variance and heritability calculations.
* **🚨 Real-Time QC:** A built-in Z-Score scanner catches "fat-finger" typos while I'm still standing in front of the plot, saving me hours of data-cleaning later.
* **📸 Offline Media Capture:** I can snap photos of morphological anomalies or disease symptoms right in the app. They safely sit in the tablet's browser memory until I get back to Wi-Fi.
* **☁️ Cloud Sync:** One tap pushes all my data and decoded images directly to my Google Drive and Google Sheets.

---

## 🧬 The "Data Splitter" Analytics Pipeline

When dealing with field data, there is always a conflict between wanting a clean spreadsheet for quick viewing and needing the raw, nested sub-samples for serious statistical modeling. 

To solve this, I wrote a custom Google Apps Script backend that acts as an intelligent data splitter. When I hit sync:
1. **Mean Calculation:** It calculates the true mean of my plot sub-samples and drops it into the primary trait column for easy reading.
2. **Variance Preservation:** It dynamically generates hidden "Raw" columns at the far right of the sheet, preserving every individual plant measurement.
3. **Image Routing:** It decodes the Base64 image strings, saves the actual JPEGs to a Google Drive folder, and drops a clickable link directly into the plot's row.

The result is a Google Sheet that is instantly ready to be pulled directly into `tidyverse` or `pandas` for GCA matrices or ANOVA.

---

## 🏗️ Tech Stack

* **Frontend:** Vanilla HTML5, CSS3, JavaScript (ES6+). No heavy frameworks.
* **Local Storage:** `IndexedDB` to handle massive trial datasets and Base64 images natively.
* **Backend:** Serverless Google Apps Script (GAS) acting as a REST API.
* **Storage:** Google Sheets (Relational Data) & Google Drive (Images).

---

## 🚀 How to Set It Up

If you want to use this for your own trials, here is how to deploy it:

### 1. Frontend Deployment (GitHub Pages)
1. Fork or clone this repository so `index.html`, `app.js`, `sw.js`, and `manifest.json` are in your root directory.
2. Go to **Settings > Pages** in your repo.
3. Set the Source to **Deploy from a branch** and select `main`.
4. Open the live URL on your tablet or phone and select "Add to Home Screen" to install it as an offline app.

### 2. Backend Setup (Google Apps Script)
To make the `☁️ Sync to Cloud` button work, you need to set up the router:

1. Create a folder in your Google Drive (e.g., `Field App Photos`) and **copy the Folder ID** from the URL.
2. Create a blank Google Sheet.
3. Click **Extensions > Apps Script**.
4. Paste the backend code (provided in the deployment steps of this project).
5. Replace `PASTE_YOUR_FOLDER_ID_HERE` with your actual Drive Folder ID.
6. Click **Deploy > New deployment**.
    * Type: **Web app**
    * Execute as: **Me**
    * Who has access: **Anyone**
7. **Copy the resulting Web App URL.**
8. Back in this code repository, open `app.js`, locate the `syncToCloud()` function, and paste your URL into the `GAS_URL` variable.
9. Commit the change, bump your `CACHE_NAME` version in `sw.js`, and refresh the app on your device!


Author: Sudip Kundu
#### Copyright (c) 2026 [Sudip Kundu]. All rights reserved.






Author: Sudip Kundu

# 🌾 Enterprise Field Data App

A high-performance, fully offline Progressive Web App (PWA) designed for plant breeders, agronomists, and field technicians. 

This tool eliminates the need for paper field books and fragile Excel spreadsheets. It allows for dynamic trial mapping, multi-observation sub-sampling, offline photo capture, and instantaneous cloud synchronization to Google Sheets for seamless integration into R and Python data pipelines.

---

## ✨ Core Features

* **📡 100% Offline-First Architecture:** Built as a PWA using Service Workers and IndexedDB. Works flawlessly in the middle of a field with zero internet connection.
* **📂 Dynamic Workspaces:** Switch between multiple crops or Multi-Location Trials (MLTs) on the fly (e.g., "Wheat_2026", "Mustard_F4"). Each workspace has its own isolated, high-capacity database.
* **🗺️ Flexible Trial Mapping:** Upload your existing field maps (CSV). The app dynamically maps your specific columns for Plot Number, Trial Name, Genotype, Replication, and Location.
* **🌱 Sub-Sample Engine:** Record multiple observations (plants) per plot for any trait. The app retains the raw data for intra-plot variance and broad-sense heritability calculations.
* **🚨 Real-Time Quality Control:** Built-in outlier detection using N-1 Sample Standard Deviation. Set Z-Score stringency (Medium, Strict, Very Strict) to catch "fat-finger" typos while still standing in front of the plot.
* **📸 Offline Media Capture:** Capture anomalies, disease symptoms, or morphological traits. Photos are stored securely in the local IndexedDB until a network connection is restored.
* **☁️ Smart Cloud Sync:** Push data directly to Google Sheets via a serverless Google Apps Script backend. 

---

## 🏗️ Architecture & Tech Stack

* **Frontend:** Vanilla HTML5, CSS3, JavaScript (ES6+).
* **Local Storage:** `IndexedDB` (Handles 500MB+ of data and Base64 image strings natively).
* **Offline Routing:** Service Workers (`sw.js`) with semantic versioning for seamless app updates without data loss.
* **Backend (Serverless):** Google Apps Script (GAS) acting as a REST API.
* **Data Storage:** Google Sheets (Relational Data) & Google Drive (Images).

---

## 🧬 The "Data Splitter" Analytics Pipeline

To satisfy both field managers (who need clean averages) and data scientists (who need raw variance), the Google Apps Script backend acts as an intelligent data splitter. 

When data is synced:
1. **Mean Calculation:** Calculates the true mean of plot sub-samples and places it in the primary trait column.
2. **Variance Preservation:** Dynamically generates hidden "Raw" columns at the far right of the spreadsheet to store individual plant observations.
3. **Image Routing:** Decodes Base64 image strings, saves them as JPEGs to Google Drive, and pastes a clickable URL directly into the plot's row.

This architecture ensures the resulting Google Sheet is instantly ready for General Combining Ability (GCA) matrices or ANOVA modeling in **R (tidyverse)** or **Python (pandas)**.

---

## 🚀 Setup & Installation

### 1. Frontend Deployment (GitHub Pages)
1. Fork or clone this repository.
2. Ensure `index.html`, `app.js`, `sw.js`, and `manifest.json` are in the root directory.
3. Go to **Settings > Pages**.
4. Set the Source to **Deploy from a branch** and select `main`.
5. Open the resulting URL on your mobile device/tablet and "Add to Home Screen" to install it as a native offline app.

### 2. Backend Setup (Google Apps Script)
To enable the `☁️ Sync to Cloud` button, you must deploy the Google Apps Script router:

1. Create a folder in Google Drive named `Field App Photos`. **Copy the Folder ID** from the URL.
2. Create a new Google Sheet.
3. In the Sheet, go to **Extensions > Apps Script**.
4. Paste the provided backend code (see documentation or `gas_backend.js` if extracted).
5. Replace `PASTE_YOUR_FOLDER_ID_HERE` with your Drive Folder ID.
6. Click **Deploy > New deployment**.
    * Type: **Web app**
    * Execute as: **Me**
    * Who has access: **Anyone**
7. **Copy the resulting Web App URL.**
8. In this repository, open `app.js`, locate the `syncToCloud()` function, and replace the `GAS_URL` variable with your new Web App URL.
9. Commit the change, bump the `CACHE_NAME` version in `sw.js`, and refresh your app!

---

## 🛠️ Usage Workflow

1. **Setup Workspace:** Open the app and create a new workspace (e.g., "Wheat MLT").
2. **Upload Trial Map:** Select your pre-generated CSV trial map. Map the Plot and Genotype columns.
3. **Define Traits:** Add the traits you will be scoring (e.g., Plant Height, Spike Length).
4. **Collect Data:** Move to the **By Plot** or **By Trait** tab. Enter data. Use the "+ Add observation" button for sub-sampling. Take photos as needed.
5. **Run QC:** Before leaving the field, navigate to the QC tab and run a scan to catch typos.
6. **Sync:** Once connected to Wi-Fi, click **Sync to Cloud** to push all data and photos to your Google Sheet.

Author: Sudip Kundu

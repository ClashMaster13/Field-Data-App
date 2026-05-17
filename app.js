// ============================================================================
// 1. SERVICE WORKER & ERROR TRACKING
// ============================================================================

// If the app crashes, this will pop up an alert telling you exactly which line broke.
window.onerror = function(msg, url, line) { alert("ERROR: " + msg + "\nLine: " + line); };

// This registers the offline cache so the app works without internet.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
}

// ============================================================================
// 2. THE INDEXED-DB DATABASE ENGINE
// ============================================================================
const DB_NAME = "FieldEnterpriseDB"; // The name of our massive offline database
const DB_VERSION = 1;

// This function opens the database and creates the tables if they don't exist
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = e => reject(e);
        request.onsuccess = e => resolve(e.target.result);
        request.onupgradeneeded = e => {
            const db = e.target.result;
            // Table for our crop workspaces (Wheat, Mustard, etc.)
            if (!db.objectStoreNames.contains('workspaces')) {
                db.createObjectStore('workspaces', { keyPath: 'ws_name' });
            }
            // Dedicated table for heavy photo data
            if (!db.objectStoreNames.contains('photos')) {
                db.createObjectStore('photos', { keyPath: 'id' });
            }
        };
    });
}

// ============================================================================
// 3. GLOBAL MEMORY (STATE)
// ============================================================================
// Load the master list of workspaces, or create 'Crop_1' if it's the first time
let workspaces = JSON.parse(localStorage.getItem('b_workspaces')) || ['Crop_1'];
let activeWS = localStorage.getItem('active_ws') || workspaces[0];

// Fallback: If the active workspace was deleted, default to the first one
if (!workspaces.includes(activeWS)) { 
    activeWS = workspaces[0]; 
    localStorage.setItem('active_ws', activeWS); 
}

// Variables to hold the currently loaded crop's data
let trialData = [];
let traits = [];
let scores = {};
let colMap = {};
let originalFileName = 'Field_Data';
let currentPlotIndex = 0;
let tempParsedData = []; 
let tempHeaders = [];

// ============================================================================
// 4. ASYNC LOADING & SAVING (Read/Write to Hard Drive)
// ============================================================================
// Pulls the current crop's data out of the database and into active memory
async function loadWorkspaceData() {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction('workspaces', 'readonly');
        const store = tx.objectStore('workspaces');
        const req = store.get(activeWS); // Get the specific crop's data
        req.onsuccess = e => {
            if (e.target.result) {
                const data = e.target.result;
                trialData = data.trialData || [];
                traits = data.traits || [];
                scores = data.scores || {};
                colMap = data.colMap || {};
                originalFileName = data.fileName || 'Field_Data';
            } else {
                // If it's a new workspace, load empty arrays
                trialData = []; traits = []; scores = {}; colMap = {}; originalFileName = 'Field_Data';
            }
            resolve();
        };
    });
}

// Saves the current crop's active memory back into the database
async function saveWorkspaceData() {
    const db = await initDB();
    const tx = db.transaction('workspaces', 'readwrite');
    tx.objectStore('workspaces').put({
        ws_name: activeWS,
        trialData: trialData,
        traits: traits,
        scores: scores,
        colMap: colMap,
        fileName: originalFileName
    });
}

// ============================================================================
// 5. STARTUP SCRIPT
// ============================================================================
// This runs the exact millisecond the app finishes loading on the screen
window.onload = async () => {
    populateWorkspaceDropdown();    // Fill the dropdown menu
    await loadWorkspaceData();      // Fetch the data from the hard drive
    updateSetupUI();                // Update the text on the screen
    if (trialData.length > 0) switchTab('tab-plot'); // Skip setup if a trial exists
};

// ============================================================================
// 6. WORKSPACE MANAGEMENT
// ============================================================================
// Fills the dropdown menu with all available crops
function populateWorkspaceDropdown() {
    const sel = document.getElementById('workspaceSelect');
    sel.innerHTML = workspaces.map(ws => `<option value="${ws}">📁 ${ws.replace(/_/g, ' ')}</option>`).join('');
    sel.value = activeWS;
}

// Switches memory banks when you select a different crop
function changeWorkspace() {
    localStorage.setItem('active_ws', document.getElementById('workspaceSelect').value);
    location.reload(); // Reload the app to fetch the new memory
}

// Creates a brand new, isolated database bucket for a new crop
function addWorkspace() {
    let rawName = document.getElementById('newWorkspaceName').value.trim();
    if (!rawName) return alert("Please enter a name for the new crop workspace.");
    
    let safeName = rawName.replace(/\s+/g, '_'); // Replace spaces with underscores
    if (!workspaces.includes(safeName)) {
        workspaces.push(safeName);
        localStorage.setItem('b_workspaces', JSON.stringify(workspaces));
        localStorage.setItem('active_ws', safeName);
        location.reload(); // Jump to the new workspace immediately
    } else { 
        alert("Workspace already exists!"); 
    }
}

// ============================================================================
// 7. UI NAVIGATION
// ============================================================================
// Hides all tabs except the one the user clicked on
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    
    const activeBtn = document.querySelector(`button[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // If switching to Plot or Trait tab, refresh their views
    if (tabId === 'tab-plot') renderPlotView();
    if (tabId === 'tab-trait') populateTraitSelector();
}

// ============================================================================
// 8. CSV UPLOADING & MAPPING
// ============================================================================
// Reads the uploaded file and breaks it down by commas
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    originalFileName = file.name;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const lines = e.target.result.split(/\r?\n/).filter(line => line.trim() !== '');
            if (lines.length < 2) throw new Error("File empty or missing headers.");

            // Bulletproof parser that ignores commas trapped inside quotes
            const parseLine = (str) => {
                let result = [], cell = '', inQuotes = false;
                for (let i = 0; i < str.length; i++) {
                    let char = str[i];
                    if (char === '"') inQuotes = !inQuotes;
                    else if (char === ',' && !inQuotes) { result.push(cell.trim()); cell = ''; }
                    else cell += char;
                }
                result.push(cell.trim());
                return result.map(c => c.replace(/^"|"$/g, '').trim());
            };

            tempHeaders = parseLine(lines[0]);
            tempParsedData = [];
            
            // Build the JSON database from the CSV rows
            for (let i = 1; i < lines.length; i++) {
                const values = parseLine(lines[i]);
                let rowObj = {};
                tempHeaders.forEach((header, index) => { rowObj[header] = values[index] || ''; });
                if (Object.values(rowObj).some(v => v !== '')) tempParsedData.push(rowObj);
            }

            // Show the mapping UI
            document.getElementById('mappingSection').style.display = 'block';
            document.getElementById('uploadStatus').innerHTML = `⏳ File read. Please map columns below.`;
            
            // Fill the mapping dropdowns with the CSV headers
            const dropdowns = ['mapPlot', 'mapTrial', 'mapGeno', 'mapRep', 'mapLoc'];
            dropdowns.forEach(id => {
                const sel = document.getElementById(id);
                sel.innerHTML = id === 'mapPlot' ? '' : '<option value="">-- None / N/A --</option>'; 
                sel.innerHTML += tempHeaders.map(h => `<option value="${h}">${h}</option>`).join('');
            });

            // Make the app guess which column is which based on keywords
            autoSelect('mapPlot', ['plot', 'plot_no', 'entry']);
            autoSelect('mapTrial', ['trial', 'trial_name', 'experiment']);
            autoSelect('mapGeno', ['genotype', 'line', 'entry_name', 'pedigree']);
            autoSelect('mapRep', ['rep', 'replication', 'block']);
            autoSelect('mapLoc', ['loc', 'location', 'site']);

        } catch (error) { alert("Error reading CSV: " + error.message); }
    };
    reader.readAsText(file);
}

// Helper function for the auto-guesser above
function autoSelect(elementId, guesses) {
    const sel = document.getElementById(elementId);
    for (let opt of sel.options) {
        if (guesses.some(g => opt.value.toLowerCase().includes(g))) { sel.value = opt.value; break; }
    }
}

// Saves the user's column choices and officially loads the trial into memory
function confirmMapping() {
    const plotCol = document.getElementById('mapPlot').value;
    if (!plotCol) return alert("You must select a Plot Number column.");

    colMap = {
        plot: plotCol,
        trial: document.getElementById('mapTrial').value,
        geno: document.getElementById('mapGeno').value,
        rep: document.getElementById('mapRep').value,
        loc: document.getElementById('mapLoc').value
    };

    trialData = tempParsedData;
    saveWorkspaceData(); // Async save to database
    
    document.getElementById('mappingSection').style.display = 'none';
    document.getElementById('uploadStatus').innerHTML = `✅ Loaded <b>${trialData.length}</b> plots.`;
    currentPlotIndex = 0;
    renderPlotView(); // Jump to the plotting screen
}

// Adds a new trait (like "Yield" or "Height") to the list
function addTrait() {
    const traitName = document.getElementById('newTraitName').value.trim();
    if (traitName && !traits.includes(traitName)) {
        traits.push(traitName);
        saveWorkspaceData(); // Async save
        document.getElementById('newTraitName').value = '';
        updateSetupUI();
    }
}

// Updates the text on the Setup screen to show what is currently loaded
function updateSetupUI() {
    let prettyWSName = activeWS.replace(/_/g, ' ');
    if (trialData.length > 0) {
        document.getElementById('uploadStatus').innerHTML = `
            <div style="background:#d4edda; color:#155724; padding:12px; border-radius:5px; margin-top:10px; border: 1px solid #c3e6cb;">
                <strong>✅ Active in ${prettyWSName}:</strong> ${originalFileName} <br>
                ${trialData.length} plots loaded. <b>Ready to score.</b>
            </div>`;
    } else {
        document.getElementById('uploadStatus').innerHTML = `No trial loaded in ${prettyWSName}.`;
    }
    // Render the list of traits
    document.getElementById('traitList').innerHTML = traits.map(t => `<li style="padding: 5px 0; border-bottom: 1px solid #eee;">${t}</li>`).join('');
}

// Instant-save function. Fires every time a number is typed into a box.
function saveScore(plotId, trait, value) {
    if (!scores[plotId]) scores[plotId] = {};
    scores[plotId][trait] = value;
    saveWorkspaceData(); // Fire and forget to IndexedDB
}

// ============================================================================
// 9. MEDIA CAPTURE (CAMERA)
// ============================================================================
// Converts a photo into a massive text string and saves it to the database
async function savePhoto(event, plotId) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64Image = e.target.result;
        
        // Show a tiny preview on the screen immediately
        document.getElementById('photoPreview').innerHTML = `<img src="${base64Image}" style="width: 100px; border-radius: 5px; border: 2px solid #28a745;">`;
        
        // Open the database and save the image text string
        const db = await initDB();
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put({
            id: `${activeWS}_${plotId}`, // Links the photo to this specific crop and plot
            image_data: base64Image,
            timestamp: new Date().toISOString()
        });
    };
    reader.readAsDataURL(file); // Triggers the conversion
}

// ============================================================================
// 10. VIEW 1: SCORE BY PLOT
// ============================================================================
// Renders the single-plot interface
async function renderPlotView() {
    if (trialData.length === 0 || !colMap.plot) return;
    const currentPlot = trialData[currentPlotIndex];
    const plotId = currentPlot[colMap.plot];
    const safePlotId = String(plotId).replace(/'/g, "\\'"); // Escapes weird characters in plot names

    // 1. Build the Metadata Header (Genotype, Trial Name, etc.)
    let metaHtml = `<h3 style="margin-bottom:5px; color:#007bff;">Plot: ${plotId}</h3><div style="font-size:14px; color:#444;">`;
    if (colMap.trial && currentPlot[colMap.trial]) metaHtml += `<strong style="color:#6c757d;">Trial:</strong> ${currentPlot[colMap.trial]} <br>`;
    if (colMap.geno && currentPlot[colMap.geno]) metaHtml += `<strong style="color:#28a745;">Genotype:</strong> ${currentPlot[colMap.geno]} <br>`;
    
    for (const [key, val] of Object.entries(currentPlot)) {
        if (key !== colMap.plot && key !== colMap.geno && key !== colMap.trial && val !== '') {
            metaHtml += `<strong style="color:#222;">${key}:</strong> ${val} <br>`;
        }
    }
    metaHtml += `</div>`;
    document.getElementById('plotMetaCard').innerHTML = metaHtml;

    // 2. Build the Trait Input Boxes
    let inputsHtml = '';
    traits.forEach(trait => {
        const existingVal = (scores[plotId] && scores[plotId][trait]) ? scores[plotId][trait] : '';
        inputsHtml += `
            <label>${trait}</label>
            <input type="number" step="any" value="${existingVal}" oninput="saveScore('${safePlotId}', '${trait}', this.value)" placeholder="Enter ${trait}...">
        `;
    });
    
    // 3. Add the Camera Button UI
    let cameraHtml = `
        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;">
            <label>📸 Capture Plot</label>
            <input type="file" accept="image/*" capture="environment" onchange="savePhoto(event, '${safePlotId}')">
            <div id="photoPreview" style="margin-top:10px;"></div>
        </div>
    `;

    document.getElementById('plotInputs').innerHTML = (inputsHtml || `<p style="color:#dc3545; font-weight:bold;">No traits defined.</p>`) + cameraHtml;

    // 4. Fetch an existing photo for this plot from the database (if they took one earlier)
    const db = await initDB();
    const tx = db.transaction('photos', 'readonly');
    const photoReq = tx.objectStore('photos').get(`${activeWS}_${plotId}`);
    photoReq.onsuccess = (e) => {
        if (e.target.result) {
            document.getElementById('photoPreview').innerHTML = `<img src="${e.target.result.image_data}" style="width: 100px; border-radius: 5px; border: 2px solid #28a745;">`;
        }
    };
}

// Moves to the next or previous plot
function navigatePlot(direction) {
    currentPlotIndex += direction;
    if (currentPlotIndex < 0) currentPlotIndex = 0;
    if (currentPlotIndex >= trialData.length) currentPlotIndex = trialData.length - 1;
    renderPlotView();
}

// Searches for a specific plot or genotype
function jumpTo() {
    const term = document.getElementById('searchPlot').value.toLowerCase().trim();
    if (!term) return;
    const index = trialData.findIndex(row => Object.values(row).some(val => String(val).toLowerCase().includes(term)));
    if (index !== -1) {
        currentPlotIndex = index;
        renderPlotView();
        document.getElementById('searchPlot').value = '';
    } else alert("Not found.");
}

// ============================================================================
// 11. VIEW 2: SCORE BY TRAIT
// ============================================================================
// Fills the dropdown with traits
function populateTraitSelector() {
    const sel = document.getElementById('traitSelector');
    sel.innerHTML = '<option value="">-- Choose Trait --</option>' + traits.map(t => `<option value="${t}">${t}</option>`).join('');
    document.getElementById('traitListView').innerHTML = '';
}

// Renders a long scrolling list of all plots for one specific trait
function renderTraitView() {
    const activeTrait = document.getElementById('traitSelector').value;
    if (!activeTrait || trialData.length === 0 || !colMap.plot) return;
    
    let html = '';
    trialData.forEach(row => {
        const plotId = row[colMap.plot];
        const genotype = colMap.geno ? row[colMap.geno] : ''; 
        const existingVal = (scores[plotId] && scores[plotId][activeTrait]) ? scores[plotId][activeTrait] : '';
        const safePlotId = String(plotId).replace(/'/g, "\\'");
        
        html += `
            <div class="trait-row" style="background: #fff; padding: 12px; margin-bottom: 8px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <div style="font-weight:bold; width:50%; font-size:16px;">Plot ${plotId} <br><span style="font-size:13px; font-weight:normal; color:#666;">${genotype}</span></div>
                <input type="number" step="any" value="${existingVal}" oninput="saveScore('${safePlotId}', '${activeTrait}', this.value)" style="width: 45%; font-size:16px;">
            </div>
        `;
    });
    document.getElementById('traitListView').innerHTML = html;
}

// ============================================================================
// 12. QUALITY CONTROL & OUTLIERS
// ============================================================================
// Calculates Sample Standard Deviation to find typos in the data
function runQC() {
    const resultsDiv = document.getElementById('qcResults');
    resultsDiv.innerHTML = '';
    let foundOutliers = false;
    const threshold = parseFloat(document.getElementById('qcThreshold').value) || 3.0; // Reads the strictness setting

    traits.forEach(trait => {
        let values = [], plotMapping = [];
        
        // Extract all numbers for this trait
        Object.keys(scores).forEach(plotId => {
            const rawVal = scores[plotId][trait];
            if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
                const val = parseFloat(rawVal);
                if (!isNaN(val)) { values.push(val); plotMapping.push({ plotId, val }); }
            }
        });

        const n = values.length;
        if (n > 2) {
            // Calculate Mean
            const mean = values.reduce((a, b) => a + b, 0) / n;
            // Calculate Sample Standard Deviation (N-1)
            const stdDev = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1));
            
            if (stdDev > 0) {
                plotMapping.forEach(entry => {
                    const zScore = Math.abs((entry.val - mean) / stdDev);
                    // If the Z-Score is higher than the strictness setting, flag it!
                    if (zScore >= threshold) {
                        foundOutliers = true;
                        resultsDiv.innerHTML += `
                            <div class="qc-alert qc-danger">
                                <strong>Plot ${entry.plotId}</strong>: ${trait} is <b>${entry.val}</b> (Z-Score: ${zScore.toFixed(2)}). 
                            </div>`;
                    }
                });
            }
        }
    });
    if (!foundOutliers) resultsDiv.innerHTML = `<div class="qc-alert" style="background:#d4edda; color:#155724;">✅ All data looks normal.</div>`;
}

// ============================================================================
// 13. EXPORT, SYNC & WIPE
// ============================================================================
// Packages the CSV into a Blob memory block and downloads it
function exportData() {
    if (trialData.length === 0) return alert("No trial data to export.");

    const baseHeaders = Object.keys(trialData[0]);
    const plotIdCol = colMap.plot || baseHeaders[0];
    const allHeaders = [...baseHeaders, ...traits];
    let csvContent = allHeaders.join(',') + "\n";

    trialData.forEach(row => {
        let rowArray = baseHeaders.map(h => {
            let val = row[h] ? String(row[h]) : '';
            return (val.includes(',') || val.includes('"')) ? `"${val.replace(/"/g, '""')}"` : val;
        });
        const plotId = row[plotIdCol];
        traits.forEach(trait => rowArray.push((scores[plotId] && scores[plotId][trait]) ? scores[plotId][trait] : ''));
        csvContent += rowArray.join(',') + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${originalFileName.replace('.csv', '')}_Scored.csv`);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// The Grand Finale: Pushing local data and photos to Google Sheets
async function syncToCloud() {
    const syncBtn = document.getElementById('syncBtn');
    syncBtn.innerText = "⏳ Gathering Data & Photos...";
    
    try {
        // 1. Gather all photos from the database for this specific crop
        const db = await initDB();
        const photosToSync = {};
        
        await new Promise((resolve) => {
            const tx = db.transaction('photos', 'readonly');
            const store = tx.objectStore('photos');
            const cursorReq = store.openCursor();
            
            cursorReq.onsuccess = e => {
                const cursor = e.target.result;
                if (cursor) {
                    // Only grab photos that belong to the active workspace
                    if (cursor.key.startsWith(activeWS + '_')) {
                        photosToSync[cursor.key] = cursor.value.image_data;
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };
        });

        // 2. Package the payload with the data, scores, and photos
        const payload = { 
            workspace: activeWS, 
            data: trialData, 
            scores: scores,
            traits: traits,
            photos: photosToSync, 
            plotCol: colMap.plot // <--- ADD THIS LINE! (Tells the script which column is the Plot ID)
        };
        
        syncBtn.innerText = "🚀 Pushing to Cloud...";
        
        // 3. Fire it at your Google App Script
        const GAS_URL = "https://script.google.com/macros/s/AKfycbwkJZx5sNojar_Z10glpIp3aSX_C2cUUKm6MUtuHnEPzKY4hwcI09nQGVAI-2r6zj_e/exec"; 
        
        // Use text/plain to bypass Google's strict CORS security blocks
        const response = await fetch(GAS_URL, {
            redirect: "follow",
            method: 'POST',
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            alert("✅ Data and Photos successfully synced to Google Sheets!");
        } else {
            throw new Error(result.message);
        }
    } catch (err) {
        alert("❌ Sync failed. Error: " + err.message);
    }
    
    syncBtn.innerText = "☁️ Sync to Cloud";
}

// Safely deletes data from IndexedDB
async function clearDatabase() {
    let prettyWSName = activeWS.replace(/_/g, ' ');
    
    if (confirm(`WARNING: This deletes ALL data and photos for "${prettyWSName}". Export or Sync first?`)) {
        const db = await initDB();
        const tx = db.transaction(['workspaces', 'photos'], 'readwrite');
        
        // Delete the text data
        tx.objectStore('workspaces').delete(activeWS);
        
        // Delete ONLY the photos that belong to this workspace
        const photoStore = tx.objectStore('photos');
        const cursorReq = photoStore.openCursor();
        cursorReq.onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) {
                if (cursor.key.startsWith(activeWS + '_')) cursor.delete();
                cursor.continue();
            }
        };

        // Once the wipe is complete, ask if they want to remove the name from the menu entirely
        tx.oncomplete = () => {
            if (confirm(`Do you also want to remove "${prettyWSName}" from the menu?`)) {
                workspaces = workspaces.filter(ws => ws !== activeWS);
                if (workspaces.length === 0) workspaces = ['Crop_1'];
                localStorage.setItem('b_workspaces', JSON.stringify(workspaces));
                localStorage.setItem('active_ws', workspaces[0]);
            }
            location.reload();
        };
    }
}

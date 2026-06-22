// ============================================================================
// 1. SYSTEM SETUP & ERROR TRACKING
// ============================================================================
// If the app crashes, this pops up an alert telling you which line broke
window.onerror = function(msg, url, line) { alert("ERROR: " + msg + "\nLine: " + line); };

// Registers the offline cache (Service Worker) so the app works without internet
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
}

// ============================================================================
// 2. THE INDEXED-DB DATABASE ENGINE
// ============================================================================
const DB_NAME = "FieldEnterpriseDB"; // High-capacity offline database name
const DB_VERSION = 1;

// Opens the database and creates the tables if they don't exist
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = e => reject(e);
        request.onsuccess = e => resolve(e.target.result);
        request.onupgradeneeded = e => {
            const db = e.target.result;
            // Table for crop workspaces (Wheat, Mustard, etc.)
            if (!db.objectStoreNames.contains('workspaces')) {
                db.createObjectStore('workspaces', { keyPath: 'ws_name' });
            }
            // Dedicated table for massive photo data
            if (!db.objectStoreNames.contains('photos')) {
                db.createObjectStore('photos', { keyPath: 'id' });
            }
        };
    });
}

// ============================================================================
// 3. GLOBAL MEMORY (STATE)
// ============================================================================
// Load master list of workspaces, default to 'Crop_1'
let workspaces = JSON.parse(localStorage.getItem('b_workspaces')) || ['Crop_1'];
let activeWS = localStorage.getItem('active_ws') || workspaces[0];

// Fallback: If active workspace was deleted, switch to the first available one
if (!workspaces.includes(activeWS)) { 
    activeWS = workspaces[0]; 
    localStorage.setItem('active_ws', activeWS); 
}

// Variables holding the currently loaded crop's data
let trialData = [];
let traits = [];
let scores = {};
let colMap = {};
let originalFileName = 'Field_Data';
let currentPlotIndex = 0;
let tempParsedData = []; 
let tempHeaders = [];

// Helper to prevent XSS by escaping HTML tags in user-uploaded data
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
}

// ============================================================================
// 4. HARD DRIVE READ / WRITE FUNCTIONS
// ============================================================================
// Pulls the current crop's data out of IndexedDB and into active memory
async function loadWorkspaceData() {
    const db = await initDB();
    return new Promise((resolve) => {
        const tx = db.transaction('workspaces', 'readonly');
        const store = tx.objectStore('workspaces');
        const req = store.get(activeWS);
        req.onsuccess = e => {
            if (e.target.result) {
                const data = e.target.result;
                trialData = data.trialData || [];
                traits = data.traits || [];
                scores = data.scores || {};
                colMap = data.colMap || {};
                originalFileName = data.fileName || 'Field_Data';
            } else {
                trialData = []; traits = []; scores = {}; colMap = {}; originalFileName = 'Field_Data';
            }
            resolve();
        };
    });
}

// Saves the current crop's memory back into IndexedDB
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
// Runs the exact millisecond the app loads on screen
window.onload = async () => {
    populateWorkspaceDropdown();
    await loadWorkspaceData();
    updateSetupUI();
    if (trialData.length > 0) switchTab('tab-plot');
};

// ============================================================================
// 6. WORKSPACE MANAGEMENT
// ============================================================================
function populateWorkspaceDropdown() {
    const sel = document.getElementById('workspaceSelect');
    sel.innerHTML = workspaces.map(ws => `<option value="${ws}">📁 ${ws.replace(/_/g, ' ')}</option>`).join('');
    sel.value = activeWS;
}

function changeWorkspace() {
    localStorage.setItem('active_ws', document.getElementById('workspaceSelect').value);
    location.reload(); // Reload to fetch new memory
}

function addWorkspace() {
    let rawName = document.getElementById('newWorkspaceName').value.trim();
    if (!rawName) return alert("Please enter a name for the new crop workspace.");
    
    let safeName = rawName.replace(/\s+/g, '_'); 
    if (!workspaces.includes(safeName)) {
        workspaces.push(safeName);
        localStorage.setItem('b_workspaces', JSON.stringify(workspaces));
        localStorage.setItem('active_ws', safeName);
        location.reload();
    } else { 
        alert("Workspace already exists!"); 
    }
}

// ============================================================================
// 7. UI NAVIGATION & TABS
// ============================================================================
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    
    const activeBtn = document.querySelector(`button[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (tabId === 'tab-plot') renderPlotView();
    if (tabId === 'tab-trait') populateTraitSelector();
}

// ============================================================================
// 8. CSV UPLOAD & MAPPING
// ============================================================================
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    originalFileName = file.name;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const lines = e.target.result.split(/\r?\n/).filter(line => line.trim() !== '');
            if (lines.length < 2) throw new Error("File empty or missing headers.");

            // Bulletproof RFC 4180 CSV parser supporting escaped quotes
            const parseLine = (str) => {
                let result = [];
                let cell = '';
                let inQuotes = false;
                for (let i = 0; i < str.length; i++) {
                    if (str[i] === '"') {
                        if (inQuotes && str[i + 1] === '"') {
                            cell += '"'; // Handle escaped quotes ("")
                            i++;
                        } else {
                            inQuotes = !inQuotes; // Toggle quote state
                        }
                    } else if (str[i] === ',' && !inQuotes) {
                        result.push(cell.trim());
                        cell = '';
                    } else {
                        cell += str[i];
                    }
                }
                result.push(cell.trim());
                return result;
            };

            tempHeaders = parseLine(lines[0]);
            tempParsedData = [];
            
            for (let i = 1; i < lines.length; i++) {
                const values = parseLine(lines[i]);
                let rowObj = {};
                tempHeaders.forEach((header, index) => { rowObj[header] = values[index] || ''; });
                if (Object.values(rowObj).some(v => v !== '')) tempParsedData.push(rowObj);
            }

            document.getElementById('mappingSection').style.display = 'block';
            document.getElementById('uploadStatus').innerHTML = `⏳ File read. Please map columns below.`;
            
            const dropdowns = ['mapPlot', 'mapTrial', 'mapGeno', 'mapRep', 'mapLoc'];
            dropdowns.forEach(id => {
                const sel = document.getElementById(id);
                sel.innerHTML = id === 'mapPlot' ? '' : '<option value="">-- None / N/A --</option>'; 
                sel.innerHTML += tempHeaders.map(h => `<option value="${escapeHTML(h)}">${escapeHTML(h)}</option>`).join('');
            });

            autoSelect('mapPlot', ['plot', 'plot_no', 'entry']);
            autoSelect('mapTrial', ['trial', 'trial_name', 'experiment']);
            autoSelect('mapGeno', ['genotype', 'line', 'entry_name', 'pedigree']);
            autoSelect('mapRep', ['rep', 'replication', 'block']);
            autoSelect('mapLoc', ['loc', 'location', 'site']);

        } catch (error) { alert("Error reading CSV: " + error.message); }
    };
    reader.readAsText(file);
}

function autoSelect(elementId, guesses) {
    const sel = document.getElementById(elementId);
    for (let opt of sel.options) {
        if (guesses.some(g => opt.value.toLowerCase().includes(g))) { sel.value = opt.value; break; }
    }
}

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
    saveWorkspaceData(); 
    
    document.getElementById('mappingSection').style.display = 'none';
    document.getElementById('uploadStatus').innerHTML = `✅ Loaded <b>${trialData.length}</b> plots.`;
    currentPlotIndex = 0;
    renderPlotView(); 
}

function addTrait() {
    const traitName = document.getElementById('newTraitName').value.trim();
    if (traitName && !traits.includes(traitName)) {
        traits.push(traitName);
        saveWorkspaceData(); 
        document.getElementById('newTraitName').value = '';
        updateSetupUI();
    }
}

function updateSetupUI() {
    let prettyWSName = activeWS.replace(/_/g, ' ');
    if (trialData.length > 0) {
        document.getElementById('uploadStatus').innerHTML = `
            <div style="background:#d4edda; color:#155724; padding:12px; border-radius:5px; margin-top:10px; border: 1px solid #c3e6cb;">
                <strong>✅ Active in ${escapeHTML(prettyWSName)}:</strong> ${escapeHTML(originalFileName)} <br>
                ${trialData.length} plots loaded. <b>Ready to score.</b>
            </div>`;
    } else {
        document.getElementById('uploadStatus').innerHTML = `No trial loaded in ${escapeHTML(prettyWSName)}.`;
    }
    document.getElementById('traitList').innerHTML = traits.map(t => `<li style="padding: 5px 0; border-bottom: 1px solid #eee;">${t}</li>`).join('');
}

// ============================================================================
// 9. THE SUB-SAMPLE ENGINE (Multi-Observation Logic)
// ============================================================================
// Forces all data into an Array format so we can hold multiple plants
function getScoreArray(plotId, trait) {
    if (!scores[plotId]) scores[plotId] = {};
    let val = scores[plotId][trait];
    if (val === undefined || val === null || val === '') return ['']; // Start with 1 empty box
    if (!Array.isArray(val)) return [val]; // Converts old single scores to arrays safely
    return val;
}

// Updates a specific plant's score (e.g., Plant 2)
function updateArrayScore(plotId, trait, index, value) {
    let arr = getScoreArray(plotId, trait);
    arr[index] = value;
    scores[plotId][trait] = arr;
    saveWorkspaceData(); 
}

// Spawns a new empty input box for a new observation
function addArrayInput(plotId, trait) {
    let arr = getScoreArray(plotId, trait);
    arr.push(''); 
    scores[plotId][trait] = arr;
    saveWorkspaceData();
    renderPlotView(); // Refresh screen
    renderTraitView(); // Refresh trait view
}

// Deletes a specific observation box
function removeArrayScore(plotId, trait, index) {
    let arr = getScoreArray(plotId, trait);
    arr.splice(index, 1); 
    scores[plotId][trait] = arr;
    saveWorkspaceData();
    renderPlotView(); // Refresh screen
    renderTraitView(); // Refresh trait view
}

// ============================================================================
// 10. MEDIA CAPTURE (CAMERA)
// ============================================================================
async function savePhoto(event, plotId) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64Image = e.target.result;
        
        const db = await initDB();
        const tx = db.transaction('photos', 'readwrite');
        const uniqueId = `${activeWS}_${plotId}_${Date.now()}`;
        tx.objectStore('photos').put({
            id: uniqueId, 
            image_data: base64Image,
            timestamp: new Date().toISOString()
        });
        
        tx.oncomplete = () => renderPlotPhotos(plotId);
    };
    reader.readAsDataURL(file); 
}

async function deletePhoto(photoId, plotId) {
    if (!confirm("Are you sure you want to delete this photo?")) return;
    const db = await initDB();
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(photoId);
    tx.oncomplete = () => renderPlotPhotos(plotId);
}

async function renderPlotPhotos(plotId) {
    const db = await initDB();
    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    
    let photosHtml = '';
    const safePlotId = String(plotId).replace(/'/g, "\\'");
    
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            // Check if this photo belongs to the current active workspace and plot
            if (cursor.key === `${activeWS}_${plotId}` || cursor.key.startsWith(`${activeWS}_${plotId}_`)) {
                photosHtml += `
                    <div style="display:inline-block; position:relative; margin-right:10px; margin-bottom:10px;">
                        <img src="${cursor.value.image_data}" style="height: 100px; border-radius: 5px; border: 2px solid #28a745; object-fit: cover;">
                        <button onclick="deletePhoto('${cursor.key}', '${safePlotId}')" style="position:absolute; top:-10px; right:-10px; background:#dc3545; color:white; border:none; border-radius:50%; width:24px; height:24px; cursor:pointer; font-weight:bold; padding:0; line-height:24px; text-align:center;">&times;</button>
                    </div>`;
            }
            cursor.continue();
        } else {
            document.getElementById('photoPreview').innerHTML = photosHtml;
        }
    };
}

// ============================================================================
// 11. VIEW 1: SCORE BY PLOT
// ============================================================================
async function renderPlotView() {
    if (trialData.length === 0 || !colMap.plot) return;
    const currentPlot = trialData[currentPlotIndex];
    const plotId = currentPlot[colMap.plot];
    const safePlotId = String(plotId).replace(/'/g, "\\'"); 

    // Metadata Header
    let metaHtml = `<h3 style="margin-bottom:5px; color:#007bff;">Plot: ${escapeHTML(plotId)}</h3><div style="font-size:14px; color:#444;">`;
    if (colMap.trial && currentPlot[colMap.trial]) metaHtml += `<strong style="color:#6c757d;">Trial:</strong> ${escapeHTML(currentPlot[colMap.trial])} <br>`;
    if (colMap.geno && currentPlot[colMap.geno]) metaHtml += `<strong style="color:#28a745;">Genotype:</strong> ${escapeHTML(currentPlot[colMap.geno])} <br>`;
    
    for (const [key, val] of Object.entries(currentPlot)) {
        if (key !== colMap.plot && key !== colMap.geno && key !== colMap.trial && val !== '') {
            metaHtml += `<strong style="color:#222;">${escapeHTML(key)}:</strong> ${escapeHTML(val)} <br>`;
        }
    }
    metaHtml += `</div>`;
    document.getElementById('plotMetaCard').innerHTML = metaHtml;

    // Build the Trait Input Boxes (With Sub-Sample Logic)
    let inputsHtml = '';
    traits.forEach(trait => {
        let vals = getScoreArray(plotId, trait);
        
        // Loop through the array and build an input box for each observation
        let inputsStr = vals.map((v, idx) => `
            <div style="display:flex; gap:5px; margin-top:5px;">
                <input type="number" step="any" value="${v}" 
                       oninput="updateArrayScore('${safePlotId}', '${trait}', ${idx}, this.value)" 
                       placeholder="Plant ${idx + 1}...">
                ${idx > 0 ? `<button onclick="removeArrayScore('${safePlotId}', '${trait}', ${idx})" style="width:40px; background:#dc3545; color:white; border:none; border-radius:5px; margin-top:0; padding:10px;">✖</button>` : ''}
            </div>
        `).join('');

        inputsHtml += `
            <div style="background:#f8f9fa; padding:10px; border-radius:5px; margin-top:10px; border:1px solid #ddd;">
                <label style="margin-top:0;">${trait}</label>
                <div id="trait_wrapper_${safePlotId}_${trait}">${inputsStr}</div>
                <button onclick="addArrayInput('${safePlotId}', '${trait}')" style="background:none; border:none; color:#007bff; font-weight:bold; padding:5px 0 0 0; text-align:left; cursor:pointer; width:auto; margin-top:5px; font-size:13px;">+ Add another observation</button>
            </div>
        `;
    });
    
    // Add Camera UI
    let cameraHtml = `
        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;">
            <label>📸 Capture Plot</label>
            <input type="file" accept="image/*" capture="environment" onchange="savePhoto(event, '${safePlotId}')">
            <div id="photoPreview" style="margin-top:10px;"></div>
        </div>
    `;

    document.getElementById('plotInputs').innerHTML = (inputsHtml || `<p style="color:#dc3545; font-weight:bold;">No traits defined.</p>`) + cameraHtml;

    // Fetch existing photo for this plot
    renderPlotPhotos(plotId);
}

function navigatePlot(direction) {
    currentPlotIndex += direction;
    if (currentPlotIndex < 0) currentPlotIndex = 0;
    if (currentPlotIndex >= trialData.length) currentPlotIndex = trialData.length - 1;
    renderPlotView();
}

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
// 12. VIEW 2: SCORE BY TRAIT
// ============================================================================
function populateTraitSelector() {
    const sel = document.getElementById('traitSelector');
    sel.innerHTML = '<option value="">-- Choose Trait --</option>' + traits.map(t => `<option value="${t}">${t}</option>`).join('');
    document.getElementById('traitListView').innerHTML = '';
}

function renderTraitView() {
    const activeTrait = document.getElementById('traitSelector').value;
    if (!activeTrait || trialData.length === 0 || !colMap.plot) return;
    
    let html = '';
    trialData.forEach(row => {
        const plotId = row[colMap.plot];
        const genotype = colMap.geno ? row[colMap.geno] : ''; 
        const safePlotId = String(plotId).replace(/'/g, "\\'");
        
        let vals = getScoreArray(plotId, activeTrait);
        
        // For trait view, we show all current observations side-by-side
        let inputsStr = vals.map((v, idx) => `
            <input type="number" step="any" value="${escapeHTML(v)}" 
                   oninput="updateArrayScore('${safePlotId}', '${activeTrait}', ${idx}, this.value)" 
                   placeholder="P${idx+1}" style="width: 60px; display:inline-block; margin-right:5px; padding:5px; margin-bottom: 5px;">
        `).join('');
        
        // Add a "+" button to allow sub-sampling directly from the Trait view
        inputsStr += `<button onclick="addArrayInput('${safePlotId}', '${activeTrait}')" style="width: 32px; padding: 5px; background: #007bff; color: white; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; display: inline-block; margin-bottom: 5px; vertical-align: top;">+</button>`;
        
        html += `
            <div class="trait-row" style="background: #fff; padding: 12px; margin-bottom: 8px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <div style="font-weight:bold; width:40%; font-size:16px;">Plot ${escapeHTML(plotId)} <br><span style="font-size:13px; font-weight:normal; color:#666;">${escapeHTML(genotype)}</span></div>
                <div style="width:60%; text-align:right;">${inputsStr}</div>
            </div>
        `;
    });
    document.getElementById('traitListView').innerHTML = html;
}

// ============================================================================
// 13. QUALITY CONTROL & OUTLIERS
// ============================================================================
function runQC() {
    const resultsDiv = document.getElementById('qcResults');
    resultsDiv.innerHTML = '';
    let foundOutliers = false;
    const threshold = parseFloat(document.getElementById('qcThreshold').value) || 3.0; 

    traits.forEach(trait => {
        let values = [], plotMapping = [];
        
        // Loop through plots and unpack the arrays
        Object.keys(scores).forEach(plotId => {
            let vals = getScoreArray(plotId, trait);
            vals.forEach(rawVal => {
                if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
                    const val = parseFloat(rawVal);
                    if (!isNaN(val)) { 
                        values.push(val); 
                        plotMapping.push({ plotId, val }); 
                    }
                }
            });
        });

        const n = values.length;
        if (n > 2) {
            const mean = values.reduce((a, b) => a + b, 0) / n;
            const stdDev = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1));
            
            if (stdDev > 0) {
                plotMapping.forEach(entry => {
                    const zScore = Math.abs((entry.val - mean) / stdDev);
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
// 14. EXPORT, SYNC & WIPE
// ============================================================================
function exportData() {
    if (trialData.length === 0) return alert("No trial data to export.");

    // ------------------------------------------------------------------------
    // STEP A: SCAN FOR MAXIMUM SUB-SAMPLES
    // ------------------------------------------------------------------------
    let maxObs = {};
    traits.forEach(t => maxObs[t] = 1); // Assume at least 1 observation

    // Read through the data to find the highest number of plants measured per trait
    Object.keys(scores).forEach(plotId => {
        traits.forEach(t => {
            // Get the array of scores and remove empty blanks
            let vals = getScoreArray(plotId, t).filter(v => v !== '');
            if (vals.length > maxObs[t]) { maxObs[t] = vals.length; }
        });
    });

    // ------------------------------------------------------------------------
    // STEP B: BUILD THE DYNAMIC HEADERS
    // ------------------------------------------------------------------------
    const baseHeaders = Object.keys(trialData[0]);
    const plotIdCol = colMap.plot || baseHeaders[0];
    
    let allHeaders = [...baseHeaders];
    
    // 1. Add Main Trait Headers (Will hold the calculated Mean)
    traits.forEach(t => allHeaders.push(`${t} (Mean)`));
    
    // 2. Add the "Raw/Hidden" Columns at the far right
    traits.forEach(t => {
        if (maxObs[t] > 1) {
            for (let k = 1; k <= maxObs[t]; k++) {
                allHeaders.push(`${t}_Raw_${k}`);
            }
        }
    });

    let csvContent = allHeaders.join(',') + "\n";

    // ------------------------------------------------------------------------
    // STEP C: PROCESS THE DATA
    // ------------------------------------------------------------------------
    trialData.forEach(row => {
        // 1. Push base CSV data (safely handling commas inside text)
        let rowArray = baseHeaders.map(h => {
            let val = row[h] ? String(row[h]) : '';
            return (val.includes(',') || val.includes('"')) ? `"${val.replace(/"/g, '""')}"` : val;
        });

        const plotId = row[plotIdCol];
        let rawValuesPerTrait = {};

        // 2. Calculate Means & Save Raw Data Temporarily
        traits.forEach(trait => {
            let vals = getScoreArray(plotId, trait).filter(v => v !== '');
            rawValuesPerTrait[trait] = vals; // Save the raw numbers

            if (vals.length > 0) {
                // Add up all the numbers and divide by how many there are
                let sum = vals.reduce((a, b) => a + parseFloat(b), 0);
                rowArray.push(sum / vals.length); // Push the Mean
            } else {
                rowArray.push(""); // Leave blank if no data
            }
        });

        // 3. Unload the Raw Data into the far-right columns
        traits.forEach(trait => {
            if (maxObs[trait] > 1) {
                let raws = rawValuesPerTrait[trait];
                for (let k = 0; k < maxObs[trait]; k++) {
                    rowArray.push(raws[k] || ""); // Push raw number or leave blank
                }
            }
        });

        // Add the finished row to the CSV text
        csvContent += rowArray.join(',') + "\n";
    });

    // ------------------------------------------------------------------------
    // STEP D: DOWNLOAD THE FILE
    // ------------------------------------------------------------------------
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
// Push to Google Sheets
async function syncToCloud() {
    const syncBtn = document.getElementById('syncBtn');
    syncBtn.innerText = "⏳ Gathering Data & Photos...";
    
    try {
        // 1. Gather Photos
        const db = await initDB();
        const photosToSync = {};
        
        await new Promise((resolve) => {
            const tx = db.transaction('photos', 'readonly');
            const store = tx.objectStore('photos');
            const cursorReq = store.openCursor();
            
            cursorReq.onsuccess = e => {
                const cursor = e.target.result;
                if (cursor) {
                    if (cursor.key.startsWith(activeWS + '_')) {
                        photosToSync[cursor.key] = cursor.value.image_data;
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };
        });

        // 2. Flatten the array scores for Google Sheets
        let flattenedScores = {};
        Object.keys(scores).forEach(pId => {
            flattenedScores[pId] = {};
            traits.forEach(t => {
                let valArr = getScoreArray(pId, t).filter(v => v !== '');
                flattenedScores[pId][t] = valArr.length > 0 ? valArr.join(' ; ') : '';
            });
        });

        // 3. Package Payload
        const payload = { 
            workspace: activeWS, 
            data: trialData, 
            scores: flattenedScores, 
            traits: traits,
            photos: photosToSync,
            plotCol: colMap.plot 
        };
        
        syncBtn.innerText = "🚀 Pushing to Cloud...";
        
        // 4. FIRE! (Using your newly provided Google URL)
        const GAS_URL = "https://script.google.com/macros/s/AKfycbwkJZx5sNojar_Z10glpIp3aSX_C2cUUKm6MUtuHnEPzKY4hwcI09nQGVAI-2r6zj_e/exec"; 
        
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

// Safely clear IDB
async function clearDatabase() {
    let prettyWSName = activeWS.replace(/_/g, ' ');
    
    if (confirm(`WARNING: This deletes ALL data and photos for "${prettyWSName}". Export or Sync first?`)) {
        const db = await initDB();
        const tx = db.transaction(['workspaces', 'photos'], 'readwrite');
        
        tx.objectStore('workspaces').delete(activeWS);
        
        const photoStore = tx.objectStore('photos');
        const cursorReq = photoStore.openCursor();
        cursorReq.onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) {
                if (cursor.key.startsWith(activeWS + '_')) cursor.delete();
                cursor.continue();
            }
        };

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
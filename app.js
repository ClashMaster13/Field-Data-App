// Register Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
}

// --- PHASE 2: INDEXED-DB ENGINE ---
const DB_NAME = "FieldEnterpriseDB";
const DB_VERSION = 1;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = e => reject(e);
        request.onsuccess = e => resolve(e.target.result);
        request.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('workspaces')) {
                db.createObjectStore('workspaces', { keyPath: 'ws_name' });
            }
            if (!db.objectStoreNames.contains('photos')) {
                db.createObjectStore('photos', { keyPath: 'id' });
            }
        };
    });
}

// Global Application State
let workspaces = JSON.parse(localStorage.getItem('b_workspaces')) || ['Crop_1'];
let activeWS = localStorage.getItem('active_ws') || workspaces[0];
if (!workspaces.includes(activeWS)) { activeWS = workspaces[0]; localStorage.setItem('active_ws', activeWS); }

// Workspace Data Memory
let trialData = [];
let traits = [];
let scores = {};
let colMap = {};
let originalFileName = 'Field_Data';
let currentPlotIndex = 0;
let tempParsedData = []; 
let tempHeaders = [];

// --- ASYNC DATA LOADING & SAVING ---
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

// Initialize App
window.onload = async () => {
    populateWorkspaceDropdown();
    await loadWorkspaceData();
    updateSetupUI();
    if (trialData.length > 0) switchTab('tab-plot');
};

// --- WORKSPACE MANAGEMENT ---
function populateWorkspaceDropdown() {
    const sel = document.getElementById('workspaceSelect');
    sel.innerHTML = workspaces.map(ws => `<option value="${ws}">📁 ${ws.replace(/_/g, ' ')}</option>`).join('');
    sel.value = activeWS;
}

function changeWorkspace() {
    localStorage.setItem('active_ws', document.getElementById('workspaceSelect').value);
    location.reload(); 
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
    } else { alert("Workspace already exists!"); }
}

// --- TAB NAVIGATION ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    const activeBtn = document.querySelector(`button[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (tabId === 'tab-plot') renderPlotView();
    if (tabId === 'tab-trait') populateTraitSelector();
}

// --- PARSING & SETUP ---
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    originalFileName = file.name;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const lines = e.target.result.split(/\r?\n/).filter(line => line.trim() !== '');
            if (lines.length < 2) throw new Error("File empty or missing headers.");

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
                sel.innerHTML += tempHeaders.map(h => `<option value="${h}">${h}</option>`).join('');
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
    saveWorkspaceData(); // Async save
    
    document.getElementById('mappingSection').style.display = 'none';
    document.getElementById('uploadStatus').innerHTML = `✅ Loaded <b>${trialData.length}</b> plots.`;
    currentPlotIndex = 0;
    renderPlotView();
}

function addTrait() {
    const traitName = document.getElementById('newTraitName').value.trim();
    if (traitName && !traits.includes(traitName)) {
        traits.push(traitName);
        saveWorkspaceData(); // Async save
        document.getElementById('newTraitName').value = '';
        updateSetupUI();
    }
}

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
    document.getElementById('traitList').innerHTML = traits.map(t => `<li style="padding: 5px 0; border-bottom: 1px solid #eee;">${t}</li>`).join('');
}

function saveScore(plotId, trait, value) {
    if (!scores[plotId]) scores[plotId] = {};
    scores[plotId][trait] = value;
    saveWorkspaceData(); // Fire and forget to IndexedDB
}

// --- MEDIA CAPTURE ---
async function savePhoto(event, plotId) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64Image = e.target.result;
        document.getElementById('photoPreview').innerHTML = `<img src="${base64Image}" style="width: 100px; border-radius: 5px; border: 2px solid #28a745;">`;
        
        const db = await initDB();
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put({
            id: `${activeWS}_${plotId}`,
            image_data: base64Image,
            timestamp: new Date().toISOString()
        });
    };
    reader.readAsDataURL(file);
}

// --- VIEW 1: BY PLOT ---
async function renderPlotView() {
    if (trialData.length === 0 || !colMap.plot) return;
    const currentPlot = trialData[currentPlotIndex];
    const plotId = currentPlot[colMap.plot];
    const safePlotId = String(plotId).replace(/'/g, "\\'");

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

    let inputsHtml = '';
    traits.forEach(trait => {
        const existingVal = (scores[plotId] && scores[plotId][trait]) ? scores[plotId][trait] : '';
        inputsHtml += `
            <label>${trait}</label>
            <input type="number" step="any" value="${existingVal}" oninput="saveScore('${safePlotId}', '${trait}', this.value)" placeholder="Enter ${trait}...">
        `;
    });
    
    // Add Camera UI
    let cameraHtml = `
        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;">
            <label>📸 Capture Plot Anomaly</label>
            <input type="file" accept="image/*" capture="environment" onchange="savePhoto(event, '${safePlotId}')">
            <div id="photoPreview" style="margin-top:10px;"></div>
        </div>
    `;

    document.getElementById('plotInputs').innerHTML = (inputsHtml || `<p style="color:#dc3545; font-weight:bold;">No traits defined.</p>`) + cameraHtml;

    // Fetch existing photo for this plot from IndexedDB
    const db = await initDB();
    const tx = db.transaction('photos', 'readonly');
    const photoReq = tx.objectStore('photos').get(`${activeWS}_${plotId}`);
    photoReq.onsuccess = (e) => {
        if (e.target.result) {
            document.getElementById('photoPreview').innerHTML = `<img src="${e.target.result.image_data}" style="width: 100px; border-radius: 5px; border: 2px solid #28a745;">`;
        }
    };
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

// --- VIEW 2: BY TRAIT ---
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

// --- QC & OUTLIER DETECTION ---
function runQC() {
    const resultsDiv = document.getElementById('qcResults');
    resultsDiv.innerHTML = '';
    let foundOutliers = false;
    const threshold = parseFloat(document.getElementById('qcThreshold').value) || 3.0;

    traits.forEach(trait => {
        let values = [], plotMapping = [];
        Object.keys(scores).forEach(plotId => {
            const rawVal = scores[plotId][trait];
            if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
                const val = parseFloat(rawVal);
                if (!isNaN(val)) { values.push(val); plotMapping.push({ plotId, val }); }
            }
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

// --- EXPORT & SYNC ---
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

async function syncToCloud() {
    const syncBtn = document.getElementById('syncBtn');
    syncBtn.innerText = "⏳ Preparing Sync...";
    
    try {
        const payload = { 
            workspace: activeWS, 
            data: trialData, 
            scores: scores,
            traits: traits
        };
        
        console.log("Payload ready for backend:", payload);
        
        // Simulating the time it takes to push to a server (1 second)
        await new Promise(r => setTimeout(r, 1000));
        
        alert("✅ Data package prepared successfully! (Ready to connect to Python or Google Sheets backend)");
    } catch (err) {
        alert("❌ Sync failed.");
    }
    syncBtn.innerText = "☁️ Sync to Cloud";
}

// --- DATABASE WIPE (Safely clears IDB) ---
async function clearDatabase() {
    let prettyWSName = activeWS.replace(/_/g, ' ');
    
    if (confirm(`WARNING: This deletes ALL data and photos for "${prettyWSName}". Export first?`)) {
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
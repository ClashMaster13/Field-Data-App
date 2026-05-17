// Register Service Worker for Offline Use
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
}

// Database State
let trialData = JSON.parse(localStorage.getItem('b_trialData')) || [];
let traits = JSON.parse(localStorage.getItem('b_traits')) || [];
let scores = JSON.parse(localStorage.getItem('b_scores')) || {}; 
let colMap = JSON.parse(localStorage.getItem('b_colMap')) || {}; 
let originalFileName = localStorage.getItem('b_fileName') || 'Field_Data'; // Tracks filename
let currentPlotIndex = 0;
let tempParsedData = []; 
let tempHeaders = [];

// Initialize App
window.onload = () => {
    updateSetupUI();
    
    // THE UX FIX: If a trial is already in memory, skip the Setup tab entirely!
    if (trialData.length > 0) {
        switchTab('tab-plot'); 
    }
};

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

// --- SETUP, PARSING & MAPPING ---
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Save the original filename to memory
    localStorage.setItem('b_fileName', file.name);
    originalFileName = file.name;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const text = e.target.result;
            const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
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
                tempHeaders.forEach((header, index) => {
                    rowObj[header] = values[index] ? values[index] : '';
                });
                
                if (Object.values(rowObj).some(v => v !== '')) {
                    tempParsedData.push(rowObj);
                }
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

        } catch (error) {
            alert("Error reading CSV: " + error.message);
            console.error(error);
        }
    };
    reader.readAsText(file);
}

function autoSelect(elementId, guesses) {
    const sel = document.getElementById(elementId);
    for (let opt of sel.options) {
        if (guesses.some(g => opt.value.toLowerCase().includes(g))) {
            sel.value = opt.value;
            break;
        }
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

    localStorage.setItem('b_colMap', JSON.stringify(colMap));
    trialData = tempParsedData;
    localStorage.setItem('b_trialData', JSON.stringify(trialData));
    
    document.getElementById('mappingSection').style.display = 'none';
    document.getElementById('uploadStatus').innerHTML = `✅ Mapped and loaded <b>${trialData.length}</b> plots successfully.`;
    currentPlotIndex = 0;
    renderPlotView();
}

function addTrait() {
    const traitName = document.getElementById('newTraitName').value.trim();
    if (traitName && !traits.includes(traitName)) {
        traits.push(traitName);
        localStorage.setItem('b_traits', JSON.stringify(traits));
        document.getElementById('newTraitName').value = '';
        updateSetupUI();
    }
}

function updateSetupUI() {
    // Make it explicitly clear that memory is active
    if (trialData.length > 0) {
        document.getElementById('uploadStatus').innerHTML = `
            <div style="background:#d4edda; color:#155724; padding:12px; border-radius:5px; margin-top:10px; border: 1px solid #c3e6cb;">
                <strong>✅ Active Trial Resumed:</strong> ${originalFileName} <br>
                ${trialData.length} plots are loaded in offline memory. <b>You do not need to upload again.</b>
            </div>
        `;
    } else {
        document.getElementById('uploadStatus').innerHTML = 'No trial loaded.';
    }
    
    // Repopulate the traits list
    const list = document.getElementById('traitList');
    list.innerHTML = traits.map(t => `<li style="padding: 5px 0; border-bottom: 1px solid #eee;">${t}</li>`).join('');
}


// --- CORE SAVING MECHANISM (Instant Save) ---
function saveScore(plotId, trait, value) {
    if (!scores[plotId]) scores[plotId] = {};
    scores[plotId][trait] = value;
    localStorage.setItem('b_scores', JSON.stringify(scores));
}

// --- VIEW 1: BY PLOT ---
function renderPlotView() {
    if (trialData.length === 0 || !colMap.plot) return;
    const currentPlot = trialData[currentPlotIndex];
    const plotId = currentPlot[colMap.plot];

    let metaHtml = `<h3 style="margin-bottom:5px; color:#007bff;">Plot: ${plotId}</h3><div style="font-size:14px; color:#444;">`;
    
    if (colMap.trial && currentPlot[colMap.trial]) {
        metaHtml += `<strong style="color:#6c757d;">Trial:</strong> ${currentPlot[colMap.trial]} <br>`;
    }
    if (colMap.geno && currentPlot[colMap.geno]) {
        metaHtml += `<strong style="color:#28a745;">Genotype:</strong> ${currentPlot[colMap.geno]} <br>`;
    }
    
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
        const safePlotId = String(plotId).replace(/'/g, "\\'");
        inputsHtml += `
            <label>${trait}</label>
            <input type="number" step="any" value="${existingVal}" oninput="saveScore('${safePlotId}', '${trait}', this.value)" placeholder="Enter ${trait}...">
        `;
    });
    document.getElementById('plotInputs').innerHTML = inputsHtml || '<p style="color:#dc3545; font-weight:bold;">No traits defined. Please go back to Setup and add traits.</p>';
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
    } else {
        alert("Plot or Genotype not found.");
    }
}

// --- VIEW 2: BY TRAIT ---
function populateTraitSelector() {
    const sel = document.getElementById('traitSelector');
    sel.innerHTML = '<option value="">-- Choose Trait to Score --</option>' + traits.map(t => `<option value="${t}">${t}</option>`).join('');
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
                <input type="number" step="any" value="${existingVal}" oninput="saveScore('${safePlotId}', '${activeTrait}', this.value)" placeholder="Value..." style="width: 45%; font-size:16px;">
            </div>
        `;
    });
    document.getElementById('traitListView').innerHTML = html;
}

// --- QC & OUTLIER DETECTION (UPGRADED ENGINE) ---
function runQC() {
    const resultsDiv = document.getElementById('qcResults');
    resultsDiv.innerHTML = '';
    let foundOutliers = false;
    
    // Read the threshold from the new UI dropdown
    const threshold = parseFloat(document.getElementById('qcThreshold').value) || 3.0;

    traits.forEach(trait => {
        let values = [];
        let plotMapping = [];
        
        // Safely extract numbers, ignoring completely empty cells
        Object.keys(scores).forEach(plotId => {
            const rawVal = scores[plotId][trait];
            if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
                const val = parseFloat(rawVal);
                if (!isNaN(val)) {
                    values.push(val);
                    plotMapping.push({ plotId, val });
                }
            }
        });

        const n = values.length;
        
        // We need at least 3 data points to do meaningful statistics
        if (n > 2) {
            // 1. Calculate Mean
            const mean = values.reduce((a, b) => a + b, 0) / n;
            
            // 2. Calculate SAMPLE Standard Deviation (divide by N-1 instead of N)
            const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
            const stdDev = Math.sqrt(variance);
            
            if (stdDev > 0) {
                plotMapping.forEach(entry => {
                    const zScore = Math.abs((entry.val - mean) / stdDev);
                    if (zScore >= threshold) {
                        foundOutliers = true;
                        resultsDiv.innerHTML += `
                            <div class="qc-alert qc-danger">
                                <strong>Plot ${entry.plotId}</strong>: ${trait} is <b>${entry.val}</b> (Z-Score: ${zScore.toFixed(2)}). 
                                <br><span style="font-size:12px; color:#555;">Trait Mean: ${mean.toFixed(1)} | Threshold: Z > ${threshold}</span>
                            </div>`;
                    }
                });
            }
        }
    });

    if (!foundOutliers) {
        resultsDiv.innerHTML = `<div class="qc-alert" style="background:#d4edda; color:#155724; border-color:#c3e6cb;">✅ All collected data looks normal. No statistical outliers found above Z=${threshold}.</div>`;
    }
}

// --- EXPORT ---
function exportData() {
    if (trialData.length === 0) return alert("No trial data to export.");

    const baseHeaders = Object.keys(trialData[0]);
    const plotIdCol = colMap.plot || baseHeaders[0];
    
    const allHeaders = [...baseHeaders, ...traits];
    let csvContent = allHeaders.join(',') + "\n";

    trialData.forEach(row => {
        let rowArray = baseHeaders.map(h => {
            let val = row[h] ? String(row[h]) : '';
            if (val.includes(',') || val.includes('"')) {
                val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        });
        
        const plotId = row[plotIdCol];
        
        traits.forEach(trait => {
            rowArray.push((scores[plotId] && scores[plotId][trait]) ? scores[plotId][trait] : '');
        });
        
        csvContent += rowArray.join(',') + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    
    // Generates the clean filename: e.g. "My_Agra_Trial_Scored.csv"
    let cleanName = originalFileName.replace('.csv', '');
    link.setAttribute("download", `${cleanName}_Scored.csv`);
    
    link.style.display = 'none';
    document.body.appendChild(link);
    
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function clearDatabase() {
    if (confirm("WARNING: This will permanently delete all trial data and scores on this device. Did you export first?")) {
        localStorage.removeItem('b_trialData');
        localStorage.removeItem('b_scores');
        localStorage.removeItem('b_colMap');
        localStorage.removeItem('b_fileName');
        location.reload();
    }
}

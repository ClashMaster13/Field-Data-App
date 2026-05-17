// Register Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
}

// Database State
let trialData = JSON.parse(localStorage.getItem('b_trialData')) || [];
let traits = JSON.parse(localStorage.getItem('b_traits')) || [];
let scores = JSON.parse(localStorage.getItem('b_scores')) || {}; // Structure: { plotNum: { traitName: value } }
let currentPlotIndex = 0;

// Initialize App
window.onload = () => {
    updateSetupUI();
    if (trialData.length > 0) renderPlotView();
};

// --- TAB NAVIGATION ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    event.currentTarget.classList.add('active');

    if (tabId === 'tab-plot') renderPlotView();
    if (tabId === 'tab-trait') populateTraitSelector();
}

// --- SETUP & PARSING ---
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n').filter(line => line.trim() !== '');
        const headers = lines[0].split(',').map(h => h.trim());
        
        let parsedData = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            let rowObj = {};
            headers.forEach((header, index) => {
                rowObj[header] = values[index] ? values[index].trim() : '';
            });
            parsedData.push(rowObj);
        }

        trialData = parsedData;
        localStorage.setItem('b_trialData', JSON.stringify(trialData));
        document.getElementById('uploadStatus').innerText = `✅ Loaded ${trialData.length} plots successfully.`;
        currentPlotIndex = 0;
        renderPlotView();
    };
    reader.readAsText(file);
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
    if (trialData.length > 0) document.getElementById('uploadStatus').innerText = `✅ Loaded ${trialData.length} plots.`;
    const list = document.getElementById('traitList');
    list.innerHTML = traits.map(t => `<li>${t}</li>`).join('');
}

// --- CORE SAVING MECHANISM ---
function saveScore(plotId, trait, value) {
    if (!scores[plotId]) scores[plotId] = {};
    scores[plotId][trait] = value;
    localStorage.setItem('b_scores', JSON.stringify(scores));
}

// --- VIEW 1: BY PLOT ---
function renderPlotView() {
    if (trialData.length === 0) return;
    const currentPlot = trialData[currentPlotIndex];
    
    // Find the plot identifier (looks for 'Plot' or 'Entry' column)
    const plotIdCol = Object.keys(currentPlot).find(k => k.toLowerCase() === 'plot' || k.toLowerCase() === 'entry') || Object.keys(currentPlot)[0];
    const plotId = currentPlot[plotIdCol];

    // Build Metadata Card
    let metaHtml = `<h3 style="margin-bottom:5px;">Plot: ${plotId}</h3><div style="font-size:14px; color:#444;">`;
    for (const [key, val] of Object.entries(currentPlot)) {
        if (key !== plotIdCol) metaHtml += `<strong>${key}:</strong> ${val} <br>`;
    }
    metaHtml += `</div>`;
    document.getElementById('plotMetaCard').innerHTML = metaHtml;

    // Build Trait Inputs
    let inputsHtml = '';
    traits.forEach(trait => {
        const existingVal = (scores[plotId] && scores[plotId][trait]) ? scores[plotId][trait] : '';
        inputsHtml += `
            <label>${trait}</label>
            <input type="number" step="any" value="${existingVal}" onchange="saveScore('${plotId}', '${trait}', this.value)">
        `;
    });
    document.getElementById('plotInputs').innerHTML = inputsHtml || '<p>No traits defined. Go to Setup.</p>';
}

function navigatePlot(direction) {
    currentPlotIndex += direction;
    if (currentPlotIndex < 0) currentPlotIndex = 0;
    if (currentPlotIndex >= trialData.length) currentPlotIndex = trialData.length - 1;
    renderPlotView();
}

function jumpTo() {
    const term = document.getElementById('searchPlot').value.toLowerCase();
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
    sel.innerHTML = '<option value="">-- Choose Trait --</option>' + traits.map(t => `<option value="${t}">${t}</option>`).join('');
    document.getElementById('traitListView').innerHTML = '';
}

function renderTraitView() {
    const activeTrait = document.getElementById('traitSelector').value;
    if (!activeTrait || trialData.length === 0) return;

    const plotIdCol = Object.keys(trialData[0]).find(k => k.toLowerCase() === 'plot' || k.toLowerCase() === 'entry') || Object.keys(trialData[0])[0];
    
    let html = '';
    trialData.forEach(row => {
        const plotId = row[plotIdCol];
        const genotype = row['Genotype'] || row['Entry'] || '';
        const existingVal = (scores[plotId] && scores[plotId][activeTrait]) ? scores[plotId][activeTrait] : '';
        
        html += `
            <div class="trait-row">
                <div style="font-weight:bold; width:45%;">Plot ${plotId} <br><span style="font-size:12px; font-weight:normal; color:#666;">${genotype}</span></div>
                <input type="number" step="any" value="${existingVal}" onchange="saveScore('${plotId}', '${activeTrait}', this.value)" placeholder="Enter value...">
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

    traits.forEach(trait => {
        // Collect all numeric values for this trait
        let values = [];
        let plotMapping = [];
        
        Object.keys(scores).forEach(plotId => {
            const val = parseFloat(scores[plotId][trait]);
            if (!isNaN(val)) {
                values.push(val);
                plotMapping.push({ plotId, val });
            }
        });

        if (values.length > 2) {
            const mean = values.reduce((a, b) => a + b) / values.length;
            const stdDev = Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / values.length);
            
            if (stdDev > 0) {
                plotMapping.forEach(entry => {
                    const zScore = Math.abs((entry.val - mean) / stdDev);
                    if (zScore > 3) {
                        foundOutliers = true;
                        resultsDiv.innerHTML += `
                            <div class="qc-alert qc-danger">
                                <strong>Plot ${entry.plotId}</strong>: ${trait} is <b>${entry.val}</b> (Z-Score: ${zScore.toFixed(2)}). Mean is ${mean.toFixed(1)}.
                            </div>`;
                    }
                });
            }
        }
    });

    if (!foundOutliers) resultsDiv.innerHTML = '<div class="qc-alert" style="background:#d4edda; color:#155724; border-color:#c3e6cb;">✅ All collected data looks normal. No outliers found.</div>';
}

// --- EXPORT ---
function exportData() {
    if (trialData.length === 0) return alert("No trial data to export.");

    const baseHeaders = Object.keys(trialData[0]);
    const plotIdCol = baseHeaders.find(k => k.toLowerCase() === 'plot' || k.toLowerCase() === 'entry') || baseHeaders[0];
    
    // Combine Headers
    const allHeaders = [...baseHeaders, ...traits];
    let csvContent = "data:text/csv;charset=utf-8," + allHeaders.join(',') + "\n";

    // Combine Rows
    trialData.forEach(row => {
        let rowArray = baseHeaders.map(h => row[h]);
        const plotId = row[plotIdCol];
        
        traits.forEach(trait => {
            rowArray.push((scores[plotId] && scores[plotId][trait]) ? scores[plotId][trait] : '');
        });
        
        csvContent += rowArray.join(',') + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Exported_Trial_Data.csv");
    document.body.appendChild(link);
    link.click();
}

function clearDatabase() {
    if (confirm("WARNING: This will permanently delete all trial data and scores on this device. Did you export first?")) {
        localStorage.clear();
        location.reload();
    }
}

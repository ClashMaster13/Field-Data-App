// Register the offline Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('Service Worker Registered'))
      .catch(err => console.error('Service Worker Error', err));
}

// Load existing data from the phone's memory when the app opens
let fieldData = JSON.parse(localStorage.getItem('breedingData')) || [];
updateTable();

// Save new plot data
function saveData() {
    const plot = document.getElementById('plotInput').value;
    const height = document.getElementById('heightInput').value;
    const lodging = document.getElementById('lodgingInput').value;

    if (!plot) { alert("Plot number is required!"); return; }

    const record = { plot, height, lodging };
    fieldData.push(record);
    
    // Save back to phone memory
    localStorage.setItem('breedingData', JSON.stringify(fieldData));
    
    // Clear inputs for the next plot and update UI
    document.getElementById('plotInput').value = parseInt(plot) + 1; // Auto-increment plot!
    document.getElementById('heightInput').value = '';
    document.getElementById('lodgingInput').value = '';
    
    updateTable();
}

// Display data in the table
function updateTable() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';
    fieldData.slice(-5).reverse().forEach(row => { // Show last 5 entries
        tbody.innerHTML += `<tr><td>${row.plot}</td><td>${row.height}</td><td>${row.lodging}</td></tr>`;
    });
    document.getElementById('recordCount').innerText = `${fieldData.length} records collected.`;
}

// Export data to CSV for your Streamlit App
function exportCSV() {
    if (fieldData.length === 0) { alert("No data to export."); return; }
    
    // Create CSV Headers
    let csvContent = "data:text/csv;charset=utf-8,Plot,Height,Lodging\n";
    
    // Add Rows
    fieldData.forEach(row => {
        csvContent += `${row.plot},${row.height},${row.lodging}\n`;
    });

    // Trigger Download
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Field_Data_Export.csv");
    document.body.appendChild(link);
    link.click();
}

function clearData() {
    if (confirm("Are you sure? This will wipe the phone's memory. Did you export first?")) {
        fieldData = [];
        localStorage.removeItem('breedingData');
        updateTable();
    }
}
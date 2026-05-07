function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('loadedFileName').textContent = 'Reading ' + file.name + '...';

  const isCSV = file.name.toLowerCase().endsWith('.csv');
  const reader = new FileReader();

  reader.onerror = function() {
    alert('Failed to read file: ' + file.name);
    document.getElementById('loadedFileName').textContent = 'Error reading file';
  };

  reader.onload = function(evt) {
    try {
      let wb;
      if (isCSV) {
        const text = evt.target.result;
        wb = XLSX.read(text, {type:'string', cellDates:true});
      } else {
        const data = new Uint8Array(evt.target.result);
        wb = XLSX.read(data, {type:'array', cellDates:true});
      }

      /* Try ALL sheets, pick the one with the most data rows */
      let bestSheet = null;
      let bestSheetName = '';
      let maxRows = 0;
      
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name];
        const json = XLSX.utils.sheet_to_json(sheet, {defval:''});
        if (json.length > maxRows) {
          maxRows = json.length;
          bestSheet = sheet;
          bestSheetName = name;
        }
      }

      if (!bestSheet || maxRows === 0) {
        alert('No data found in any sheet of ' + file.name + '. Sheets found: ' + wb.SheetNames.join(', '));
        return;
      }

      document.getElementById('loadedFileName').textContent = 'Parsing ' + maxRows + ' rows from sheet "' + bestSheetName + '"...';

      const json = XLSX.utils.sheet_to_json(bestSheet, {defval:''});
      const parsedRows = json.map(r => normalizeRow(r));
      const validRows = parsedRows.filter(r => r.Plant || r.Inspector || r.Category);

      if (validRows.length === 0) {
        alert('Sheet "' + bestSheetName + '" has ' + json.length + ' rows but no valid data.\n\nFound columns: ' + Object.keys(json[0]||{}).join(', ') + '\n\nExpected columns: Plant, Inspector, Category, EquipmentType, Status, Score, Findings, InspectionDate');
        return;
      }

      importToDatabase(validRows, file.name);

    } catch (err) {
      console.error('Import error:', err);
      alert('Import failed: ' + err.message);
      document.getElementById('loadedFileName').textContent = 'Import failed';
    }
  };

  if (isCSV) {
    reader.readAsText(file);
  } else {
    reader.readAsArrayBuffer(file);
  }
}
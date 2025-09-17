require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ExcelJS = require('exceljs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'));
    }
  }
});

// Configuration for remote API
const IS_TEST_MODE = false;

// Validate required environment variables
const API_KEY = process.env.ARCHERY_API_KEY;
if (!API_KEY) {
  console.error('❌ ARCHERY_API_KEY environment variable is required but not set');
  console.error('Please set ARCHERY_API_KEY in your .env file or environment');
  process.exit(1);
}

const REMOTE_API_CONFIG = {
  baseURL: process.env.ARCHERY_API_BASE_URL || 'https://api.archery-records.net', 
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': API_KEY
  }
};

// console.log(`🔧 API Mode: ${IS_TEST_MODE ? 'TEST (Mock API)' : 'PRODUCTION (Real API)'}`);
console.log(`🎯 Target API: ${REMOTE_API_CONFIG.baseURL}`);

// Helper function to normalize boolean values
function normalizeBool(value, defaultValue = false) {
  if (value === undefined || value === '') return defaultValue;
  const str = String(value).toLowerCase().trim();
  if (['true', '1', 'yes', 'y'].includes(str)) return true;
  if (['false', '0', 'no', 'n'].includes(str)) return false;
  return defaultValue;
}

// Helper function to format date for API
function formatDateForAPI(dateStr) {
  if (!dateStr) return null;
  try {
    let date;
    
    // Check if it's an Excel serial number (numeric string)
    if (/^\d+(\.\d+)?$/.test(dateStr)) {
      // Convert Excel serial date to JavaScript date
      // Excel serial date: days since 1900-01-01 (with 1900 leap year bug)
      const excelEpoch = new Date(1900, 0, 1);
      const serialNum = parseFloat(dateStr);
      date = new Date(excelEpoch.getTime() + (serialNum - 2) * 24 * 60 * 60 * 1000);
    } else {
      // Try parsing as regular date string
      date = new Date(dateStr);
    }
    
    if (isNaN(date.getTime())) {
      console.error(`Invalid date: ${dateStr}`);
      return null;
    }
    
    // Use ISO format - user's test shows dd/MM/yyyy CAUSES score.date_shot errors
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T00:00:00`;
  } catch (error) {
    console.error(`Date parsing error for "${dateStr}":`, error.message);
    return null;
  }
}

// Lookup data caching
const lookupCache = {
  rounds: null,
  classes: null,
  categories: null,
  lastFetched: {
    rounds: null,
    classes: null,
    categories: null
  }
};

// Cache timeout (5 minutes)
const CACHE_TIMEOUT = 5 * 60 * 1000;

// Helper function to check if cache is valid
function isCacheValid(lastFetched) {
  return lastFetched && (Date.now() - lastFetched) < CACHE_TIMEOUT;
}

// Fetch and cache rounds data
async function fetchRoundsData() {
  if (isCacheValid(lookupCache.lastFetched.rounds)) {
    return lookupCache.rounds;
  }

  try {
    let allRounds = [];
    let pageNumber = 1;
    const pageSize = 1000;

    while (true) {
      const response = await axios.get(
        `${REMOTE_API_CONFIG.baseURL}/api/rounds`,
        {
          params: { pageNumber, pageSize },
          headers: REMOTE_API_CONFIG.headers,
          timeout: REMOTE_API_CONFIG.timeout
        }
      );

      if (response.data && response.data.length > 0) {
        allRounds = allRounds.concat(response.data);
        
        if (response.data.length < pageSize) {
          break;
        }
        pageNumber++;
      } else {
        break;
      }
    }

    // Filter for active = true AND round_archived = false
    const validRounds = allRounds.filter(round => round.active === true && round.round_archived === false);
    
    lookupCache.rounds = validRounds;
    lookupCache.lastFetched.rounds = Date.now();
    
    console.log(`🎯 Cached ${validRounds.length} valid rounds (from ${allRounds.length} total)`);
    return validRounds;
  } catch (error) {
    console.error('Failed to fetch rounds data:', error);
    return lookupCache.rounds || [];
  }
}

// Fetch and cache classes data
async function fetchClassesData() {
  if (isCacheValid(lookupCache.lastFetched.classes)) {
    return lookupCache.classes;
  }

  try {
    let allClasses = [];
    let pageNumber = 1;
    const pageSize = 1000;

    while (true) {
      const response = await axios.get(
        `${REMOTE_API_CONFIG.baseURL}/api/classes`,
        {
          params: { pageNumber, pageSize },
          headers: REMOTE_API_CONFIG.headers,
          timeout: REMOTE_API_CONFIG.timeout
        }
      );

      if (response.data && response.data.length > 0) {
        allClasses = allClasses.concat(response.data);
        
        if (response.data.length < pageSize) {
          break;
        }
        pageNumber++;
      } else {
        break;
      }
    }

    // Filter for class_archived = false
    const validClasses = allClasses.filter(cls => cls.class_archived === false);
    
    lookupCache.classes = validClasses;
    lookupCache.lastFetched.classes = Date.now();
    
    console.log(`🏹 Cached ${validClasses.length} valid classes (from ${allClasses.length} total)`);
    return validClasses;
  } catch (error) {
    console.error('Failed to fetch classes data:', error);
    return lookupCache.classes || [];
  }
}

// Fetch and cache categories data
async function fetchCategoriesData() {
  if (isCacheValid(lookupCache.lastFetched.categories)) {
    return lookupCache.categories;
  }

  try {
    let allCategories = [];
    let pageNumber = 1;
    const pageSize = 1000;

    while (true) {
      const response = await axios.get(
        `${REMOTE_API_CONFIG.baseURL}/api/categories`,
        {
          params: { pageNumber, pageSize },
          headers: REMOTE_API_CONFIG.headers,
          timeout: REMOTE_API_CONFIG.timeout
        }
      );

      if (response.data && response.data.length > 0) {
        allCategories = allCategories.concat(response.data);
        
        if (response.data.length < pageSize) {
          break;
        }
        pageNumber++;
      } else {
        break;
      }
    }

    // Filter for category_archived = false
    const validCategories = allCategories.filter(cat => cat.category_archived === false);
    
    lookupCache.categories = validCategories;
    lookupCache.lastFetched.categories = Date.now();
    
    console.log(`📂 Cached ${validCategories.length} valid categories (from ${allCategories.length} total)`);
    return validCategories;
  } catch (error) {
    console.error('Failed to fetch categories data:', error);
    return lookupCache.categories || [];
  }
}

// Lookup functions to find IDs from names
async function findRoundId(roundName) {
  if (!roundName) return null;
  
  console.log(`🔍 Looking for round: "${roundName}"`);
  const rounds = await fetchRoundsData();
  console.log(`📋 Fetched ${rounds.length} rounds for lookup`);
  
  const found = rounds.find(round => 
    round.round.toLowerCase() === roundName.toLowerCase()
  );
  
  if (found) {
    console.log(`✅ Found round "${roundName}" → ID: ${found.round_id}`);
  } else {
    console.log(`❌ Round "${roundName}" not found. Similar rounds:`);
    const similar = rounds
      .filter(r => r.round.toLowerCase().includes(roundName.toLowerCase().substring(0, 3)))
      .slice(0, 5)
      .map(r => r.round);
    console.log(similar);
  }
  
  return found ? found.round_id : null;
}

async function findClassId(className) {
  if (!className) return null;
  
  const classes = await fetchClassesData();
  const found = classes.find(cls => 
    cls.bow_class.toLowerCase() === className.toLowerCase()
  );
  
  return found ? found.class_id : null;
}

async function findCategoryId(categoryName) {
  if (!categoryName) return null;
  
  const categories = await fetchCategoriesData();
  const found = categories.find(cat => 
    cat.category.toLowerCase() === categoryName.toLowerCase()
  );
  
  return found ? found.category_id : null;
}

async function validateRecord(record) {
  const errors = [];
  
  if (!record.date) errors.push('date');
  if (!record.score || isNaN(Number(record.score))) errors.push('score');
  if (!record.location) errors.push('location');
  if (!record.status) errors.push('status');
  else {
    const status = Number(record.status);
    if (!(status >= 1 && status <= 4)) errors.push('status (must be 1-4)');
  }
  
  if (record.qualifying === undefined || record.qualifying === '') errors.push('qualifying');
  if (record.record_qualifying === undefined || record.record_qualifying === '') errors.push('record_qualifying');
  if (record.record_status === undefined || record.record_status === '') errors.push('record_status');
  
  // Validate Round (either text lookup or UUID)
  if (record.round_id) {
    // Processed format with UUID - validate UUID exists
    if (!record.round_id || record.round_id === '') errors.push('round_id (UUID required)');
  } else if (record.Round) {
    // Excel format with text - do lookup validation
    const roundId = await findRoundId(record.Round);
    if (!roundId) errors.push(`Round "${record.Round}" not found`);
  } else {
    errors.push('Round or round_id required');
  }
  
  // Validate Class (either text lookup or UUID)
  if (record.class_id) {
    // Processed format with UUID - validate UUID exists
    if (!record.class_id || record.class_id === '') errors.push('class_id (UUID required)');
  } else if (record.Class) {
    // Excel format with text - do lookup validation
    const classId = await findClassId(record.Class);
    if (!classId) errors.push(`Class "${record.Class}" not found`);
  } else {
    errors.push('Class or class_id required');
  }
  
  // Validate Category (either text lookup or UUID)
  if (record.age_group_id) {
    // Processed format with UUID - validate UUID exists
    if (!record.age_group_id || record.age_group_id === '') errors.push('age_group_id (UUID required)');
  } else if (record.Category) {
    // Excel format with text - do lookup validation
    const categoryId = await findCategoryId(record.Category);
    if (!categoryId) errors.push(`Category "${record.Category}" not found`);
  } else {
    errors.push('Category or age_group_id required');
  }
  
  return errors;
}

// Endpoint to process scores (accepts either Excel file or processed scores JSON)
app.post('/api/process-scores', upload.single('excelFile'), async (req, res) => {
  try {
    const { fromDate, memberId, defaultRound, defaultClass, defaultAgeGroup, scores } = req.body;
    
    // Check if we have processed scores JSON (new format) or Excel file (old format)
    if (!req.file && !scores) {
      return res.status(400).json({ error: 'Either Excel file or processed scores data is required' });
    }

    // Auth token now comes from environment variable (API_KEY)

    if (!memberId) {
      return res.status(400).json({ error: 'Member ID is required' });
    }

    if (!fromDate) {
      return res.status(400).json({ error: 'From date is required' });
    }

    let processedRecords = [];

    // Handle new format: processed scores JSON (frontend sends pre-processed data with UUIDs)
    if (scores) {
      console.log(`📊 Processing ${JSON.parse(scores).length} pre-processed scores with UUIDs`);
      console.log(`📅 From date: ${fromDate}`);
      
      processedRecords = JSON.parse(scores);
      console.log('✅ Using pre-processed scores data (skipping Excel processing)');
      
    } else {
      // Handle old format: Excel file processing
      const filePath = req.file.path;
      const originalName = req.file.originalname;
      
      console.log(`📂 Processing uploaded Excel file: ${originalName}`);
      console.log(`📅 From date: ${fromDate}`);

    // Use ExcelJS to read the file securely
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    // Find the 'Scores' worksheet
    const worksheet = workbook.getWorksheet('Scores');
    if (!worksheet) {
      return res.status(400).json({ error: "Excel file must contain a sheet named 'Scores'" });
    }

    // Convert worksheet to array format (similar to XLSX.utils.sheet_to_json with header: 1)
    const jsonData = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const rowData = [];
      // ExcelJS row.values has an undefined first element, so we start from index 1
      for (let i = 1; i < row.values.length; i++) {
        const cell = row.getCell(i);
        let value = cell.value;
        
        // Handle different cell value types
        if (value === null || value === undefined) {
          value = '';
        } else if (typeof value === 'object' && value.result !== undefined) {
          // Handle formula results
          value = value.result;
        } else if (value instanceof Date) {
          // Handle dates - convert to string format similar to xlsx
          value = value.toISOString().split('T')[0]; // YYYY-MM-DD format
        }
        
        rowData.push(value);
      }
      jsonData.push(rowData);
    });
    
    if (jsonData.length === 0) {
      return res.status(400).json({ error: 'Scores sheet is empty' });
    }

    // Parse headers and data
    const headers = jsonData[0].map(h => String(h || '').trim().toLowerCase());
    const rows = jsonData.slice(1);

    // Removed uploaded column tracking - API handles duplicates automatically

    // Convert rows to objects and apply filtering
    const records = [];
    const skippedRecords = [];
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.some(cell => cell != null && String(cell).trim())) continue;

      const record = {};
      headers.forEach((header, idx) => {
        record[header] = row[idx] != null ? String(row[idx]).trim() : '';
      });

      // Apply date filter
      if (fromDate && record.date) {
        const recordDate = new Date(record.date);
        const filterDate = new Date(fromDate);
        if (recordDate < filterDate) {
          skippedRecords.push({ ...record, reason: 'Before date filter' });
          continue;
        }
      }

      // Removed uploaded status filtering - API handles duplicates automatically

      // Add row index for later updating
      record._rowIndex = i + 1; // +1 because header is row 0
      records.push(record);
    }

      console.log(`Found ${records.length} records to process, ${skippedRecords.length} skipped`);
      
      // Set processed records for API submission
      processedRecords = records;
    }

    // At this point, processedRecords contains either:
    // 1. Pre-processed scores from frontend (with UUIDs) - new format
    // 2. Records processed from Excel file - old format
    
    const results = {
      successful: 0,
      failed: 0,
      skipped: processedRecords.length > 0 ? 0 : 0, // Will be updated based on actual processing
      errors: []
    };

    for (let i = 0; i < processedRecords.length; i++) {
      const record = processedRecords[i];
      
      // Add delay between requests to avoid rate limiting (except for first request)
      if (i > 0) {
        console.log(`⏳ Waiting 1 second before next upload to avoid rate limiting...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      try {
        const validationErrors = await validateRecord(record);
        if (validationErrors.length > 0) {
          results.failed++;
          results.errors.push({
            row: record._rowIndex + 1,
            error: `Validation failed: ${validationErrors.join(', ')}`
          });
          continue;
        }

        //
        // {
        //   "category_id": "",
        //     "class_id": "0e44916e-0c8a-498a-b0c5-c18ec794f884",
        //     "archer_id": "4086e2f0-87b6-45e7-8a41-4cfcc78e2009",
        //     "date_shot": "2025-08-31T00:00:00",
        //     "round_id": "864784e8-b76e-44ec-9814-b4a0187388f9",
        //     "type_id": "6ce01cf1-fff1-427d-b38e-085f8164c4d0",
        //     "score": 529,
        //     "status": 1,
        //     "location": "GVGC",
        //     "qualifying": true,
        //     "record_qualifying": false,
        //     "record_status": false,
        //     "golds": 31,
        //     "hits": 71,
        //     "Xs": 0,
        //     "notes": "",
        //     "user_1": "",
        //     "user_2": ""
        // }
        //
        // {
        //   "category_id": "",
        //     "class_id": "0e44916e-0c8a-498a-b0c5-c18ec794f884",
        //     "archer_id": "4086e2f0-87b6-45e7-8a41-4cfcc78e2009",
        //     "date_shot": "2025-08-31T00:00:00",
        //     "round_id": "864784e8-b76e-44ec-9814-b4a0187388f9",
        //     "type_id": "6ce01cf1-fff1-427d-b38e-085f8164c4d0",
        //     "score": 564,
        //     "status": 1,
        //     "location": "GVGC",
        //     "qualifying": true,
        //     "record_qualifying": false,
        //     "record_status": false,
        //     "golds": 39,
        //     "hits": 72,
        //     "Xs": 0,
        //     "notes": "",
        //     "user_1": "",
        //     "user_2": ""
        // }
        //
        // {
        //   "category_id": "",
        //     "class_id": "0e44916e-0c8a-498a-b0c5-c18ec794f884",
        //     "archer_id": "4086e2f0-87b6-45e7-8a41-4cfcc78e2009",
        //     "date_shot": "2025-09-04T00:00:00",
        //     "round_id": "7e0a466d-232e-4cd2-9672-61f5dacf0c69",
        //     "type_id": "6ce01cf1-fff1-427d-b38e-085f8164c4d0",
        //     "score": 429,
        //     "status": 1,
        //     "location": "GVGC",
        //     "qualifying": true,
        //     "record_qualifying": false,
        //     "record_status": false,
        //     "golds": 2,
        //     "hits": 68,
        //     "Xs": 0,
        //     "notes": "",
        //     "user_1": "",
        //     "user_2": ""
        // }
        //

        // {
        //   "category_id": "c570e5d9-d71b-4672-92f6-10976c6e1e3b",
        //     "class_id": "0e44916e-0c8a-498a-b0c5-c18ec794f884",
        //     "archer_id": "4086e2f0-87b6-45e7-8a41-4cfcc78e2009",
        //     "date_shot": "2024-12-13T00:00:00",
        //     "round_id": "7e0a466d-232e-4cd2-9672-61f5dacf0c69",
        //     "score": 429,
        //     "status": 1,
        //     "location": "GVGC",
        //     "qualifying": true,
        //     "record_qualifying": false,
        //     "record_status": false,
        //     "golds": 2,
        //     "hits": 68,
        //     "Xs": 0,
        //     "notes": "",
        //     "user_1": "",
        //     "user_2": ""
        // }
        //
        //
        // Resolve text names to IDs using lookup functions
        // Use processed UUID fields from frontend (or fallback to Excel text lookup for old format)
        const roundId = record.round_id || (record.Round ? await findRoundId(record.Round) : defaultRound);
        const classId = record.class_id || (record.Class ? await findClassId(record.Class) : defaultClass);
        const categoryId = record.age_group_id || (record.Category ? await findCategoryId(record.Category) : defaultAgeGroup);

        // Prepare API payload matching user's successful Postman format exactly
        const payload = {
          category_id: categoryId,
          class_id: classId,
          archer_id: memberId,
          date_shot: formatDateForAPI(record.date),
          round_id: roundId,
          type_id: "6ce01cf1-fff1-427d-b38e-085f8164c4d0",
          score: Number(record.score),
          status: Number(record.status),
          location: record.location,
          qualifying: normalizeBool(record.qualifying, false),
          record_qualifying: normalizeBool(record.record_qualifying, false),
          record_status: normalizeBool(record.record_status, false),
          golds: record['10s'] ? Number(record['10s']) : 0,
          hits: record.hits ? Number(record.hits) : 0,
          Xs: record.xs ? Number(record.xs) : 0,
          notes: record.notes || "",
          user_1: "",
          user_2: ""
        };

        // Remove undefined values
        Object.keys(payload).forEach(key => {
          if (payload[key] === undefined) delete payload[key];
        });

        // Log payload being sent for debugging
        console.log(`🔍 Sending payload for record ${record._rowIndex}:`, JSON.stringify(payload, null, 2));

        // Post to remote API
        const response = await axios.post(
          `${REMOTE_API_CONFIG.baseURL}/api/scores`,
          payload,
          {
            headers: REMOTE_API_CONFIG.headers,
            timeout: REMOTE_API_CONFIG.timeout
          }
        );

        if (response.status >= 200 && response.status < 300) {
          results.successful++;
          console.log(`Successfully uploaded record ${record._rowIndex + 1}`);
        } else {
          throw new Error(`API returned status ${response.status}`);
        }

      } catch (error) {
        results.failed++;
        
        // Enhanced error logging to understand API rejection reasons
        let errorMessage = error.message || 'Unknown error';
        let apiResponseData = null;
        
        if (error.response) {
          apiResponseData = error.response.data;
          errorMessage = `Status ${error.response.status}: ${JSON.stringify(apiResponseData)}`;
          console.error(`❌ API Error Details for record ${record._rowIndex + 1}:`, {
            status: error.response.status,
            statusText: error.response.statusText,
            data: apiResponseData
          });
        } else {
          console.error(`❌ Network/Other Error for record ${record._rowIndex + 1}:`, error.message);
        }
        
        results.errors.push({
          row: record._rowIndex + 1,
          error: errorMessage
        });
        console.error(`Failed to upload record ${record._rowIndex + 1}:`, errorMessage);
      }
    }

    // Removed Excel file creation - API handles duplicates, no need for local tracking

    // Clean up uploaded file (only if file was uploaded)
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('✅ Cleaned up uploaded Excel file');
      } catch (cleanupError) {
        console.warn('Failed to clean up uploaded file:', cleanupError.message);
      }
    }

    res.json({
      success: true,
      results: results,
      message: `Processing complete: ${results.successful} uploaded, ${results.failed} failed, ${results.skipped} skipped`
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Download endpoint for updated Excel files
app.get('/api/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Set headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    // Clean up file after download
    fileStream.on('end', () => {
      setTimeout(() => {
        try {
          fs.unlinkSync(filePath);
          console.log(`Cleaned up downloaded file: ${filename}`);
        } catch (error) {
          console.warn(`Failed to clean up file ${filename}:`, error.message);
        }
      }, 1000); // Wait 1 second before cleanup
    });
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

// Rounds lookup endpoint for validation
app.get('/api/rounds', async (req, res) => {
  try {
    console.log('📋 Fetching rounds lookup data...');
    
    // // In production, this would proxy to the real API endpoint
    // // For now, we'll provide some sample rounds data for testing
    // if (IS_TEST_MODE) {
    //   // Mock rounds data for testing
    //   const mockRounds = [
    //     { id: '732198f7-4550-4ce1-ad91-6b80017cb834', name: 'Portsmouth', distance: '20 yards' },
    //     { id: 'abc12345-1234-5678-9abc-123456789012', name: 'WA 18', distance: '18 meters' },
    //     { id: 'def67890-5678-9012-3456-789012345678', name: 'York', distance: '100/80/60 yards' },
    //     { id: '12345678-abcd-efgh-ijkl-123456789012', name: 'Hereford', distance: '80/60/50 yards' },
    //     { id: 'round123-4567-8901-2345-678901234567', name: 'American', distance: '60/50/40 yards' }
    //   ];
    //  
    //   console.log(`📋 Returning ${mockRounds.length} mock rounds for testing`);
    //   return res.json(mockRounds);
    // }
    
    // In production mode, proxy to the real API with pagination
    try {
      // Fetch all pages to get complete dataset
      let allRounds = [];
      let pageNumber = 1;
      const pageSize = 1000; // Maximum page size
      
      while (true) {
        const response = await axios.get(
          `${REMOTE_API_CONFIG.baseURL}/api/rounds`,
          {
            params: { pageNumber, pageSize },
            headers: REMOTE_API_CONFIG.headers,
            timeout: REMOTE_API_CONFIG.timeout
          }
        );
        
        if (response.data && response.data.length > 0) {
          allRounds = allRounds.concat(response.data);
          
          // Check if there are more pages
          if (response.data.length < pageSize) {
            break; // Last page
          }
          pageNumber++;
        } else {
          break; // No more data
        }
      }
      
      console.log(`📋 Fetched ${allRounds.length} rounds from remote API (${pageNumber} pages)`);
      res.json(allRounds);
    } catch (apiError) {
      console.error('Failed to fetch rounds from remote API:', apiError.message);
      
      // Fallback to empty array - frontend will handle gracefully
      res.status(500).json({
        error: 'Failed to fetch rounds data',
        message: apiError.message
      });
    }
    
  } catch (error) {
    console.error('Rounds lookup error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});
//
// // Classes lookup endpoint for validation
// app.get('/api/lookups/classes', async (req, res) => {
//   try {
//     console.log('🏹 Fetching classes lookup data...');
//    
//     // if (IS_TEST_MODE) {
//     //   // Mock classes data for testing
//     //   const mockClasses = [
//     //     { id: 'class-recurve-123', name: 'Recurve', description: 'Traditional recurve bow' },
//     //     { id: 'class-compound-456', name: 'Compound', description: 'Compound bow with sights' },
//     //     { id: 'class-barebow-789', name: 'Barebow', description: 'Recurve without sights' },
//     //     { id: 'class-longbow-abc', name: 'Longbow', description: 'Traditional longbow' },
//     //     { id: 'class-instinctive-def', name: 'Instinctive', description: 'Instinctive shooting' }
//     //   ];
//      
//       // console.log(`🏹 Returning ${mockClasses.length} mock classes for testing`);
//       // return res.json(mockClasses);
//     // }
//    
//     // In production mode, proxy to the real API with pagination
//     try {
//       // Fetch all pages to get complete dataset
//       let allClasses = [];
//       let pageNumber = 1;
//       const pageSize = 1000; // Maximum page size
//      
//       while (true) {
//         const response = await axios.get(
//           `${REMOTE_API_CONFIG.baseURL}/api/classes`,
//           {
//             params: { pageNumber, pageSize },
//             headers: REMOTE_API_CONFIG.headers,
//             timeout: REMOTE_API_CONFIG.timeout
//           }
//         );
//        
//         if (response.data && response.data.length > 0) {
//           allClasses = allClasses.concat(response.data);
//          
//           // Check if there are more pages
//           if (response.data.length < pageSize) {
//             break; // Last page
//           }
//           pageNumber++;
//         } else {
//           break; // No more data
//         }
//       }
//      
//       console.log(`🏹 Fetched ${allClasses.length} classes from remote API (${pageNumber} pages)`);
//       res.json(allClasses);
//     } catch (apiError) {
//       console.error('Failed to fetch classes from remote API:', apiError.message);
//      
//       res.status(500).json({
//         error: 'Failed to fetch classes data',
//         message: apiError.message
//       });
//     }
//    
//   } catch (error) {
//     console.error('Classes lookup error:', error);
//     res.status(500).json({
//       error: 'Internal server error',
//       message: error.message
//     });
//   }
// });

// Classes endpoint for class configuration dropdown (class_archived = false)
app.get('/api/classes', async (req, res) => {
  try {
    console.log('🏹 Fetching classes data for dropdown...');
    
    // if (IS_TEST_MODE) {
    //   // Mock classes data for testing (some archived, some not)
    //   const mockClasses = [
    //     { id: 'class-recurve-123', name: 'Recurve', description: 'Traditional recurve bow', class_archived: false },
    //     { id: 'class-compound-456', name: 'Compound', description: 'Compound bow with sights', class_archived: false },
    //     { id: 'class-barebow-789', name: 'Barebow', description: 'Recurve without sights', class_archived: false },
    //     { id: 'class-longbow-abc', name: 'Longbow', description: 'Traditional longbow', class_archived: false },
    //     { id: 'class-instinctive-def', name: 'Instinctive', description: 'Instinctive shooting', class_archived: false },
    //     { id: 'class-archived-xyz', name: 'Archived Class', description: 'Should be filtered out', class_archived: true }
    //   ];
    //  
    //   // Filter for class_archived = false
    //   const validClasses = mockClasses.filter(cls => cls.class_archived === false);
    //  
    //   console.log(`🏹 Returning ${validClasses.length} non-archived classes for testing (filtered from ${mockClasses.length} total)`);
    //   return res.json(validClasses);
    // }
    
    // In production mode, proxy to the real API with pagination
    try {
      // Fetch all pages to get complete dataset
      let allClasses = [];
      let pageNumber = 1;
      const pageSize = 1000; // Maximum page size
      
      while (true) {
        const response = await axios.get(
          `${REMOTE_API_CONFIG.baseURL}/api/classes`,
          {
            params: { pageNumber, pageSize },
            headers: REMOTE_API_CONFIG.headers,
            timeout: REMOTE_API_CONFIG.timeout
          }
        );
        
        if (response.data && response.data.length > 0) {
          allClasses = allClasses.concat(response.data);
          
          // Check if there are more pages
          if (response.data.length < pageSize) {
            break; // Last page
          }
          pageNumber++;
        } else {
          break; // No more data
        }
      }
      
      // Filter for class_archived = false
      const validClasses = allClasses.filter(cls => cls.class_archived === false);
      
      console.log(`🏹 Fetched ${allClasses.length} classes from remote API (${pageNumber} pages), filtered to ${validClasses.length} non-archived classes`);
      res.json(validClasses);
    } catch (apiError) {
      console.error('Failed to fetch classes from remote API:', apiError.message);
      
      res.status(500).json({
        error: 'Failed to fetch classes data',
        message: apiError.message
      });
    }
    
  } catch (error) {
    console.error('Classes lookup error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Age Groups lookup endpoint for validation
app.get('/api/lookups/age-groups', async (req, res) => {
  try {
    console.log('👥 Fetching age groups lookup data...');
    
    if (IS_TEST_MODE) {
      // Mock age groups data for testing
      const mockAgeGroups = [
        { id: 'age-adult-123', name: 'Adult', description: '18+ years' },
        { id: 'age-u21-456', name: 'U21', description: 'Under 21 years' },
        { id: 'age-u18-789', name: 'U18', description: 'Under 18 years' },
        { id: 'age-u16-abc', name: 'U16', description: 'Under 16 years' },
        { id: 'age-u14-def', name: 'U14', description: 'Under 14 years' },
        { id: 'age-50plus-ghi', name: '50+', description: '50+ years' }
      ];
      
      console.log(`👥 Returning ${mockAgeGroups.length} mock age groups for testing`);
      return res.json(mockAgeGroups);
    }
    
    // In production mode, proxy to the real API with pagination
    try {
      // Fetch all pages to get complete dataset
      let allAgeGroups = [];
      let pageNumber = 1;
      const pageSize = 1000; // Maximum page size
      
      while (true) {
        const response = await axios.get(
          `${REMOTE_API_CONFIG.baseURL}/api/age-groups`,
          {
            params: { pageNumber, pageSize },
            headers: REMOTE_API_CONFIG.headers,
            timeout: REMOTE_API_CONFIG.timeout
          }
        );
        
        if (response.data && response.data.length > 0) {
          allAgeGroups = allAgeGroups.concat(response.data);
          
          // Check if there are more pages
          if (response.data.length < pageSize) {
            break; // Last page
          }
          pageNumber++;
        } else {
          break; // No more data
        }
      }
      
      console.log(`👥 Fetched ${allAgeGroups.length} age groups from remote API (${pageNumber} pages)`);
      res.json(allAgeGroups);
    } catch (apiError) {
      console.error('Failed to fetch age groups from remote API:', apiError.message);
      
      res.status(500).json({
        error: 'Failed to fetch age groups data',
        message: apiError.message
      });
    }
    
  } catch (error) {
    console.error('Age groups lookup error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Categories lookup endpoint for age configuration dropdown
app.get('/api/categories', async (req, res) => {
  try {
    console.log('📂 Fetching categories data...');
    
    try {
      // Fetch all pages to get complete dataset
      let allCategories = [];
      let pageNumber = 1;
      const pageSize = 1000; // Maximum page size
      
      while (true) {
        const response = await axios.get(
          `${REMOTE_API_CONFIG.baseURL}/api/categories`,
          {
            params: { pageNumber, pageSize },
            headers: REMOTE_API_CONFIG.headers,
            timeout: REMOTE_API_CONFIG.timeout
          }
        );
        
        if (response.data && response.data.length > 0) {
          allCategories = allCategories.concat(response.data);
          
          // Check if there are more pages
          if (response.data.length < pageSize) {
            break; // Last page
          }
          pageNumber++;
        } else {
          break; // No more data
        }
      }
      
      // Filter for active = true AND age_group_archived = false
      const validCategories = allCategories.filter(cat => cat.active === true && cat.category_archived === false);
      
      console.log(`📂 Fetched ${allCategories.length} categories from remote API (${pageNumber} pages), filtered to ${validCategories.length} active non-archived categories`);
      res.json(validCategories);
    } catch (apiError) {
      console.error('Failed to fetch categories from remote API:', apiError.message);
      
      res.status(500).json({
        error: 'Failed to fetch categories data',
        message: apiError.message
      });
    }
    
  } catch (error) {
    console.error('Categories lookup error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Rounds lookup endpoint for round configuration dropdown
app.get('/api/rounds', async (req, res) => {
  try {
    console.log('🎯 Fetching rounds data...');
    
    try {
      // Fetch all pages to get complete dataset
      let allRounds = [];
      let pageNumber = 1;
      const pageSize = 1000; // Maximum page size
      
      while (true) {
        const response = await axios.get(
          `${REMOTE_API_CONFIG.baseURL}/api/rounds`,
          {
            params: { pageNumber, pageSize },
            headers: REMOTE_API_CONFIG.headers,
            timeout: REMOTE_API_CONFIG.timeout
          }
        );
        
        if (response.data && response.data.length > 0) {
          allRounds = allRounds.concat(response.data);
          
          // Check if there are more pages
          if (response.data.length < pageSize) {
            break; // Last page
          }
          pageNumber++;
        } else {
          break; // No more data
        }
      }
      
      // Filter for active = true AND round_archived = false
      const validRounds = allRounds.filter(round => round.active === true && round.round_archived === false);
      
      console.log(`🎯 Fetched ${allRounds.length} rounds from remote API (${pageNumber} pages), filtered to ${validRounds.length} active non-archived rounds`);
      res.json(validRounds);
    } catch (apiError) {
      console.error('Failed to fetch rounds from remote API:', apiError.message);
      
      res.status(500).json({
        error: 'Failed to fetch rounds data',
        message: apiError.message
      });
    }
    
  } catch (error) {
    console.error('Rounds lookup error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve static files (for the frontend)
app.use(express.static('public'));

// Start server
app.listen(PORT, () => {
  console.log(`🏹 Archery Scores Backend running on http://localhost:${PORT}`);
  console.log('Ready to process Excel files and proxy API calls!');
});

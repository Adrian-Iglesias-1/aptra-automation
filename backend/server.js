// server.js - Backend para automatización NCR Atleos
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const puppeteer = require('puppeteer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('uploads'));

// Configuración de multer para archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.includes('excel') || file.mimetype.includes('spreadsheet')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos Excel'));
    }
  }
});

// Variables globales para el estado del procesamiento
let currentProcessing = {
  isProcessing: false,
  currentRecord: null,
  totalRecords: 0,
  processedRecords: 0,
  logs: [],
  records: []
};

// Función para agregar logs
function addLog(message, type = 'info') {
  const log = {
    timestamp: new Date().toISOString(),
    message,
    type
  };
  currentProcessing.logs.push(log);
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Clase para manejar la automatización de NCR Atleos
class NCRAtleosAutomation {
  constructor(credentials) {
    this.credentials = credentials;
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    addLog('Iniciando navegador...');
    this.browser = await puppeteer.launch({
      headless: process.env.NODE_ENV === 'production',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });
  }

  async login() {
    try {
      addLog('Navegando a NCR Atleos...');
      await this.page.goto('https://vision.dcs.latam.ncr.com/cxp-core-webapp/login');
      
      // Esperar a que cargue el formulario de login
      await this.page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });
      
      addLog('Introduciendo credenciales...');
      // Buscar campos de usuario y contraseña
      const usernameSelector = 'input[name="username"], input[type="text"]';
      const passwordSelector = 'input[name="password"], input[type="password"]';
      
      await this.page.type(usernameSelector, this.credentials.username);
      await this.page.type(passwordSelector, this.credentials.password);
      
      // Hacer clic en el botón de login
      await this.page.click('button[type="submit"], input[type="submit"], .btn:contains("LOG-IN")');
      
      // Esperar a que la página se redirija después del login
      await this.page.waitForNavigation({ timeout: 15000 });
      
      addLog('Login exitoso', 'success');
      return true;
    } catch (error) {
      addLog(`Error en login: ${error.message}`, 'error');
      return false;
    }
  }

  async searchAndSelectATM(idNCR) {
    try {
      addLog(`Buscando ATM con ID: ${idNCR}`);
      
      // Buscar el campo de búsqueda en la parte superior
      const searchSelector = 'input[type="text"]:not([name="username"]):not([name="password"])';
      await this.page.waitForSelector(searchSelector, { timeout: 10000 });
      
      // Limpiar y escribir el ID
      await this.page.click(searchSelector);
      await this.page.keyboard.selectAll();
      await this.page.type(searchSelector, idNCR);
      await this.page.keyboard.press('Enter');
      
      // Esperar a que aparezcan los resultados
      await this.page.waitForTimeout(3000);
      
      // Buscar y hacer clic en el ATM encontrado
      const atmSelector = `a:contains("${idNCR}"), tr:contains("${idNCR}")`;
      await this.page.waitForSelector(atmSelector, { timeout: 10000 });
      await this.page.click(atmSelector);
      
      addLog(`ATM ${idNCR} seleccionado exitosamente`, 'success');
      return true;
    } catch (error) {
      addLog(`Error buscando ATM ${idNCR}: ${error.message}`, 'error');
      return false;
    }
  }

  async createIncident(record) {
    try {
      addLog(`Creando incidente para ${record.idNCR}`);
      
      // Buscar y hacer clic en "Create Incident" o botón similar
      const createButtonSelectors = [
        'button:contains("Create")',
        'a:contains("Create")',
        '.btn:contains("Create")',
        'button:contains("New")',
        'a:contains("New")'
      ];
      
      let buttonFound = false;
      for (const selector of createButtonSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 5000 });
          await this.page.click(selector);
          buttonFound = true;
          break;
        } catch (e) {
          continue;
        }
      }
      
      if (!buttonFound) {
        throw new Error('No se encontró el botón para crear incidente');
      }
      
      // Esperar a que aparezca el formulario
      await this.page.waitForTimeout(2000);
      
      // Llenar campos del formulario
      await this.fillIncidentForm(record);
      
      // Guardar el incidente
      await this.saveIncident();
      
      addLog(`Incidente creado exitosamente para ${record.idNCR}`, 'success');
      return true;
    } catch (error) {
      addLog(`Error creando incidente: ${error.message}`, 'error');
      return false;
    }
  }

  async fillIncidentForm(record) {
    try {
      // Mapear tipo de operación a código de estado
      const statusCodeMap = {
        'VANDG': 'VANDG Vandalismo en ATM - Grave',
        'GENERAR': 'Otro código según sea necesario'
      };
      
      // Llenar Status Code
      const statusCode = statusCodeMap[record.tipo] || 'VANDG Vandalismo en ATM - Grave';
      await this.fillField('Status Code', statusCode);
      
      // Llenar fechas
      await this.fillDateField('Start Date', record.startDate);
      await this.fillDateField('End Date', record.endDate);
      
      // Llenar comentarios
      if (record.comentario) {
        await this.fillField('Shared Comment', record.comentario);
      }
      
      // Configurar Action Code (25 Vandalism - Manual Close)
      await this.fillField('Action Code', '25 Vandalism - Manual Close');
      
      addLog('Formulario llenado correctamente');
    } catch (error) {
      addLog(`Error llenando formulario: ${error.message}`, 'error');
      throw error;
    }
  }

  async fillField(fieldName, value) {
    try {
      // Buscar el campo por su label o nombre
      const selectors = [
        `input[name*="${fieldName.toLowerCase().replace(' ', '')}"]`,
        `textarea[name*="${fieldName.toLowerCase().replace(' ', '')}"]`,
        `select[name*="${fieldName.toLowerCase().replace(' ', '')}"]`,
        `input[placeholder*="${fieldName}"]`,
        `label:contains("${fieldName}") + input`,
        `label:contains("${fieldName}") + textarea`,
        `label:contains("${fieldName}") + select`
      ];
      
      for (const selector of selectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 3000 });
          
          const elementType = await this.page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el ? el.tagName.toLowerCase() : null;
          }, selector);
          
          if (elementType === 'select') {
            await this.page.select(selector, value);
          } else {
            await this.page.click(selector);
            await this.page.keyboard.selectAll();
            await this.page.type(selector, value);
          }
          
          addLog(`Campo "${fieldName}" llenado con: ${value}`);
          return;
        } catch (e) {
          continue;
        }
      }
      
      addLog(`Advertencia: No se pudo encontrar el campo "${fieldName}"`, 'warning');
    } catch (error) {
      addLog(`Error llenando campo ${fieldName}: ${error.message}`, 'error');
    }
  }

  async fillDateField(fieldName, dateString) {
    try {
      // Convertir fecha del Excel al formato requerido
      const date = new Date(dateString);
      const formattedDate = date.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
      });
      const formattedTime = date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      });
      
      await this.fillField(fieldName, `${formattedDate} ${formattedTime}`);
    } catch (error) {
      addLog(`Error con fecha ${fieldName}: ${error.message}`, 'error');
    }
  }

  async saveIncident() {
    try {
      // Buscar botón de guardar
      const saveSelectors = [
        'button:contains("Save")',
        'button:contains("SAVE")',
        'input[type="submit"]:contains("Save")',
        '.btn:contains("Save")'
      ];
      
      for (const selector of saveSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 3000 });
          await this.page.click(selector);
          await this.page.waitForTimeout(2000);
          addLog('Incidente guardado');
          return;
        } catch (e) {
          continue;
        }
      }
      
      throw new Error('No se encontró el botón de guardar');
    } catch (error) {
      addLog(`Error guardando incidente: ${error.message}`, 'error');
      throw error;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      addLog('Navegador cerrado');
    }
  }
}

// Endpoints de la API

// Subir archivo Excel
app.post('/api/upload-excel', upload.single('excel'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Leer archivo Excel
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    // Procesar y limpiar datos
    const records = data.map((row, index) => ({
      id: index + 1,
      tipo: row['GENERAR'] || row['VANDG'] || 'VANDG',
      idNCR: row['Id NCR'] || '',
      startDate: row['Start Date'] || '',
      endDate: row['End Date'] || '',
      comentario: row['COMENTARIO'] || '',
      status: 'pending'
    })).filter(record => record.idNCR); // Filtrar registros sin ID

    // Actualizar estado global
    currentProcessing.records = records;
    currentProcessing.totalRecords = records.length;
    currentProcessing.processedRecords = 0;
    currentProcessing.logs = [];
    
    addLog(`Archivo Excel procesado: ${records.length} registros encontrados`, 'success');

    // Eliminar archivo temporal
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      records: records,
      totalRecords: records.length
    });

  } catch (error) {
    addLog(`Error procesando Excel: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// Iniciar procesamiento automático
app.post('/api/start-processing', async (req, res) => {
  try {
    if (currentProcessing.isProcessing) {
      return res.status(400).json({ error: 'Ya hay un procesamiento en curso' });
    }

    const { credentials, config } = req.body;
    
    if (!credentials || !credentials.username || !credentials.password) {
      return res.status(400).json({ error: 'Credenciales requeridas' });
    }

    if (!currentProcessing.records.length) {
      return res.status(400).json({ error: 'No hay registros para procesar' });
    }

    currentProcessing.isProcessing = true;
    currentProcessing.processedRecords = 0;

    res.json({ success: true, message: 'Procesamiento iniciado' });

    // Procesar registros de forma asíncrona
    processRecords(credentials, config);

  } catch (error) {
    addLog(`Error iniciando procesamiento: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// Función para procesar todos los registros
async function processRecords(credentials, config) {
  const automation = new NCRAtleosAutomation(credentials);
  
  try {
    await automation.initialize();
    
    const loginSuccess = await automation.login();
    if (!loginSuccess) {
      throw new Error('Error en el login');
    }

    for (let i = 0; i < currentProcessing.records.length; i++) {
      const record = currentProcessing.records[i];
      currentProcessing.currentRecord = record;
      
      addLog(`Procesando registro ${i + 1}/${currentProcessing.totalRecords}: ${record.idNCR}`);
      
      try {
        // Buscar y seleccionar ATM
        const searchSuccess = await automation.searchAndSelectATM(record.idNCR);
        if (!searchSuccess) {
          record.status = 'error';
          record.error = 'No se pudo encontrar el ATM';
          continue;
        }

        // Crear incidente
        const createSuccess = await automation.createIncident(record);
        if (createSuccess) {
          record.status = 'completed';
          addLog(`✅ Registro ${record.idNCR} procesado exitosamente`, 'success');
        } else {
          record.status = 'error';
          record.error = 'Error creando incidente';
        }

        // Delay entre registros
        if (config && config.delay && i < currentProcessing.records.length - 1) {
          addLog(`Esperando ${config.delay}ms antes del siguiente registro...`);
          await new Promise(resolve => setTimeout(resolve, config.delay));
        }

      } catch (error) {
        record.status = 'error';
        record.error = error.message;
        addLog(`❌ Error procesando ${record.idNCR}: ${error.message}`, 'error');
      }

      currentProcessing.processedRecords++;
    }

    addLog('🎉 Procesamiento completado', 'success');

  } catch (error) {
    addLog(`Error fatal en procesamiento: ${error.message}`, 'error');
  } finally {
    await automation.close();
    currentProcessing.isProcessing = false;
    currentProcessing.currentRecord = null;
  }
}

// Obtener estado del procesamiento
app.get('/api/processing-status', (req, res) => {
  res.json({
    isProcessing: currentProcessing.isProcessing,
    currentRecord: currentProcessing.currentRecord,
    totalRecords: currentProcessing.totalRecords,
    processedRecords: currentProcessing.processedRecords,
    progress: currentProcessing.totalRecords > 0 
      ? Math.round((currentProcessing.processedRecords / currentProcessing.totalRecords) * 100) 
      : 0,
    records: currentProcessing.records
  });
});

// Obtener logs del sistema
app.get('/api/logs', (req, res) => {
  res.json({
    logs: currentProcessing.logs.slice(-50) // Últimos 50 logs
  });
});

// Detener procesamiento
app.post('/api/stop-processing', (req, res) => {
  currentProcessing.isProcessing = false;
  addLog('Procesamiento detenido por el usuario', 'warning');
  res.json({ success: true, message: 'Procesamiento detenido' });
});

// Limpiar datos
app.post('/api/clear-data', (req, res) => {
  currentProcessing = {
    isProcessing: false,
    currentRecord: null,
    totalRecords: 0,
    processedRecords: 0,
    logs: [],
    records: []
  };
  res.json({ success: true, message: 'Datos limpiados' });
});

// Endpoint de salud
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  addLog(`Servidor iniciado en puerto ${PORT}`, 'success');
});

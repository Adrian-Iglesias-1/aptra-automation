const express = require('express');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de multer para subida de archivos
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Estado global para el procesamiento
let processingState = {
  isProcessing: false,
  currentRecord: null,
  processedCount: 0,
  totalCount: 0,
  logs: []
};

// Función para agregar logs
const addLog = (message, type = 'info') => {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, message, type };
  processingState.logs.push(logEntry);
  console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`);
  
  // Mantener solo los últimos 100 logs
  if (processingState.logs.length > 100) {
    processingState.logs = processingState.logs.slice(-100);
  }
};

// Simulación de procesamiento (sin Puppeteer por ahora)
const simulateAptraProcessing = async (config, records) => {
  try {
    addLog('🚀 Iniciando procesamiento simulado...', 'info');
    addLog('🔐 Simulando login a Aptra...', 'info');
    
    // Simular login
    await new Promise(resolve => setTimeout(resolve, 2000));
    addLog('✅ Sesión iniciada correctamente', 'success');

    // Procesar cada registro
    for (let i = 0; i < records.length && processingState.isProcessing; i++) {
      const record = records[i];
      processingState.currentRecord = record;
      processingState.processedCount = i;

      try {
        addLog(`🔍 Procesando ${record.ncrId}...`, 'info');
        
        // Simular búsqueda
        await new Promise(resolve => setTimeout(resolve, 1000));
        addLog(`📝 Creando evento para ${record.ncrId}...`, 'info');
        
        // Simular creación de evento
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Simular éxito (90% de las veces)
        const success = Math.random() > 0.1;
        
        if (success) {
          records[i].status = 'completed';
          records[i].result = 'Evento creado exitosamente';
          addLog(`✅ Evento creado para ${record.ncrId}`, 'success');
        } else {
          records[i].status = 'failed';
          records[i].result = 'Error simulado';
          addLog(`❌ Error simulado con ${record.ncrId}`, 'error');
        }

        // Delay entre registros
        await new Promise(resolve => setTimeout(resolve, config.delayBetweenRecords || 2000));

      } catch (error) {
        records[i].status = 'failed';
        records[i].result = error.message;
        addLog(`❌ Error con ${record.ncrId}: ${error.message}`, 'error');
      }
    }

    processingState.processedCount = records.length;
    addLog('🏁 Procesamiento completado', 'success');

  } catch (error) {
    addLog(`💥 Error general: ${error.message}`, 'error');
  } finally {
    processingState.isProcessing = false;
    processingState.currentRecord = null;
  }
};

// RUTAS DE LA API

// Health check
app.get('/', (req, res) => {
  res.json({ 
    message: 'Aptra Automation API funcionando! 🚀',
    status: 'active',
    timestamp: new Date().toISOString()
  });
});

// Subir y procesar archivo Excel
app.post('/api/upload', upload.single('excel'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió archivo' });
    }

    // Procesar Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Procesar datos (saltear header)
    const processedData = jsonData.slice(1).map((row, index) => ({
      id: index + 1,
      action: row[0] || '',
      ncrId: row[1] || '',
      startDate: row[2] || '',
      endDate: row[3] || '',
      comment: row[4] || '',
      status: 'pending'
    })).filter(record => record.ncrId && record.ncrId.trim() !== '');

    addLog(`📂 Archivo procesado: ${processedData.length} registros`, 'success');

    res.json({
      success: true,
      data: processedData,
      count: processedData.length
    });

  } catch (error) {
    addLog(`❌ Error al procesar Excel: ${error.message}`, 'error');
    res.status(500).json({ error: error.message });
  }
});

// Iniciar procesamiento
app.post('/api/process', async (req, res) => {
  const { config, records } = req.body;

  if (processingState.isProcessing) {
    return res.status(400).json({ error: 'Ya hay un procesamiento en curso' });
  }

  if (!config.username || !config.password) {
    return res.status(400).json({ error: 'Credenciales requeridas' });
  }

  processingState.isProcessing = true;
  processingState.totalCount = records.length;
  processingState.processedCount = 0;
  processingState.logs = [];

  // Procesar en background
  simulateAptraProcessing(config, records).catch(error => {
    addLog(`💥 Error en procesamiento: ${error.message}`, 'error');
  });

  res.json({ success: true, message: 'Procesamiento iniciado' });
});

// Detener procesamiento
app.post('/api/stop', (req, res) => {
  processingState.isProcessing = false;
  addLog('⏹️ Procesamiento detenido por usuario', 'warning');
  res.json({ success: true, message: 'Procesamiento detenido' });
});

// Obtener estado actual
app.get('/api/status', (req, res) => {
  res.json(processingState);
});

// Obtener logs
app.get('/api/logs', (req, res) => {
  res.json({ logs: processingState.logs });
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en puerto ${port}`);
  addLog('🚀 Servidor iniciado correctamente', 'success');
});

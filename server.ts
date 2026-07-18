import express from 'express';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { cleanupAndValidateWithGemini } from './src/services/gemini';

// Firebase Admin SDK — server-side write access (uses service account, not client API key)
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, WriteBatch } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env.local') });
dotenv.config();

// ─── Firebase Admin init ───────────────────────────────────────────────────────
// Init priority:
// 1. Service account JSON file in project root (most reliable — correct PEM newlines)
// 2. FIREBASE_SERVICE_ACCOUNT env var (JSON string — may have \\n escaping issues)
let adminDb: ReturnType<typeof getFirestore> | null = null;
try {
  let serviceAccountObj: object | null = null;

  // Priority 1: look for the service account JSON file in the project root
  const jsonFiles = fs.readdirSync(__dirname).filter(
    f => f.startsWith('classroom-managment') && f.endsWith('.json')
  ).sort(); // sort so we pick consistently; last = newest by name
  if (jsonFiles.length > 0) {
    // Pick the last file (newest key, revoked keys appear first alphabetically)
    const latest = jsonFiles[jsonFiles.length - 1];
    const filePath = path.join(__dirname, latest);
    serviceAccountObj = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log(`📄 Loaded Firebase service account from file: ${latest}`);
  }

  // Priority 2: fallback to env var
  // The private_key in the JSON stored in .env.local has \\n (double-escaped by dotenv on Windows).
  // Strategy: JSON.parse the raw string first (\\n is valid JSON for literal backslash-n),
  // THEN replace \n with real newlines inside the private_key field only.
  if (!serviceAccountObj) {
    const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountRaw) {
      const parsed = JSON.parse(serviceAccountRaw) as any;
      if (parsed.private_key && typeof parsed.private_key === 'string') {
        // Convert literal \n sequences inside the key to real newline characters
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      serviceAccountObj = parsed;
    }
  }

  if (serviceAccountObj) {
    if (getApps().length === 0) {
      initializeApp({ credential: cert(serviceAccountObj as any) });
    }
    adminDb = getFirestore();
    console.log('🔥 Firebase Admin SDK initialized successfully.');
  } else {
    console.warn('⚠️  No Firebase service account found — /api/commit-schedules will be unavailable.');
    console.warn('    Place the service account JSON file in the project root or set FIREBASE_SERVICE_ACCOUNT in .env.local.');
  }
} catch (err) {
  console.error('❌ Firebase Admin init failed:', err);
}


const app = express();
const PORT = process.env.PORT || 3001;

// CORS setup for dev integration
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// JSON parser for general routes (increase limit to support base64 PDF uploads)
app.use(express.json({ limit: '50mb' }));

/**
 * PDF timetable upload and parsing API.
 * Receives the raw binary PDF data, parses it using the deterministic pypdf python parser,
 * runs the optional Gemini AI cleanup layer, and returns structured JSON.
 */
app.post(
  '/api/import-schedule-pdf',
  express.raw({ type: 'application/pdf', limit: '50mb' }),
  async (req: any, res: any) => {
    try {
      let pdfBuffer: Buffer;
      let dbRooms: any[] = [];

      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        const body = req.body || {};
        if (!body.pdfBase64) {
          return res.status(400).json({ success: false, error: 'لم يتم استلام ملف PDF المرمّز بـ base64.' });
        }
        pdfBuffer = Buffer.from(body.pdfBase64, 'base64');
        dbRooms = body.rooms || [];
      } else {
        if (!req.body || req.body.length === 0) {
          return res.status(400).json({ success: false, error: 'لم يتم استلام ملف PDF.' });
        }
        pdfBuffer = req.body;
      }

      // 1. Create a secure temp file for processing
      const tempId = Math.random().toString(36).substring(2, 9);
      const tempPdfPath = path.join(__dirname, `temp_upload_${tempId}.pdf`);
      fs.writeFileSync(tempPdfPath, pdfBuffer);

      // 2. Locate the Python virtual environment executable dynamically based on OS
      const pythonPath = process.platform === 'win32'
        ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
        : path.join(__dirname, '.venv', 'bin', 'python');
      const scriptPath = path.join(__dirname, 'scripts', 'parse_pdf.py');

      if (!fs.existsSync(pythonPath)) {
        if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
        return res.status(500).json({
          success: false,
          error: 'بيئة العمل بايثون (Python Virtual Environment) غير متوفرة في المشروع.'
        });
      }

      // 3. Execute the deterministic spatial layout parser as a child subprocess
      execFile(pythonPath, [scriptPath, tempPdfPath], { timeout: 30000 }, async (error, stdout, stderr) => {
        // Clean up the temp file immediately
        if (fs.existsSync(tempPdfPath)) {
          fs.unlinkSync(tempPdfPath);
        }

        if (error) {
          console.error("❌ Python parser subprocess execution error:", error);
          console.error("Stderr:", stderr);
          return res.status(500).json({
            success: false,
            error: `فشل تحليل ملف PDF: ${stderr || error.message || 'خطأ غير معروف في المحلل'}`
          });
        }

        try {
          const parsedResult = JSON.parse(stdout);
          if (!parsedResult.success) {
            return res.status(422).json({
              success: false,
              error: parsedResult.error || 'فشل في استخراج خلايا جدول المواعيد.'
            });
          }

          // 4. Run Gemini validation & correction layer on the parsed pages
          const geminiValidated = await cleanupAndValidateWithGemini(parsedResult.data, dbRooms);

          return res.json({
            success: true,
            totalPages: parsedResult.totalPages,
            parsedPages: parsedResult.parsedPages,
            data: geminiValidated.pages,
            rawPages: parsedResult.data,
            globalWarnings: geminiValidated.globalWarnings,
            vocabulary: geminiValidated.vocabulary
          });

        } catch (parseErr: any) {
          console.error("❌ Failed to parse Python stdout:", parseErr);
          console.log("Stdout received:", stdout);
          return res.status(500).json({
            success: false,
            error: 'استجابة غير صالحة من نظام تحليل المواعيد.'
          });
        }
      });

    } catch (err: any) {
      console.error("❌ PDF Import API Exception:", err);
      return res.status(500).json({
        success: false,
        error: `حدث خطأ داخلي في الخادم: ${err.message}`
      });
    }
  }
);

/**
 * Commit confirmed schedules to Firebase Firestore (server-side, using Admin SDK).
 * Called by the frontend after the user reviews and confirms the PDF import.
 *
 * Body: { session: ImportSession, schedules: FixedSchedule[], newRooms?: Room[] }
 */
app.post('/api/commit-schedules', async (req: any, res: any) => {
  if (!adminDb) {
    return res.status(503).json({
      success: false,
      error: 'Firebase Admin SDK غير مهيّأ على الخادم. يرجى إضافة FIREBASE_SERVICE_ACCOUNT إلى ملف .env.local'
    });
  }

  try {
    const { session, schedules, newRooms = [] } = req.body;

    if (!session || !schedules) {
      return res.status(400).json({ success: false, error: 'بيانات غير مكتملة: session و schedules مطلوبان.' });
    }

    const semesterId: string = session.semesterId;

    // 1. Delete existing data for this semester (idempotent re-import)
    const [oldSchedulesSnap, oldSessionsSnap] = await Promise.all([
      adminDb.collection('fixedSchedules').where('semesterId', '==', semesterId).get(),
      adminDb.collection('importSessions').where('semesterId', '==', semesterId).get(),
    ]);

    // Delete in batches of 490
    const deleteInBatches = async (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
      for (let i = 0; i < docs.length; i += 490) {
        const batch: WriteBatch = adminDb!.batch();
        docs.slice(i, i + 490).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    };

    await Promise.all([
      deleteInBatches(oldSchedulesSnap.docs),
      deleteInBatches(oldSessionsSnap.docs),
    ]);

    // 2. Write new rooms (merge — don't overwrite existing)
    if (newRooms.length > 0) {
      const roomsBatch: WriteBatch = adminDb.batch();
      newRooms.forEach((room: any) => {
        const { id, ...data } = room;
        roomsBatch.set(adminDb!.collection('rooms').doc(id), data, { merge: true });
      });
      await roomsBatch.commit();
    }

    // 3. Write fixed schedules in batches
    for (let i = 0; i < schedules.length; i += 490) {
      const batch: WriteBatch = adminDb.batch();
      schedules.slice(i, i + 490).forEach((s: any) => {
        const { id, ...data } = s;
        batch.set(adminDb!.collection('fixedSchedules').doc(id), data);
      });
      await batch.commit();
    }

    // 4. Write import session
    const { id: sessionId, ...sessionData } = session;
    await adminDb.collection('importSessions').doc(sessionId).set(sessionData);

    console.log(`✅ Committed ${schedules.length} schedules for semester "${semesterId}" to Firestore.`);
    return res.json({ success: true, committed: schedules.length });

  } catch (err: any) {
    console.error("❌ Commit schedules API Exception:", err);
    return res.status(500).json({
      success: false,
      error: `فشل في حفظ البيانات على Firebase: ${err.message}`
    });
  }
});

// Serve static assets in production mode
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Remix timetable backend server running on http://localhost:${PORT}`);
});


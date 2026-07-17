import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from './supabase'

const apiKey = import.meta.env.VITE_GEMINI_API_KEY
const modelName = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.5-flash'

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const dataUrl = result.split(',')[1]
        resolve(dataUrl)
        return
      }

      reject(new Error('Unable to read document'))
    }
    reader.onerror = () => reject(new Error('Unable to read document'))
    reader.readAsDataURL(file)
  })
}

function getDocumentMimeType(file) {
  if (file.type) {
    return file.type
  }

  if (file.name?.toLowerCase().endsWith('.pdf')) {
    return 'application/pdf'
  }

  return 'application/octet-stream'
}

function manualExtraction(file, isPdf) {
  return {
    vendor: file.name,
    amount: 0,
    date: '',
    description: isPdf ? 'Uploaded PDF document' : 'Uploaded image',
    entryType: 'unknown',
    reference: '',
    notes: isPdf ? 'Gemini invoice reading is not configured yet. PDF intake requires manual review.' : 'Gemini invoice reading is not configured yet.',
  }
}

async function extractWithEdgeFunction(file, projectName) {
  if (!supabase || import.meta.env.MODE === 'test') {
    return null
  }

  const data = await toBase64(file)
  const { data: extracted, error } = await supabase.functions.invoke('extract-invoice', {
    body: {
      fileName: file.name,
      mimeType: getDocumentMimeType(file),
      data,
      projectName,
    },
  })

  if (error) {
    throw new Error(error.message || 'Gemini invoice reader is unavailable')
  }

  return extracted
}

const GEMINI_TIMEOUT_MS = 45000

// Wraps a Gemini call so a hung/slow network request fails after a bounded time instead of
// leaving the UI's loading spinner stuck forever with no feedback.
function withTimeout(promise, ms = GEMINI_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini took too long to respond. Please try again.')), ms)),
  ])
}

export function createGeminiClient() {
  if (!apiKey) {
    return null
  }

  return new GoogleGenerativeAI(apiKey)
}

export async function suggestCategory(description, projectName) {
  if (import.meta.env.MODE === 'test') {
    return null
  }

  const client = createGeminiClient()
  if (!client) {
    return null
  }

  const model = client.getGenerativeModel({ model: modelName })
  const prompt = `You are helping a construction accounting app. Given the transaction description "${description}" and project name "${projectName}", return a short suggested category name and a one-sentence reason. Respond as JSON with fields: category and reason.`

  const result = await withTimeout(model.generateContent(prompt))
  const text = result.response.text()

  try {
    return JSON.parse(text)
  } catch {
    return { category: 'Uncategorized', reason: text }
  }
}

function manualLoanDrawExtraction() {
  return {
    totalAmount: null,
    date: '',
    drawNumber: '',
    lender: '',
    lots: [],
    notes: 'Gemini draw sheet reading is not configured yet. Enter the lot breakdown manually.',
  }
}

function parseJsonResponse(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : text).trim()
  return JSON.parse(candidate)
}

function manualLotCommitmentExtraction() {
  return {
    lot: null,
    address: '',
    commitmentAmount: null,
    notes: 'Gemini commitment letter reading is not configured yet. Enter the lot details manually.',
  }
}

export async function extractLotCommitmentFromDocument(file) {
  const client = createGeminiClient()

  if (import.meta.env.MODE === 'test' || !client) {
    return manualLotCommitmentExtraction()
  }

  const model = client.getGenerativeModel({ model: modelName })
  const imageData = await toBase64(file)
  const prompt = 'You are reading a bank construction loan commitment letter for one lot, part of a loan covering Lot 2, Lot 3, and Lot 4. Extract which lot this letter is for (respond exactly as "Lot 2", "Lot 3", or "Lot 4" if determinable, otherwise null), the property address, and the total committed loan amount for this lot. Respond with raw JSON only — no markdown code fences, no surrounding prose. Return JSON with fields: lot (string or null), address (string or null), commitmentAmount (number or null), notes (string).'

  const result = await withTimeout(model.generateContent([
    {
      inlineData: {
        mimeType: getDocumentMimeType(file),
        data: imageData,
      },
    },
    { text: prompt },
  ]))

  const text = result.response.text()

  try {
    const parsed = parseJsonResponse(text)
    return {
      lot: parsed.lot || null,
      address: parsed.address || '',
      commitmentAmount: parsed.commitmentAmount ?? null,
      notes: parsed.notes || 'Commitment letter intake captured for review.',
    }
  } catch {
    return {
      lot: null,
      address: '',
      commitmentAmount: null,
      notes: 'Could not parse the commitment letter response. Enter the lot details manually.',
    }
  }
}

function manualLotDocumentClassification() {
  return {
    lot: null,
    documentType: 'Other',
    address: '',
    commitmentAmount: null,
    documentDate: null,
    notes: 'Gemini document sorting is not configured yet. Assign the lot and label manually.',
  }
}

export async function classifyLotDocument(file, knownLots = []) {
  const client = createGeminiClient()

  if (import.meta.env.MODE === 'test' || !client) {
    return manualLotDocumentClassification()
  }

  const model = client.getGenerativeModel({ model: modelName })
  const imageData = await toBase64(file)
  const knownLotLines = knownLots
    .filter((entry) => entry.address)
    .map((entry) => `${entry.lot}: ${entry.address}`)
    .join('\n')
  const knownLotContext = knownLotLines
    ? ` These are the known property addresses for each lot in this project — if any address, street number, or unit range in the document matches one of these (even partially, e.g. same street number, or a range like "5556-5558" matching "5556"), use that lot with confidence instead of responding null:\n${knownLotLines}\n`
    : ''
  const prompt = `You are sorting a construction document for a home-building project with 4 lots (Lot 1, Lot 2, Lot 3, Lot 4) inside one subdivision.${knownLotContext} Identify: which lot this document is for if determinable (respond exactly as "Lot 1", "Lot 2", "Lot 3", or "Lot 4"); if the document instead applies to the whole subdivision rather than one specific lot — e.g. a subdivision plat, recorded plat, subdivision-wide grading/drainage drawings, or an HOA/covenants document — respond "Subdivision" instead; otherwise respond null. What type of document it is, as a short label — use "Elevation Drawings" for exterior elevation views, "Architectural Plans" for floor plans/framing/structural drawing sets, "Subdivision Plat" or "Subdivision Drawings" for subdivision-wide drawings, "Contract" for a pre-sale purchase agreement (even if it is named after the buyer rather than the property), or one of "Commitment Letter", "Plot Plan", "Survey", "Permit"; only use "Other" if none of those genuinely fit; the property address if one appears on it; the loan commitment amount if this is a bank commitment letter; and the date printed on the document itself (the document's own date, not today's date), as YYYY-MM-DD if determinable. Respond with raw JSON only — no markdown code fences, no surrounding prose. Return JSON with fields: lot (string or null), documentType (string), address (string or null), commitmentAmount (number or null), documentDate (string YYYY-MM-DD or null), notes (string).`

  const result = await withTimeout(model.generateContent([
    {
      inlineData: {
        mimeType: getDocumentMimeType(file),
        data: imageData,
      },
    },
    { text: prompt },
  ]))

  const text = result.response.text()

  try {
    const parsed = parseJsonResponse(text)
    return {
      lot: parsed.lot || null,
      documentType: parsed.documentType || 'Other',
      address: parsed.address || '',
      commitmentAmount: parsed.commitmentAmount ?? null,
      documentDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.documentDate) ? parsed.documentDate : null,
      notes: parsed.notes || 'Document sorted for review.',
    }
  } catch {
    return {
      lot: null,
      documentType: 'Other',
      address: '',
      commitmentAmount: null,
      documentDate: null,
      notes: 'Could not parse the document classification response. Assign the lot and label manually.',
    }
  }
}

export async function extractLoanDrawFromDocument(file) {
  const client = createGeminiClient()

  if (import.meta.env.MODE === 'test' || !client) {
    return manualLoanDrawExtraction()
  }

  const model = client.getGenerativeModel({ model: modelName })
  const imageData = await toBase64(file)
  const prompt = 'You are reading a construction loan draw sheet from a bank, covering 3 lots (Lot 2, Lot 3, Lot 4). Extract the total draw amount, the draw date, the draw number if present, the lender name, and the dollar amount allocated to each lot. Respond with raw JSON only — no markdown code fences, no surrounding prose. Return JSON with fields: totalAmount (number or null), date (YYYY-MM-DD or null), drawNumber (string or null), lender (string or null), lots (array of objects with fields lot and amount, one entry per lot that has an amount on the sheet), notes (string).'

  const result = await withTimeout(model.generateContent([
    {
      inlineData: {
        mimeType: getDocumentMimeType(file),
        data: imageData,
      },
    },
    { text: prompt },
  ]))

  const text = result.response.text()

  try {
    const parsed = parseJsonResponse(text)
    return {
      totalAmount: parsed.totalAmount ?? null,
      date: parsed.date || '',
      drawNumber: parsed.drawNumber || '',
      lender: parsed.lender || '',
      lots: Array.isArray(parsed.lots) ? parsed.lots : [],
      notes: parsed.notes || 'Draw sheet intake captured for review.',
    }
  } catch {
    return {
      totalAmount: null,
      date: '',
      drawNumber: '',
      lender: '',
      lots: [],
      notes: 'Could not parse the draw sheet response. Enter the lot breakdown manually.',
    }
  }
}

export async function extractTransactionFromImage(file, projectName) {
  const client = createGeminiClient()
  const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')

  if (import.meta.env.MODE === 'test') {
    return manualExtraction(file, isPdf)
  }

  try {
    const edgeExtraction = await extractWithEdgeFunction(file, projectName)
    if (edgeExtraction) {
      return edgeExtraction
    }
  } catch (error) {
    if (!client) {
      throw error
    }
  }

  if (!client) {
    return manualExtraction(file, isPdf)
  }

  const model = client.getGenerativeModel({ model: modelName })
  const imageData = await toBase64(file)
  const prompt = `You are reviewing a check, invoice, or bank statement document for a construction accounting app. Extract the transaction details for project "${projectName}". Return JSON with fields: vendor, amount, date, description, entryType, reference, notes. Use lowercase entryType values: deposit, debit, or unknown. If data is not present, use null. If the file is a PDF, note that it is a PDF and needs manual review if the details are unclear.`

  const result = await withTimeout(model.generateContent([
    {
      inlineData: {
        mimeType: getDocumentMimeType(file),
        data: imageData,
      },
    },
    { text: prompt },
  ]))

  const text = result.response.text()

  try {
    const parsed = JSON.parse(text)
    return {
      ...parsed,
      description: parsed.description || (isPdf ? 'Uploaded PDF document' : 'Uploaded document'),
      notes: parsed.notes || (isPdf ? 'PDF intake captured for review.' : 'Document intake captured for review.'),
    }
  } catch {
    return {
      vendor: 'Unclear source',
      amount: null,
      date: null,
      description: isPdf ? 'Uploaded PDF document' : text,
      entryType: 'unknown',
      reference: null,
      notes: isPdf ? 'PDF intake captured for review.' : 'Could not parse image response',
    }
  }
}

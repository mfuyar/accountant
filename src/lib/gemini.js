import { supabase } from './supabase'

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string' && result.includes(',')) {
        resolve(result.slice(result.indexOf(',') + 1))
      } else {
        reject(new Error('Unable to read document'))
      }
    }
    reader.onerror = () => reject(new Error('Unable to read document'))
    reader.readAsDataURL(file)
  })
}

function getDocumentMimeType(file) {
  if (file.type) return file.type.toLowerCase()
  if (file.name?.toLowerCase().endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

function validateDocument(file) {
  if (!file) throw new Error('Choose a document to analyze')
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Choose a document smaller than 10 MB')
  if (!SUPPORTED_MIME_TYPES.has(getDocumentMimeType(file))) {
    throw new Error('Only PDF, JPEG, PNG, WebP, HEIC, and HEIF documents are supported')
  }
}

async function invokeAnalysis(operation, projectId, payload = {}, file = null) {
  if (!supabase || import.meta.env.MODE === 'test') return null
  if (!Number.isFinite(Number(projectId))) throw new Error('Select a project before analyzing a document')

  const body = { operation, projectId: Number(projectId), ...payload }
  if (file) {
    validateDocument(file)
    Object.assign(body, {
      data: await toBase64(file),
      fileName: String(file.name || 'document').slice(0, 255),
      mimeType: getDocumentMimeType(file),
    })
  }

  const { data, error } = await supabase.functions.invoke('extract-invoice', { body })
  if (error) throw new Error(error.message || 'Document analysis is unavailable')
  if (data?.error) throw new Error(data.error)
  return data
}

function manualExtraction(file, isPdf) {
  return {
    vendor: file.name,
    amount: 0,
    date: '',
    description: isPdf ? 'Uploaded PDF document' : 'Uploaded image',
    entryType: 'unknown',
    reference: '',
    notes: isPdf
      ? 'Automated PDF reading is unavailable. Review this entry manually.'
      : 'Automated document reading is unavailable. Review this entry manually.',
  }
}

export async function suggestCategory(description, projectName, projectId) {
  return invokeAnalysis('suggest-category', projectId, {
    description: String(description || '').slice(0, 2000),
    projectName: String(projectName || 'Project').slice(0, 200),
  })
}

export async function extractLotCommitmentFromDocument(file, projectId) {
  return (await invokeAnalysis('lot-commitment', projectId, {}, file)) || {
    lot: null,
    address: '',
    commitmentAmount: null,
    notes: 'Automated document reading is unavailable. Enter the lot details manually.',
  }
}

export async function classifyLotDocument(file, knownLots = [], projectId) {
  return (await invokeAnalysis('classify-lot-document', projectId, {
    knownLots: knownLots.slice(0, 20).map((entry) => ({
      lot: String(entry?.lot || '').slice(0, 40),
      address: String(entry?.address || '').slice(0, 300),
    })),
  }, file)) || {
    lot: null,
    documentType: 'Other',
    address: '',
    commitmentAmount: null,
    documentDate: null,
    notes: 'Automated document sorting is unavailable. Assign the lot and label manually.',
  }
}

export async function extractLoanDrawFromDocument(file, projectId) {
  return (await invokeAnalysis('loan-draw', projectId, {}, file)) || {
    totalAmount: null,
    date: '',
    drawNumber: '',
    lender: '',
    lots: [],
    notes: 'Automated document reading is unavailable. Enter the lot breakdown manually.',
  }
}

export async function extractTransactionFromImage(file, projectName, projectId) {
  const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')
  return (await invokeAnalysis('invoice', projectId, {
    projectName: String(projectName || 'Project').slice(0, 200),
  }, file)) || manualExtraction(file, isPdf)
}

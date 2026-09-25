import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

// Uploaded PDFs are data. Never execute embedded PDF scripts or evaluated font code.
const loadSafePdf = (options) => pdfjsLib.getDocument({ ...options, enableScripting: false, isEvalSupported: false }).promise

export { pdfjsLib, loadSafePdf }

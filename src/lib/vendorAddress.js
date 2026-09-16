export function extractVendorMailingAddressFromText(documentText) {
  const source = String(documentText || '').replace(/\s+/g, ' ').trim()
  if (!source) return ''

  // Vendor/remittance details normally appear before SOLD TO, BILL TO, or SHIP TO.
  // Restrict local matching to that header area so a job-site/customer address is never used.
  const vendorHeader = source.split(/\b(?:SOLD TO|BILL TO|SHIP TO|CUSTOMER)\b/i)[0].slice(0, 2500)
  const poBox = vendorHeader.match(/\b(P\.?\s*O\.?\s+Box\s+\d+)\s+([A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i)
  if (poBox) return `${poBox[1].replace(/\s+/g, ' ')}\n${poBox[2].replace(/\s+/g, ' ')}`

  const street = vendorHeader.match(/\b(\d{1,6}\s+[A-Za-z0-9 .'-]+\s(?:Street|St\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Boulevard|Blvd\.?|Avenue|Ave\.?|Highway|Hwy\.?|Parkway|Pkwy\.?|Way|Circle|Cir\.?|Suite\s+\d+))\s+([A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i)
  return street ? `${street[1].replace(/\s+/g, ' ')}\n${street[2].replace(/\s+/g, ' ')}` : ''
}

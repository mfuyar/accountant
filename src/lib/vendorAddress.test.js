import { describe, expect, it } from 'vitest'
import { extractVendorMailingAddressFromText } from './vendorAddress'

describe('extractVendorMailingAddressFromText', () => {
  it('extracts the vendor PO box before customer and job addresses', () => {
    expect(extractVendorMailingAddressFromText('PO Box 896730 Charlotte, NC 28289-6730 PHONE 919-776-1500 SOLD TO HABITECH BUILDERS 5520 McNeely Dr, Suite 303 Raleigh, NC 27612')).toBe('PO Box 896730\nCharlotte, NC 28289-6730')
  })

  it('extracts Rushin Plumbing mailing address instead of the Tryon job site', () => {
    const invoiceText = 'Page 1 of 1 Rushin Plumbing LLC PO Box 2314 Smithfield, NC 27577 US rushinplumbing@gmail.com INVOICE BILL TO 4700 Tryon Rd Lot 4 Raleigh, NC 27606 SHIP TO 4700 Tryon Rd Lot 4 Raleigh, NC 27606'
    const address = extractVendorMailingAddressFromText(invoiceText)
    expect(address).toBe('PO Box 2314\nSmithfield, NC 27577')
    expect(address).not.toContain('Tryon')
  })

  it('does not use a bill-to address as the vendor mailing address', () => {
    expect(extractVendorMailingAddressFromText('INVOICE BILL TO Green Fort LLC 200 Rosa Bluff Ct Holly Springs, NC 27540')).toBe('')
  })
})

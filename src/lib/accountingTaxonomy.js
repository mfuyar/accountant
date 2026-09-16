export const MAIN_COST_CATEGORIES = [
  'Land Acquisition',
  'Land Interest & Financing',
  'Soft / Development Costs',
  'Construction Costs',
  'Construction Financing Costs',
  'Legal & Professional Fees',
  'Insurance & Taxes',
  'Other Costs',
]

export const COST_SUBCATEGORIES = {
  'Land Acquisition': ['Original Land Purchase Price', 'Closing Costs', 'Land Attorney Fees', 'Recording Fees', 'Title Fees', 'Taxes at Acquisition', 'Other Land Acquisition'],
  'Land Interest & Financing': ['Land Loan Interest', 'Mortgage Interest', 'HELOC Interest', 'Personal Loan Interest', 'Outsource Loan', 'Bank Fees', 'Loan Origination Fees', 'Loan Closing Costs', 'Extension Fees', 'Other Financing Costs'],
  'Soft / Development Costs': ['Survey', 'Boundary Survey', 'Topographic Survey', 'Engineering', 'Civil Engineering', 'Structural Engineering', 'Architectural Fees', 'Site Plans', 'Subdivision Plans', 'Soil Testing', 'Geotechnical Study', 'Environmental Study', 'Wetland Study', 'Traffic Study', 'Permit Fees', 'Building Permit', 'Grading Permit', 'Utility Permit', 'Water / Sewer Fees', 'Tap Fees', 'Impact Fees', 'City Fees', 'County Fees', 'Inspection Fees', 'Zoning Fees', 'Rezoning', 'Plat Recording', 'Legal Fees', 'Accounting Fees', 'Consulting Fees', 'HOA / Association Setup', 'Insurance before construction', 'Property Taxes during development', 'Utility bills during development', 'Clearing / Preliminary Site Work', 'Temporary Fencing', 'Erosion Control', 'Other Development Costs'],
  'Construction Costs': ['Clearing', 'Grading', 'Foundation', 'Concrete', 'Framing', 'Lumber', 'Roofing', 'Windows', 'Exterior Doors', 'Plumbing', 'Electrical', 'HVAC', 'Insulation', 'Drywall', 'Flooring', 'Cabinets', 'Countertops', 'Tile', 'Painting', 'Siding', 'Exterior Trim', 'Interior Trim', 'Appliances', 'Landscaping', 'Driveway', 'Sidewalk', 'Utility Connections', 'Final Cleanup', 'General Contractor Fees', 'Subcontractors', 'Change Orders', 'Construction Insurance', 'Other Construction Costs'],
  'Construction Financing Costs': ['Construction Loan Interest', 'Construction Loan Fees', 'Inspection / Draw Fees', 'Extension Fees', 'Other Construction Financing'],
  'Legal & Professional Fees': ['Attorney Fees', 'Legal Consultation', 'Contract Review', 'Closing / Title Legal Fees', 'Other Legal Fees'],
  'Insurance & Taxes': ['Property Insurance', 'Builder’s Risk Insurance', 'General Liability Insurance', 'Property Taxes', 'Other Insurance & Taxes'],
  'Other Costs': ['Company Overhead', 'Other Project Cost'],
}

export const inferMainCostCategory = (cost = {}) => {
  if (MAIN_COST_CATEGORIES.includes(cost.mainCategory)) return cost.mainCategory
  const category = String(cost.category || '').toLowerCase()
  const name = String(cost.name || '').toLowerCase()
  if (category.includes('land cost') || /land (purchase|downpayment|principal|closing)/.test(name)) return 'Land Acquisition'
  // A loan can describe how a cost was funded without describing the cost
  // itself. Explicit ground/site-work classification must therefore win over
  // words such as "outsource loan" in the record name.
  if (/ground work|site work|clearing|grading/.test(category)) return cost.phase === 'construction' ? 'Construction Costs' : 'Soft / Development Costs'
  if (/interest|financing|loan fee|heloc|mortgage|out\s*source loan|outsource loan/.test(`${category} ${name}`)) return cost.phase === 'construction' ? 'Construction Financing Costs' : 'Land Interest & Financing'
  if (/legal|attorney/.test(`${category} ${name}`)) return 'Legal & Professional Fees'
  if (/insurance|propert(?:y|ies) tax/.test(`${category} ${name}`)) return 'Insurance & Taxes'
  if (/soft cost/.test(`${category} ${name}`)) return 'Soft / Development Costs'
  if (cost.phase === 'construction') return 'Construction Costs'
  if (['development', 'soft_cost'].includes(cost.phase)) return 'Soft / Development Costs'
  return 'Other Costs'
}

export const inferCostSubcategory = (cost = {}) => {
  if (cost.subcategory) return cost.subcategory
  const source = `${cost.category || ''} ${cost.name || ''} ${cost.details || ''}`.toLowerCase()
  if (/civil engineer/.test(source)) return 'Civil Engineering'
  if (/structural engineer/.test(source)) return 'Structural Engineering'
  if (/engineer/.test(source)) return 'Engineering'
  if (/ground work|site work|narr[ao]n|clearing|grading/.test(source)) return 'Clearing / Preliminary Site Work'
  if (/out\s*source loan|outsource loan/.test(source)) return 'Outsource Loan'
  if (/boundary survey/.test(source)) return 'Boundary Survey'
  if (/topographic|topo survey/.test(source)) return 'Topographic Survey'
  if (/survey/.test(source)) return 'Survey'
  if (/building permit/.test(source)) return 'Building Permit'
  if (/grading permit/.test(source)) return 'Grading Permit'
  if (/permit/.test(source)) return 'Permit Fees'
  if (/architect/.test(source)) return 'Architectural Fees'
  if (/site plan/.test(source)) return 'Site Plans'
  if (/legal|attorney/.test(source)) return 'Attorney Fees'
  if (/accounting/.test(source)) return 'Accounting Fees'
  if (/consult/.test(source)) return 'Consulting Fees'
  if (/soft cost/.test(source)) return 'Other Development Costs'
  return cost.category || 'Other Development Costs'
}

export const payerLabel = (cost, owners = []) => {
  if (cost.payerType === 'owner') return owners.find((owner) => String(owner.id) === String(cost.payerOwnerId || cost.ownerId))?.name || 'Owner'
  return ({ company: 'Green Fort LLC', construction_loan: 'Construction Loan', other_company: cost.payerName || 'Other Company', third_party: cost.payerName || 'Other / Third Party' }[cost.payerType]
    || owners.find((owner) => String(owner.id) === String(cost.ownerId))?.name
    || 'Not specified')
}

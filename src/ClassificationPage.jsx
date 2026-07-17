import { useMemo, useState } from 'react'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function ClassificationPage({ owners, categories, reviewItems, onApproveReviewItem, onRemoveReviewItem, onBack }) {
  const [selectedOwnerId, setSelectedOwnerId] = useState(() => {
    const greenfortOwner = (owners || []).find((owner) => owner.name.toLowerCase() === 'greenfort')
    return greenfortOwner?.id ?? owners?.[0]?.id ?? 1
  })
  const [selectedCategory, setSelectedCategory] = useState('')
  const [notes, setNotes] = useState('')
  const [approvalError, setApprovalError] = useState('')

  const ownerOptions = useMemo(() => owners || [], [owners])
  const categoryOptions = useMemo(() => categories || [], [categories])

  const filteredReviewItems = useMemo(() => {
    return (reviewItems || []).filter((item) => {
      const matchesOwner = selectedOwnerId === 'all' ? true : Number(item.ownerId ?? selectedOwnerId) === Number(selectedOwnerId)
      return matchesOwner
    })
  }, [reviewItems, selectedOwnerId])

  const greenfortTotal = useMemo(() => {
    return filteredReviewItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  }, [filteredReviewItems])

  const handleApprove = async (itemId) => {
    if (!selectedCategory || selectedCategory === 'all') {
      setApprovalError('Select one specific cost category before approving this item.')
      return
    }
    const categoryId = selectedCategory
    if (!categoryOptions.some((category) => Number(category.id) === Number(categoryId))) {
      setApprovalError('The selected category is no longer available. Choose another category.')
      return
    }
    setApprovalError('')
    try {
      if (notes.trim()) {
        await onApproveReviewItem(itemId, Number(categoryId), notes.trim())
      } else {
        await onApproveReviewItem(itemId, Number(categoryId))
      }
    } catch (error) {
      setApprovalError(`The approval could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleRemove = async (itemId) => {
    setApprovalError('')
    try {
      await onRemoveReviewItem(itemId)
    } catch (error) {
      setApprovalError(`The item could not be removed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Classification</p>
          <h1>Classify costs by owner and category</h1>
          <p className="hero-copy">Review each cost item, assign an owner, and classify it by the appropriate project-cost phase.</p>
        </div>
        <button type="button" className="action-button" onClick={onBack}>Back to dashboard</button>
      </header>

      <section className="section-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Filters</p>
              <h2>Review settings</h2>
            </div>
          </div>
          <div className="owner-form">
            <label>
              Owner
              <select aria-label="Owner" value={selectedOwnerId} onChange={(event) => setSelectedOwnerId(event.target.value)}>
                <option value="all">All owners</option>
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name}</option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select aria-label="Category" value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
                <option value="">Select category</option>
                <option value="all">All</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>{category.name} ({category.phase})</option>
                ))}
              </select>
            </label>
            <label>
              Notes
              <textarea aria-label="Classification notes" rows="4" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Classification queue</p>
              <h2>Pending review</h2>
            </div>
          </div>
          <div className="table-row total-row">
            <div>
              <strong>Greenfort total</strong>
              <p>Filtered costs for the selected view</p>
            </div>
            <div>{currency.format(greenfortTotal)}</div>
          </div>
          <div className="table-card">
            {approvalError ? <p className="validation-error" role="alert">{approvalError}</p> : null}
            {filteredReviewItems.length === 0 ? (
              <div className="table-row">
                <div>
                  <strong>No pending review items</strong>
                  <p>Uploaded statements will appear here once they are ready for classification.</p>
                </div>
              </div>
            ) : null}
            {filteredReviewItems.map((item) => (
              <div key={item.id} className="table-row">
                <div>
                  <strong>{item.vendor || item.sourceName || 'Review item'}</strong>
                  <p>{item.description || 'Imported statement'} • {item.date || 'Date pending'}</p>
                  {notes ? <small>{notes}</small> : null}
                </div>
                <div>{currency.format(item.amount || 0)}</div>
                <div className="owner-form">
                  <button type="button" className="action-button" onClick={() => handleApprove(item.id)}>Approve and save</button>
                  <button type="button" className="action-button" onClick={() => handleRemove(item.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export default ClassificationPage

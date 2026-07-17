const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const invoiceSchema = {
  type: 'object',
  properties: {
    vendor: { type: 'string' },
    amount: { type: 'number' },
    date: { type: 'string', description: 'Invoice date in YYYY-MM-DD format, or an empty string when missing' },
    description: { type: 'string' },
    entryType: { type: 'string', enum: ['deposit', 'debit', 'unknown'] },
    reference: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['vendor', 'amount', 'date', 'description', 'entryType', 'reference', 'notes'],
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured')
    }

    const { data, fileName, mimeType, projectName } = await request.json()
    if (!data || !mimeType) {
      return new Response(JSON.stringify({ error: 'Invoice file data and MIME type are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash'
    const prompt = `Read this invoice or accounting document for project "${projectName || 'Project'}". Extract the vendor, total amount, invoice date, concise cost description, transaction type, invoice/reference number, and any review notes. The source file is "${fileName || 'invoice'}". Do not invent missing values; use an empty string for missing text and 0 for a missing amount.`
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType, data } },
              { text: prompt },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: invoiceSchema,
          },
        }),
      },
    )

    const responseBody = await geminiResponse.json()
    if (!geminiResponse.ok) {
      throw new Error(responseBody?.error?.message || 'Gemini could not read the invoice')
    }

    const text = responseBody?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      throw new Error('Gemini returned no invoice data')
    }

    return new Response(text, {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Invoice extraction failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

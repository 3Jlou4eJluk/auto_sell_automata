export type Rounding = '1' | '0.01' | '10'

export interface RepriceParams {
  discount: number
  markdownMarkup: number
  costMarkup: number
  rounding: Rounding
}

export interface RepriceSummary {
  sheet: string
  total: number
  by_status: Record<string, number>
  review_count: number
  warnings?: string[]
  params: {
    discount: number
    markdown_markup: number
    cost_markup: number
    rounding: Rounding
  }
}

export interface RepriceRow {
  row: number
  num: number | null
  article: string | null
  brand: string | null
  name: string | null
  qty: number | null
  cost: number | null
  min_price: number | null
  effective_min_price: number | null
  supplier: string | null
  markdown: number | null
  new_price: number | null
  delta: number | null
  status: string
  for_review: boolean
  warehouse: string | null
}

export interface ApiRepriceResponse {
  summary: RepriceSummary
  rows: RepriceRow[]
  output_filename: string
  output_xlsx_base64: string
}

export interface RepriceResult {
  summary: RepriceSummary
  rows: RepriceRow[]
  outputFilename: string
  outputBase64: string
}

export interface ApiErrorResponse {
  detail: string
}

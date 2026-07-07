import { create } from 'zustand'
import type {
  ApiErrorResponse,
  ApiRepriceResponse,
  RepriceParams,
  RepriceResult,
} from './types'

export const DEFAULT_PARAMS: RepriceParams = {
  discount: 0.04,
  markdownMarkup: 0.05,
  costMarkup: 0.04,
  rounding: '1',
}

interface RepriceStore {
  file: File | null
  params: RepriceParams
  result: RepriceResult | null
  loading: boolean
  error: string | null
  openFile: (file: File) => Promise<void>
  recalc: () => Promise<void>
  download: () => void
  reset: () => void
  setParams: (params: Partial<RepriceParams>) => void
}

let requestSeq = 0

function isApiError(data: unknown): data is ApiErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'detail' in data &&
    typeof (data as { detail: unknown }).detail === 'string'
  )
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function postReprice(
  file: File,
  params: RepriceParams,
): Promise<RepriceResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('discount', String(params.discount))
  formData.append('markdown_markup', String(params.markdownMarkup))
  formData.append('cost_markup', String(params.costMarkup))
  formData.append('rounding', params.rounding)

  const response = await fetch('/api/reprice', {
    method: 'POST',
    body: formData,
  })

  const data = await readResponseJson(response)

  if (!response.ok) {
    throw new Error(
      isApiError(data)
        ? data.detail
        : `Сервер вернул ошибку ${response.status}`,
    )
  }

  const apiResult = data as ApiRepriceResponse

  return {
    summary: apiResult.summary,
    rows: apiResult.rows,
    outputFilename: apiResult.output_filename,
    outputBase64: apiResult.output_xlsx_base64,
  }
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export const useRepriceStore = create<RepriceStore>((set, get) => ({
  file: null,
  params: DEFAULT_PARAMS,
  result: null,
  loading: false,
  error: null,

  openFile: async (file: File) => {
    const requestId = (requestSeq += 1)
    const params = get().params

    set({ file, loading: true, error: null })

    try {
      const result = await postReprice(file, params)
      if (requestId === requestSeq) {
        set({ result, loading: false, error: null })
      }
    } catch (error) {
      if (requestId === requestSeq) {
        set({
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось пересчитать прайс',
        })
      }
    }
  },

  recalc: async () => {
    const { file, params } = get()

    if (!file) {
      set({ error: 'Сначала откройте файл проценки.' })
      return
    }

    const requestId = (requestSeq += 1)
    set({ loading: true, error: null })

    try {
      const result = await postReprice(file, params)
      if (requestId === requestSeq) {
        set({ result, loading: false, error: null })
      }
    } catch (error) {
      if (requestId === requestSeq) {
        set({
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось пересчитать прайс',
        })
      }
    }
  },

  download: () => {
    const result = get().result
    if (!result) {
      return
    }

    const blob = base64ToBlob(result.outputBase64)
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = result.outputFilename || 'price_repriced.xlsx'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(href), 0)
  },

  reset: () => {
    requestSeq += 1
    set({
      file: null,
      params: DEFAULT_PARAMS,
      result: null,
      loading: false,
      error: null,
    })
  },

  setParams: (params: Partial<RepriceParams>) => {
    set((state) => ({ params: { ...state.params, ...params } }))
  },
}))

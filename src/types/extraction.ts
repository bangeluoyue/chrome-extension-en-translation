export interface ExtractedArticle {
  title: string
  author: string
  url: string
  markdown: string
}

export interface ExtractArticleRequest {
  type: 'EXTRACT_ARTICLE'
}

export type ExtractArticleResponse =
  | {
      ok: true
      data: ExtractedArticle
    }
  | {
      ok: false
      error: string
    }
